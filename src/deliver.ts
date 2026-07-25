import { copyFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

import { ensureDir } from './paths';
import type { ResolvedConfig, TargetSpec } from './types';

/**
 * Locale directory names differ from the short caption keys: both `deliver`
 * and `supply` expect full store locale codes.
 */
export const DEFAULT_STORE_LOCALES: Readonly<Record<string, string>> = {
  en: 'en-US',
};

export function toStoreLocale(locale: string, config: ResolvedConfig) {
  return config.storeLocales[locale] ?? locale;
}

/**
 * `deliver` reads every PNG in `fastlane/screenshots/<locale>/` and infers the
 * device class from the image dimensions, so iPhone and iPad assets live side
 * by side. `supply` instead wants one directory per Play device type.
 */
export function deliveryPathFor(
  target: TargetSpec,
  locale: string,
  fileName: string,
  config: ResolvedConfig,
) {
  const storeLocale = toStoreLocale(locale, config);
  const fastlane = config.paths.fastlane;

  if (target.store === 'app-store') {
    return resolve(fastlane, 'screenshots', storeLocale, fileName);
  }

  const bucket =
    target.deliveryKind === 'tablet' ? 'tenInchScreenshots' : 'phoneScreenshots';

  return resolve(
    fastlane,
    'metadata/android',
    storeLocale,
    'images',
    bucket,
    fileName,
  );
}

export async function resetDeliveryDirs(
  locales: readonly string[],
  config: ResolvedConfig,
) {
  const fastlane = config.paths.fastlane;

  for (const locale of locales) {
    const storeLocale = toStoreLocale(locale, config);

    await rm(resolve(fastlane, 'screenshots', storeLocale), {
      recursive: true,
      force: true,
    });

    for (const bucket of ['phoneScreenshots', 'tenInchScreenshots']) {
      await rm(
        resolve(fastlane, 'metadata/android', storeLocale, 'images', bucket),
        { recursive: true, force: true },
      );
    }
  }
}

export async function stageForDelivery(
  source: string,
  target: TargetSpec,
  locale: string,
  fileName: string,
  config: ResolvedConfig,
) {
  const destination = deliveryPathFor(target, locale, fileName, config);

  await ensureDir(resolve(destination, '..'));
  await copyFile(source, destination);

  return destination;
}
