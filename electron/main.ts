import { app, BrowserWindow, globalShortcut, Menu, nativeImage, screen, Tray } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AppSnapshot, RuntimeStatus } from '../src/types';
import { DesktopLayer } from './desktopLayer';
import { clearIpcHandlers, registerIpcHandlers } from './ipc';
import { ReminderScheduler } from './reminderScheduler';
import { resolveHostExecutablePath, resolvePathsFromEnvironment } from './runtimePaths';
import { TaskStore } from './taskStore';
import { FIXED_WINDOW_HEIGHT, WindowController } from './windowController';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const hostExecutablePath = resolveHostExecutablePath(
  process.execPath,
  app.isPackaged ? process.env.PORTABLE_EXECUTABLE_FILE : undefined,
);
const appRoot = app.isPackaged ? dirname(hostExecutablePath) : process.cwd();
const assetRoot = app.isPackaged ? join(currentDirectory, '../renderer') : join(appRoot, 'assets');
const defaultUserData = app.getPath('userData');
const paths = resolvePathsFromEnvironment(appRoot, defaultUserData, process.argv, assetRoot);
if (process.platform === 'win32') app.setAppUserModelId('com.ghhostttt.todo');
const capturePath = process.argv.find((argument) => argument.startsWith('--todo-capture='))?.slice('--todo-capture='.length)
  ?? process.env.TODO_CAPTURE_PATH;
const captureSize = process.argv.find((argument) => argument.startsWith('--todo-capture-size='))?.slice('--todo-capture-size='.length);
const captureViewMode = process.argv.includes('--todo-capture-view');
const captureSettings = process.argv.includes('--todo-capture-settings');
const captureThemeArgument = process.argv.find((argument) => argument.startsWith('--todo-capture-theme='))?.slice('--todo-capture-theme='.length);
const captureTheme = captureThemeArgument === 'dark' || captureThemeArgument === 'light' ? captureThemeArgument : undefined;
if (paths.effectiveMode === 'portable') app.setPath('userData', paths.dataDir);

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

let mainWindow: BrowserWindow | undefined;
let tray: Tray | undefined;
let controller: WindowController | undefined;
let reminders: ReminderScheduler | undefined;
let quitting = false;
let activeShortcut: string | undefined;
let suspendedShortcut: string | undefined;
let boundsSaveTimer: NodeJS.Timeout | undefined;
let updateTrayMenu: (() => void) | undefined;

const store = new TaskStore(paths.stateFile);
const runtime: RuntimeStatus = {
  requestedDataMode: paths.requestedMode,
  effectiveDataMode: paths.effectiveMode,
  dataPath: paths.dataDir,
  dataFallbackReason: paths.fallbackReason,
  readOnly: false,
  hasUnpersistedChanges: false,
  shortcutActive: false,
  desktop: { state: 'pending' },
  windowMode: 'starting',
};

function snapshot(): AppSnapshot {
  const current = store.getSnapshot();
  if (captureTheme) current.settings.theme = captureTheme;
  return { ...current, runtime: structuredClone(runtime) };
}

function broadcastSnapshot(): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('todo:snapshot-changed', snapshot());
}

function broadcastRuntime(): void {
  updateTrayMenu?.();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('todo:runtime-changed', structuredClone(runtime));
}

function applyLaunchAtLogin(enabled: boolean): void {
  if (process.platform !== 'win32') return;
  app.setLoginItemSettings({
    openAtLogin: enabled,
    path: hostExecutablePath,
    args: [],
  });
}

function registerGlobalShortcut(accelerator: string): { ok: boolean; error?: string } {
  const next = accelerator.trim();
  if (!next) return { ok: false, error: '快捷键不能为空。' };
  if (next === activeShortcut && runtime.shortcutActive) return { ok: true };
  const registered = globalShortcut.register(next, () => { void controller?.toggleEditing(); });
  if (!registered) {
    runtime.shortcutActive = Boolean(activeShortcut);
    runtime.shortcutError = `快捷键 ${next} 已被占用或无效。`;
    broadcastRuntime();
    return { ok: false, error: runtime.shortcutError };
  }
  if (activeShortcut) globalShortcut.unregister(activeShortcut);
  activeShortcut = next;
  suspendedShortcut = undefined;
  runtime.shortcutActive = true;
  runtime.shortcutError = undefined;
  broadcastRuntime();
  return { ok: true };
}

function setShortcutCapture(capturing: boolean): void {
  if (capturing) {
    if (activeShortcut) {
      suspendedShortcut = activeShortcut;
      globalShortcut.unregister(activeShortcut);
      activeShortcut = undefined;
      runtime.shortcutActive = false;
      runtime.shortcutError = undefined;
      broadcastRuntime();
    }
    return;
  }

  if (!activeShortcut && suspendedShortcut) registerGlobalShortcut(suspendedShortcut);
}

function fallbackIconSvg(): string {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect x="6" y="6" width="52" height="52" rx="14" fill="#3478f6"/><rect x="17" y="17" width="30" height="7" rx="3.5" fill="#fff"/><rect x="28.5" y="17" width="7" height="29" rx="3.5" fill="#fff"/><circle cx="45" cy="45" r="11" fill="#fff"/><path d="M39.8 45.2 43.2 48.6 50.6 40.7" fill="none" stroke="#3478f6" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}

function loadIcon(size = 16): Electron.NativeImage {
  const icoPath = join(paths.assetRoot, 'icons', 'todo-tray.ico');
  if (process.platform === 'win32' && existsSync(icoPath)) {
    const image = nativeImage.createFromPath(icoPath);
    if (!image.isEmpty()) return image.resize({ width: size, height: size });
  }

  const pngPath = join(paths.assetRoot, 'icons', `todo-tray-${size >= 48 ? 64 : 32}.png`);
  if (existsSync(pngPath)) {
    const image = nativeImage.createFromPath(pngPath);
    if (!image.isEmpty()) return image.resize({ width: size, height: size });
  }

  const svgPath = join(paths.assetRoot, 'icons', 'todo-tray.svg');
  const svg = existsSync(svgPath) ? readFileSync(svgPath, 'utf8') : fallbackIconSvg();
  return nativeImage
    .createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`)
    .resize({ width: size, height: size });
}

function createTrayIcon(): Electron.NativeImage {
  return loadIcon(16);
}

function createTray(): void {
  tray = new Tray(createTrayIcon());
  tray.setToolTip('Todo 桌面插件');
  updateTrayMenu = () => {
    const editing = runtime.windowMode === 'editing' || runtime.windowMode === 'entering-editing';
    const modeAction = editing
      ? { label: '回到桌面', click: () => { void controller?.setEditing(false); } }
      : { label: '打开编辑', click: () => { void controller?.setEditing(true); } };
    tray?.setContextMenu(Menu.buildFromTemplate([
    modeAction,
    { type: 'separator' },
    { label: '重试桌面绑定', click: () => { void controller?.retryBinding(); } },
    { type: 'separator' },
    { label: '退出', click: () => { quitting = true; app.quit(); } },
  ]));
  };
  updateTrayMenu();
  tray.on('click', () => { void controller?.toggleEditing(); });
}

async function createWindow(): Promise<void> {
  const loaded = store.load();
  runtime.readOnly = loaded.readOnly;
  runtime.persistenceError = loaded.recoveryMessage;
  applyLaunchAtLogin(loaded.settings.launchAtLogin);

  const desktopLayer = new DesktopLayer();
  try {
    await desktopLayer.initialize();
  } catch (error) {
    runtime.desktop = { state: 'fallback', stage: 'initialize', message: error instanceof Error ? error.message : 'Win32 初始化失败。' };
  }

  mainWindow = new BrowserWindow({
    ...loaded.settings.windowBounds,
    minWidth: 680,
    height: FIXED_WINDOW_HEIGHT,
    minHeight: FIXED_WINDOW_HEIGHT,
    maxHeight: FIXED_WINDOW_HEIGHT,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    roundedCorners: true,
    skipTaskbar: true,
    show: false,
    hasShadow: true,
    icon: loadIcon(64),
    webPreferences: {
      preload: join(currentDirectory, '../preload/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.setOpacity(loaded.settings.opacity);
  controller = new WindowController(mainWindow, desktopLayer, runtime, broadcastRuntime);
  reminders = new ReminderScheduler(store, broadcastSnapshot, () => { void controller?.setEditing(true); }, loadIcon(64));
  mainWindow.setBounds(controller.safeBounds(loaded.settings.windowBounds));

  registerIpcHandlers({
    store,
    window: mainWindow,
    windowController: controller,
    runtime,
    registerShortcut: registerGlobalShortcut,
    setShortcutCapture,
    applyLaunchAtLogin,
    onStoreChanged: () => reminders?.scheduleAll(),
    transientSettings: captureTheme ? { theme: captureTheme } : undefined,
  });
  registerGlobalShortcut(loaded.settings.globalShortcut);
  reminders.scheduleAll();
  createTray();

  mainWindow.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      void controller?.setEditing(false);
    }
  });

  const scheduleBoundsSave = () => {
    if (!controller || !mainWindow || runtime.windowMode !== 'editing') return;
    if (boundsSaveTimer) clearTimeout(boundsSaveTimer);
    boundsSaveTimer = setTimeout(async () => {
      if (!controller) return;
      try {
        const current = store.getSnapshot();
        await store.updateSettings(current.revision, { windowBounds: controller.currentBounds() });
        broadcastSnapshot();
      } catch (error) {
        runtime.persistenceError = error instanceof Error ? error.message : '窗口位置保存失败。';
        runtime.hasUnpersistedChanges = true;
        broadcastRuntime();
      }
    }, 500);
  };
  mainWindow.on('move', scheduleBoundsSave);
  mainWindow.on('resize', scheduleBoundsSave);

  if (process.env.ELECTRON_RENDERER_URL) await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  else await mainWindow.loadFile(join(currentDirectory, '../renderer/index.html'));
  await controller.startViewing();
  if (!app.isPackaged && capturePath) {
    if (!captureViewMode) await controller.setEditing(true);
    if (captureSize && /^\d+x\d+$/.test(captureSize)) {
      const [width] = captureSize.split('x').map(Number);
      const bounds = mainWindow.getBounds();
      mainWindow.setBounds({ ...bounds, width: Math.max(680, width), height: FIXED_WINDOW_HEIGHT }, false);
      mainWindow.setContentSize(Math.max(680, width), FIXED_WINDOW_HEIGHT, false);
    }
    if (captureSettings) {
      await mainWindow.webContents.executeJavaScript(`new Promise((resolve) => {
        const deadline = Date.now() + 3000;
        const openSettings = () => {
          const button = document.querySelector('[aria-label="打开设置"]');
          if (button instanceof HTMLElement) {
            button.click();
            resolve(true);
          } else if (Date.now() < deadline) {
            setTimeout(openSettings, 50);
          } else {
            resolve(false);
          }
        };
        openSettings();
      })`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    const image = await mainWindow.capturePage();
    writeFileSync(capturePath, image.toPNG());
  }
}

if (hasSingleInstanceLock) {
  app.whenReady().then(async () => {
    const lockAcquired = store.acquireLock();
    if (!lockAcquired) {
      store.forceReadOnly('数据文件正在被另一个进程使用。');
      runtime.readOnly = true;
      runtime.persistenceError = store.getRecoveryMessage();
    }
    await createWindow();

    app.on('second-instance', () => { void controller?.setEditing(true); });
    screen.on('display-added', () => { if (runtime.windowMode !== 'editing') void controller?.startViewing(); });
    screen.on('display-removed', () => { if (runtime.windowMode !== 'editing') void controller?.startViewing(); });
    screen.on('display-metrics-changed', () => { if (runtime.windowMode !== 'editing') void controller?.startViewing(); });
  }).catch((error) => {
    console.error(error);
    app.quit();
  });
}

app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => {
  if (boundsSaveTimer) clearTimeout(boundsSaveTimer);
  globalShortcut.unregisterAll();
  clearIpcHandlers();
  reminders?.clear();
  store.releaseLock();
  tray?.destroy();
});
app.on('window-all-closed', () => { /* Tray application remains active. */ });
