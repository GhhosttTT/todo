import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import type { AppSnapshot, MutationResult, RuntimeStatus, Settings, Task } from '../src/types';
import { ReadOnlyStoreError, RevisionConflictError, TaskStore } from './taskStore';
import type { WindowController } from './windowController';

interface IpcDependencies {
  store: TaskStore;
  window: BrowserWindow;
  windowController: WindowController;
  runtime: RuntimeStatus;
  registerShortcut: (accelerator: string) => { ok: boolean; error?: string };
  setShortcutCapture: (capturing: boolean) => void;
  applyLaunchAtLogin: (enabled: boolean) => void;
  onStoreChanged?: () => void;
  transientSettings?: Partial<Settings>;
}

interface UndoEntry { task: Task; expiresAt: number }

export function registerIpcHandlers(deps: IpcDependencies): void {
  const undo = new Map<string, UndoEntry>();
  const withTransientSettings = (storeSnapshot = deps.store.getSnapshot()) => ({
    ...storeSnapshot,
    settings: { ...storeSnapshot.settings, ...deps.transientSettings },
  });
  const snapshot = (): AppSnapshot => ({ ...withTransientSettings(), runtime: structuredClone(deps.runtime) });
  const broadcast = () => deps.window.webContents.send('todo:snapshot-changed', snapshot());
  const result = (storeSnapshot = deps.store.getSnapshot(), extras: Partial<MutationResult> = {}): MutationResult => ({
    ok: true,
    snapshot: { ...withTransientSettings(storeSnapshot), runtime: structuredClone(deps.runtime) },
    ...extras,
  });
  const mutation = async (action: () => Promise<ReturnType<TaskStore['getSnapshot']>>): Promise<MutationResult> => {
    try {
      const changed = await action();
      deps.onStoreChanged?.();
      broadcast();
      return result(changed);
    } catch (error) {
      return {
        ok: false,
        snapshot: snapshot(),
        conflict: error instanceof RevisionConflictError,
        error: error instanceof Error ? error.message : '操作失败。',
      };
    }
  };

  ipcMain.handle('todo:get-snapshot', () => snapshot());
  ipcMain.handle('todo:create-task', (_event, input) => mutation(() => deps.store.createTask(input.baseRevision, input)));
  ipcMain.handle('todo:update-task', (_event, input) => mutation(() => deps.store.updateTask(input.baseRevision, input)));
  ipcMain.handle('todo:set-completed', (_event, input) => mutation(() => deps.store.setCompleted(input.baseRevision, input.id, input.completed)));
  ipcMain.handle('todo:reorder-tasks', (_event, input) => mutation(() => deps.store.reorderTasks(input.baseRevision, input.ids)));

  ipcMain.handle('todo:delete-task', async (_event, input): Promise<MutationResult> => {
    try {
      const { snapshot: changed, deleted } = await deps.store.deleteTask(input.baseRevision, input.id);
      undo.clear();
      const token = crypto.randomUUID();
      undo.set(token, { task: deleted, expiresAt: Date.now() + 8000 });
      deps.onStoreChanged?.();
      broadcast();
      return result(changed, { undoToken: token });
    } catch (error) {
      return { ok: false, snapshot: snapshot(), conflict: error instanceof RevisionConflictError, error: error instanceof Error ? error.message : '删除失败。' };
    }
  });

  ipcMain.handle('todo:restore-task', (_event, input) => {
    const entry = undo.get(input.token);
    if (!entry || entry.expiresAt < Date.now()) return Promise.resolve({ ok: false, snapshot: snapshot(), error: '撤销已过期。' } satisfies MutationResult);
    undo.delete(input.token);
    return mutation(() => deps.store.restoreTask(input.baseRevision, entry.task));
  });

  ipcMain.handle('todo:update-settings', async (_event, input): Promise<MutationResult> => {
    const settings = input.settings as Partial<Settings>;
    const oldShortcut = deps.store.getSnapshot().settings.globalShortcut;
    if (settings.globalShortcut !== undefined && settings.globalShortcut !== oldShortcut) {
      const shortcut = deps.registerShortcut(settings.globalShortcut);
      if (!shortcut.ok) return { ok: false, snapshot: snapshot(), error: shortcut.error ?? '快捷键注册失败。' };
    }
    const changed = await mutation(() => deps.store.updateSettings(input.baseRevision, settings));
    if (changed.ok && settings.opacity !== undefined) deps.window.setOpacity(Math.min(1, Math.max(0.72, settings.opacity)));
    if (changed.ok && settings.launchAtLogin !== undefined) deps.applyLaunchAtLogin(settings.launchAtLogin);
    if (!changed.ok && settings.globalShortcut !== undefined && settings.globalShortcut !== oldShortcut) deps.registerShortcut(oldShortcut);
    return changed;
  });

  ipcMain.handle('todo:set-shortcut-capture', (_event, capturing: unknown) => {
    if (typeof capturing !== 'boolean') throw new Error('快捷键录制参数无效。');
    deps.setShortcutCapture(capturing);
    return structuredClone(deps.runtime);
  });

  ipcMain.handle('todo:set-edit-mode', async (_event, editing: unknown) => {
    if (typeof editing !== 'boolean') throw new Error('编辑模式参数无效。');
    await deps.windowController.setEditing(editing);
    return structuredClone(deps.runtime);
  });

  ipcMain.handle('todo:retry-desktop-binding', () => deps.windowController.retryBinding());
}

export function clearIpcHandlers(): void {
  for (const channel of [
    'todo:get-snapshot', 'todo:create-task', 'todo:update-task', 'todo:set-completed', 'todo:delete-task',
    'todo:restore-task', 'todo:reorder-tasks', 'todo:update-settings', 'todo:set-shortcut-capture', 'todo:set-edit-mode', 'todo:retry-desktop-binding',
  ]) ipcMain.removeHandler(channel);
}

export function isPersistenceError(error: unknown): boolean {
  return error instanceof ReadOnlyStoreError;
}
