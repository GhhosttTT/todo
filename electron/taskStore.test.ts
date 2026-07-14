import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { RevisionConflictError, TaskStore } from './taskStore';

const directories: string[] = [];
function createStore(): TaskStore {
  const directory = mkdtempSync(join(tmpdir(), 'todo-store-'));
  directories.push(directory);
  return new TaskStore(join(directory, 'state.json'));
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('TaskStore', () => {
  it('defaults to the All view', () => {
    const store = createStore();
    expect(store.load().settings.selectedView).toBe('all');
  });

  it('keeps the widget height fixed when loading saved bounds', () => {
    const store = createStore();
    writeFileSync(store.stateFile, JSON.stringify({
      schemaVersion: 2,
      revision: 1,
      tasks: [],
      settings: { windowBounds: { x: 10, y: 20, width: 760, height: 1200 } },
    }), 'utf8');

    expect(store.load().settings.windowBounds).toMatchObject({ width: 760, height: 620 });
  });

  it('uses light theme by default and persists a dark theme choice', async () => {
    const store = createStore();
    expect(store.load().settings.theme).toBe('light');

    await store.updateSettings(0, { theme: 'dark' });
    expect(new TaskStore(store.stateFile).load().settings.theme).toBe('dark');
  });

  it('persists mutations and reloads them', async () => {
    const store = createStore();
    store.load();
    const changed = await store.createTask(0, { title: 'Persistent task', dueDate: '2026-07-13', remindAt: '2026-07-13T09:30:00.000Z' });
    expect(changed.revision).toBe(1);

    const reloaded = new TaskStore(store.stateFile).load();
    expect(reloaded.tasks[0].title).toBe('Persistent task');
    expect(reloaded.tasks[0].remindAt).toBe('2026-07-13T09:30:00.000Z');
    expect(reloaded.revision).toBe(1);
  });

  it('marks reminders notified and resets notification state when reminder time changes', async () => {
    const store = createStore();
    store.load();
    const created = await store.createTask(0, { title: 'Reminder', remindAt: '2026-07-13T09:30:00.000Z' });
    const task = created.tasks[0];

    const notified = await store.markReminderNotified(task.id, '2026-07-13T09:30:00.000Z');
    expect(notified.tasks[0].notifiedAt).toEqual(expect.any(String));

    const changed = await store.updateTask(notified.revision, { id: task.id, remindAt: '2026-07-13T10:30:00.000Z' });
    expect(changed.tasks[0].remindAt).toBe('2026-07-13T10:30:00.000Z');
    expect(changed.tasks[0].notifiedAt).toBeNull();
  });

  it('rejects stale revisions', async () => {
    const store = createStore();
    store.load();
    await store.createTask(0, { title: 'First' });
    await expect(store.createTask(0, { title: 'Stale' })).rejects.toBeInstanceOf(RevisionConflictError);
  });

  it('uses a valid backup when the main file is damaged', async () => {
    const store = createStore();
    store.load();
    await store.createTask(0, { title: 'One' });
    await store.createTask(1, { title: 'Two' });
    writeFileSync(store.stateFile, '{broken', 'utf8');
    const recovered = new TaskStore(store.stateFile).load();
    expect(recovered.tasks.map(({ title }) => title)).toEqual(['One']);
    expect(recovered.recoveryMessage).toContain('备份');
  });

  it('opens future schemas read-only without overwriting them', () => {
    const store = createStore();
    writeFileSync(store.stateFile, JSON.stringify({ schemaVersion: 99, revision: 2, tasks: [], settings: {} }), 'utf8');
    const before = readFileSync(store.stateFile, 'utf8');
    const loaded = store.load();
    expect(loaded.readOnly).toBe(true);
    expect(readFileSync(store.stateFile, 'utf8')).toBe(before);
  });
});
