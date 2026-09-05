import sharp from 'sharp';
import type { OverlayOptions } from 'sharp';

import { ellipseGradientToSvg, linearGradientToSvg, toPaint } from './color.ts';
import { wrap } from './text.ts';
import { measureLine, typesetLine } from './typeset.ts';
import type { TextStyle } from './typeset.ts';
import type { CanvasTheme, Caption, Size, ThemeName } from '../types.ts';
import { captionLayout } from './caption-layout.ts';

/**
 * Lays out the marketing canvas: backdrop, caption, and the framed device.
 *
 * Rendered with sharp rather than a browser. The decorative layers are one SVG,
 * which librsvg handles natively including patterns, gradient masks and blurs;
 * the type is shaped by Pango, which reports exact extents so lines can be
 * placed on a grid instead of guessing at baselines; and the device is resampled
 * by sharp so the product shot keeps Lanczos quality.
 */

export interface CanvasOptions {
  readonly output: Size;
  readonly caption: Caption;
  readonly theme: ThemeName;
  readonly canvas: CanvasTheme;
  readonly captionScale: number;
  readonly captionGapRatio: number;
  readonly allowBleed: boolean;
  readonly allowShadow: boolean;
  /** The device, already wrapped in its bezel. */
  readonly device: Buffer;
  /** 1-based position in the set, rendered as the `[ 01 ]` eyebrow index. */
  readonly index: number;
}

/** Backdrop, technical grid, vignette, accent bloom and the eyebrow rules. */
function backdropSvg(
  options: CanvasOptions,
  layout: ReturnType<typeof captionLayout>,
  eyebrow: { readonly width: number; readonly height: number; readonly rule: number } | undefined,
) {
  const { output, canvas, theme } = options;
  const palette = canvas[theme];
  const step = Math.round(output.width / 12);
  const grid = toPaint(palette.grid);
  const halo = toPaint(palette.halo);
  const rule = toPaint(palette.rule);
  const haloTop = layout.stageTop - Math.round(output.height * 0.03);
  const haloHeight = output.height - haloTop;

  const defs = [
    linearGradientToSvg(palette.sweep, 'sweep', output),
    `<pattern id="grid" width="${step}" height="${step}" patternUnits="userSpaceOnUse">` +
      `<rect width="1" height="${step}" fill="${grid.color}" fill-opacity="${grid.opacity}" />` +
      `<rect width="${step}" height="1" fill="${grid.color}" fill-opacity="${grid.opacity}" />` +
      `</pattern>`,
    // The grid fades out before it reaches the device. In an SVG mask white is
    // opaque and black is transparent, which is what CSS expresses as an alpha
    // ramp to `transparent`.
    `<linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0%" stop-color="#ffffff" />` +
      `<stop offset="62%" stop-color="#000000" /></linearGradient>`,
    `<mask id="gridFade"><rect width="${output.width}" height="${output.height}" fill="url(#fade)" /></mask>`,
    // Deepens the corners so the bloom reads as deliberate lighting.
    ellipseGradientToSvg({
      id: 'vignette',
      centre: { x: output.width / 2, y: output.height * 0.42 },
      radius: { x: output.width * 0.95, y: output.height * 0.62 },
      stops: [
        { paint: { color: '#000000', opacity: 0 }, offset: 0.45 },
        {
          paint: { color: '#000000', opacity: theme === 'dark' ? 0.55 : 0.06 },
          offset: 1,
        },
      ],
    }),
    // Accent bloom behind the top of the device. It separates the bezel from the
    // backdrop without putting a shadow on the product, which Apple disallows.
    ellipseGradientToSvg({
      id: 'halo',
      centre: { x: output.width / 2, y: haloTop + haloHeight * 0.14 },
      radius: { x: output.width * 0.6, y: output.height * 0.2 },
      stops: [
        { paint: { color: halo.color, opacity: halo.opacity }, offset: 0 },
        { paint: { color: halo.color, opacity: 0 }, offset: 0.72 },
      ],
    }),
  ];

  const rules = eyebrow && canvas.showRules
    ? [-1, 1]
        .map((side) => {
          const gap = Math.round(layout.kickerSize * 0.9);
          const inner = eyebrow.width / 2 + gap;
          const x =
            side < 0
              ? output.width / 2 - inner - eyebrow.rule
              : output.width / 2 + inner;

          return (
            `<rect x="${x.toFixed(2)}" ` +
            `y="${layout.kickerBottom - eyebrow.height / 2}" ` +
            `width="${eyebrow.rule}" height="1" ` +
            `fill="${rule.color}" fill-opacity="${rule.opacity}" />`
          );
        })
        .join('')
    : '';

  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${output.width}" ` +
      `height="${output.height}"><defs>${defs.join('')}</defs>` +
      `<rect width="${output.width}" height="${output.height}" fill="${toPaint(palette.base).color}" />` +
      `<rect width="${output.width}" height="${output.height}" fill="url(#sweep)" />` +
      `<rect width="${output.width}" height="${output.height}" fill="url(#grid)" mask="url(#gridFade)" />` +
      `<rect width="${output.width}" height="${output.height}" fill="url(#vignette)" />` +
      `<g opacity="${theme === 'dark' ? 0.42 : 0.2}">` +
      `<rect width="${output.width}" height="${output.height}" fill="url(#halo)" />` +
      `</g>${rules}</svg>`,
  );
}

/**
 * A soft shadow traced from the device's own silhouette.
 *
 * Play listings allow a shadow under the device; Apple treats one as modifying a
 * product image. Blurring the alpha channel gives the same result a CSS
 * `drop-shadow` would, which the browser renderer used to provide.
 */
async function shadowFor(device: Buffer, size: Size, blur: number) {
  const mask = await sharp(device)
    .ensureAlpha()
    .extractChannel('alpha')
    .png()
    .toBuffer();
  const alpha = await sharp(mask)
    .blur(Math.max(blur / 2, 0.3))
    .linear(0.55, 0)
    .toBuffer();

  return sharp({
    create: {
      width: size.width,
      height: size.height,
      channels: 3,
      background: '#000000',
    },
  })
    .joinChannel(alpha)
    .png()
    .toBuffer();
}

export async function renderCanvas(options: CanvasOptions): Promise<Buffer> {
  const { output, canvas, caption, theme } = options;
  const palette = canvas[theme];

  const ratio = (value: number, name: string, min = 0.01, max = 1) => {
    if (!Number.isFinite(value) || value < min || value > max) {
      throw new Error(`${name} must be between ${min} and ${max}.`);
    }
    return value;
  };
  const maxLines = canvas.titleLines ?? 2;
  if (!Number.isInteger(maxLines) || maxLines < 1 || maxLines > 4) {
    throw new Error('titleLines must be an integer between 1 and 4.');
  }
  const maxWidth = Math.round(output.width * ratio(canvas.titleWidthRatio ?? 0.8, 'titleWidthRatio'));
  const minScale = ratio(canvas.titleMinScale ?? 0.72, 'titleMinScale');
  ratio(canvas.deviceWidthRatio ?? 0.88, 'deviceWidthRatio');
  if (!caption.title.trim()) throw new Error('Caption title must not be empty.');
  const probe = captionLayout(options);
  const baseTitleStyle: TextStyle = {
    family: canvas.titleFont ?? canvas.sansFont,
    fontFile: canvas.titleFontFile,
    size: probe.titleSize,
    weight: 700,
    letterSpacing: probe.titleSize * -0.032,
    colour: palette.title,
  };

  let title: Awaited<ReturnType<typeof typesetLine>> | undefined;
  let titleSize = probe.titleSize;
  for (let size = probe.titleSize; size >= Math.ceil(probe.titleSize * minScale); size -= 1) {
    const titleStyle = { ...baseTitleStyle, size, letterSpacing: size * -0.025 };
    const lines = await wrap(caption.title, titleStyle, maxWidth);
    if (lines.length > maxLines) continue;
    const widths = await Promise.all(lines.map((line) => measureLine(line, titleStyle)));
    if (widths.some((width) => width > maxWidth)) continue;
    // Shape the whole paragraph: Pango preserves baselines across all lines.
    const candidate = await typesetLine(lines.join('\n'), titleStyle);
    if (candidate.height <= probe.titleBlockHeight && candidate.width <= maxWidth) {
      title = candidate;
      titleSize = size;
      break;
    }
  }
  if (!title) throw new Error(`Caption does not fit ${maxLines} lines: "${caption.title}". Shorten it or increase titleLines.`);

  const index = canvas.showIndex
    ? `[ ${String(options.index).padStart(2, '0')} ]`
    : '';
  const label = [index, caption.kicker ?? ''].filter(Boolean).join('\u00a0\u00a0');
  const kickerStyle: TextStyle = {
    family: canvas.kickerFont ?? canvas.monoFont,
    fontFile: canvas.kickerFontFile,
    size: probe.kickerSize,
    weight: 600,
    letterSpacing: probe.kickerSize * 0.02,
    colour: palette.kicker,
  };

  const kicker = label
    ? await typesetLine(label.toUpperCase(), kickerStyle)
    : undefined;

  if (kicker && (kicker.width > maxWidth || kicker.height > probe.kickerHeight)) {
    throw new Error(`Kicker exceeds the caption safe area: "${label}".`);
  }
  const layout = captionLayout(options, { titleHeight: title.height, kickerHeight: kicker?.height ?? 0, titleSize });
  const backdrop = backdropSvg(
    options,
    layout,
    kicker
      ? { width: kicker.width, height: kicker.height, rule: Math.round(layout.kickerSize * 2.4) }
      : undefined,
  );

  const overlays: OverlayOptions[] = [];

  if (kicker) {
    overlays.push({
      input: kicker.buffer,
      left: Math.round((output.width - kicker.width) / 2),
      top: layout.kickerBottom - kicker.height,
    });
  }

  overlays.push({
    input: title.buffer,
    left: Math.round((output.width - title.width) / 2),
    top: layout.titleTop,
  });

  const bleed = options.allowBleed && (canvas.deviceBleed ?? false);
  const stageHeight =
    output.height -
    layout.stageTop -
    (bleed ? 0 : layout.bottomPadding);
  if (stageHeight <= 0) throw new Error('Caption leaves no space for the device.');
  const source = await sharp(options.device).metadata();
  const scale = Math.min(
    (output.width * (canvas.deviceWidthRatio ?? 0.88)) / (source.width ?? 1),
    (stageHeight * (bleed ? 1.16 : 1)) / (source.height ?? 1),
  );
  const width = Math.round((source.width ?? 1) * scale);
  const height = Math.round((source.height ?? 1) * scale);
  const left = Math.round((output.width - width) / 2);
  // A bleed target wants the device running off the bottom edge. When its aspect
  // ratio makes it width-limited it can come up short of that, so it is anchored
  // to the bottom rather than left floating with a band of backdrop beneath it.
  const top = bleed
    ? Math.max(layout.stageTop, output.height - height)
    : layout.stageTop;
  // sharp will not composite past the canvas, so any overflow is trimmed here.
  const visible = Math.min(height, output.height - top);

  let device = await sharp(options.device)
    .resize(width, height, { fit: 'fill' })
    .png()
    .toBuffer();

  if (visible < height) {
    device = await sharp(device)
      .extract({ left: 0, top: 0, width, height: visible })
      .png()
      .toBuffer();
  }

  if (options.allowShadow) {
    overlays.push({
      input: await shadowFor(
        device,
        { width, height: visible },
        Math.round(output.height * 0.028),
      ),
      left,
      top: Math.min(top + Math.round(output.height * 0.012), output.height - visible),
    });
  }

  overlays.push({ input: device, left, top });

  return sharp(backdrop).composite(overlays).png().toBuffer();
}
