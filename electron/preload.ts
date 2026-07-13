import { contextBridge, ipcRenderer } from 'electron';
import type { AppSnapshot, DesktopBindingStatus, MutationResult, RuntimeStatus, TodoApi } from '../src/types';

const api: TodoApi = {
  getSnapshot: () => ipcRenderer.invoke('todo:get-snapshot'),
  createTask: (input) => ipcRenderer.invoke('todo:create-task', input),
  updateTask: (input) => ipcRenderer.invoke('todo:update-task', input),
  setTaskCompleted: (input) => ipcRenderer.invoke('todo:set-completed', input),
  deleteTask: (input) => ipcRenderer.invoke('todo:delete-task', input),
  restoreDeletedTask: (input) => ipcRenderer.invoke('todo:restore-task', input),
  reorderTasks: (input) => ipcRenderer.invoke('todo:reorder-tasks', input),
  updateSettings: (input) => ipcRenderer.invoke('todo:update-settings', input),
  setEditMode: (editing) => ipcRenderer.invoke('todo:set-edit-mode', editing),
  retryDesktopBinding: () => ipcRenderer.invoke('todo:retry-desktop-binding'),
  onSnapshotChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: AppSnapshot) => callback(snapshot);
    ipcRenderer.on('todo:snapshot-changed', listener);
    return () => ipcRenderer.removeListener('todo:snapshot-changed', listener);
  },
  onEditModeChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, runtime: RuntimeStatus) => callback(runtime);
    ipcRenderer.on('todo:runtime-changed', listener);
    return () => ipcRenderer.removeListener('todo:runtime-changed', listener);
  },
};

contextBridge.exposeInMainWorld('todo', api);

export type PreloadResult = MutationResult | RuntimeStatus | DesktopBindingStatus;
