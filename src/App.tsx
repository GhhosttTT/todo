import { addDays, format } from 'date-fns';
import {
  CalendarDays,
  Check,
  CircleAlert,
  CirclePlus,
  Clock3,
  GripVertical,
  HardDrive,
  Keyboard,
  LayoutPanelLeft,
  LayoutPanelTop,
  MonitorDown,
  Plus,
  Repeat2,
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
import { localDateKey } from './domain/tasks';
import { recurrenceLabels } from './domain/recurrence';
import type { AppSnapshot, LayoutMode, MutationResult, RecurrenceFrequency, Task } from './types';

interface DraftTask {
  title: string;
  notes: string;
  dueDate: string;
  remindAt: string;
  recurrence: RecurrenceFrequency;
}

const recurrenceOptions: RecurrenceFrequency[] = ['none', 'daily', 'weekly', 'monthly', 'yearly'];

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

function formatAgendaTime(value: string | null): string {
  if (!value) return '全天';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? format(date, 'HH:mm') : '全天';
}

function dateFromKey(dateKey: string): Date {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function taskCalendarDate(task: Task): string | null {
  if (task.remindAt) {
    const date = new Date(task.remindAt);
    if (Number.isFinite(date.getTime())) return format(date, 'yyyy-MM-dd');
  }
  return task.dueDate;
}

function defaultReminderForDate(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  return format(new Date(year, month - 1, day, 9, 0, 0), "yyyy-MM-dd'T'HH:mm");
}

function millisecondsUntilNextLocalDay(): number {
  const now = new Date();
  const nextDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 2);
  return Math.max(1000, nextDay.getTime() - now.getTime());
}

function App() {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);
  const [todayKey, setTodayKey] = useState(localDateKey());
  const [selectedDate, setSelectedDate] = useState(localDateKey());
  const [query, setQuery] = useState('');
  const [composerOpen, setComposerOpen] = useState(false);
  const [composer, setComposer] = useState<DraftTask>({ title: '', notes: '', dueDate: '', remindAt: '', recurrence: 'none' });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftTask>({ title: '', notes: '', dueDate: '', remindAt: '', recurrence: 'none' });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shortcutDraft, setShortcutDraft] = useState('Ctrl+Alt+T');
  const [shortcutRecording, setShortcutRecording] = useState(false);
  const [shortcutError, setShortcutError] = useState<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [pendingLayoutMode, setPendingLayoutMode] = useState<LayoutMode | null>(null);
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
  const calendarRangeDays = snapshot?.settings.calendarRangeDays ?? 7;
  const calendarDays = useMemo(() => Array.from({ length: calendarRangeDays }, (_, index) => {
    const date = addDays(new Date(), index);
    return { key: format(date, 'yyyy-MM-dd'), day: format(date, 'dd'), week: format(date, 'EEE'), month: format(date, 'MMM') };
  }), [calendarRangeDays, todayKey]);
  const dateCounts = useMemo(() => {
    const counts = new Map<string, number>();
    snapshot?.tasks.forEach((task) => {
      if (task.completedAt) return;
      const key = taskCalendarDate(task);
      if (!key) return;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    return counts;
  }, [snapshot]);
  const visibleTasks = useMemo(() => {
    if (!snapshot) return [];
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return snapshot.tasks
      .filter((task) => taskCalendarDate(task) === selectedDate)
      .filter((task) => snapshot.settings.showCompleted || !task.completedAt)
      .filter((task) => !normalizedQuery || task.title.toLocaleLowerCase().includes(normalizedQuery) || task.notes.toLocaleLowerCase().includes(normalizedQuery))
      .sort((left, right) => {
        if (Boolean(left.completedAt) !== Boolean(right.completedAt)) return left.completedAt ? 1 : -1;
        const leftTime = left.remindAt ? Date.parse(left.remindAt) : Number.MAX_SAFE_INTEGER;
        const rightTime = right.remindAt ? Date.parse(right.remindAt) : Number.MAX_SAFE_INTEGER;
        if (leftTime !== rightTime) return leftTime - rightTime;
        return left.sortOrder - right.sortOrder || left.createdAt.localeCompare(right.createdAt);
      });
  }, [query, selectedDate, snapshot]);
  const selectedDateObject = useMemo(() => dateFromKey(selectedDate), [selectedDate]);
  const selectedDateLabel = useMemo(() => format(selectedDateObject, 'yyyy年 MM月dd日'), [selectedDateObject]);
  const selectedWeekLabel = useMemo(() => format(selectedDateObject, 'EEEE'), [selectedDateObject]);

  useEffect(() => {
    if (editing) return;
    setSettingsOpen(false);
    setComposerOpen(false);
    setEditingId(null);
    setDraggedId(null);
  }, [editing]);

  const openComposer = () => {
    setComposer({ title: '', notes: '', dueDate: selectedDate, remindAt: defaultReminderForDate(selectedDate), recurrence: 'none' });
    setComposerOpen(true);
    setEditingId(null);
  };

  const createTask = async () => {
    if (!snapshot || !composer.title.trim()) return;
    const result = await window.todo.createTask({
      ...composer,
      dueDate: composer.dueDate || null,
      remindAt: fromDateTimeInput(composer.remindAt),
      recurrence: composer.recurrence,
      baseRevision: snapshot.revision,
    });
    if (applyResult(result)) {
      setComposerOpen(false);
      setComposer({ title: '', notes: '', dueDate: '', remindAt: '', recurrence: 'none' });
    }
  };

  const beginEdit = (task: Task) => {
    if (!editing) return;
    setEditingId(task.id);
    setDraft({ title: task.title, notes: task.notes, dueDate: task.dueDate ?? '', remindAt: toDateTimeInput(task.remindAt), recurrence: task.recurrence });
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
      recurrence: draft.recurrence,
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
    setPendingLayoutMode(layoutMode);
    try {
      const latest = await window.todo.getSnapshot();
      if (latest.settings.layoutMode === layoutMode) {
        setSnapshot(latest);
        return;
      }
      applyResult(await window.todo.updateSettings({ settings: { layoutMode }, baseRevision: latest.revision }));
    } finally {
      setPendingLayoutMode(null);
    }
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

  const runtimeWarning = snapshot.runtime.desktop.state === 'fallback'
    || snapshot.runtime.dataFallbackReason
    || snapshot.runtime.shortcutError
    || snapshot.runtime.persistenceError;

  return (
    <div
      className={`app-shell calendar-widget theme-${snapshot.settings.theme} layout-${snapshot.settings.layoutMode} ${editing ? 'is-editing' : 'is-viewing'}`}
      style={{ '--surface-opacity': snapshot.settings.opacity, '--background-intensity': snapshot.settings.backgroundIntensity } as React.CSSProperties}
    >
      <aside className="sidebar calendar-sidebar">
        <div className="drag-strip calendar-drag-strip" aria-hidden="true" />

        <section className="calendar-date-plate" aria-label="当前日期">
          <div>
            <span>{format(selectedDateObject, 'MMM yyyy')}</span>
            <strong>{format(selectedDateObject, 'dd')}</strong>
          </div>
          <p>{selectedWeekLabel}</p>
        </section>

        {editing && (
          <label className="search-box">
            <Search size={18} strokeWidth={2.2} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索任务" aria-label="搜索任务" />
            {query && <button className="icon-button compact" onClick={() => setQuery('')} title="清除搜索"><X size={15} /></button>}
          </label>
        )}

        <nav className="calendar-day-grid" aria-label="提醒日期">
          {calendarDays.map((day, index) => {
            const count = dateCounts.get(day.key) ?? 0;
            return (
              <button
                key={day.key}
                className={`calendar-day-cell ${selectedDate === day.key ? 'active' : ''} ${day.key === todayKey ? 'today' : ''}`}
                onClick={() => { setSelectedDate(day.key); setQuery(''); setComposerOpen(false); setEditingId(null); }}
              >
                <span>{index === 0 ? 'Today' : day.week}</span>
                <strong>{day.day}</strong>
                {calendarRangeDays === 30 && <em>{day.month}</em>}
                {count > 0 && <small>{count}</small>}
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

      <main className="task-pane calendar-agenda-pane">
        <header className="pane-header calendar-agenda-header">
          <div>
            <span className="calendar-eyebrow">Calendar reminder</span>
            <h1>{selectedDate === todayKey ? 'Today' : format(selectedDateObject, 'MMM d')}</h1>
            <p>{selectedDateLabel} · {visibleTasks.length} 个提醒 · 未来 {calendarRangeDays} 天</p>
          </div>
          <div className="agenda-header-side">
            <span><Clock3 size={15} />{visibleTasks.length}</span>
            {editing && <button className="icon-button add-button" onClick={openComposer} title="添加提醒"><Plus size={24} /></button>}
          </div>
        </header>

        <section className="task-scroll calendar-agenda-scroll" aria-live="polite">
          {composerOpen && (
            <div className="composer calendar-composer">
              <span className="agenda-time-label">NEW</span>
              <div className="composer-fields">
                <input autoFocus className="title-input" value={composer.title} onChange={(event) => setComposer({ ...composer, title: event.target.value })} onKeyDown={(event) => { if (event.key === 'Enter') void createTask(); }} placeholder="新提醒" maxLength={300} />
                <textarea value={composer.notes} onChange={(event) => setComposer({ ...composer, notes: event.target.value })} placeholder="备注（可选）" maxLength={10000} />
                <div className="editor-footer">
                  <label><CalendarDays size={15} /><input type="date" value={composer.dueDate} onChange={(event) => setComposer({ ...composer, dueDate: event.target.value })} /></label>
                  <label><Clock3 size={15} /><input type="datetime-local" value={composer.remindAt} onChange={(event) => setComposer({ ...composer, remindAt: event.target.value })} /></label>
                  <label><Repeat2 size={15} /><select value={composer.recurrence} onChange={(event) => setComposer({ ...composer, recurrence: event.target.value as RecurrenceFrequency })}>{recurrenceOptions.map((option) => <option key={option} value={option}>{recurrenceLabels[option]}</option>)}</select></label>
                  <span />
                  <button className="text-button" onClick={() => setComposerOpen(false)}>取消</button>
                  <button className="text-button primary" disabled={!composer.title.trim()} onClick={() => void createTask()}>添加</button>
                </div>
              </div>
            </div>
          )}

          {visibleTasks.length === 0 && !composerOpen ? (
            <div className="empty-state calendar-empty-state">
              <span className="empty-icon"><CalendarDays size={26} /></span>
              <h2>{query ? '没有匹配的任务' : 'No Reminders'}</h2>
              <p>{query ? '换一个关键词试试。' : '这一天还没有提醒。'}</p>
              {editing && !query && <button className="empty-add" onClick={openComposer}><CirclePlus size={17} />添加提醒</button>}
            </div>
          ) : (
            <div className="agenda-list">
              {visibleTasks.map((task) => (
                <article
                  key={task.id}
                  className={`agenda-item ${task.completedAt ? 'completed' : ''} ${editingId === task.id ? 'expanded' : ''}`}
                  draggable={editing && editingId !== task.id}
                  onDragStart={() => setDraggedId(task.id)}
                  onDragOver={(event) => editing && event.preventDefault()}
                  onDrop={() => void dropOn(task.id)}
                >
                  <time className="agenda-time-label">{formatAgendaTime(task.remindAt)}</time>

                  {editingId === task.id ? (
                    <div className="task-editor agenda-card agenda-editor-card">
                      <input autoFocus className="title-input" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} maxLength={300} />
                      <textarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} placeholder="备注（可选）" maxLength={10000} />
                      <div className="editor-footer">
                        <label><CalendarDays size={15} /><input type="date" value={draft.dueDate} onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })} /></label>
                        <label><Clock3 size={15} /><input type="datetime-local" value={draft.remindAt} onChange={(event) => setDraft({ ...draft, remindAt: event.target.value })} /></label>
                        <label><Repeat2 size={15} /><select value={draft.recurrence} onChange={(event) => setDraft({ ...draft, recurrence: event.target.value as RecurrenceFrequency })}>{recurrenceOptions.map((option) => <option key={option} value={option}>{recurrenceLabels[option]}</option>)}</select></label>
                        <button className="danger-icon" onClick={() => void deleteTask(task.id)} title="删除任务"><Trash2 size={16} /></button>
                        <button className="text-button" onClick={() => setEditingId(null)}>取消</button>
                        <button className="text-button primary" disabled={!draft.title.trim()} onClick={() => void saveTask()}>保存</button>
                      </div>
                    </div>
                  ) : (
                    <div className="agenda-card">
                      <div className="agenda-card-top">
                        <button className="completion-button" disabled={!editing} onClick={() => void toggleCompleted(task)} title={task.completedAt ? '恢复提醒' : '完成提醒'}>
                          {task.completedAt && <Check size={13} strokeWidth={3} />}
                        </button>
                        <button className="task-content" disabled={!editing} onClick={() => beginEdit(task)}>
                          <span className="task-title">{task.title}</span>
                        </button>
                        {editing && <span className="drag-handle" title="拖动排序"><GripVertical size={16} /></span>}
                      </div>
                      {(task.notes || task.dueDate || task.remindAt || task.recurrence !== 'none') && (
                        <span className="task-meta">
                          {task.notes && <span className="task-notes">{task.notes}</span>}
                          {(task.dueDate || task.remindAt || task.recurrence !== 'none') && (
                            <span className="task-timing-row">
                              {task.dueDate && <span className={task.dueDate < todayKey && !task.completedAt ? 'overdue' : ''}><CalendarDays size={13} />{task.dueDate}</span>}
                              {task.remindAt && <span><Clock3 size={13} />{formatReminder(task.remindAt)}</span>}
                              {task.recurrence !== 'none' && <span><Repeat2 size={13} />{recurrenceLabels[task.recurrence]}</span>}
                            </span>
                          )}
                        </span>
                      )}
                    </div>
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
              <button className={(pendingLayoutMode ?? snapshot.settings.layoutMode) === 'compact' ? 'active' : ''} onClick={() => void changeLayoutMode('compact')}>
                <LayoutPanelTop size={15} />紧凑
              </button>
              <button className={(pendingLayoutMode ?? snapshot.settings.layoutMode) === 'expanded' ? 'active' : ''} onClick={() => void changeLayoutMode('expanded')}>
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
            <h3><CalendarDays size={17} />日期范围</h3>
            <div className="theme-segmented" aria-label="日期范围">
              <button className={snapshot.settings.calendarRangeDays === 7 ? 'active' : ''} onClick={() => void changeSettings({ calendarRangeDays: 7 })}>
                未来 7 天
              </button>
              <button className={snapshot.settings.calendarRangeDays === 30 ? 'active' : ''} onClick={() => void changeSettings({ calendarRangeDays: 30 })}>
                未来 30 天
              </button>
            </div>
          </section>

          <section>
            <h3><Clock3 size={17} />提醒停留</h3>
            <div className="theme-segmented triple" aria-label="提醒停留时长">
              <button className={snapshot.settings.notificationTimeoutType === 'default' ? 'active' : ''} onClick={() => void changeSettings({ notificationTimeoutType: 'default' })}>
                系统默认
              </button>
              <button className={snapshot.settings.notificationTimeoutType === 'custom' ? 'active' : ''} onClick={() => void changeSettings({ notificationTimeoutType: 'custom' })}>
                自定义
              </button>
              <button className={snapshot.settings.notificationTimeoutType === 'never' ? 'active' : ''} onClick={() => void changeSettings({ notificationTimeoutType: 'never' })}>
                手动关闭
              </button>
            </div>
            {snapshot.settings.notificationTimeoutType === 'custom' && (
              <label className="range-row compact-range">
                <span>{snapshot.settings.notificationDurationSeconds} 秒后关闭</span>
                <input type="range" min="3" max="300" step="1" value={snapshot.settings.notificationDurationSeconds} onChange={(event) => void changeSettings({ notificationDurationSeconds: Number(event.target.value) })} />
              </label>
            )}
            <p className="shortcut-help">自定义会先保持悬浮，再按设定秒数关闭；手动关闭会一直悬浮直到用户关闭通知。</p>
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

      {editing && <div className="resize-grip" aria-hidden="true" />}
    </div>
  );
}

function StatusLine({ ok, text }: { ok: boolean; text: string }) {
  return <div className={`status-line ${ok ? 'ok' : 'warning'}`}><span />{text}</div>;
}

export default App;
