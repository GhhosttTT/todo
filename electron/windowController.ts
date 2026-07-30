import { app, BrowserWindow, screen } from 'electron';
import { dimensionsForLayout, minDimensionsForLayout } from '../src/domain/layout';
import type { DesktopBindingStatus, RuntimeStatus, WindowBounds, WindowMode, LayoutMode } from '../src/types';
import { DesktopLayer } from './desktopLayer';

export const DEFAULT_WINDOW_HEIGHT = dimensionsForLayout('expanded').height;
export const MINIMUM_WINDOW_WIDTH = minDimensionsForLayout('compact').width;
export const MINIMUM_WINDOW_HEIGHT = minDimensionsForLayout('expanded').height;
const FOCUS_BOOST_DURATION_MS = 900;

export class WindowController {
  private mode: WindowMode = 'starting';
  private generation = 0;
  private transition: Promise<void> = Promise.resolve();
  private layoutMode: LayoutMode;

  constructor(
    private readonly window: BrowserWindow,
    private readonly desktopLayer: DesktopLayer,
    private readonly runtime: RuntimeStatus,
    private readonly onStatusChanged: () => void,
    initialLayoutMode: LayoutMode,
    private readonly onBeforeExitEditing?: () => Promise<void> | void,
  ) {
    this.layoutMode = initialLayoutMode;
    this.applyMinimumSize();
  }

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

  safeBounds(bounds: WindowBounds, layoutMode = this.layoutMode): Electron.Rectangle {
    const displays = screen.getAllDisplays();
    const preferred = bounds.displayId ? displays.find(({ id }) => String(id) === bounds.displayId) : undefined;
    const target = preferred ?? screen.getDisplayMatching(bounds);
    const area = target.workArea;
    const minimum = minDimensionsForLayout(layoutMode);
    const width = Math.min(Math.max(bounds.width, minimum.width), area.width);
    const height = Math.min(Math.max(bounds.height, minimum.height), area.height);
    return {
      x: Math.min(Math.max(bounds.x, area.x), area.x + area.width - width),
      y: Math.min(Math.max(bounds.y, area.y), area.y + area.height - height),
      width,
      height,
    };
  }

  applyLayoutBounds(bounds: WindowBounds, layoutMode = this.layoutMode): Electron.Rectangle {
    this.layoutMode = layoutMode;
    this.applyMinimumSize();
    const safe = this.safeBounds(bounds, layoutMode);
    this.window.setBounds(safe, true);
    return safe;
  }

  ensureVisible(): Electron.Rectangle {
    const safe = this.safeBounds(this.currentBounds());
    this.window.setBounds(safe, true);
    return safe;
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
    this.applyMinimumSize();
    this.window.setResizable(true);
    this.window.setFocusable(true);
    this.window.setIgnoreMouseEvents(false);
    if (this.window.isMinimized()) this.window.restore();
    this.window.setAlwaysOnTop(true, 'pop-up-menu');
    this.window.showInactive();
    this.window.moveTop();
    this.window.show();
    this.window.focus();
    app.focus({ steal: true });
    setTimeout(() => {
      if (!this.window.isDestroyed() && this.mode === 'editing') this.window.setAlwaysOnTop(false);
    }, FOCUS_BOOST_DURATION_MS);
    this.setMode('editing');
  }

  private async exitEditing(generation: number): Promise<void> {
    if (this.mode !== 'editing' && this.mode !== 'entering-editing') return;
    this.setMode('exiting-editing');
    await this.onBeforeExitEditing?.();
    if (generation !== this.generation) return;
    this.window.setAlwaysOnTop(false);
    this.window.setResizable(false);
    this.setMode('rebinding');
    await this.bindForView(generation);
  }

  private async bindForView(generation: number): Promise<void> {
    this.window.setAlwaysOnTop(false);
    this.window.setResizable(false);
    this.window.setSkipTaskbar(true);
    this.ensureVisible();
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

  private applyMinimumSize(): void {
    const minimum = minDimensionsForLayout(this.layoutMode);
    this.window.setMinimumSize(minimum.width, minimum.height);
  }
}
