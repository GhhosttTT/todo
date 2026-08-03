import { addDays, addMonths, endOfMonth, endOfWeek, format, isSameMonth, startOfMonth, startOfWeek } from 'date-fns';
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  HardDrive,
  Keyboard,
  MonitorDown,
  Plus,
  Repeat2,
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
import type { AppSnapshot, MutationResult, RecurrenceFrequency, Task } from './types';

interface DraftTask {
  title: string;
  notes: string;
  dueDate: string;
  remindAt: string;
  recurrence: RecurrenceFrequency;
}

const recurrenceOptions: RecurrenceFrequency[] = ['none', 'daily', 'weekly', 'monthly', 'yearly'];
const eventToneClasses = ['red', 'blue', 'green', 'amber', 'violet'];
const weekdayLabels = ['日', '一', '二', '三', '四', '五', '六'];

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

function taskAnchorDate(task: Task): Date | null {
  if (task.remindAt) {
    const date = new Date(task.remindAt);
    if (Number.isFinite(date.getTime())) return date;
  }
  if (task.dueDate) {
    const [year, month, day] = task.dueDate.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    if (Number.isFinite(date.getTime())) return date;
  }
  return null;
}

function formatTaskSchedule(task: Task): string {
  const anchor = taskAnchorDate(task);
  const time = task.remindAt ? formatAgendaTime(task.remindAt) : '';
  const suffix = time ? ` ${time} 提示` : ' 提示';
  if (task.recurrence === 'daily') return `每天${suffix}`;
  if (task.recurrence === 'weekly' && anchor) return `每周${weekdayLabels[anchor.getDay()]}${suffix}`;
  if (task.recurrence === 'monthly' && anchor) return `每月 ${anchor.getDate()} 日${suffix}`;
  if (task.recurrence === 'yearly' && anchor) return `每年 ${anchor.getMonth() + 1} 月 ${anchor.getDate()} 日${suffix}`;
  if (task.remindAt) return formatReminder(task.remindAt);
  return task.dueDate ?? '未设置时间';
}

function formatMonthEventPrefix(task: Task): string {
  if (task.recurrence !== 'none') return recurrenceLabels[task.recurrence];
  return task.remindAt ? formatAgendaTime(task.remindAt) : '';
}

function dateFromKey(dateKey: string): Date {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function eventTone(task: Task): string {
  if (task.completedAt) return 'completed';
  const seed = Array.from(task.id || task.title).reduce((total, char) => total + char.charCodeAt(0), 0);
  return eventToneClasses[seed % eventToneClasses.length];
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
  const [dayPopoverOpen, setDayPopoverOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftTask>({ title: '', notes: '', dueDate: '', remindAt: '', recurrence: 'none' });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shortcutDraft, setShortcutDraft] = useState('Ctrl+Alt+T');
  const [shortcutRecording, setShortcutRecording] = useState(false);
  const [shortcutError, setShortcutError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; kind: 'error' | 'info' } | null>(null);
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
    const timer = window.setTimeout(() => setNotice(null), 4200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const applyResult = useCallback((result: MutationResult) => {
    setSnapshot(result.snapshot);
    if (!result.ok) setNotice({ text: result.error ?? '操作失败。', kind: 'error' });
    return result.ok;
  }, []);

  const editing = snapshot?.runtime.windowMode === 'editing' || snapshot?.runtime.windowMode === 'entering-editing';
  const selectedDateObject = useMemo(() => dateFromKey(selectedDate), [selectedDate]);
  const selectedDateLabel = useMemo(() => format(selectedDateObject, 'yyyy年 MM月dd日'), [selectedDateObject]);
  const monthCells = useMemo(() => {
    const gridStart = startOfWeek(startOfMonth(selectedDateObject));
    const gridEnd = endOfWeek(endOfMonth(selectedDateObject));
    const cells: Date[] = [];
    for (let cursor = gridStart; cursor <= gridEnd; cursor = addDays(cursor, 1)) {
      cells.push(cursor);
    }
    return cells;
  }, [selectedDateObject]);
  const tasksByDate = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const grouped = new Map<string, Task[]>();
    snapshot?.tasks
      .filter((task) => snapshot.settings.showCompleted || !task.completedAt)
      .filter((task) => !normalizedQuery || task.title.toLocaleLowerCase().includes(normalizedQuery) || task.notes.toLocaleLowerCase().includes(normalizedQuery))
      .forEach((task) => {
        const key = taskCalendarDate(task);
        if (!key) return;
        const tasks = grouped.get(key) ?? [];
        tasks.push(task);
        grouped.set(key, tasks);
      });
    grouped.forEach((tasks) => tasks.sort((left, right) => {
      if (Boolean(left.completedAt) !== Boolean(right.completedAt)) return left.completedAt ? 1 : -1;
      const leftTime = left.remindAt ? Date.parse(left.remindAt) : Number.MAX_SAFE_INTEGER;
      const rightTime = right.remindAt ? Date.parse(right.remindAt) : Number.MAX_SAFE_INTEGER;
      if (leftTime !== rightTime) return leftTime - rightTime;
      return left.sortOrder - right.sortOrder || left.createdAt.localeCompare(right.createdAt);
    }));
    return grouped;
  }, [query, snapshot]);
  const selectedDayTasks = useMemo(() => tasksByDate.get(selectedDate) ?? [], [selectedDate, tasksByDate]);
  const selectedTask = useMemo(() => selectedDayTasks.find((task) => task.id === editingId) ?? null, [editingId, selectedDayTasks]);

  useEffect(() => {
    if (editing) return;
    setSettingsOpen(false);
    setComposerOpen(false);
    setDayPopoverOpen(false);
    setEditingId(null);
  }, [editing]);

  const openComposer = () => {
    setComposer({ title: '', notes: '', dueDate: selectedDate, remindAt: defaultReminderForDate(selectedDate), recurrence: 'none' });
    setComposerOpen(true);
    setDayPopoverOpen(true);
    setEditingId(null);
  };

  const selectMonthOffset = (offset: number) => {
    const target = addMonths(selectedDateObject, offset);
    setSelectedDate(format(target, 'yyyy-MM-dd'));
    setQuery('');
    setComposerOpen(false);
    setEditingId(null);
  };

  const selectDay = (dateKey: string) => {
    setSelectedDate(dateKey);
    setComposerOpen(false);
    setEditingId(null);
    setDayPopoverOpen(true);
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
    setDayPopoverOpen(true);
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
    if (task.completedAt) return;
    applyResult(await window.todo.setTaskCompleted({ id: task.id, completed: !task.completedAt, baseRevision: snapshot.revision }));
  };

  const deleteTask = async (id: string) => {
    if (!snapshot) return;
    const result = await window.todo.deleteTask({ id, baseRevision: snapshot.revision });
    if (applyResult(result)) {
      setEditingId(null);
      setNotice({ text: '任务已删除', kind: 'info' });
    }
  };

  const changeSettings = async (settings: Parameters<typeof window.todo.updateSettings>[0]['settings']) => {
    if (!snapshot) return;
    applyResult(await window.todo.updateSettings({ settings, baseRevision: snapshot.revision }));
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
      className={`app-shell calendar-widget theme-${snapshot.settings.theme} layout-expanded ${editing ? 'is-editing' : 'is-viewing'}`}
      style={{ '--surface-opacity': snapshot.settings.opacity, '--background-intensity': snapshot.settings.backgroundIntensity } as React.CSSProperties}
    >
      <aside className="sidebar calendar-toolbar">
        <div className="drag-strip calendar-drag-strip" aria-hidden="true" />

        <div className="calendar-toolbar-main">
          <button className="toolbar-command today-command" onClick={() => selectDay(todayKey)}>Today</button>
          <div className="month-switcher">
            <button className="icon-button" onClick={() => selectMonthOffset(-1)} title="上个月"><ChevronLeft size={18} /></button>
            <strong>{format(selectedDateObject, 'MMMM yyyy')}</strong>
            <button className="icon-button" onClick={() => selectMonthOffset(1)} title="下个月"><ChevronRight size={18} /></button>
          </div>

          {editing && (
            <label className="search-box calendar-search-box">
              <Search size={18} strokeWidth={2.2} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索提醒" aria-label="搜索提醒" />
              {query && <button className="icon-button compact" onClick={() => setQuery('')} title="清除搜索"><X size={15} /></button>}
            </label>
          )}

          {editing ? (
            <div className="toolbar-actions">
              <button aria-label="打开设置" className={`sidebar-command ${runtimeWarning ? 'has-warning' : ''}`} onClick={() => setSettingsOpen(true)}>
                <SettingsIcon size={18} />
                <span>设置</span>
              </button>
              <button className="sidebar-command primary" onClick={() => void exitEditing()}>
                <Check size={18} />
                <span>完成</span>
              </button>
            </div>
          ) : (
            <div className="shortcut-hint" aria-label={`按 ${snapshot.settings.globalShortcut} 进入编辑模式`}>
              <Keyboard size={13} />
              <kbd>{snapshot.settings.globalShortcut}</kbd>
            </div>
          )}
        </div>
      </aside>

      <main className="task-pane calendar-month-pane">
        <section className="calendar-month-board" aria-label="月历">
          <div className="calendar-week-header">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((week) => <span key={week}>{week}</span>)}
          </div>

          <div className="calendar-month-grid">
            {monthCells.map((date) => {
              const dateKey = format(date, 'yyyy-MM-dd');
              const dayTasks = tasksByDate.get(dateKey) ?? [];
              const overflowCount = Math.max(0, dayTasks.length - 3);
              return (
                <div
                  key={dateKey}
                  className={`calendar-month-cell ${selectedDate === dateKey ? 'active' : ''} ${dateKey === todayKey ? 'today' : ''} ${isSameMonth(date, selectedDateObject) ? '' : 'outside-month'}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => selectDay(dateKey)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      selectDay(dateKey);
                    }
                  }}
                >
                  <div className="month-cell-head">
                    <span>{format(date, 'd')}</span>
                    {dateKey === todayKey && <em>Today</em>}
                  </div>
                  <div className="month-event-stack">
                    {dayTasks.slice(0, 3).map((task) => (
                      <button
                        key={task.id}
                        className={`month-event-pill ${eventTone(task)}`}
                        onClick={() => selectDay(dateKey)}
                        title={task.title}
                      >
                        {formatMonthEventPrefix(task) && <span>{formatMonthEventPrefix(task)}</span>}
                        <strong>{task.title}</strong>
                      </button>
                    ))}
                    {overflowCount > 0 && <small className="month-event-more">+{overflowCount} more</small>}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {editing && <button className="calendar-floating-add" onClick={openComposer} title="添加提醒"><Plus size={28} /></button>}
      </main>

      {editing && composerOpen && (
        <div className="event-popover-layer" onClick={() => { setComposerOpen(false); setDayPopoverOpen(false); }}>
          <aside className="event-popover" onClick={(event) => event.stopPropagation()} aria-label="新建提醒">
            <header>
              <div><span>NEW REMINDER</span><h2>{selectedDateLabel}</h2></div>
              <button className="icon-button" onClick={() => setComposerOpen(false)} title="关闭"><X size={19} /></button>
            </header>
            <div className="task-editor">
              <input autoFocus className="title-input" value={composer.title} onChange={(event) => setComposer({ ...composer, title: event.target.value })} onKeyDown={(event) => { if (event.key === 'Enter') void createTask(); }} placeholder="新提醒" maxLength={300} />
              <textarea value={composer.notes} onChange={(event) => setComposer({ ...composer, notes: event.target.value })} placeholder="备注（可选）" maxLength={10000} />
              <div className="editor-footer">
                <label><CalendarDays size={15} /><span>{composer.recurrence === 'none' ? '日期' : '起始日期'}</span><input type="date" value={composer.dueDate} onChange={(event) => setComposer({ ...composer, dueDate: event.target.value })} /></label>
                <label><Clock3 size={15} /><span>{composer.recurrence === 'none' ? '提醒时间' : '提示时间'}</span><input type="datetime-local" value={composer.remindAt} onChange={(event) => setComposer({ ...composer, remindAt: event.target.value })} /></label>
                <label><Repeat2 size={15} /><select value={composer.recurrence} onChange={(event) => setComposer({ ...composer, recurrence: event.target.value as RecurrenceFrequency })}>{recurrenceOptions.map((option) => <option key={option} value={option}>{recurrenceLabels[option]}</option>)}</select></label>
                <span />
                <button className="text-button" onClick={() => setComposerOpen(false)}>取消</button>
                <button className="text-button primary" disabled={!composer.title.trim()} onClick={() => void createTask()}>添加</button>
              </div>
            </div>
          </aside>
        </div>
      )}

      {dayPopoverOpen && !composerOpen && (
        <div className="event-popover-layer" onClick={() => { setDayPopoverOpen(false); setEditingId(null); }}>
          <aside className="event-popover day-popover" onClick={(event) => event.stopPropagation()} aria-label="当天提醒">
            <header>
              <div><span>DAY DETAIL</span><h2>{selectedDateLabel}</h2><p>{selectedDayTasks.length} 个提醒</p></div>
              <div className="popover-header-actions">
                {editing && <button className="icon-button" onClick={openComposer} title="添加提醒"><Plus size={20} /></button>}
                <button className="icon-button" onClick={() => { setDayPopoverOpen(false); setEditingId(null); }} title="关闭"><X size={19} /></button>
              </div>
            </header>

            <div className="day-popover-grid">
              <div className="day-event-list">
                {selectedDayTasks.length === 0 ? (
                  <div className="day-empty">这一天还没有提醒。</div>
                ) : selectedDayTasks.map((task) => (
                  <button key={task.id} className={`day-event-item ${editingId === task.id ? 'active' : ''} ${task.completedAt ? 'completed' : ''}`} onClick={() => editing ? beginEdit(task) : setEditingId(task.id)}>
                    <time>{task.recurrence === 'none' ? formatAgendaTime(task.remindAt) : recurrenceLabels[task.recurrence]}</time>
                    <span>
                      <strong>{task.title}</strong>
                      <small>{formatTaskSchedule(task)}</small>
                      {task.notes && <small>{task.notes}</small>}
                    </span>
                  </button>
                ))}
              </div>

              <div className="day-editor-panel">
                {selectedTask ? (
                  editing ? (
                  <div className="task-editor">
                    <input autoFocus className="title-input" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} maxLength={300} />
                    <textarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} placeholder="备注（可选）" maxLength={10000} />
                    <div className="editor-footer">
                      <label><CalendarDays size={15} /><span>{draft.recurrence === 'none' ? '日期' : '起始日期'}</span><input type="date" value={draft.dueDate} onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })} /></label>
                      <label><Clock3 size={15} /><span>{draft.recurrence === 'none' ? '提醒时间' : '提示时间'}</span><input type="datetime-local" value={draft.remindAt} onChange={(event) => setDraft({ ...draft, remindAt: event.target.value })} /></label>
                      <label><Repeat2 size={15} /><select value={draft.recurrence} onChange={(event) => setDraft({ ...draft, recurrence: event.target.value as RecurrenceFrequency })}>{recurrenceOptions.map((option) => <option key={option} value={option}>{recurrenceLabels[option]}</option>)}</select></label>
                      {!selectedTask.completedAt && <button className="completion-action" onClick={() => void toggleCompleted(selectedTask)}>完成</button>}
                      {selectedTask.completedAt && <span className="completed-lock">已完成</span>}
                      <button className="danger-icon" onClick={() => void deleteTask(selectedTask.id)} title="删除任务"><Trash2 size={16} /></button>
                      <button className="text-button" onClick={() => setEditingId(null)}>取消</button>
                      <button className="text-button primary" disabled={!draft.title.trim()} onClick={() => void saveTask()}>保存</button>
                    </div>
                  </div>
                  ) : (
                    <div className="day-read-panel">
                      <h3>{selectedTask.title}</h3>
                      {selectedTask.notes && <p>{selectedTask.notes}</p>}
                      <div className="task-timing-row">
                        <span>{selectedTask.recurrence === 'none' ? <CalendarDays size={13} /> : <Repeat2 size={13} />}{formatTaskSchedule(selectedTask)}</span>
                      </div>
                    </div>
                  )
                ) : (
                  <div className="day-detail-placeholder">
                    <CalendarDays size={24} />
                    <span>选择左侧提醒查看详情</span>
                  </div>
                )}
              </div>
            </div>
          </aside>
        </div>
      )}

      {settingsOpen && (
        <aside className="settings-drawer" aria-label="设置与运行状态">
          <header>
            <div><span>SETTINGS</span><h2>设置与状态</h2></div>
            <button className="icon-button" onClick={() => setSettingsOpen(false)} title="关闭设置"><X size={20} /></button>
          </header>

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
