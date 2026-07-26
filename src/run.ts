import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { chromium } from 'playwright';

import { composeScreenshot } from './compose';
import type { RunOptions } from './config';
import { captureSpecFor, createDriver, driverFor } from './drivers';
import { resetDeliveryDirs, stageForDelivery } from './deliver';
import { flattenForStore, validateAsset } from './encode';
import type { ValidationIssue } from './encode';
import { fail, info, step, warn } from './log';
import { ensureParentDir } from './paths';
import type {
  CaptureDriver,
  CaptureSpec,
  ResolvedConfig,
  ScreenSpec,
  TargetSpec,
} from './types';

function includesTarget(screen: ScreenSpec, target: TargetSpec) {
  return !screen.excludeTargets?.includes(target.id);
}

function rawPath(
  config: ResolvedConfig,
  locale: string,
  target: TargetSpec,
  screen: ScreenSpec,
) {
  return resolve(config.paths.raw, locale, target.id, `${screen.id}.png`);
}

function framedPath(
  config: ResolvedConfig,
  locale: string,
  target: TargetSpec,
  screen: ScreenSpec,
  order: number,
) {
  const index = String(order + 1).padStart(2, '0');

  return resolve(
    config.paths.framed,
    locale,
    target.id,
    `${index}-${screen.id}.png`,
  );
}

export async function runCapture(options: RunOptions) {
  const { config } = options;

  step('Capturing device screenshots');

  // One driver per distinct capture spec, so a run that mixes an iOS simulator
  // with an Android emulator only signs in, boots or installs once per platform
  // rather than once per target.
  const bySpec = new Map<CaptureSpec, CaptureDriver>();
  const byTarget = new Map<string, CaptureDriver>();

  for (const target of options.targets) {
    const spec = captureSpecFor(target, config);
    let driver = bySpec.get(spec);

    if (!driver) {
      driver = createDriver(spec);
      bySpec.set(spec, driver);
    }

    byTarget.set(target.id, driver);
  }

  for (const driver of bySpec.values()) {
    await driver.setup?.(config, { freshAuth: options.freshAuth });
  }

  for (const target of options.targets) {
    const driver = byTarget.get(target.id)!;

    info(`${target.id} via ${driver.kind}`);

    const session = await driver.open({ target, config });

    try {
      for (const locale of options.locales) {
        for (const screen of options.screens) {
          if (!includesTarget(screen, target)) {
            continue;
          }

          const buffer = await session.capture(screen, locale);
          const path = rawPath(config, locale, target, screen);

          await ensureParentDir(path);
          await writeFile(path, buffer);
          info(`  ${target.id}/${locale}/${screen.id}`);
        }
      }
    } finally {
      await session.close();
    }
  }
}

export async function runCompose(options: RunOptions) {
  const { config } = options;

  step('Composing framed store assets');

  const browser = await chromium.launch();
  const issues: ValidationIssue[] = [];

  try {
    for (const locale of options.locales) {
      const captions = config.captions[locale] ?? {};

      for (const target of options.targets) {
        // Declared by the capture spec rather than measured, so `--skip-capture`
        // composes the same way a full run would.
        const { includesStatusBar } = driverFor(target, config);

        for (const screen of options.screens) {
          if (!includesTarget(screen, target)) {
            continue;
          }

          // Position in the full set, not in this run's filtered subset, so a
          // partial rerun keeps the same numbering instead of writing a second
          // file under a different index.
          const order = config.screens.indexOf(screen);
          const caption = captions[screen.id];

          if (!caption) {
            fail(
              `No caption for screen "${screen.id}" in locale "${locale}".`,
              'Add it to the captions map in your storeshot config.',
            );
          }

          const source = rawPath(config, locale, target, screen);
          let capture: Buffer;

          try {
            capture = await readFile(source);
          } catch {
            warn(`missing capture ${source}, skipping`);
            continue;
          }

          const composed = await composeScreenshot({
            browser,
            target,
            capture,
            caption,
            theme: screen.theme,
            canvas: config.theme,
            frameCacheDir: config.paths.frameCache,
            includesStatusBar,
            index: order + 1,
          });
          const flattened = await flattenForStore(composed);
          const destination = framedPath(config, locale, target, screen, order);

          await ensureParentDir(destination);
          await writeFile(destination, flattened);

          const name = `${target.id}/${locale}/${screen.id}`;

          issues.push(
            ...(await validateAsset(
              name,
              flattened,
              target.output,
              target.store,
            )),
          );

          await stageForDelivery(
            destination,
            target,
            locale,
            `${String(order + 1).padStart(2, '0')}-${target.id}-${screen.id}.png`,
            config,
          );

          info(`${name} → ${target.output.width}x${target.output.height}`);
        }
      }
    }
  } finally {
    await browser.close();
  }

  return issues;
}

/** Runs the pipeline end to end. The CLI is a thin wrapper around this. */
export async function run(options: RunOptions) {
  const { config } = options;

  info(`base url: ${config.baseUrl}`);
  info(`targets:  ${options.targets.map((target) => target.id).join(', ')}`);
  info(`locales:  ${options.locales.join(', ')}`);

  if (options.capture) {
    await runCapture(options);
  }

  if (!options.compose) {
    return;
  }

  await resetDeliveryDirs(options.locales, config);

  const issues = await runCompose(options);

  if (issues.length) {
    step('Store compliance problems');

    for (const issue of issues) {
      warn(`${issue.asset} ${issue.problem}`);
    }

    fail(`${issues.length} asset(s) would be rejected on upload.`);
  }

  step('Done');
  info(`framed assets: ${config.paths.framed}`);
  info(`staged for fastlane deliver/supply under ${config.paths.fastlane}`);
}
