import sharp from 'sharp';
import { access } from 'node:fs/promises';

import { escapeXml, toPaint } from './color.ts';

/**
 * Shapes single lines of text with Pango, the shaper librsvg and GTK use.
 *
 * Text is rendered to its own raster rather than placed in the SVG so its exact
 * extents are known, which is what lets the canvas put lines on a fixed grid
 * instead of approximating baselines from the em size. Pango also handles bidi
 * and complex scripts properly, which matters for localised captions.
 */

const WEIGHTS: readonly (readonly [number, string])[] = [
  [100, 'Thin'],
  [200, 'ExtraLight'],
  [300, 'Light'],
  [400, 'Regular'],
  [500, 'Medium'],
  [600, 'Semibold'],
  [700, 'Bold'],
  [800, 'ExtraBold'],
  [900, 'Black'],
];

export interface TextStyle {
  /**
   * A CSS font stack. Pango reads comma-separated families and picks the first
   * one installed, so the same value works here and in a browser.
   */
  readonly family: string;
  readonly fontFile?: string;
  /** Em size in pixels. Rendering is at 72dpi, so a pixel is a point. */
  readonly size: number;
  readonly weight: number;
  /** Extra space between characters, in pixels. Negative tightens. */
  readonly letterSpacing: number;
  readonly colour?: string;
  readonly align?: 'left' | 'center' | 'right';
  /** Additional line spacing in pixels, handled by Pango's paragraph layout. */
  readonly lineSpacing?: number;
}

function description({ family, size, weight }: TextStyle) {
  const name =
    WEIGHTS.reduce(
      (closest, entry) =>
        Math.abs(entry[0] - weight) < Math.abs(closest[0] - weight)
          ? entry
          : closest,
      WEIGHTS[3] as readonly [number, string],
    )[1] ?? 'Regular';

  return `${family} ${name} ${size}`;
}

function markup(text: string, style: TextStyle) {
  // Pango measures letter spacing in 1024ths of a point.
  const spacing = Math.round(style.letterSpacing * 1024);
  const attributes = [
    style.colour ? `foreground="${escapeXml(toPaint(style.colour).color)}"` : '',
    style.colour ? `alpha="${Math.round(toPaint(style.colour).opacity * 65535)}"` : '',
    spacing === 0 ? '' : `letter_spacing="${spacing}"`,
  ]
    .filter(Boolean)
    .join(' ');

  return attributes
    ? `<span ${attributes}>${escapeXml(text)}</span>`
    : escapeXml(text);
}

export interface TypesetLine {
  readonly buffer: Buffer;
  readonly width: number;
  readonly height: number;
}

export async function typesetLine(
  text: string,
  style: TextStyle,
): Promise<TypesetLine> {
  if (style.fontFile) await access(style.fontFile);
  const { data, info } = await sharp({
    text: {
      text: markup(text, style), font: description(style), fontfile: style.fontFile,
      rgba: true, dpi: 72,
      align: style.align === 'left' || style.align === 'right' ? style.align : 'centre',
      spacing: style.lineSpacing ?? 0,
    },
  })
    .png()
    .toBuffer({ resolveWithObject: true });

  // Pango substitutes silently when a family is missing, but with no font
  // installed at all it produces nothing, and the caption would vanish from an
  // otherwise successful run.
  if (text.trim() && info.width <= 1) {
    throw new Error(
      `Could not render "${text}" in "${style.family}". No usable font was ` +
        `found.\nInstall at least one font — on a slim Linux image that means a ` +
        `package such as fonts-dejavu-core — or name an installed family in ` +
        `the theme's titleFont, kickerFont, sansFont, or monoFont.`,
    );
  }

  return { buffer: data, width: info.width, height: info.height };
}

const widths = new Map<string, Promise<number>>();

/** Width of one line as Pango will shape it, in pixels. */
export function measureLine(text: string, style: TextStyle): Promise<number> {
  if (!text.trim()) {
    return Promise.resolve(0);
  }

  const key = `${style.family}|${style.fontFile ?? ""}|${style.size}|${style.weight}|${style.letterSpacing}|${text}`;
  const cached = widths.get(key);

  if (cached) {
    return cached;
  }

  const pending = typesetLine(text, style).then((line) => line.width);

  widths.set(key, pending);

  return pending;
}
