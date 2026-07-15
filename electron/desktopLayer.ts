import type { BrowserWindow } from 'electron';
import type { DesktopBindingStatus } from '../src/types';

const GWL_STYLE = -16;
const WS_CHILD = 0x40000000n;
const WS_POPUP = 0x80000000n;
const SWP_NOSIZE = 0x0001;
const SWP_NOMOVE = 0x0002;
const SWP_NOACTIVATE = 0x0010;
const SWP_FRAMECHANGED = 0x0020;
const SMTO_ABORTIFHUNG = 0x0002;

interface NativeApi {
  koffi: {
    address(value: unknown): bigint;
    decode(value: unknown, type: unknown): unknown;
  };
  HWND: unknown;
  FindWindowW: (...args: unknown[]) => unknown;
  FindWindowExW: (...args: unknown[]) => unknown;
  SendMessageTimeoutW: (...args: unknown[]) => unknown;
  EnumWindows: (...args: unknown[]) => unknown;
  SetParent: (...args: unknown[]) => unknown;
  GetParent: (...args: unknown[]) => unknown;
  IsWindow: (...args: unknown[]) => boolean;
  IsWindowVisible: (...args: unknown[]) => boolean;
  GetWindowLongPtrW: (...args: unknown[]) => bigint | number;
  SetWindowLongPtrW: (...args: unknown[]) => bigint | number;
  SetWindowPos: (...args: unknown[]) => boolean;
}

function samePointer(api: NativeApi, left: unknown, right: unknown): boolean {
  if (!left || !right) return false;
  return api.koffi.address(left) === api.koffi.address(right);
}

export class DesktopLayer {
  private api?: NativeApi;
  private workerW?: unknown;
  private originalStyle?: bigint;

  async initialize(): Promise<void> {
    if (process.platform !== 'win32') return;
    const koffi = (await import('koffi')).default;
    const user32 = koffi.load('user32.dll');
    const HWND = koffi.pointer('HWND', koffi.opaque());
    const EnumWindowsProc = koffi.proto('__stdcall', 'EnumWindowsProc', 'bool', [HWND, 'intptr_t']);
    this.api = {
      koffi,
      HWND,
      FindWindowW: user32.func('__stdcall', 'FindWindowW', HWND, ['str16', 'str16']),
      FindWindowExW: user32.func('__stdcall', 'FindWindowExW', HWND, [HWND, HWND, 'str16', 'str16']),
      SendMessageTimeoutW: user32.func('__stdcall', 'SendMessageTimeoutW', 'uintptr_t', [HWND, 'uint32_t', 'uintptr_t', 'intptr_t', 'uint32_t', 'uint32_t', koffi.out(koffi.pointer('uintptr_t'))]),
      EnumWindows: user32.func('__stdcall', 'EnumWindows', 'bool', [koffi.pointer(EnumWindowsProc), 'intptr_t']),
      SetParent: user32.func('__stdcall', 'SetParent', HWND, [HWND, HWND]),
      GetParent: user32.func('__stdcall', 'GetParent', HWND, [HWND]),
      IsWindow: user32.func('__stdcall', 'IsWindow', 'bool', [HWND]),
      IsWindowVisible: user32.func('__stdcall', 'IsWindowVisible', 'bool', [HWND]),
      GetWindowLongPtrW: user32.func('__stdcall', 'GetWindowLongPtrW', 'intptr_t', [HWND, 'int']),
      SetWindowLongPtrW: user32.func('__stdcall', 'SetWindowLongPtrW', 'intptr_t', [HWND, 'int', 'intptr_t']),
      SetWindowPos: user32.func('__stdcall', 'SetWindowPos', 'bool', [HWND, HWND, 'int', 'int', 'int', 'int', 'uint32_t']),
    };
  }

  bind(window: BrowserWindow): DesktopBindingStatus {
    try {
      const api = this.requireApi();
      const hwnd = api.koffi.decode(window.getNativeWindowHandle(), api.HWND);
      const workerW = this.workerW && api.IsWindow(this.workerW) ? this.workerW : this.findWorkerW(api);
      if (!workerW) return { state: 'fallback', stage: 'find-workerw', message: '未找到可验证的 WorkerW 桌面层。' };
      if (!api.IsWindow(hwnd) || !api.IsWindow(workerW)) return { state: 'fallback', stage: 'validate-handles', message: '桌面窗口句柄已失效。' };

      const currentStyle = BigInt(api.GetWindowLongPtrW(hwnd, GWL_STYLE));
      this.originalStyle ??= currentStyle;
      const childStyle = (currentStyle | WS_CHILD) & ~WS_POPUP;
      api.SetWindowLongPtrW(hwnd, GWL_STYLE, childStyle);
      api.SetParent(hwnd, workerW);
      const bounds = window.getBounds();
      api.SetWindowPos(hwnd, null, bounds.x, bounds.y, bounds.width, bounds.height, SWP_NOACTIVATE | SWP_FRAMECHANGED);

      const parent = api.GetParent(hwnd);
      if (!samePointer(api, parent, workerW) || !api.IsWindowVisible(hwnd)) {
        return { state: 'fallback', stage: 'verify-parent', message: 'WorkerW 父子关系或可见性验证失败。' };
      }
      this.workerW = workerW;
      return { state: 'bound' };
    } catch (error) {
      return { state: 'fallback', stage: 'native-call', message: error instanceof Error ? error.message : 'Win32 调用失败。' };
    }
  }

  detach(window: BrowserWindow): DesktopBindingStatus {
    try {
      const api = this.requireApi();
      const hwnd = api.koffi.decode(window.getNativeWindowHandle(), api.HWND);
      api.SetParent(hwnd, null);
      const style = this.originalStyle ?? BigInt(api.GetWindowLongPtrW(hwnd, GWL_STYLE));
      api.SetWindowLongPtrW(hwnd, GWL_STYLE, (style | WS_POPUP) & ~WS_CHILD);
      api.SetWindowPos(hwnd, null, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_FRAMECHANGED);
      if (api.GetParent(hwnd)) return { state: 'fallback', stage: 'detach', message: '窗口未能脱离桌面父窗口。' };
      return { state: 'pending' };
    } catch (error) {
      return { state: 'fallback', stage: 'detach', message: error instanceof Error ? error.message : '窗口脱离失败。' };
    }
  }

  isBindingAlive(window: BrowserWindow): boolean {
    if (!this.api || !this.workerW) return false;
    try {
      const hwnd = this.api.koffi.decode(window.getNativeWindowHandle(), this.api.HWND);
      return this.api.IsWindow(hwnd) && this.api.IsWindow(this.workerW) && samePointer(this.api, this.api.GetParent(hwnd), this.workerW);
    } catch {
      return false;
    }
  }

  sendToBottom(window: BrowserWindow): void {
    try {
      const api = this.requireApi();
      const hwnd = api.koffi.decode(window.getNativeWindowHandle(), api.HWND);
      api.SetWindowPos(hwnd, 1, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    } catch {
      // Fallback ordering is best-effort by definition.
    }
  }

  private requireApi(): NativeApi {
    if (!this.api) throw new Error(process.platform === 'win32' ? 'Win32 API 尚未初始化。' : 'WorkerW 仅支持 Windows。');
    return this.api;
  }

  private findWorkerW(api: NativeApi): unknown | undefined {
    const progman = api.FindWindowW('Progman', null);
    if (!progman) return undefined;
    const result = [null];
    api.SendMessageTimeoutW(progman, 0x052c, 0, 0, SMTO_ABORTIFHUNG, 1000, result);
    let found: unknown;
    api.EnumWindows((topLevel: unknown) => {
      const defView = api.FindWindowExW(topLevel, null, 'SHELLDLL_DefView', null);
      if (!defView) return true;
      const candidate = api.FindWindowExW(null, topLevel, 'WorkerW', null);
      if (candidate && api.IsWindow(candidate)) found = candidate;
      return !found;
    }, 0);
    return found;
  }
}
