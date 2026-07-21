import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Task } from '../src/types';

const notificationMock = vi.hoisted(() => {
  const instances: Array<{
    options: { title: string; body: string };
    handlers: Map<string, () => void>;
    show: ReturnType<typeof vi.fn>;
  }> = [];

  class MockNotification {
    handlers = new Map<string, () => void>();
    show = vi.fn();

    constructor(public options: { title: string; body: string }) {
      instances.push(this);
    }

    static isSupported(): boolean {
      return true;
    }

    on(event: string, handler: () => void): void {
      this.handlers.set(event, handler);
    }
  }

  return { instances, MockNotification };
});

vi.mock('electron', () => ({
  Notification: notificationMock.MockNotification,
  nativeImage: { createEmpty: () => ({}) },
}));

import { ReminderScheduler } from './reminderScheduler';

function task(remindAt: string, overrides: Partial<Task> = {}): Task {
  return {
    id: 'reminder-task',
    title: '测试到期提醒',
    notes: '保存任务后应按时通知',
    dueDate: null,
    remindAt,
    notifiedAt: null,
    completedAt: null,
    createdAt: '2026-07-21T01:00:00.000Z',
    updatedAt: '2026-07-21T01:00:00.000Z',
    sortOrder: 0,
    ...overrides,
  };
}

describe('ReminderScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-21T02:00:00.000Z'));
    notificationMock.instances.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('shows one notification when a saved reminder reaches its time', async () => {
    const tasks = [task('2026-07-21T02:00:05.000Z')];
    const markReminderNotified = vi.fn(async () => {
      tasks[0].notifiedAt = new Date().toISOString();
      return { tasks };
    });
    const onChanged = vi.fn();
    const onOpenTask = vi.fn();
    const store = { getSnapshot: () => ({ tasks }), markReminderNotified };
    const scheduler = new ReminderScheduler(store as never, onChanged, onOpenTask);

    scheduler.scheduleAll();
    await vi.advanceTimersByTimeAsync(4_999);
    expect(notificationMock.instances).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1);
    expect(notificationMock.instances).toHaveLength(1);
    expect(notificationMock.instances[0].options).toMatchObject({
      title: 'Todo 提醒',
      body: '测试到期提醒\n保存任务后应按时通知',
    });
    expect(notificationMock.instances[0].show).toHaveBeenCalledOnce();
    expect(markReminderNotified).toHaveBeenCalledWith('reminder-task', '2026-07-21T02:00:05.000Z');
    expect(onChanged).toHaveBeenCalledOnce();

    notificationMock.instances[0].handlers.get('click')?.();
    expect(onOpenTask).toHaveBeenCalledOnce();
  });

  it('reschedules after an edited reminder time and does not fire the old timer', async () => {
    const tasks = [task('2026-07-21T02:01:00.000Z')];
    const store = {
      getSnapshot: () => ({ tasks }),
      markReminderNotified: vi.fn(async () => {
        tasks[0].notifiedAt = new Date().toISOString();
        return { tasks };
      }),
    };
    const scheduler = new ReminderScheduler(store as never, vi.fn(), vi.fn());

    scheduler.scheduleAll();
    tasks[0].remindAt = '2026-07-21T02:00:05.000Z';
    scheduler.scheduleAll();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(notificationMock.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(55_000);
    expect(notificationMock.instances).toHaveLength(1);
  });

  it('does not notify completed or already-notified tasks', async () => {
    const tasks = [
      task('2026-07-21T02:00:01.000Z', { id: 'completed', completedAt: '2026-07-21T01:30:00.000Z' }),
      task('2026-07-21T02:00:01.000Z', { id: 'notified', notifiedAt: '2026-07-21T01:30:00.000Z' }),
    ];
    const scheduler = new ReminderScheduler({ getSnapshot: () => ({ tasks }) } as never, vi.fn(), vi.fn());

    scheduler.scheduleAll();
    await vi.advanceTimersByTimeAsync(2_000);

    expect(notificationMock.instances).toHaveLength(0);
  });
});
