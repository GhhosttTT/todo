import { app, BrowserWindow, screen } from 'electron';
import type { DesktopBindingStatus, RuntimeStatus, WindowBounds, WindowMode } from '../src/types';
import { DesktopLayer } from './desktopLayer';

export const FIXED_WINDOW_HEIGHT = 620;

export class WindowController {
  private mode: WindowMode = 'starting';
  private generation = 0;
  private transition: Promise<void> = Promise.resolve();

  constructor(
    private readonly window: BrowserWindow,
    private readonly desktopLayer: DesktopLayer,
    private readonly runtime: RuntimeStatus,
    private readonly onStatusChanged: () => void,
  ) {}

  getMode(): WindowMode { return this.mode; }

  startViewing(): Promise<void> {
    return this.enqueue(async (generation) => { await this.bindForView(generation); });
  }

  setEditing(editing: boolean): Promise<void> {
    return this.enqueue(async (generation) => {
      if (editing) await this.enterEditing(generation);
      else await this.exitEditing(generation);
    });
  }

  toggleEditing(): Promise<void> {
    return this.setEditing(this.mode !== 'editing' && this.mode !== 'entering-editing');
  }

  retryBinding(): Promise<DesktopBindingStatus> {
    return this.enqueue(async (generation) => { await this.bindForView(generation); }).then(() => this.runtime.desktop);
  }

  hide(): void {
    this.window.hide();
    this.setMode('hidden');
  }

  safeBounds(bounds: WindowBounds): Electron.Rectangle {
    const displays = screen.getAllDisplays();
    const preferred = bounds.displayId ? displays.find(({ id }) => String(id) === bounds.displayId) : undefined;
    const target = preferred ?? screen.getDisplayMatching(bounds);
    const area = target.workArea;
    const width = Math.min(Math.max(bounds.width, 680), area.width);
    const height = Math.min(FIXED_WINDOW_HEIGHT, area.height);
    return {
      x: Math.min(Math.max(bounds.x, area.x), area.x + area.width - width),
      y: Math.min(Math.max(bounds.y, area.y), area.y + area.height - height),
      width,
      height,
    };
  }

  currentBounds(): WindowBounds {
    const bounds = this.window.getBounds();
    const display = screen.getDisplayMatching(bounds);
    return { ...bounds, displayId: String(display.id), scaleFactor: display.scaleFactor };
  }

  private enqueue(action: (generation: number) => Promise<void>): Promise<void> {
    const generation = ++this.generation;
    const next = this.transition.then(() => action(generation));
    this.transition = next.catch(() => undefined);
    return next;
  }

  private async enterEditing(generation: number): Promise<void> {
    if (this.mode === 'editing') return;
    this.setMode('entering-editing');
    const detached = this.desktopLayer.detach(this.window);
    if (generation !== this.generation) return;
    if (detached.state === 'fallback') this.runtime.desktop = detached;
    this.window.setFocusable(true);
    this.window.setIgnoreMouseEvents(false);
    if (this.window.isMinimized()) this.window.restore();
    this.window.show();
    app.focus({ steal: true });
    this.window.moveTop();
    this.window.focus();
    this.setMode('editing');
  }

  private async exitEditing(generation: number): Promise<void> {
    if (this.mode !== 'editing' && this.mode !== 'entering-editing') return;
    this.setMode('exiting-editing');
    this.setMode('rebinding');
    await this.bindForView(generation);
  }

  private async bindForView(generation: number): Promise<void> {
    this.window.setAlwaysOnTop(false);
    this.window.setSkipTaskbar(true);
    this.window.showInactive();
    const status = this.desktopLayer.bind(this.window);
    if (generation !== this.generation) return;
    this.runtime.desktop = status;
    if (status.state === 'bound') {
      this.setMode('viewing-desktop');
    } else {
      this.window.setFocusable(true);
      this.desktopLayer.sendToBottom(this.window);
      this.setMode('viewing-fallback');
    }
  }

  private setMode(mode: WindowMode): void {
    this.mode = mode;
    this.runtime.windowMode = mode;
    this.onStatusChanged();
  }
}
