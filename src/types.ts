export type ViewId = 'today' | 'scheduled' | 'all';
export type DataMode = 'normal' | 'portable';
export type Theme = 'light' | 'dark';
export type WindowMode = 'starting' | 'viewing-desktop' | 'viewing-fallback' | 'entering-editing' | 'editing' | 'exiting-editing' | 'rebinding' | 'hidden';

export interface Task {
  id: string;
  title: string;
  notes: string;
  dueDate: string | null;
  remindAt: string | null;
  notifiedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  sortOrder: number;
}

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  displayId?: string;
  scaleFactor?: number;
}

export interface Settings {
  selectedView: ViewId;
  windowBounds: WindowBounds;
  theme: Theme;
  globalShortcut: string;
  launchAtLogin: boolean;
  showCompleted: boolean;
  opacity: number;
  backgroundIntensity: number;
}

export interface DesktopBindingStatus {
  state: 'pending' | 'bound' | 'fallback';
  stage?: string;
  message?: string;
  errorCode?: number;
}

export interface RuntimeStatus {
  requestedDataMode: DataMode;
  effectiveDataMode: DataMode;
  dataPath: string;
  dataFallbackReason?: string;
  readOnly: boolean;
  persistenceError?: string;
  hasUnpersistedChanges: boolean;
  shortcutActive: boolean;
  shortcutError?: string;
  desktop: DesktopBindingStatus;
  windowMode: WindowMode;
}

export interface AppSnapshot {
  revision: number;
  tasks: Task[];
  settings: Settings;
  runtime: RuntimeStatus;
}

export interface CreateTaskInput {
  title: string;
  notes?: string;
  dueDate?: string | null;
  remindAt?: string | null;
  baseRevision: number;
}

export interface UpdateTaskInput {
  id: string;
  title?: string;
  notes?: string;
  dueDate?: string | null;
  remindAt?: string | null;
  baseRevision: number;
}

export interface MutationResult {
  ok: boolean;
  snapshot: AppSnapshot;
  error?: string;
  conflict?: boolean;
  undoToken?: string;
}

export interface TodoApi {
  getSnapshot(): Promise<AppSnapshot>;
  createTask(input: CreateTaskInput): Promise<MutationResult>;
  updateTask(input: UpdateTaskInput): Promise<MutationResult>;
  setTaskCompleted(input: { id: string; completed: boolean; baseRevision: number }): Promise<MutationResult>;
  deleteTask(input: { id: string; baseRevision: number }): Promise<MutationResult>;
  restoreDeletedTask(input: { token: string; baseRevision: number }): Promise<MutationResult>;
  reorderTasks(input: { ids: string[]; baseRevision: number }): Promise<MutationResult>;
  updateSettings(input: { settings: Partial<Pick<Settings, 'selectedView' | 'theme' | 'globalShortcut' | 'launchAtLogin' | 'showCompleted' | 'opacity' | 'backgroundIntensity'>>; baseRevision: number }): Promise<MutationResult>;
  setShortcutCapture(capturing: boolean): Promise<RuntimeStatus>;
  setEditMode(editing: boolean): Promise<RuntimeStatus>;
  retryDesktopBinding(): Promise<DesktopBindingStatus>;
  onSnapshotChanged(callback: (snapshot: AppSnapshot) => void): () => void;
  onEditModeChanged(callback: (runtime: RuntimeStatus) => void): () => void;
}

declare global {
  interface Window {
    todo: TodoApi;
  }
}
