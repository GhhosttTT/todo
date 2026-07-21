import { addDays, format } from 'date-fns';
import {
  CalendarDays,
  Check,
  CircleAlert,
  CirclePlus,
  Clock3,
  GripVertical,
  HardDrive,
  Inbox,
  Keyboard,
  LayoutPanelLeft,
  LayoutPanelTop,
  Layers3,
  MonitorDown,
  Plus,
  RotateCcw,
  Search,
  Settings as SettingsIcon,
  Moon,
  Sun,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { shortcutFromKeyInput } from './domain/shortcut';
import { filterTasks, getViewCounts, localDateKey } from './domain/tasks';
import type { AppSnapshot, LayoutMode, MutationResult, Task, ViewId } from './types';

const viewMeta = {
  today: { label: 'Today', hint: '今天与逾期', icon: CalendarDays, tone: 'blue' },
  scheduled: { label: 'Scheduled', hint: '未来计划', icon: Layers3, tone: 'coral' },
  all: { label: 'All', hint: '全部任务', icon: Inbox, tone: 'graphite' },
} as const;

interface DraftTask {
  title: string;
  notes: string;
  dueDate: string;
  remindAt: string;
}

function dueDateForView(view: ViewId): string {
  if (view === 'today') return localDateKey();
  if (view === 'scheduled') return format(addDays(new Date(), 1), 'yyyy-MM-dd');
  return '';
}

function toDateTimeInput(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? format(date, "yyyy-MM-dd'T'HH:mm") : '';
}

function fromDateTimeInput(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function formatReminder(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? format(date, 'yyyy-MM-dd HH:mm') : value;
}

function millisecondsUntilNextLocalDay(): number {
  const now = new Date();
  const nextDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 2);
  return Math.max(1000, nextDay.getTime() - now.getTime());
}

function App() {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);
  const [todayKey, setTodayKey] = useState(localDateKey());
  const [query, setQuery] = useState('');
  const [composerOpen, setComposerOpen] = useState(false);
  const [composer, setComposer] = useState<DraftTask>({ title: '', notes: '', dueDate: '', remindAt: '' });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftTask>({ title: '', notes: '', dueDate: '', remindAt: '' });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shortcutDraft, setShortcutDraft] = useState('Ctrl+Alt+T');
  const [shortcutRecording, setShortcutRecording] = useState(false);
  const [shortcutError, setShortcutError] = useState<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; kind: 'error' | 'info'; undoToken?: string } | null>(null);
  const activeTheme = snapshot?.settings.theme;

  useEffect(() => {
    void window.todo.getSnapshot().then((value) => {
      setSnapshot(value);
      setShortcutDraft(value.settings.globalShortcut);
    });
    const offSnapshot = window.todo.onSnapshotChanged(setSnapshot);
    const offRuntime = window.todo.onEditModeChanged((runtime) => setSnapshot((current) => current ? { ...current, runtime } : current));
    return () => { offSnapshot(); offRuntime(); };
  }, []);

  useEffect(() => {
    if (!activeTheme) return;
    document.documentElement.style.colorScheme = activeTheme;
  }, [activeTheme]);

  useEffect(() => {
    const refreshToday = () => setTodayKey(localDateKey());
    const timer = window.setTimeout(refreshToday, millisecondsUntilNextLocalDay());
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshToday();
    };
    const onFocus = () => refreshToday();

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', onFocus);
    };
  }, [todayKey]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), notice.undoToken ? 8000 : 4200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const applyResult = useCallback((result: MutationResult) => {
    setSnapshot(result.snapshot);
    if (!result.ok) setNotice({ text: result.error ?? '操作失败。', kind: 'error' });
    return result.ok;
  }, []);

  const editing = snapshot?.runtime.windowMode === 'editing' || snapshot?.runtime.windowMode === 'entering-editing';
  const view = snapshot?.settings.selectedView ?? 'all';
  const counts = useMemo(() => getViewCounts(snapshot?.tasks ?? [], todayKey), [snapshot?.tasks, todayKey]);
  const visibleTasks = useMemo(() => snapshot ? filterTasks(snapshot.tasks, {
    view,
    showCompleted: snapshot.settings.showCompleted,
    query,
    today: todayKey,
  }) : [], [query, snapshot, todayKey, view]);

  useEffect(() => {
    if (editing) return;
    setSettingsOpen(false);
    setComposerOpen(false);
    setEditingId(null);
    setDraggedId(null);
  }, [editing]);

  const selectView = async (nextView: ViewId) => {
    if (!snapshot || nextView === view) return;
    const result = await window.todo.updateSettings({ settings: { selectedView: nextView }, baseRevision: snapshot.revision });
    if (applyResult(result)) {
      setComposerOpen(false);
      setEditingId(null);
      setQuery('');
    }
  };

  const openComposer = () => {
    setComposer({ title: '', notes: '', dueDate: dueDateForView(view), remindAt: '' });
    setComposerOpen(true);
    setEditingId(null);
  };

  const createTask = async () => {
    if (!snapshot || !composer.title.trim()) return;
    const result = await window.todo.createTask({
      ...composer,
      dueDate: composer.dueDate || null,
      remindAt: fromDateTimeInput(composer.remindAt),
      baseRevision: snapshot.revision,
    });
    if (applyResult(result)) {
      setComposerOpen(false);
      setComposer({ title: '', notes: '', dueDate: '', remindAt: '' });
    }
  };

  const beginEdit = (task: Task) => {
    if (!editing) return;
    setEditingId(task.id);
    setDraft({ title: task.title, notes: task.notes, dueDate: task.dueDate ?? '', remindAt: toDateTimeInput(task.remindAt) });
    setComposerOpen(false);
  };

  const saveTask = async () => {
    if (!snapshot || !editingId || !draft.title.trim()) return;
    const result = await window.todo.updateTask({
      id: editingId,
      title: draft.title,
      notes: draft.notes,
      dueDate: draft.dueDate || null,
      remindAt: fromDateTimeInput(draft.remindAt),
      baseRevision: snapshot.revision,
    });
    if (applyResult(result)) setEditingId(null);
  };

  const toggleCompleted = async (task: Task) => {
    if (!snapshot || !editing) return;
    applyResult(await window.todo.setTaskCompleted({ id: task.id, completed: !task.completedAt, baseRevision: snapshot.revision }));
  };

  const deleteTask = async (id: string) => {
    if (!snapshot) return;
    const result = await window.todo.deleteTask({ id, baseRevision: snapshot.revision });
    if (applyResult(result)) {
      setEditingId(null);
      setNotice({ text: '任务已删除', kind: 'info', undoToken: result.undoToken });
    }
  };

  const undoDelete = async () => {
    if (!snapshot || !notice?.undoToken) return;
    const result = await window.todo.restoreDeletedTask({ token: notice.undoToken, baseRevision: snapshot.revision });
    if (applyResult(result)) setNotice({ text: '任务已恢复', kind: 'info' });
  };

  const dropOn = async (targetId: string) => {
    if (!snapshot || !draggedId || draggedId === targetId) return;
    const ids = visibleTasks.map(({ id }) => id);
    const sourceIndex = ids.indexOf(draggedId);
    const targetIndex = ids.indexOf(targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    ids.splice(sourceIndex, 1);
    ids.splice(targetIndex, 0, draggedId);
    setDraggedId(null);
    applyResult(await window.todo.reorderTasks({ ids, baseRevision: snapshot.revision }));
  };

  const changeSettings = async (settings: Parameters<typeof window.todo.updateSettings>[0]['settings']) => {
    if (!snapshot) return;
    applyResult(await window.todo.updateSettings({ settings, baseRevision: snapshot.revision }));
  };

  const changeLayoutMode = async (layoutMode: LayoutMode) => {
    if (!snapshot || snapshot.settings.layoutMode === layoutMode) return;
    const baseRevision = snapshot.revision;
    setSnapshot((current) => current ? { ...current, settings: { ...current.settings, layoutMode } } : current);
    applyResult(await window.todo.updateSettings({ settings: { layoutMode }, baseRevision }));
  };

  const startShortcutCapture = useCallback(async () => {
    setShortcutRecording(true);
    setShortcutError(null);
    const runtime = await window.todo.setShortcutCapture(true);
    setSnapshot((current) => current ? { ...current, runtime } : current);
  }, []);

  const stopShortcutCapture = useCallback(async () => {
    setShortcutRecording(false);
    const runtime = await window.todo.setShortcutCapture(false);
    setSnapshot((current) => current ? { ...current, runtime } : current);
  }, []);

  const captureShortcut = (event: React.KeyboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') {
      setShortcutDraft(snapshot?.settings.globalShortcut ?? 'Ctrl+Alt+T');
      setShortcutError(null);
      event.currentTarget.blur();
      return;
    }

    const result = shortcutFromKeyInput(event);
    if (result.accelerator) {
      setShortcutDraft(result.accelerator);
      setShortcutError(null);
    } else {
      setShortcutError(result.error ?? '无法识别这个组合键。');
    }
  };

  const applyShortcut = async () => {
    if (!snapshot) return;
    await stopShortcutCapture();
    const result = await window.todo.updateSettings({
      settings: { globalShortcut: shortcutDraft },
      baseRevision: snapshot.revision,
    });
    if (applyResult(result)) {
      setShortcutDraft(result.snapshot.settings.globalShortcut);
      setShortcutError(null);
      setNotice({ text: `全局快捷键已改为 ${result.snapshot.settings.globalShortcut}`, kind: 'info' });
    } else {
      setShortcutError(result.error ?? '快捷键不可用。');
    }
  };

  useEffect(() => {
    if (settingsOpen || !shortcutRecording) return;
    void stopShortcutCapture();
  }, [settingsOpen, shortcutRecording, stopShortcutCapture]);

  const exitEditing = async () => {
    if (editingId) setEditingId(null);
    setComposerOpen(false);
    setSettingsOpen(false);
    await window.todo.setEditMode(false);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && editing) {
        if (settingsOpen) setSettingsOpen(false);
        else if (composerOpen) setComposerOpen(false);
        else if (editingId) setEditingId(null);
        else void exitEditing();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  if (!snapshot) return <div className="boot-state">正在打开 Todo...</div>;

  const meta = viewMeta[view];
  const Icon = meta.icon;
  const runtimeWarning = snapshot.runtime.desktop.state === 'fallback'
    || snapshot.runtime.dataFallbackReason
    || snapshot.runtime.shortcutError
    || snapshot.runtime.persistenceError;

  return (
    <div
      className={`app-shell theme-${snapshot.settings.theme} layout-${snapshot.settings.layoutMode} ${editing ? 'is-editing' : 'is-viewing'}`}
      style={{ '--surface-opacity': snapshot.settings.opacity, '--background-intensity': snapshot.settings.backgroundIntensity } as React.CSSProperties}
    >
      <aside className="sidebar">
        <div className="drag-strip" aria-hidden="true" />

        {editing && (
          <label className="search-box">
            <Search size={18} strokeWidth={2.2} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索任务" aria-label="搜索任务" />
            {query && <button className="icon-button compact" onClick={() => setQuery('')} title="清除搜索"><X size={15} /></button>}
          </label>
        )}

        <nav className="smart-views" aria-label="固定任务视图">
          {(Object.keys(viewMeta) as ViewId[]).map((id) => {
            const item = viewMeta[id];
            const ItemIcon = item.icon;
            return (
              <button key={id} className={`view-tile ${item.tone} ${view === id ? 'active' : ''}`} onClick={() => void selectView(id)}>
                <span className="view-icon"><ItemIcon size={17} /></span>
                <strong>{counts[id]}</strong>
                <span>{item.label}</span>
                <small>{item.hint}</small>
              </button>
            );
          })}
        </nav>

        <div className="sidebar-spacer" />
        {editing ? (
          <div className="sidebar-actions">
            <button aria-label="打开设置" className={`sidebar-command ${runtimeWarning ? 'has-warning' : ''}`} onClick={() => setSettingsOpen(true)}>
              <SettingsIcon size={18} />
              <span>设置与状态</span>
            </button>
            <button className="sidebar-command primary" onClick={() => void exitEditing()}>
              <Check size={18} />
              <span>完成编辑</span>
            </button>
          </div>
        ) : (
          <div className="shortcut-hint" aria-label={`按 ${snapshot.settings.globalShortcut} 进入编辑模式`}>
            <Keyboard size={13} />
            <kbd>{snapshot.settings.globalShortcut}</kbd>
          </div>
        )}
      </aside>

      <main className="task-pane">
        <header className="pane-header">
          <div>
            <span className={`title-symbol ${meta.tone}`}><Icon size={18} /></span>
            <h1 className={meta.tone}>{meta.label}</h1>
            <p>{meta.hint}</p>
          </div>
          {editing && <button className="icon-button add-button" onClick={openComposer} title="添加任务"><Plus size={24} /></button>}
        </header>

        <section className="task-scroll" aria-live="polite">
          {composerOpen && (
            <div className="composer">
              <span className="completion-ring idle" />
              <div className="composer-fields">
                <input autoFocus className="title-input" value={composer.title} onChange={(event) => setComposer({ ...composer, title: event.target.value })} onKeyDown={(event) => { if (event.key === 'Enter') void createTask(); }} placeholder="新任务" maxLength={300} />
                <textarea value={composer.notes} onChange={(event) => setComposer({ ...composer, notes: event.target.value })} placeholder="备注（可选）" maxLength={10000} />
                <div className="editor-footer">
                  <label><CalendarDays size={15} /><input type="date" value={composer.dueDate} onChange={(event) => setComposer({ ...composer, dueDate: event.target.value })} /></label>
                  <label><Clock3 size={15} /><input type="datetime-local" value={composer.remindAt} onChange={(event) => setComposer({ ...composer, remindAt: event.target.value })} /></label>
                  <span />
                  <button className="text-button" onClick={() => setComposerOpen(false)}>取消</button>
                  <button className="text-button primary" disabled={!composer.title.trim()} onClick={() => void createTask()}>添加</button>
                </div>
              </div>
            </div>
          )}

          {visibleTasks.length === 0 && !composerOpen ? (
            <div className="empty-state">
              <span className={`empty-icon ${meta.tone}`}><Icon size={26} /></span>
              <h2>{query ? '没有匹配的任务' : 'No Reminders'}</h2>
              <p>{query ? '换一个关键词试试。' : view === 'today' ? '今天没有需要处理的事项。' : view === 'scheduled' ? '未来还没有安排任务。' : '这里会显示你的全部任务。'}</p>
              {editing && !query && <button className="empty-add" onClick={openComposer}><CirclePlus size={17} />添加任务</button>}
            </div>
          ) : (
            <div className="task-list">
              {visibleTasks.map((task) => (
                <article
                  key={task.id}
                  className={`task-row ${task.completedAt ? 'completed' : ''} ${editingId === task.id ? 'expanded' : ''}`}
                  draggable={editing && editingId !== task.id}
                  onDragStart={() => setDraggedId(task.id)}
                  onDragOver={(event) => editing && event.preventDefault()}
                  onDrop={() => void dropOn(task.id)}
                >
                  {editing && <span className="drag-handle" title="拖动排序"><GripVertical size={16} /></span>}
                  <button className="completion-button" disabled={!editing} onClick={() => void toggleCompleted(task)} title={task.completedAt ? '恢复任务' : '完成任务'}>
                    {task.completedAt && <Check size={13} strokeWidth={3} />}
                  </button>

                  {editingId === task.id ? (
                    <div className="task-editor">
                      <input autoFocus className="title-input" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} maxLength={300} />
                      <textarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} placeholder="备注（可选）" maxLength={10000} />
                      <div className="editor-footer">
                        <label><CalendarDays size={15} /><input type="date" value={draft.dueDate} onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })} /></label>
                        <label><Clock3 size={15} /><input type="datetime-local" value={draft.remindAt} onChange={(event) => setDraft({ ...draft, remindAt: event.target.value })} /></label>
                        <button className="danger-icon" onClick={() => void deleteTask(task.id)} title="删除任务"><Trash2 size={16} /></button>
                        <button className="text-button" onClick={() => setEditingId(null)}>取消</button>
                        <button className="text-button primary" disabled={!draft.title.trim()} onClick={() => void saveTask()}>保存</button>
                      </div>
                    </div>
                  ) : (
                    <button className="task-content" disabled={!editing} onClick={() => beginEdit(task)}>
                      <span className="task-title">{task.title}</span>
                      {(task.notes || task.dueDate || task.remindAt) && (
                        <span className="task-meta">
                          {task.notes && <span className="task-notes">{task.notes}</span>}
                          {(task.dueDate || task.remindAt) && (
                            <span className="task-timing-row">
                              {task.dueDate && <span className={task.dueDate < todayKey && !task.completedAt ? 'overdue' : ''}><CalendarDays size={13} />{task.dueDate}</span>}
                              {task.remindAt && <span><Clock3 size={13} />{formatReminder(task.remindAt)}</span>}
                            </span>
                          )}
                        </span>
                      )}
                    </button>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      </main>

      {!editing && snapshot.settings.layoutMode === 'compact' && (
        <div className="shortcut-hint compact-shortcut-hint" aria-label={`按 ${snapshot.settings.globalShortcut} 进入编辑模式`}>
          <Keyboard size={13} />
          <kbd>{snapshot.settings.globalShortcut}</kbd>
        </div>
      )}

      {editing && snapshot.settings.layoutMode === 'compact' && (
        <div className="compact-edit-actions">
          <button aria-label="打开设置" className={`sidebar-command ${runtimeWarning ? 'has-warning' : ''}`} onClick={() => setSettingsOpen(true)}>
            <SettingsIcon size={18} />
            <span>设置与状态</span>
          </button>
          <button className="sidebar-command primary" onClick={() => void exitEditing()}>
            <Check size={18} />
            <span>完成编辑</span>
          </button>
        </div>
      )}

      {settingsOpen && (
        <aside className="settings-drawer" aria-label="设置与运行状态">
          <header>
            <div><span>SETTINGS</span><h2>设置与状态</h2></div>
            <button className="icon-button" onClick={() => setSettingsOpen(false)} title="关闭设置"><X size={20} /></button>
          </header>

          <section>
            <h3><LayoutPanelTop size={17} />窗口布局</h3>
            <div className="theme-segmented layout-segmented" aria-label="窗口布局">
              <button className={snapshot.settings.layoutMode === 'compact' ? 'active' : ''} onClick={() => void changeLayoutMode('compact')}>
                <LayoutPanelTop size={15} />紧凑
              </button>
              <button className={snapshot.settings.layoutMode === 'expanded' ? 'active' : ''} onClick={() => void changeLayoutMode('expanded')}>
                <LayoutPanelLeft size={15} />展开
              </button>
            </div>
          </section>

          <section>
            <h3><Sun size={17} />外观主题</h3>
            <div className="theme-segmented" aria-label="主题">
              <button className={snapshot.settings.theme === 'light' ? 'active' : ''} onClick={() => void changeSettings({ theme: 'light' })}>
                <Sun size={15} />白色
              </button>
              <button className={snapshot.settings.theme === 'dark' ? 'active' : ''} onClick={() => void changeSettings({ theme: 'dark' })}>
                <Moon size={15} />黑色
              </button>
            </div>
          </section>

          <section>
            <h3><Keyboard size={17} />全局快捷键</h3>
            <div className={`shortcut-control ${shortcutRecording ? 'is-recording' : ''}`}>
              <input
                value={shortcutDraft}
                readOnly
                aria-label="录制全局快捷键"
                aria-invalid={Boolean(shortcutError)}
                onFocus={() => void startShortcutCapture()}
                onBlur={() => void stopShortcutCapture()}
                onKeyDown={captureShortcut}
              />
              <button onMouseDown={(event) => event.preventDefault()} onClick={() => void applyShortcut()}>检测并应用</button>
            </div>
            <p className="shortcut-help">点击输入框后直接按组合键；应用时会检测是否被其他程序占用。</p>
            <StatusLine
              ok={!shortcutError && (shortcutRecording || snapshot.runtime.shortcutActive)}
              text={shortcutError
                ?? (shortcutRecording
                  ? '正在录制，当前快捷键已暂时暂停。按 Esc 取消。'
                  : snapshot.runtime.shortcutActive
                    ? `已启用 ${snapshot.settings.globalShortcut}`
                    : snapshot.runtime.shortcutError ?? '未激活')}
            />
          </section>

          <section>
            <h3><MonitorDown size={17} />桌面层</h3>
            <StatusLine ok={snapshot.runtime.desktop.state === 'bound'} text={snapshot.runtime.desktop.state === 'bound' ? '已绑定 WorkerW 桌面层' : `降级模式 · ${snapshot.runtime.desktop.message ?? '等待绑定'}`} />
            <button className="outline-command" onClick={() => void window.todo.retryDesktopBinding()}>重试桌面绑定</button>
          </section>

          <section>
            <h3><HardDrive size={17} />本地数据</h3>
            <StatusLine ok={!snapshot.runtime.dataFallbackReason && !snapshot.runtime.persistenceError} text={`${snapshot.runtime.effectiveDataMode === 'portable' ? '便携模式' : '普通模式'} · ${snapshot.runtime.readOnly ? '只读' : '可写'}`} />
            <code title={snapshot.runtime.dataPath}>{snapshot.runtime.dataPath}</code>
            {(snapshot.runtime.dataFallbackReason || snapshot.runtime.persistenceError) && <p className="status-detail">{snapshot.runtime.persistenceError ?? '便携目录不可写，已使用系统数据目录。'}</p>}
          </section>

          <section className="toggles">
            <label className="toggle-row">
              <span><strong>开机自启</strong><small>Windows 登录后自动启动 Todo</small></span>
              <input type="checkbox" checked={snapshot.settings.launchAtLogin} onChange={(event) => void changeSettings({ launchAtLogin: event.target.checked })} />
            </label>
            <label className="toggle-row">
              <span><strong>显示已完成</strong><small>在当前视图中保留完成项</small></span>
              <input type="checkbox" checked={snapshot.settings.showCompleted} onChange={(event) => void changeSettings({ showCompleted: event.target.checked })} />
            </label>
            <label className="range-row"><span>窗口透明度</span><input type="range" min="0.72" max="1" step="0.01" value={snapshot.settings.opacity} onChange={(event) => void changeSettings({ opacity: Number(event.target.value) })} /></label>
            <label className="range-row"><span>背景强度</span><input type="range" min="0" max="1" step="0.05" value={snapshot.settings.backgroundIntensity} onChange={(event) => void changeSettings({ backgroundIntensity: Number(event.target.value) })} /></label>
          </section>
        </aside>
      )}

      {notice && (
        <div className={`notice ${notice.kind}`}>
          {notice.kind === 'error' ? <CircleAlert size={17} /> : <Check size={17} />}
          <span>{notice.text}</span>
          {notice.undoToken && <button onClick={() => void undoDelete()}><RotateCcw size={15} />撤销</button>}
        </div>
      )}
    </div>
  );
}

function StatusLine({ ok, text }: { ok: boolean; text: string }) {
  return <div className={`status-line ${ok ? 'ok' : 'warning'}`}><span />{text}</div>;
}

export default App;
