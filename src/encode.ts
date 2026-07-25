import sharp from 'sharp';

import type { Size, StoreId } from './types';

/** Google Play rejects preview assets above 8MB. Apple has no documented cap. */
const PLAY_MAX_BYTES = 8 * 1024 * 1024;

/**
 * Both stores reject alpha channels — Apple states screenshots "can't include
 * alpha channels or transparencies", Play requires "JPEG or 24-bit PNG (no
 * alpha)". Playwright always writes RGBA PNGs even when nothing is
 * transparent, so every asset has to be flattened before upload.
 */
export async function flattenForStore(buffer: Buffer, background = '#ffffff') {
  return sharp(buffer)
    .flatten({ background })
    .removeAlpha()
    .png({ compressionLevel: 9 })
    .toBuffer();
}

export interface ValidationIssue {
  readonly asset: string;
  readonly problem: string;
}

export async function validateAsset(
  asset: string,
  buffer: Buffer,
  expected: Size,
  store: StoreId,
): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  const metadata = await sharp(buffer).metadata();

  if (metadata.width !== expected.width || metadata.height !== expected.height) {
    issues.push({
      asset,
      problem:
        `is ${metadata.width}x${metadata.height}, expected ` +
        `${expected.width}x${expected.height}`,
    });
  }

  if (metadata.hasAlpha || metadata.channels !== 3) {
    issues.push({
      asset,
      problem: `has an alpha channel (${metadata.channels} channels); both stores reject it`,
    });
  }

  if (store === 'play-store' && buffer.byteLength > PLAY_MAX_BYTES) {
    const mb = (buffer.byteLength / 1024 / 1024).toFixed(1);

    issues.push({ asset, problem: `is ${mb}MB, over Play's 8MB limit` });
  }

  return issues;
}
