import { readFile } from 'node:fs/promises';

import opentype from 'opentype.js';
import sharp from 'sharp';

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
  /** Absolute path to a font file used without consulting the host registry. */
  readonly fontFile?: string;
  /** Em size in pixels. Rendering is at 72dpi, so a pixel is a point. */
  readonly size: number;
  readonly weight: number;
  /** Extra space between characters, in pixels. Negative tightens. */
  readonly letterSpacing: number;
  readonly colour?: string;
  readonly align?: 'left' | 'center' | 'right';
  /** Additional space between paragraph baselines, in pixels. */
  readonly lineSpacing?: number;
  /** Baseline-to-baseline distance in pixels; replaces the font line height and `lineSpacing`. */
  readonly lineHeight?: number;
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

const fontFiles = new Map<string, Promise<opentype.Font>>();

function fontFromFile(path: string) {
  let pending = fontFiles.get(path);

  if (!pending) {
    pending = readFile(path).then((bytes) =>
      opentype.parse(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      ),
    );
    fontFiles.set(path, pending);
  }

  return pending;
}

/** Parts of the opentype.js API its type definitions omit. */
interface FontTables {
  readonly position: {
    getDefaultScriptName(): string;
    getKerningTables(script: string): unknown;
    getKerningValue(tables: unknown, left: number, right: number): number;
  };
  readonly substitution: {
    getLigatures(feature: string, script: string, language: string): { sub: number[]; by: number }[];
  };
}

/**
 * opentype.js runs `ccmp` on every string and throws on lookups it cannot
 * apply, such as a class-based chained context. Such fonts are shaped by
 * character, keeping their plain ligatures and the same kerning opentype.js
 * would use.
 */
function unshapedPaths(font: opentype.Font, line: string, size: number, letterSpacing: number) {
  const { position, substitution } = font as unknown as FontTables;
  const ligatures = (font.tables.gsub ? [...substitution.getLigatures('liga', 'latn', 'dflt')] : [])
    .sort((a, b) => b.sub.length - a.sub.length);
  const mapped = Array.from(line, (char) => font.charToGlyph(char));
  const glyphs: opentype.Glyph[] = [];
  for (let i = 0; i < mapped.length;) {
    const match = ligatures.find((ligature) => ligature.sub.every((index, k) => mapped[i + k]?.index === index));
    glyphs.push(match ? font.glyphs.get(match.by) : mapped[i]!);
    i += match ? match.sub.length : 1;
  }
  const tables = font.tables.gpos ? position.getKerningTables(position.getDefaultScriptName()) : undefined;
  const scale = size / font.unitsPerEm;
  let x = 0;
  return glyphs.map((glyph, i) => {
    const path = glyph.getPath(x, 0, size);
    x += (glyph.advanceWidth ?? 0) * scale + letterSpacing * size;
    const next = glyphs[i + 1];
    if (next) {
      x += (tables ? position.getKerningValue(tables, glyph.index, next.index) : font.getKerningValue(glyph, next)) * scale;
    }
    return path;
  });
}

/**
 * SVG path data at three decimals. opentype.js's own `toPathData` writes `NaN`
 * for a coordinate within about 1e-7 of an integer, which breaks whichever
 * glyph lands there.
 */
export function svgPathData(path: opentype.Path) {
  const n = (value: number) => String(Math.round(value * 1000) / 1000 || 0);
  return path.commands.map((command) => {
    switch (command.type) {
      case 'M':
      case 'L': return `${command.type}${n(command.x)} ${n(command.y)}`;
      case 'Q': return `Q${n(command.x1)} ${n(command.y1)} ${n(command.x)} ${n(command.y)}`;
      case 'C': return `C${n(command.x1)} ${n(command.y1)} ${n(command.x2)} ${n(command.y2)} ${n(command.x)} ${n(command.y)}`;
      case 'Z': return 'Z';
    }
  }).join('');
}

export function linePaths(font: opentype.Font, line: string, size: number, letterSpacing: number) {
  try {
    return font.getPaths(line, 0, 0, size, { kerning: true, letterSpacing });
  } catch (error) {
    if (!/not yet supported/.test(String(error))) throw error;
    return unshapedPaths(font, line, size, letterSpacing);
  }
}

/** Renders a bundled font as paths, so host font registries cannot substitute it. */
async function typesetFile(text: string, style: TextStyle): Promise<TypesetLine> {
  const font = await fontFromFile(style.fontFile!);
  const lines = text.split('\n').map((line) => {
    const paths = linePaths(font, line, style.size, style.letterSpacing / style.size);
    const boxes = paths.map((path) => path.getBoundingBox()).filter((box) => !box.isEmpty());
    const left = boxes.length ? Math.min(...boxes.map((box) => box.x1)) : 0;
    const right = boxes.length ? Math.max(...boxes.map((box) => box.x2)) : 0;
    return { paths, left, width: right - left };
  });
  const inset = 2;
  const scale = style.size / font.unitsPerEm;
  // OpenType paths use a baseline at y=0. Use the font-wide vertical metrics
  // instead of each line's ink bounds so wrapped lines keep one baseline.
  const top = -font.ascender * scale;
  const bottom = -font.descender * scale;
  const lineWidth = Math.max(0, ...lines.map((line) => line.width));
  const lineHeight = style.lineHeight ?? bottom - top + (style.lineSpacing ?? 0);
  const width = Math.max(1, Math.ceil(lineWidth) + inset * 2);
  const height = Math.max(1, Math.ceil(bottom - top + (lines.length - 1) * lineHeight) + inset * 2);
  const align = style.align === 'left' ? 0 : style.align === 'right' ? 1 : 0.5;
  const pathsSvg = lines.map((line, i) => {
    const x = inset - line.left + (lineWidth - line.width) * align;
    const y = inset - top + i * lineHeight;
    return `<g transform="translate(${x.toFixed(3)} ${y.toFixed(3)})">` +
      line.paths.map((path) => `<path d="${svgPathData(path)}"/>`).join('') + '</g>';
  }).join('');
  const paint = toPaint(style.colour ?? '#000000');
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
      `viewBox="0 0 ${width} ${height}"><g fill="${escapeXml(paint.color)}" fill-opacity="${paint.opacity}">` +
      `${pathsSvg}</g></svg>`,
  );

  return { buffer: await sharp(svg).png().toBuffer(), width, height };
}

/** Remove font metric padding around the whole caption while preserving its baselines. */
export async function typesetCaption(text: string, style: TextStyle): Promise<TypesetLine> {
  const result = await typesetLine(text, style);
  if (!style.fontFile || !text.trim() || toPaint(style.colour ?? '#000000').opacity === 0) return result;
  const { data, info } = await sharp(result.buffer).trim({ threshold: 0 }).png().toBuffer({ resolveWithObject: true });
  return { buffer: data, width: info.width, height: info.height };
}

function pangoText(text: string, style: TextStyle, spacing: number) {
  return sharp({
    text: {
      text: markup(text, style), font: description(style), fontfile: style.fontFile,
      rgba: true, dpi: 72,
      align: style.align === 'left' || style.align === 'right' ? style.align : 'centre',
      spacing,
    },
  }).png().toBuffer({ resolveWithObject: true });
}

const pitches = new Map<string, Promise<number>>();

/** Pango's own baseline-to-baseline distance for a style, in pixels. */
function naturalPitch(style: TextStyle) {
  const key = `${style.family}|${style.size}|${style.weight}`;
  let pitch = pitches.get(key);
  if (!pitch) {
    const probe = { ...style, letterSpacing: 0 };
    pitch = Promise.all([pangoText('Hg', probe, 0), pangoText('Hg\nHg', probe, 0)])
      .then(([one, two]) => two.info.height - one.info.height);
    pitches.set(key, pitch);
  }
  return pitch;
}

export async function typesetLine(
  text: string,
  style: TextStyle,
): Promise<TypesetLine> {
  if (style.fontFile) return typesetFile(text, style);

  // libvips `spacing` is the gap Pango adds between lines, in whole pixels.
  const spacing = style.lineHeight === undefined
    ? style.lineSpacing ?? 0
    : style.lineHeight - await naturalPitch(style);
  const { data, info } = await pangoText(text, style, Math.round(spacing));

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

  const key = `${style.family}|${style.fontFile ?? ''}|${style.size}|${style.weight}|${style.letterSpacing}|${text}`;
  const cached = widths.get(key);

  if (cached) {
    return cached;
  }

  const pending = typesetLine(text, style).then((line) => line.width);

  widths.set(key, pending);

  return pending;
}
