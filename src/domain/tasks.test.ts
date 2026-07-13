import { describe, expect, it } from 'vitest';
import { applyVisibleOrder, filterTasks, getViewCounts, isValidDateKey } from './tasks';
import type { Task } from '../types';

const task = (id: string, dueDate: string | null, completed = false, title = id): Task => ({
  id,
  title,
  notes: id === 'notes' ? 'Needle lives here' : '',
  dueDate,
  remindAt: null,
  notifiedAt: null,
  completedAt: completed ? '2026-07-13T10:00:00.000Z' : null,
  createdAt: `2026-07-13T00:00:0${id.length}.000Z`,
  updatedAt: '2026-07-13T00:00:00.000Z',
  sortOrder: id.length * 1000,
});

const tasks = [
  task('overdue', '2026-07-12'),
  task('today', '2026-07-13'),
  task('future', '2026-07-14'),
  task('none', null),
  task('done', '2026-07-13', true),
  task('notes', null),
];

describe('fixed task views', () => {
  it('puts overdue and today tasks in Today', () => {
    expect(filterTasks(tasks, { view: 'today', showCompleted: false, today: '2026-07-13' }).map(({ id }) => id))
      .toEqual(expect.arrayContaining(['overdue', 'today']));
  });

  it('puts only future dated tasks in Scheduled', () => {
    expect(filterTasks(tasks, { view: 'scheduled', showCompleted: false, today: '2026-07-13' }).map(({ id }) => id))
      .toEqual(['future']);
  });

  it('shows completed tasks only when enabled', () => {
    expect(filterTasks(tasks, { view: 'today', showCompleted: false, today: '2026-07-13' }).some(({ id }) => id === 'done')).toBe(false);
    expect(filterTasks(tasks, { view: 'today', showCompleted: true, today: '2026-07-13' }).some(({ id }) => id === 'done')).toBe(true);
  });

  it('counts only active tasks', () => {
    expect(getViewCounts(tasks, '2026-07-13')).toEqual({ today: 2, scheduled: 1, all: 5 });
  });

  it('searches title and notes inside the current view', () => {
    expect(filterTasks(tasks, { view: 'all', showCompleted: false, query: 'needle', today: '2026-07-13' }).map(({ id }) => id)).toEqual(['notes']);
    expect(filterTasks(tasks, { view: 'scheduled', showCompleted: false, query: 'overdue', today: '2026-07-13' })).toHaveLength(0);
  });
});

describe('task ordering and dates', () => {
  it('reorders only visible tasks', () => {
    const input = [task('a', null), task('hidden', null), task('b', null)];
    const reordered = applyVisibleOrder(input, ['b', 'a']);
    expect(reordered.map(({ id }) => id)).toEqual(['b', 'hidden', 'a']);
    expect(reordered.map(({ sortOrder }) => sortOrder)).toEqual([0, 1000, 2000]);
  });

  it('validates real local date keys', () => {
    expect(isValidDateKey('2024-02-29')).toBe(true);
    expect(isValidDateKey('2025-02-29')).toBe(false);
    expect(isValidDateKey('2026-7-1')).toBe(false);
  });
});
