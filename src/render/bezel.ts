import sharp from 'sharp';

import { toPaint } from './color';
import type { CssFrame, Size } from '../types';

function roundedRect(size: Size, radius: number, fill: string, opacity = 1) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" ` +
      `height="${size.height}"><rect width="${size.width}" ` +
      `height="${size.height}" rx="${radius}" ry="${radius}" fill="${fill}" ` +
      `fill-opacity="${opacity}" /></svg>`,
  );
}

/**
 * Wraps a capture in a plain bezel drawn from theme values, for devices the
 * fastlane frame set does not cover.
 *
 * Proportions come from the capture width, so the bezel scales with the device
 * the way real hardware does rather than staying a fixed thickness once the
 * canvas shrinks it.
 */
export async function renderCssBezel(
  capture: Buffer,
  frame: CssFrame,
  captureWidth: number,
): Promise<Buffer> {
  const { width = captureWidth, height = 0 } = await sharp(capture).metadata();
  const bezel = Math.round(captureWidth * frame.bezelRatio);
  const radius = Math.round(captureWidth * frame.radiusRatio);
  const outer = { width: width + bezel * 2, height: height + bezel * 2 };
  const paint = toPaint(frame.color);

  const screen = await sharp(capture)
    .ensureAlpha()
    .composite([
      {
        input: roundedRect({ width, height }, radius, '#ffffff'),
        blend: 'dest-in',
      },
    ])
    .png()
    .toBuffer();

  return sharp(roundedRect(outer, radius + bezel, paint.color, paint.opacity))
    .composite([{ input: screen, left: bezel, top: bezel }])
    .png()
    .toBuffer();
}
