import { format } from 'date-fns';
import type { Task, ViewId } from '../types';

export function localDateKey(date = new Date()): string {
  return format(date, 'yyyy-MM-dd');
}

export function isValidDateKey(value: string | null): boolean {
  if (value === null) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(year, month - 1, day);
  return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day;
}

export function taskMatchesView(task: Task, view: ViewId, today = localDateKey()): boolean {
  if (view === 'all') return true;
  if (!task.dueDate) return false;
  if (view === 'today') return task.dueDate <= today;
  return task.dueDate > today;
}

export function compareTasks(a: Task, b: Task): number {
  if (Boolean(a.completedAt) !== Boolean(b.completedAt)) return a.completedAt ? 1 : -1;
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

export function filterTasks(
  tasks: Task[],
  options: { view: ViewId; showCompleted: boolean; query?: string; today?: string },
): Task[] {
  const query = options.query?.trim().toLocaleLowerCase() ?? '';
  const today = options.today ?? localDateKey();

  return tasks
    .filter((task) => taskMatchesView(task, options.view, today))
    .filter((task) => options.showCompleted || !task.completedAt)
    .filter((task) => {
      if (!query) return true;
      return task.title.toLocaleLowerCase().includes(query) || task.notes.toLocaleLowerCase().includes(query);
    })
    .sort(compareTasks);
}

export function getViewCounts(tasks: Task[], today = localDateKey()): Record<ViewId, number> {
  const active = tasks.filter((task) => !task.completedAt);
  return {
    today: active.filter((task) => taskMatchesView(task, 'today', today)).length,
    scheduled: active.filter((task) => taskMatchesView(task, 'scheduled', today)).length,
    all: active.length,
  };
}

export function normalizeSortOrder(tasks: Task[]): Task[] {
  return [...tasks].sort(compareTasks).map((task, index) => ({ ...task, sortOrder: index * 1000 }));
}

export function applyVisibleOrder(tasks: Task[], orderedVisibleIds: string[]): Task[] {
  const rank = new Map(orderedVisibleIds.map((id, index) => [id, index]));
  const visible = tasks.filter((task) => rank.has(task.id)).sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
  const slots = tasks.map((task, index) => ({ task, index })).filter(({ task }) => rank.has(task.id)).map(({ index }) => index);
  const result = [...tasks];
  slots.forEach((slot, index) => { result[slot] = visible[index]; });
  return result.map((task, index) => ({ ...task, sortOrder: index * 1000 }));
}
