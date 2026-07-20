import { describe, expect, it } from 'vitest';
import { shortcutFromKeyInput } from './shortcut';

const keyInput = (overrides: Partial<Parameters<typeof shortcutFromKeyInput>[0]>) => ({
  key: 't',
  code: 'KeyT',
  ctrlKey: true,
  altKey: true,
  shiftKey: false,
  metaKey: false,
  ...overrides,
});

describe('shortcutFromKeyInput', () => {
  it('formats a Windows modifier combination for Electron', () => {
    expect(shortcutFromKeyInput(keyInput({}))).toEqual({ accelerator: 'Ctrl+Alt+T' });
  });

  it('supports function keys without a modifier', () => {
    expect(shortcutFromKeyInput(keyInput({ key: 'F8', code: 'F8', ctrlKey: false, altKey: false }))).toEqual({ accelerator: 'F8' });
  });

  it('does not accept an ordinary unmodified key', () => {
    expect(shortcutFromKeyInput(keyInput({ ctrlKey: false, altKey: false }))).toEqual({ error: '请至少搭配 Ctrl、Alt、Shift 或 Windows 键。' });
  });

  it('waits when only a modifier is pressed', () => {
    expect(shortcutFromKeyInput(keyInput({ key: 'Control', code: 'ControlLeft', altKey: false }))).toEqual({ error: '请继续按一个字母、数字或功能键。' });
  });
});
