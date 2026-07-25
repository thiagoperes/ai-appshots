import { mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';

import type { ResolvedPaths, StoreshotConfig } from './types';

function from(root: string, value: string | undefined, fallback: string) {
  if (!value) {
    return resolve(root, fallback);
  }

  return isAbsolute(value) ? value : resolve(root, value);
}

/**
 * Turns the config's optional, possibly relative directories into absolute
 * ones. Everything defaults to somewhere under the config file's own directory
 * so a fresh project needs no path settings at all.
 */
export function resolvePaths(
  config: StoreshotConfig,
  configDir: string,
): ResolvedPaths {
  const root = from(configDir, config.rootDir, '.');
  const out = from(root, config.outDir, 'screenshots');
  // Defaults inside the output directory, but an explicit value is read
  // relative to the root like every other setting.
  const cache = config.cacheDir
    ? from(root, config.cacheDir, '.cache')
    : resolve(out, '.cache');

  return {
    root,
    raw: resolve(out, 'raw'),
    framed: resolve(out, 'framed'),
    frameCache: resolve(cache, 'frames'),
    authState: resolve(cache, 'auth.json'),
    fastlane: from(root, config.fastlaneDir, 'fastlane'),
  };
}

export async function ensureDir(path: string) {
  await mkdir(path, { recursive: true });

  return path;
}

export async function ensureParentDir(filePath: string) {
  await mkdir(dirname(filePath), { recursive: true });

  return filePath;
}
