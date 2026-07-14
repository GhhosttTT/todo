import { describe, expect, it } from 'vitest';
import { resolveRuntimePaths } from './runtimePaths';

describe('resolveRuntimePaths', () => {
  it('uses the normal user data directory by default', () => {
    const paths = resolveRuntimePaths({ appRoot: 'C:\\Todo', userDataDir: 'C:\\Users\\A\\AppData\\Todo', argv: [], writable: () => true });
    expect(paths.effectiveMode).toBe('normal');
    expect(paths.stateFile.toLocaleLowerCase()).toContain('appdata');
  });

  it('uses a relocatable directory for portable mode', () => {
    const paths = resolveRuntimePaths({ appRoot: 'E:\\Apps\\Todo', userDataDir: 'C:\\Data', argv: ['--portable'], writable: () => true });
    expect(paths.effectiveMode).toBe('portable');
    expect(paths.dataDir).toMatch(/portable-data$/);
    expect(paths.dataDir.startsWith(paths.appRoot)).toBe(true);
  });

  it('can resolve packaged assets outside the executable directory', () => {
    const paths = resolveRuntimePaths({
      appRoot: 'C:\\Todo',
      assetRoot: 'C:\\Todo\\resources\\assets',
      userDataDir: 'C:\\Users\\A\\AppData\\Todo',
      argv: [],
      writable: () => true,
    });
    expect(paths.assetRoot).toBe('C:\\Todo\\resources\\assets');
  });

  it('falls back when the portable directory is not writable', () => {
    const paths = resolveRuntimePaths({ appRoot: 'E:\\Todo', userDataDir: 'C:\\Data', argv: [], portableFlagExists: true, writable: () => false });
    expect(paths.requestedMode).toBe('portable');
    expect(paths.effectiveMode).toBe('normal');
    expect(paths.fallbackReason).toBe('portable-not-writable');
  });

  it('resolves portable data from the current app root after drive changes', () => {
    const first = resolveRuntimePaths({ appRoot: 'E:\\Todo', userDataDir: 'C:\\Data', argv: ['--portable'], writable: () => true });
    const moved = resolveRuntimePaths({ appRoot: 'F:\\Todo', userDataDir: 'C:\\Data', argv: ['--portable'], writable: () => true });
    expect(first.dataDir).not.toBe(moved.dataDir);
    expect(moved.dataDir).toMatch(/^F:/i);
  });
});
