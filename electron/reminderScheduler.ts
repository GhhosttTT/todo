import { Notification } from 'electron';
import type { Task } from '../src/types';
import type { TaskStore } from './taskStore';

const MAX_TIMEOUT_MS = 2_147_483_647;

function shouldScheduleReminder(task: Task): task is Task & { remindAt: string } {
  return Boolean(task.remindAt && !task.completedAt && !task.notifiedAt && Number.isFinite(Date.parse(task.remindAt)));
}

export class ReminderScheduler {
  private timers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly store: TaskStore,
    private readonly onChanged: () => void,
    private readonly onOpenTask: () => void,
  ) {}

  scheduleAll(): void {
    this.clear();
    const now = Date.now();
    for (const task of this.store.getSnapshot().tasks) {
      if (!shouldScheduleReminder(task)) continue;
      const dueAt = Date.parse(task.remindAt);
      const delay = Math.max(0, dueAt - now);
      const timer = setTimeout(() => {
        void this.fire(task.id, task.remindAt);
      }, Math.min(delay, MAX_TIMEOUT_MS));
      this.timers.set(task.id, timer);
    }
  }

  clear(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  private async fire(id: string, remindAt: string): Promise<void> {
    this.timers.delete(id);
    const task = this.store.getSnapshot().tasks.find((item) => item.id === id);
    if (!task || !shouldScheduleReminder(task) || task.remindAt !== remindAt) return;

    const dueAt = Date.parse(task.remindAt);
    if (dueAt > Date.now()) {
      this.scheduleAll();
      return;
    }

    if (!Notification.isSupported()) return;

    const notification = new Notification({
      title: 'Todo 提醒',
      body: task.notes ? `${task.title}\n${task.notes.slice(0, 120)}` : task.title,
      silent: false,
    });
    notification.on('click', this.onOpenTask);
    notification.show();

    await this.store.markReminderNotified(task.id, task.remindAt);
    this.onChanged();
    this.scheduleAll();
  }
}
