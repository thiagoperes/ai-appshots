import sharp from 'sharp';

import { toPaint } from './color';
import { typesetLine } from './typeset';
import type { Platform, Size } from '../types';

/**
 * Apple has shown 9:41 in iPhone marketing since the original keynote, and a
 * full battery avoids implying the app drains one. Android has no equivalent
 * convention, so it uses the same values for a consistent set.
 *
 * @see https://developer.apple.com/design/human-interface-guidelines/going-full-screen
 */
const MARKETING_TIME = '9:41';

export interface StatusBarStyle {
  readonly background: { r: number; g: number; b: number };
  readonly foreground: string;
}

/**
 * Reads the average colour of a capture's top row.
 *
 * The strip has to disappear into whatever the app renders behind it, and that
 * varies by theme and by route, so sampling beats hardcoding a token. The top
 * row sits above the header's content padding, so it is background only.
 */
export async function sampleTopColor(capture: Buffer) {
  const { width } = await sharp(capture).metadata();

  const { data } = await sharp(capture)
    .extract({ left: 0, top: 0, width: width ?? 1, height: 1 })
    .resize(1, 1, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  return { r: data[0] ?? 0, g: data[1] ?? 0, b: data[2] ?? 0 };
}

export function foregroundFor(background: StatusBarStyle['background']) {
  const luminance =
    (0.299 * background.r + 0.587 * background.g + 0.114 * background.b) / 255;

  return luminance > 0.55 ? '#000000' : '#FFFFFF';
}

/** Cellular bars, wifi arcs and a battery, drawn at the clock's scale. */
function icons(glyph: number, colour: string) {
  const scale = glyph / 14;
  const at = (x: number) => (x * scale).toFixed(2);
  const gap = glyph * 0.28;
  const cellular = 17 * scale;
  const wifi = 16 * scale;
  const battery = 25 * scale;
  const width = cellular + wifi + battery + gap * 2;

  const bars = [
    [0, 7.5, 3, 3.5],
    [4.6, 5.4, 3, 5.6],
    [9.2, 2.9, 3, 8.1],
    [13.8, 0, 3, 11],
  ]
    .map(
      ([x, y, w, h]) =>
        `<rect x="${at(x as number)}" y="${at(y as number)}" ` +
        `width="${at(w as number)}" height="${at(h as number)}" ` +
        `rx="${at(1)}" fill="${colour}" />`,
    )
    .join('');

  return {
    width,
    // Each group is translated into place; the shapes keep the proportions the
    // browser template used, scaled off the clock size.
    markup:
      `<g transform="translate(0 ${at(1.5)}) scale(${scale})">` +
      `<g transform="scale(${1 / scale})">${bars}</g></g>` +
      `<g transform="translate(${(cellular + gap).toFixed(2)} ${at(1.5)})" ` +
      `fill="none" stroke="${colour}" stroke-width="${at(1.7)}" stroke-linecap="round">` +
      `<path d="M${at(1)} ${at(3.4)}A${at(11)} ${at(11)} 0 0 1 ${at(15)} ${at(3.4)}" />` +
      `<path d="M${at(3.7)} ${at(6.3)}A${at(7)} ${at(7)} 0 0 1 ${at(12.3)} ${at(6.3)}" />` +
      `<path d="M${at(6.4)} ${at(9.1)}A${at(3)} ${at(3)} 0 0 1 ${at(9.6)} ${at(9.1)}" />` +
      `</g>` +
      `<g transform="translate(${(cellular + wifi + gap * 2).toFixed(2)} ${at(1)})">` +
      `<rect x="${at(0.6)}" y="${at(0.6)}" width="${at(21)}" height="${at(10.8)}" ` +
      `rx="${at(3.1)}" fill="none" stroke="${colour}" stroke-opacity="0.42" ` +
      `stroke-width="${at(1.1)}" />` +
      `<rect x="${at(2.2)}" y="${at(2.2)}" width="${at(17.8)}" height="${at(7.6)}" ` +
      `rx="${at(1.9)}" fill="${colour}" />` +
      `<path d="M${at(23.2)} ${at(4.1)}v${at(3.8)}a${at(2)} ${at(2)} 0 0 0 0 -${at(3.8)}Z" ` +
      `fill="${colour}" fill-opacity="0.42" />` +
      `</g>`,
  };
}

export interface StatusBarOptions {
  readonly size: Size;
  readonly style: StatusBarStyle;
  readonly platform: Platform;
  /** Clock size in pixels, already multiplied by the device scale factor. */
  readonly glyph: number;
  readonly font: string;
}

const cache = new Map<string, Promise<Buffer>>();

/**
 * Renders the status bar strip that sits above a browser capture.
 *
 * A web view runs below the real status bar, so a browser capture never contains
 * one and the framed device reads as a mockup. Rendering it as a separate strip,
 * rather than overlaying the capture, means no app content is hidden behind it.
 */
export function renderStatusBar(options: StatusBarOptions): Promise<Buffer> {
  const { size, style, platform, glyph } = options;
  const { r, g, b } = style.background;
  const key = `${platform}|${size.width}x${size.height}|${glyph}|${r},${g},${b}|${options.font}`;
  const cached = cache.get(key);

  if (cached) {
    return cached;
  }

  const pending = (async () => {
    // iOS clears the curved top edge and sits either side of the Dynamic Island.
    // The Pixel bezel puts a hole-punch camera in the top left, so the Android
    // clock starts to the right of it rather than underneath it.
    const leading = Math.round(size.width * (platform === 'ios' ? 0.083 : 0.185));
    const trailing = Math.round(size.width * (platform === 'ios' ? 0.083 : 0.05));
    const nudge = platform === 'ios' ? size.height * 0.16 : 0;
    const colour = toPaint(style.foreground).color;

    const clock = await typesetLine(MARKETING_TIME, {
      family: options.font,
      size: glyph,
      weight: 600,
      letterSpacing: platform === 'ios' ? glyph * -0.01 : 0,
      colour: style.foreground,
    });

    const glyphs = icons(glyph, colour);
    const centre = nudge + (size.height - nudge) / 2;

    const overlay = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" ` +
        `height="${size.height}">` +
        `<g transform="translate(${size.width - trailing - glyphs.width} ` +
        `${(centre - glyph * 0.42).toFixed(2)})">${glyphs.markup}</g></svg>`,
    );

    return sharp({
      create: {
        width: size.width,
        height: size.height,
        channels: 4,
        background: { r, g, b, alpha: 1 },
      },
    })
      .composite([
        {
          input: clock.buffer,
          left: leading,
          top: Math.round(centre - clock.height / 2),
        },
        { input: overlay, left: 0, top: 0 },
      ])
      .png()
      .toBuffer();
  })();

  cache.set(key, pending);

  return pending;
}
