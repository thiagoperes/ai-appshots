import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { composeComposition, composeScreenshot } from './compose';
import type { RunOptions } from './config';
import { planCompositions } from './composition-plan';
import { renderGallery } from './render/gallery';
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

  const sources = new Map(options.targets.map((target) => [target.id,
    [...new Set(planCompositions(config, target, options.screens).flatMap((job) => job.sources))],
  ]));

  // One driver per distinct capture spec, so a run that mixes an iOS simulator
  // with an Android emulator only signs in, boots or installs once per platform
  // rather than once per target.
  const bySpec = new Map<CaptureSpec, CaptureDriver>();
  const byTarget = new Map<string, CaptureDriver>();

  for (const target of options.targets) {
    if (!sources.get(target.id)?.length) continue;
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
    if (!sources.get(target.id)?.length) continue;
    const driver = byTarget.get(target.id)!;

    info(`${target.id} via ${driver.kind}`);

    const session = await driver.open({ target, config });

    try {
      for (const locale of options.locales) {
        for (const screen of sources.get(target.id) ?? []) {
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
  const issues: ValidationIssue[] = [];
  // Validate the whole plan before any output is touched.
  const plans = new Map(options.targets.map((target) => [target.id,
    planCompositions(config, target, options.screens),
  ]));

  for (const locale of options.locales) {
    const captions = config.captions[locale] ?? {};
    for (const target of options.targets) {
      const { includesStatusBar } = driverFor(target, config);
      for (const job of plans.get(target.id) ?? []) {
        for (const screen of job.screens) {
          if (!captions[screen.id]) {
            throw new Error(`No caption for screen "${screen.id}" in locale "${locale}".`);
          }
        }
        const captures: Record<string, Buffer> = {};
        let missing = false;
        for (const source of job.sources) {
          const path = rawPath(config, locale, target, source);
          try {
            captures[source.id] = await readFile(path);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
            if (job.composition) {
              throw new Error(`Missing capture ${path}. Capture the complete composition before recomposing.`);
            }
            warn(`missing capture ${path}, skipping`);
            missing = true;
          }
        }
        if (missing) continue;
        const first = job.screens[0]!;
        const canvas = {
          ...config.theme, ...first.canvas, ...job.panorama?.canvas,
          dark: { ...config.theme.dark, ...first.canvas?.dark, ...job.panorama?.canvas?.dark },
          light: { ...config.theme.light, ...first.canvas?.light, ...job.panorama?.canvas?.light },
        };
        let panels: readonly Buffer[];
        if (job.composition) {
          const result = await composeComposition({
            target, captures, screens: job.screens.map((screen) => screen.id), captions,
            composition: job.composition, canvas, theme: job.panorama?.theme ?? first.theme,
            locale, frameCacheDir: config.paths.frameCache, includesStatusBar, assetRoot: config.paths.root,
          });
          panels = result.panels;
          for (const notice of result.notices) warn(`${target.id}/${locale}/${notice.layer}: ${notice.message}`);
        } else {
          panels = [await composeScreenshot({
            target, capture: captures[first.id]!, caption: captions[first.id]!,
            theme: first.theme, canvas, frameCacheDir: config.paths.frameCache, assetRoot: config.paths.root,
            includesStatusBar, index: config.screens.indexOf(first) + 1,
          })];
        }
        // Finish all panels before writing either half of a panorama.
        const flattened = await Promise.all(panels.map((panel) => flattenForStore(panel)));
        for (const [i, screen] of job.screens.entries()) {
          const order = config.screens.indexOf(screen);
          const destination = framedPath(config, locale, target, screen, order);
          const buffer = flattened[i]!;
          const name = `${target.id}/${locale}/${screen.id}`;
          issues.push(...(await validateAsset(name, buffer, target.output, target.store)));
          await ensureParentDir(destination);
          await writeFile(destination, buffer);
          await stageForDelivery(destination, target, locale,
            `${String(order + 1).padStart(2, '0')}-${target.id}-${screen.id}.png`, config);
          info(`${name} → ${target.output.width}x${target.output.height}`);
        }
      }
      if (config.preview !== false) {
        const panels: Buffer[] = [];
        for (const [order, screen] of config.screens.entries()) {
          if (!includesTarget(screen, target)) continue;
          try {
            panels.push(await readFile(framedPath(config, locale, target, screen, order)));
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          }
        }
        if (panels.length) {
          const path = resolve(config.paths.framed, '..', 'previews', locale, `${target.id}.png`);
          const gallery = await renderGallery(panels, typeof config.preview === 'object' ? config.preview : undefined);
          await ensureParentDir(path);
          await writeFile(path, gallery);
          info(`gallery preview: ${path}`);
        }
      }
    }
  }
  return issues;
}

/** Runs the pipeline end to end. The CLI is a thin wrapper around this. */
export async function run(options: RunOptions) {
  const { config } = options;

  for (const target of options.targets) planCompositions(config, target, options.screens);

  info(`base url: ${config.baseUrl}`);
  info(`targets:  ${options.targets.map((target) => target.id).join(', ')}`);
  info(`locales:  ${options.locales.join(', ')}`);

  if (options.capture) {
    await runCapture(options);
  }

  if (!options.compose) {
    return;
  }

  const fullSet = config.screens.every((screen) => options.screens.some((entry) => entry.id === screen.id))
    && config.targets.every((target) => options.targets.some((entry) => entry.id === target.id));
  // Partial reruns replace their own exports without erasing unrelated assets.
  if (fullSet) await resetDeliveryDirs(options.locales, config);

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
