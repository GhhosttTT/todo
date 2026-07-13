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
  it('uses light theme by default and persists a dark theme choice', async () => {
    const store = createStore();
    expect(store.load().settings.theme).toBe('light');

    await store.updateSettings(0, { theme: 'dark' });
    expect(new TaskStore(store.stateFile).load().settings.theme).toBe('dark');
  });

  it('persists mutations and reloads them', async () => {
    const store = createStore();
    store.load();
    const changed = await store.createTask(0, { title: 'Persistent task', dueDate: '2026-07-13' });
    expect(changed.revision).toBe(1);

    const reloaded = new TaskStore(store.stateFile).load();
    expect(reloaded.tasks[0].title).toBe('Persistent task');
    expect(reloaded.revision).toBe(1);
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
