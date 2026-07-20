export interface ShortcutKeyInput {
  key: string;
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

export interface ShortcutKeyResult {
  accelerator?: string;
  error?: string;
}

const modifierKeys = new Set(['Control', 'Alt', 'Shift', 'Meta']);
const namedKeys: Record<string, string> = {
  ' ': 'Space',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Escape: 'Esc',
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
};

function acceleratorKey(input: ShortcutKeyInput): string | undefined {
  if (modifierKeys.has(input.key)) return undefined;
  if (/^F(?:[1-9]|1\d|2[0-4])$/.test(input.key)) return input.key;
  if (/^Key[A-Z]$/.test(input.code)) return input.code.slice(3);
  if (/^Digit\d$/.test(input.code)) return input.code.slice(5);
  if (/^Numpad\d$/.test(input.code)) return `num${input.code.slice(6)}`;
  return namedKeys[input.key];
}

export function shortcutFromKeyInput(input: ShortcutKeyInput): ShortcutKeyResult {
  const key = acceleratorKey(input);
  if (!key) return { error: modifierKeys.has(input.key) ? '请继续按一个字母、数字或功能键。' : '这个按键不能用作全局快捷键。' };

  const hasModifier = input.ctrlKey || input.altKey || input.shiftKey || input.metaKey;
  const isFunctionKey = /^F(?:[1-9]|1\d|2[0-4])$/.test(key);
  if (!hasModifier && !isFunctionKey) return { error: '请至少搭配 Ctrl、Alt、Shift 或 Windows 键。' };

  const parts: string[] = [];
  if (input.ctrlKey) parts.push('Ctrl');
  if (input.altKey) parts.push('Alt');
  if (input.shiftKey) parts.push('Shift');
  if (input.metaKey) parts.push('Super');
  parts.push(key);
  return { accelerator: parts.join('+') };
}
