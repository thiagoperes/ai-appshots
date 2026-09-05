import sharp from 'sharp';
import type { OverlayOptions } from 'sharp';

import { escapeXml, toPaint } from './color.ts';
import { typesetLine } from './typeset.ts';
import type { WindowFrame } from '../types.ts';

/** Window chrome is outside the capture, so the app's toolbar is never covered. */
export async function renderWindowFrame(capture: Buffer, frame: WindowFrame, font: string): Promise<Buffer> {
  const { width = 0, height = 0 } = await sharp(capture).metadata();
  const barRatio = frame.titleBarRatio ?? 0.034;
  const radiusRatio = frame.radiusRatio ?? 0.009;
  if (!Number.isFinite(barRatio) || barRatio < 0.015 || barRatio > 0.15) {
    throw new Error('Window titleBarRatio must be between 0.015 and 0.15.');
  }
  if (!Number.isFinite(radiusRatio) || radiusRatio < 0 || radiusRatio > 0.1) {
    throw new Error('Window radiusRatio must be between 0 and 0.1.');
  }
  const bar = Math.max(1, Math.round(width * barRatio));
  const radius = Math.round(width * radiusRatio);
  const dark = frame.appearance === 'dark';
  const paint = toPaint(frame.color ?? (dark ? '#292b30' : '#f1f2f5'));
  const totalHeight = height + bar;
  const circle = width * 0.0043;
  const controls = ['#ff5f57', '#febc2e', '#28c840'].map((fill, index) =>
    `<circle cx="${width * 0.017 + index * circle * 3.25}" cy="${bar / 2}" r="${circle}" fill="${fill}"/>`).join('');
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${totalHeight}">` +
    `<rect width="${width}" height="${totalHeight}" rx="${radius}" fill="${escapeXml(paint.color)}" fill-opacity="${paint.opacity}"/>` +
    controls + `<path d="M0 ${bar - 0.5}H${width}" stroke="${dark ? '#ffffff' : '#000000'}" stroke-opacity="0.12"/></svg>`);
  const overlays: OverlayOptions[] = [{ input: capture, left: 0, top: bar }];
  if (frame.title?.trim()) {
    const title = await typesetLine(frame.title, {
      family: font, size: Math.max(1, Math.round(bar * 0.32)), weight: 500,
      colour: dark ? '#ededf1' : '#4d5059', letterSpacing: 0,
    });
    if (title.width > width * 0.68) throw new Error('Window title is too long; shorten it to fit the title bar.');
    overlays.push({ input: title.buffer, left: Math.round((width - title.width) / 2), top: Math.round((bar - title.height) / 2) });
  }
  const window = await sharp(svg).composite(overlays).png().toBuffer();
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${totalHeight}">` +
    `<rect width="${width}" height="${totalHeight}" rx="${radius}" fill="white"/></svg>`);
  return sharp(window).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
}
