import sharp from 'sharp';
import type { OverlayOptions } from 'sharp';

import { ellipseGradientToSvg, linearGradientToSvg, toPaint } from './color';
import { wrap } from './text';
import { typesetLine } from './typeset';
import type { TextStyle } from './typeset';
import type { CanvasTheme, Caption, Size, ThemeName } from '../types';

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

interface Layout {
  readonly titleSize: number;
  readonly kickerSize: number;
  readonly topPadding: number;
  readonly titleTop: number;
  readonly titleLineHeight: number;
  readonly titleBlockHeight: number;
  readonly eyebrowHeight: number;
  readonly captionHeight: number;
  readonly stageTop: number;
}

function layoutFor(
  options: CanvasOptions,
  lines: readonly string[],
  hasEyebrow: boolean,
): Layout {
  const { output } = options;
  const titleSize = Math.round(output.width * options.captionScale);
  const kickerSize = Math.max(14, Math.round(titleSize * 0.28));
  const topPadding = Math.round(output.height * 0.05);
  const titleLineHeight = titleSize * 1.04;
  const eyebrowHeight = hasEyebrow
    ? Math.round(kickerSize * 1.2) + Math.round(kickerSize * 1.25)
    : 0;
  // Always reserves two lines so the device sits at the same height on every
  // screen in the set. Without it a one-line caption lets the device ride up and
  // the frames jump as the user swipes. A three-line title still expands.
  const titleBlockHeight = Math.max(
    Math.round(titleLineHeight * 2),
    Math.round(titleLineHeight * lines.length),
  );
  const titleTop = topPadding + eyebrowHeight;
  const captionHeight =
    titleTop +
    titleBlockHeight +
    Math.round(output.height * options.captionGapRatio);

  return {
    titleSize,
    kickerSize,
    topPadding,
    titleTop,
    titleLineHeight,
    titleBlockHeight,
    eyebrowHeight,
    captionHeight,
    stageTop: captionHeight,
  };
}

/** Backdrop, technical grid, vignette, accent bloom and the eyebrow rules. */
function backdropSvg(
  options: CanvasOptions,
  layout: Layout,
  eyebrow: { readonly width: number; readonly rule: number } | undefined,
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

  const rules = eyebrow
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
            `y="${layout.topPadding + Math.round(layout.kickerSize * 1.2) / 2}" ` +
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
      `<rect y="${haloTop}" width="${output.width}" height="${haloHeight}" fill="url(#halo)" />` +
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
  const alpha = await sharp(device)
    .ensureAlpha()
    .extractChannel('alpha')
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

  const probe = layoutFor(options, ['', ''], Boolean(caption.kicker));
  const titleStyle: TextStyle = {
    family: canvas.sansFont,
    size: probe.titleSize,
    weight: 700,
    letterSpacing: probe.titleSize * -0.032,
    colour: palette.title,
  };

  const lines = await wrap(
    caption.title,
    titleStyle,
    Math.round(output.width * 0.94),
  );

  const index = canvas.showIndex
    ? `[ ${String(options.index).padStart(2, '0')} ]`
    : '';
  const label = [index, caption.kicker ?? ''].filter(Boolean).join('\u00a0\u00a0');
  const layout = layoutFor(options, lines, Boolean(label));

  const kickerStyle: TextStyle = {
    family: canvas.monoFont,
    size: layout.kickerSize,
    weight: 500,
    letterSpacing: layout.kickerSize * 0.22,
    colour: palette.kicker,
  };

  const kicker = label
    ? await typesetLine(label.toUpperCase(), kickerStyle)
    : undefined;

  const backdrop = backdropSvg(
    options,
    layout,
    kicker
      ? { width: kicker.width, rule: Math.round(layout.kickerSize * 2.4) }
      : undefined,
  );

  const overlays: OverlayOptions[] = [];

  if (kicker) {
    overlays.push({
      input: kicker.buffer,
      left: Math.round((output.width - kicker.width) / 2),
      top:
        layout.topPadding +
        Math.round((Math.round(layout.kickerSize * 1.2) - kicker.height) / 2),
    });
  }

  const rendered = await Promise.all(
    lines.map((line) => typesetLine(line, titleStyle)),
  );
  const blockCentre = layout.titleTop + layout.titleBlockHeight / 2;
  const textHeight = lines.length * layout.titleLineHeight;

  rendered.forEach((line, position) => {
    const lineTop =
      blockCentre - textHeight / 2 + position * layout.titleLineHeight;

    overlays.push({
      input: line.buffer,
      left: Math.round((output.width - line.width) / 2),
      top: Math.round(lineTop + (layout.titleLineHeight - line.height) / 2),
    });
  });

  const stageHeight =
    output.height -
    layout.stageTop -
    (options.allowBleed ? 0 : Math.round(output.height * 0.042));
  const source = await sharp(options.device).metadata();
  const scale = Math.min(
    (output.width * 0.88) / (source.width ?? 1),
    (stageHeight * (options.allowBleed ? 1.16 : 1)) / (source.height ?? 1),
  );
  const width = Math.round((source.width ?? 1) * scale);
  const height = Math.round((source.height ?? 1) * scale);
  const left = Math.round((output.width - width) / 2);
  // A bleed target wants the device running off the bottom edge. When its aspect
  // ratio makes it width-limited it can come up short of that, so it is anchored
  // to the bottom rather than left floating with a band of backdrop beneath it.
  const top = options.allowBleed
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
