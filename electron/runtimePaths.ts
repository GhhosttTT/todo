import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { DataMode } from '../src/types';

export interface RuntimePaths {
  appRoot: string;
  assetRoot: string;
  requestedMode: DataMode;
  effectiveMode: DataMode;
  dataDir: string;
  stateFile: string;
  logDir: string;
  fallbackReason?: 'portable-not-writable';
}

export interface ResolvePathOptions {
  appRoot: string;
  assetRoot?: string;
  userDataDir: string;
  argv: string[];
  portableFlagExists?: boolean;
  bootstrapMode?: DataMode;
  writable?: (path: string) => boolean;
}

export function resolveHostExecutablePath(execPath: string, portableExecutableFile?: string): string {
  const portablePath = portableExecutableFile?.trim();
  return resolve(portablePath || execPath);
}

export function probeWritable(path: string): boolean {
  const probe = join(path, `.write-probe-${process.pid}-${Date.now()}`);
  try {
    mkdirSync(path, { recursive: true });
    const descriptor = openSync(probe, 'wx');
    writeSync(descriptor, 'ok');
    closeSync(descriptor);
    rmSync(probe, { force: true });
    return true;
  } catch {
    try { rmSync(probe, { force: true }); } catch { /* ignored */ }
    return false;
  }
}

export function readBootstrapMode(appRoot: string): DataMode | undefined {
  try {
    const parsed = JSON.parse(readFileSync(join(appRoot, 'bootstrap.json'), 'utf8')) as { dataMode?: unknown };
    return parsed.dataMode === 'portable' || parsed.dataMode === 'normal' ? parsed.dataMode : undefined;
  } catch {
    return undefined;
  }
}

export function resolveRuntimePaths(options: ResolvePathOptions): RuntimePaths {
  const appRoot = resolve(options.appRoot);
  const requestedMode: DataMode = options.argv.includes('--portable')
    || options.portableFlagExists
    || options.bootstrapMode === 'portable'
    ? 'portable'
    : 'normal';
  const portableDir = join(appRoot, 'portable-data');
  const writable = options.writable ?? probeWritable;
  const portableWritable = requestedMode === 'portable' && writable(portableDir);
  const effectiveMode: DataMode = portableWritable ? 'portable' : 'normal';
  const dataDir = effectiveMode === 'portable' ? portableDir : resolve(options.userDataDir);

  return {
    appRoot,
    assetRoot: options.assetRoot ? resolve(options.assetRoot) : join(appRoot, 'assets'),
    requestedMode,
    effectiveMode,
    dataDir,
    stateFile: join(dataDir, 'state.json'),
    logDir: join(dataDir, 'logs'),
    fallbackReason: requestedMode === 'portable' && effectiveMode === 'normal' ? 'portable-not-writable' : undefined,
  };
}

export function resolvePathsFromEnvironment(appRoot: string, userDataDir: string, argv = process.argv, assetRoot?: string): RuntimePaths {
  return resolveRuntimePaths({
    appRoot,
    assetRoot,
    userDataDir,
    argv,
    portableFlagExists: existsSync(join(appRoot, 'portable.flag')),
    bootstrapMode: readBootstrapMode(appRoot),
  });
}

export function normalizeLockKey(stateFile: string): string {
  return resolve(dirname(stateFile), stateFile).toLocaleLowerCase();
}
