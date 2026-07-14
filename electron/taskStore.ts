import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { createRequire } from 'node:module';
import { applyVisibleOrder, isValidDateKey } from '../src/domain/tasks';
import type { Settings, Task, ViewId } from '../src/types';

const SCHEMA_VERSION = 2;
const FIXED_WINDOW_HEIGHT = 620;
const require = createRequire(import.meta.url);
type ReplaceFileApi = (replaced: string, replacement: string, backup: string, flags: number, exclude: null, reserved: null) => boolean;
let replaceFileApi: ReplaceFileApi | undefined;

function replaceFileWithBackup(target: string, replacement: string, backup: string): void {
  if (process.platform !== 'win32') {
    if (existsSync(target)) {
      writeFileSync(backup, readFileSync(target));
    }
    renameSync(replacement, target);
    return;
  }
  if (!replaceFileApi) {
    const koffi = require('koffi') as typeof import('koffi');
    const kernel32 = koffi.load('kernel32.dll');
    replaceFileApi = kernel32.func('__stdcall', 'ReplaceFileW', 'bool', ['str16', 'str16', 'str16', 'uint32_t', 'void *', 'void *']) as unknown as ReplaceFileApi;
  }
  const replace = replaceFileApi;
  if (!replace(target, replacement, backup, 0x00000001, null, null)) throw new Error('Windows 原子替换数据文件失败。');
}

interface PersistedState {
  schemaVersion: number;
  revision: number;
  tasks: Task[];
  settings: Settings;
  [key: string]: unknown;
}

export interface StoreSnapshot {
  revision: number;
  tasks: Task[];
  settings: Settings;
}

export interface StoreLoadResult extends StoreSnapshot {
  readOnly: boolean;
  recoveryMessage?: string;
}

export class RevisionConflictError extends Error {
  constructor() {
    super('数据已更新，请基于最新内容重试。');
  }
}

export class ReadOnlyStoreError extends Error {
  constructor(message = '数据处于只读保护状态。') {
    super(message);
  }
}

export function createDefaultSettings(): Settings {
  return {
    selectedView: 'all',
    windowBounds: { x: 120, y: 100, width: 900, height: 620 },
    theme: 'light',
    globalShortcut: 'Ctrl+Alt+T',
    showCompleted: false,
    opacity: 0.96,
    backgroundIntensity: 0.78,
  };
}

function defaultState(): PersistedState {
  return { schemaVersion: SCHEMA_VERSION, revision: 0, tasks: [], settings: createDefaultSettings() };
}

function isViewId(value: unknown): value is ViewId {
  return value === 'today' || value === 'scheduled' || value === 'all';
}

function isValidTimestamp(value: string | null): boolean {
  return value === null || (typeof value === 'string' && Number.isFinite(Date.parse(value)));
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function parseTask(value: unknown): Task | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  const title = typeof item.title === 'string' ? item.title.trim() : '';
  if (typeof item.id !== 'string' || !title || title.length > 300) return null;
  const dueDate = item.dueDate === null || typeof item.dueDate === 'string' ? item.dueDate : null;
  if (!isValidDateKey(dueDate)) return null;
  const remindAt = item.remindAt === null || typeof item.remindAt === 'string' ? item.remindAt : null;
  if (!isValidTimestamp(remindAt)) return null;
  const notifiedAt = item.notifiedAt === null || typeof item.notifiedAt === 'string' ? item.notifiedAt : null;
  if (!isValidTimestamp(notifiedAt)) return null;
  const createdAt = typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString();
  const updatedAt = typeof item.updatedAt === 'string' ? item.updatedAt : createdAt;
  return {
    id: item.id,
    title,
    notes: typeof item.notes === 'string' ? item.notes.slice(0, 10_000) : '',
    dueDate,
    remindAt,
    notifiedAt,
    completedAt: typeof item.completedAt === 'string' ? item.completedAt : null,
    createdAt,
    updatedAt,
    sortOrder: finiteNumber(item.sortOrder, 0),
  };
}

function parseSettings(value: unknown): Settings {
  const defaults = createDefaultSettings();
  if (!value || typeof value !== 'object') return defaults;
  const item = value as Record<string, unknown>;
  const bounds = item.windowBounds && typeof item.windowBounds === 'object'
    ? item.windowBounds as Record<string, unknown>
    : {};
  return {
    selectedView: isViewId(item.selectedView) ? item.selectedView : defaults.selectedView,
    windowBounds: {
      x: finiteNumber(bounds.x, defaults.windowBounds.x),
      y: finiteNumber(bounds.y, defaults.windowBounds.y),
      width: Math.max(680, finiteNumber(bounds.width, defaults.windowBounds.width)),
      height: FIXED_WINDOW_HEIGHT,
      displayId: typeof bounds.displayId === 'string' ? bounds.displayId : undefined,
      scaleFactor: finiteNumber(bounds.scaleFactor, 1),
    },
    theme: item.theme === 'dark' ? 'dark' : 'light',
    globalShortcut: typeof item.globalShortcut === 'string' && item.globalShortcut.trim() ? item.globalShortcut : defaults.globalShortcut,
    showCompleted: typeof item.showCompleted === 'boolean' ? item.showCompleted : defaults.showCompleted,
    opacity: Math.min(1, Math.max(0.72, finiteNumber(item.opacity, defaults.opacity))),
    backgroundIntensity: Math.min(1, Math.max(0, finiteNumber(item.backgroundIntensity, defaults.backgroundIntensity))),
  };
}

function parseState(raw: string): PersistedState {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  if (!parsed || typeof parsed !== 'object') throw new Error('数据文件根节点无效。');
  if (typeof parsed.schemaVersion !== 'number') throw new Error('数据文件缺少 schemaVersion。');
  if (parsed.schemaVersion > SCHEMA_VERSION) throw new ReadOnlyStoreError('数据来自更高版本，已进入只读保护。');
  if (parsed.schemaVersion < 1) throw new Error('不支持的数据版本。');
  if (!Array.isArray(parsed.tasks)) throw new Error('任务列表格式无效。');

  const tasks = parsed.tasks.map(parseTask).filter((task): task is Task => Boolean(task));
  return {
    ...parsed,
    schemaVersion: SCHEMA_VERSION,
    revision: Math.max(0, finiteNumber(parsed.revision, 0)),
    tasks,
    settings: parseSettings(parsed.settings),
  };
}

function cloneState(state: PersistedState): PersistedState {
  return structuredClone(state);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export class TaskStore {
  readonly stateFile: string;
  readonly backupFile: string;
  readonly lockFile: string;
  private state = defaultState();
  private readOnly = false;
  private recoveryMessage?: string;
  private lockDescriptor?: number;
  private extraRootFields: Record<string, unknown> = {};
  private saveQueue: Promise<void> = Promise.resolve();

  constructor(stateFile: string) {
    this.stateFile = stateFile;
    this.backupFile = `${stateFile}.bak`;
    this.lockFile = `${stateFile}.lock`;
  }

  acquireLock(): boolean {
    mkdirSync(dirname(this.stateFile), { recursive: true });
    const attempt = (): boolean => {
      try {
        this.lockDescriptor = openSync(this.lockFile, 'wx');
        writeFileSync(this.lockDescriptor, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
        fsyncSync(this.lockDescriptor);
        return true;
      } catch {
        try {
          const lock = JSON.parse(readFileSync(this.lockFile, 'utf8')) as { pid?: unknown };
          if (typeof lock.pid === 'number' && !isProcessAlive(lock.pid)) {
            rmSync(this.lockFile, { force: true });
            return attempt();
          }
        } catch {
          return false;
        }
        return false;
      }
    };
    return attempt();
  }

  releaseLock(): void {
    if (this.lockDescriptor !== undefined) {
      try { closeSync(this.lockDescriptor); } catch { /* ignored */ }
      this.lockDescriptor = undefined;
      try { rmSync(this.lockFile, { force: true }); } catch { /* ignored */ }
    }
  }

  load(): StoreLoadResult {
    if (!existsSync(this.stateFile)) return this.result();
    try {
      this.state = parseState(readFileSync(this.stateFile, 'utf8'));
      this.extraRootFields = Object.fromEntries(
        Object.entries(this.state).filter(([key]) => !['schemaVersion', 'revision', 'tasks', 'settings'].includes(key)),
      );
      return this.result();
    } catch (primaryError) {
      if (primaryError instanceof ReadOnlyStoreError) {
        this.readOnly = true;
        this.recoveryMessage = primaryError.message;
        return this.result();
      }
      try {
        this.state = parseState(readFileSync(this.backupFile, 'utf8'));
        this.recoveryMessage = '主数据文件损坏，当前内容来自备份。下一次成功修改会生成新的主文件。';
        return this.result();
      } catch {
        this.state = defaultState();
        this.readOnly = true;
        this.recoveryMessage = '主数据和备份均无法读取，已进入只读恢复模式，原文件未被覆盖。';
        return this.result();
      }
    }
  }

  getSnapshot(): StoreSnapshot {
    return { revision: this.state.revision, tasks: structuredClone(this.state.tasks), settings: structuredClone(this.state.settings) };
  }

  isReadOnly(): boolean { return this.readOnly; }
  getRecoveryMessage(): string | undefined { return this.recoveryMessage; }

  forceReadOnly(message: string): void {
    this.readOnly = true;
    this.recoveryMessage = message;
  }

  async mutate(baseRevision: number, mutator: (draft: PersistedState) => void): Promise<StoreSnapshot> {
    if (this.readOnly) throw new ReadOnlyStoreError(this.recoveryMessage);
    if (baseRevision !== this.state.revision) throw new RevisionConflictError();
    const draft = cloneState(this.state);
    mutator(draft);
    draft.revision += 1;
    draft.schemaVersion = SCHEMA_VERSION;
    await this.enqueueSave(draft);
    this.state = draft;
    return this.getSnapshot();
  }

  createTask(baseRevision: number, input: { title: string; notes?: string; dueDate?: string | null; remindAt?: string | null }): Promise<StoreSnapshot> {
    const title = input.title.trim();
    if (!title || title.length > 300) return Promise.reject(new Error('任务标题长度必须为 1 到 300 个字符。'));
    if (!isValidDateKey(input.dueDate ?? null)) return Promise.reject(new Error('截止日期格式无效。'));
    if (!isValidTimestamp(input.remindAt ?? null)) return Promise.reject(new Error('提醒时间格式无效。'));
    return this.mutate(baseRevision, (draft) => {
      const now = new Date().toISOString();
      const nextOrder = draft.tasks.reduce((max, task) => Math.max(max, task.sortOrder), -1000) + 1000;
      draft.tasks.push({
        id: crypto.randomUUID(),
        title,
        notes: (input.notes ?? '').slice(0, 10_000),
        dueDate: input.dueDate ?? null,
        remindAt: input.remindAt ?? null,
        notifiedAt: null,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
        sortOrder: nextOrder,
      });
    });
  }

  updateTask(baseRevision: number, input: { id: string; title?: string; notes?: string; dueDate?: string | null; remindAt?: string | null }): Promise<StoreSnapshot> {
    if (input.title !== undefined && (!input.title.trim() || input.title.trim().length > 300)) return Promise.reject(new Error('任务标题长度必须为 1 到 300 个字符。'));
    if (input.dueDate !== undefined && !isValidDateKey(input.dueDate)) return Promise.reject(new Error('截止日期格式无效。'));
    if (input.remindAt !== undefined && !isValidTimestamp(input.remindAt)) return Promise.reject(new Error('提醒时间格式无效。'));
    return this.mutate(baseRevision, (draft) => {
      const task = draft.tasks.find(({ id }) => id === input.id);
      if (!task) throw new Error('任务不存在。');
      if (input.title !== undefined) task.title = input.title.trim();
      if (input.notes !== undefined) task.notes = input.notes.slice(0, 10_000);
      if (input.dueDate !== undefined) task.dueDate = input.dueDate;
      if (input.remindAt !== undefined && task.remindAt !== input.remindAt) {
        task.remindAt = input.remindAt;
        task.notifiedAt = null;
      }
      task.updatedAt = new Date().toISOString();
    });
  }

  setCompleted(baseRevision: number, id: string, completed: boolean): Promise<StoreSnapshot> {
    return this.mutate(baseRevision, (draft) => {
      const task = draft.tasks.find((item) => item.id === id);
      if (!task) throw new Error('任务不存在。');
      task.completedAt = completed ? new Date().toISOString() : null;
      task.updatedAt = new Date().toISOString();
    });
  }

  deleteTask(baseRevision: number, id: string): Promise<{ snapshot: StoreSnapshot; deleted: Task }> {
    let deleted: Task | undefined;
    return this.mutate(baseRevision, (draft) => {
      const index = draft.tasks.findIndex((item) => item.id === id);
      if (index < 0) throw new Error('任务不存在。');
      [deleted] = draft.tasks.splice(index, 1);
    }).then((snapshot) => ({ snapshot, deleted: deleted as Task }));
  }

  restoreTask(baseRevision: number, task: Task): Promise<StoreSnapshot> {
    return this.mutate(baseRevision, (draft) => {
      if (draft.tasks.some(({ id }) => id === task.id)) throw new Error('任务已存在。');
      draft.tasks.push(task);
    });
  }

  reorderTasks(baseRevision: number, ids: string[]): Promise<StoreSnapshot> {
    if (new Set(ids).size !== ids.length) return Promise.reject(new Error('排序列表包含重复任务。'));
    return this.mutate(baseRevision, (draft) => { draft.tasks = applyVisibleOrder(draft.tasks, ids); });
  }

  updateSettings(baseRevision: number, settings: Partial<Settings>): Promise<StoreSnapshot> {
    return this.mutate(baseRevision, (draft) => {
      draft.settings = parseSettings({ ...draft.settings, ...settings });
    });
  }

  markReminderNotified(id: string, remindAt: string): Promise<StoreSnapshot> {
    return this.mutate(this.state.revision, (draft) => {
      const task = draft.tasks.find((item) => item.id === id);
      if (!task || task.completedAt || task.remindAt !== remindAt || task.notifiedAt) return;
      task.notifiedAt = new Date().toISOString();
      task.updatedAt = task.notifiedAt;
    });
  }

  private result(): StoreLoadResult {
    return { ...this.getSnapshot(), readOnly: this.readOnly, recoveryMessage: this.recoveryMessage };
  }

  private enqueueSave(next: PersistedState): Promise<void> {
    const save = this.saveQueue.then(() => this.writeAtomically({ ...this.extraRootFields, ...next }));
    this.saveQueue = save.catch(() => undefined);
    return save;
  }

  private writeAtomically(next: PersistedState): void {
    mkdirSync(dirname(this.stateFile), { recursive: true });
    const tempFile = `${this.stateFile}.tmp-${process.pid}-${crypto.randomUUID()}`;
    try {
      writeFileSync(tempFile, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
      const descriptor = openSync(tempFile, 'r+');
      try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
      if (existsSync(this.stateFile)) {
        replaceFileWithBackup(this.stateFile, tempFile, this.backupFile);
      } else {
        renameSync(tempFile, this.stateFile);
      }
    } finally {
      try { rmSync(tempFile, { force: true }); } catch { /* ignored */ }
    }
  }
}
