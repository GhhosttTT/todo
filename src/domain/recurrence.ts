import { addDays, addMonths, addWeeks, addYears, format } from 'date-fns';
import type { RecurrenceFrequency } from '../types';

export const recurrenceLabels: Record<RecurrenceFrequency, string> = {
  none: '不重复',
  daily: '每天',
  weekly: '每周',
  monthly: '每月',
  yearly: '每年',
};

export function isRecurrenceFrequency(value: unknown): value is RecurrenceFrequency {
  return value === 'none' || value === 'daily' || value === 'weekly' || value === 'monthly' || value === 'yearly';
}

export function isRecurring(value: RecurrenceFrequency): boolean {
  return value !== 'none';
}

function addOccurrence(date: Date, recurrence: RecurrenceFrequency): Date {
  if (recurrence === 'daily') return addDays(date, 1);
  if (recurrence === 'weekly') return addWeeks(date, 1);
  if (recurrence === 'monthly') return addMonths(date, 1);
  if (recurrence === 'yearly') return addYears(date, 1);
  return date;
}

export function advanceDateKeyAfter(value: string, recurrence: RecurrenceFrequency, after = new Date()): { value: string; steps: number } | null {
  if (!isRecurring(recurrence)) return null;
  const [year, month, day] = value.split('-').map(Number);
  let next = new Date(year, month - 1, day);
  if (!Number.isFinite(next.getTime())) return null;
  const afterKey = format(after, 'yyyy-MM-dd');
  let steps = 0;
  do {
    next = addOccurrence(next, recurrence);
    steps += 1;
  } while (format(next, 'yyyy-MM-dd') <= afterKey && steps < 3700);
  return { value: format(next, 'yyyy-MM-dd'), steps };
}

export function advanceTimestampAfter(value: string, recurrence: RecurrenceFrequency, after = new Date()): { value: string; steps: number } | null {
  if (!isRecurring(recurrence)) return null;
  let next = new Date(value);
  if (!Number.isFinite(next.getTime())) return null;
  let steps = 0;
  do {
    next = addOccurrence(next, recurrence);
    steps += 1;
  } while (next.getTime() <= after.getTime() && steps < 3700);
  return { value: next.toISOString(), steps };
}

export function advanceDateKeyBySteps(value: string, recurrence: RecurrenceFrequency, steps: number): string | null {
  if (!isRecurring(recurrence)) return null;
  const [year, month, day] = value.split('-').map(Number);
  let next = new Date(year, month - 1, day);
  if (!Number.isFinite(next.getTime())) return null;
  for (let index = 0; index < steps; index += 1) next = addOccurrence(next, recurrence);
  return format(next, 'yyyy-MM-dd');
}
