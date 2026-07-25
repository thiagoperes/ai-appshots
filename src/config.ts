import { access } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createJiti } from 'jiti';

import { DEFAULT_STORE_LOCALES } from './deliver';
import { fail } from './log';
import { resolvePaths } from './paths';
import { DEFAULT_TARGETS, findTarget } from './targets';
import { resolveTheme } from './theme';
import type { ResolvedConfig, ScreenSpec, StoreshotConfig } from './types';

/** Identity helper that gives config files type checking and completion. */
export function defineConfig(config: StoreshotConfig): StoreshotConfig {
  return config;
}

const CONFIG_NAMES = [
  'storeshot.config.ts',
  'storeshot.config.mts',
  'storeshot.config.js',
  'storeshot.config.mjs',
];

async function exists(path: string) {
  try {
    await access(path);

    return true;
  } catch {
    return false;
  }
}

/**
 * Walks up from the working directory looking for a config, so the command
 * works from anywhere inside a repo or workspace package.
 */
async function findConfig(explicit: string | undefined, cwd: string) {
  if (explicit) {
    const path = isAbsolute(explicit) ? explicit : resolve(cwd, explicit);

    if (!(await exists(path))) {
      fail(`No config at ${path}.`);
    }

    return path;
  }

  let dir = cwd;

  for (;;) {
    for (const name of CONFIG_NAMES) {
      const candidate = resolve(dir, name);

      if (await exists(candidate)) {
        return candidate;
      }
    }

    const parent = dirname(dir);

    if (parent === dir) {
      return fail(
        `No ${CONFIG_NAMES[0]} found in ${cwd} or any parent directory.`,
        'Create one with `defineConfig` from "storeshot", or pass --config.',
      );
    }

    dir = parent;
  }
}

/**
 * Loads the config through jiti so it can be TypeScript and import from the
 * rest of the project — captions as JSON, colours from a design tokens module —
 * without the project needing a build step for it.
 */
export async function loadConfig(
  explicit: string | undefined,
  cwd = process.cwd(),
): Promise<ResolvedConfig> {
  const path = await findConfig(explicit, cwd);
  const jiti = createJiti(pathToFileURL(path).href, { interopDefault: true });
  const loaded = (await jiti.import(path, { default: true })) as StoreshotConfig;

  if (!loaded?.baseUrl || !loaded.screens?.length) {
    fail(
      `${path} must export a config with "baseUrl" and at least one screen.`,
    );
  }

  return {
    ...loaded,
    targets: loaded.targets?.length ? loaded.targets : DEFAULT_TARGETS,
    theme: resolveTheme(loaded.theme),
    hide: loaded.hide ?? ['nextjs-portal'],
    storeLocales: { ...DEFAULT_STORE_LOCALES, ...loaded.storeLocales },
    settleDelay: loaded.settleDelay ?? 900,
    paths: resolvePaths(loaded, dirname(path)),
  };
}

export interface RunOptions {
  readonly config: ResolvedConfig;
  readonly targets: ResolvedConfig['targets'];
  readonly screens: readonly ScreenSpec[];
  readonly locales: readonly string[];
  readonly capture: boolean;
  readonly compose: boolean;
  readonly freshAuth: boolean;
}

export const USAGE = `Usage: storeshot [options]

  --config <path>    Config file. Default: nearest storeshot.config.ts.
  --target <id>      Only this target (repeatable). Default: all.
  --screen <id>      Only this screen (repeatable). Default: all.
  --locale <code>    Caption locale (repeatable). Default: all configured.
  --skip-capture     Recompose from the existing raw captures.
  --skip-compose     Capture only.
  --fresh-auth       Ignore the cached session and sign in again.
  --help             Show this message.`;

function collect(args: readonly string[], flag: string) {
  const values: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag) {
      const value = args[index + 1];

      if (!value || value.startsWith('--')) {
        fail(`${flag} requires a value.`, USAGE);
      }

      values.push(value);
      index += 1;
    }
  }

  return values;
}

function single(args: readonly string[], flag: string) {
  return collect(args, flag).at(-1);
}

export async function parseOptions(
  argv: readonly string[],
): Promise<RunOptions> {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE);
    process.exit(0);
  }

  const configPath = single(argv, '--config');
  const config = await loadConfig(configPath);

  const targetIds = collect(argv, '--target');
  const screenIds = collect(argv, '--screen');
  const locales = collect(argv, '--locale');
  const configured = Object.keys(config.captions);

  for (const locale of locales) {
    if (!config.captions[locale]) {
      fail(
        `No captions for locale "${locale}".`,
        `Configured locales: ${configured.join(', ') || 'none'}.`,
      );
    }
  }

  const screens = screenIds.length
    ? screenIds.map((id) => {
        const screen = config.screens.find((candidate) => candidate.id === id);

        if (!screen) {
          const known = config.screens.map((each) => each.id).join(', ');

          fail(`Unknown screen "${id}". Available screens: ${known}.`);
        }

        return screen;
      })
    : config.screens;

  return {
    config,
    targets: targetIds.length
      ? targetIds.map((id) => findTarget(id, config.targets))
      : config.targets,
    screens,
    locales: locales.length ? locales : configured,
    capture: !argv.includes('--skip-capture'),
    compose: !argv.includes('--skip-compose'),
    freshAuth: argv.includes('--fresh-auth'),
  };
}
