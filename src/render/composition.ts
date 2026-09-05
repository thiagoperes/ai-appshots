import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import type { OverlayOptions } from 'sharp';

import type {
  CompositionLayer, CompositionNotice, CompositionResult, CompositionSpec,
  DeviceLayer, ImageLayer, LayerPlacement, ShapeLayer, SourceCrop, TextLayer,
} from '../composition-types';
import type { CanvasTheme, CaptionBundle, FormFactor, Size, ThemeName } from '../types';
import { escapeXml, linearGradientToSvg, toPaint } from './color.ts';
import { compositionLayers } from './presets.ts';
import { wrap } from './text.ts';
import { measureLine, typesetCaption } from './typeset.ts';
import type { TextStyle } from './typeset.ts';

export interface CompositionOptions {
  readonly output: Size;
  readonly screens: readonly string[];
  readonly composition: CompositionSpec;
  readonly canvas: CanvasTheme;
  readonly theme: ThemeName;
  readonly captions: CaptionBundle;
  readonly locale: string;
  readonly captionScale: number;
  readonly captionGapRatio?: number;
  readonly formFactor?: FormFactor;
  readonly deviceSize?: Size;
  readonly deviceSizes?: Readonly<Record<string, Size>>;
  readonly assetRoot?: string;
  /** Device preparation is separate from placement and store validation. */
  readonly resolveDevice: (layer: DeviceLayer) => Promise<{
    readonly image: Buffer;
    readonly appleArtwork?: boolean;
  }>;
}

const transparent = { r: 0, g: 0, b: 0, alpha: 0 };

function number(value: number, name: string, min = -Infinity, max = Infinity) {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be finite and between ${min} and ${max}.`);
  }
  return value;
}

function validateLayer(layer: CompositionLayer) {
  const prefix = `Layer "${layer.id}"`;
  if (!['device', 'image', 'text', 'shape'].includes(layer.kind)) throw new Error(`${prefix} has an unknown kind.`);
  number(layer.x, `${prefix} x`);
  number(layer.y, `${prefix} y`);
  number(layer.width, `${prefix} width`, 0.001, 20);
  if (layer.height !== undefined) number(layer.height, `${prefix} height`, 0.001, 20);
  number(layer.rotation ?? 0, `${prefix} rotation`, -360, 360);
  number(layer.scale ?? 1, `${prefix} scale`, 0.01, 10);
  number(layer.opacity ?? 1, `${prefix} opacity`, 0, 1);
  number(layer.zIndex ?? 0, `${prefix} zIndex`);
  number(layer.anchor?.x ?? 0.5, `${prefix} anchor.x`, 0, 1);
  number(layer.anchor?.y ?? 0.5, `${prefix} anchor.y`, 0, 1);
  if (layer.shadow) {
    number(layer.shadow.blur ?? 0.025, `${prefix} shadow.blur`, 0, 0.25);
    number(layer.shadow.opacity ?? 0.25, `${prefix} shadow.opacity`, 0, 1);
    number(layer.shadow.x ?? 0, `${prefix} shadow.x`, -1, 1);
    number(layer.shadow.y ?? 0.012, `${prefix} shadow.y`, -1, 1);
  }
  if ('radius' in layer) number(layer.radius ?? 0, `${prefix} radius`, 0, 10);
  if (layer.kind === 'shape') {
    number(layer.height, `${prefix} height`, 0.001, 20);
    number(layer.strokeWidth ?? 0, `${prefix} strokeWidth`, 0, 1);
  }
  if (layer.kind === 'text') {
    number(layer.height, `${prefix} height`, 0.001, 20);
    number(layer.fontSize ?? 0.07, `${prefix} fontSize`, 0.001, 1);
    number(layer.minFontSize ?? (layer.fontSize ?? 0.07) * 0.72, `${prefix} minFontSize`, 0.001, layer.fontSize ?? 0.07);
    number(layer.weight ?? 700, `${prefix} weight`, 100, 900);
    number(layer.letterSpacing ?? -0.025, `${prefix} letterSpacing`, -0.25, 2);
    number(layer.lineSpacing ?? 0, `${prefix} lineSpacing`, 0, 3);
    const lines = number(layer.maxLines ?? 3, `${prefix} maxLines`, 1, 20);
    if (!Number.isInteger(lines)) throw new Error(`${prefix} maxLines must be an integer.`);
  }
}

function fillMarkup(fill: string, size: Size) {
  if (fill.trim().startsWith('linear-gradient(')) {
    return { defs: linearGradientToSvg(fill, 'fill', size), paint: 'fill="url(#fill)"' };
  }
  const paint = toPaint(fill);
  return { defs: '', paint: `fill="${escapeXml(paint.color)}" fill-opacity="${paint.opacity}"` };
}

function shapeBuffer(size: Size, fill: string, layer?: ShapeLayer, radius = 0, strokeWidth = 0) {
  const { defs, paint } = fillMarkup(fill, size);
  const stroke = toPaint(layer?.stroke ?? 'transparent');
  const attributes = `${paint} stroke="${escapeXml(stroke.color)}" stroke-opacity="${stroke.opacity}" stroke-width="${strokeWidth}"`;
  const inset = strokeWidth / 2;
  const shape = layer?.shape === 'ellipse'
    ? `<ellipse cx="${size.width / 2}" cy="${size.height / 2}" rx="${Math.max(0, size.width / 2 - inset)}" ry="${Math.max(0, size.height / 2 - inset)}" ${attributes}/>`
    : `<rect x="${inset}" y="${inset}" width="${Math.max(0, size.width - strokeWidth)}" height="${Math.max(0, size.height - strokeWidth)}" rx="${radius}" ${attributes}/>`;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}"><defs>${defs}</defs>${shape}</svg>`);
}

async function withOpacity(input: Buffer, opacity: number) {
  if (opacity === 1) return input;
  const { data, info } = await sharp(input).toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 3; i < data.length; i += 4) data[i] = Math.round(data[i]! * opacity);
  return sharp(data, { raw: info }).png().toBuffer();
}

async function cropImage(input: Buffer, crop: SourceCrop, id: string) {
  number(crop.x, `${id} crop.x`, 0, 1);
  number(crop.y, `${id} crop.y`, 0, 1);
  number(crop.width, `${id} crop.width`, 0.001, 1);
  number(crop.height, `${id} crop.height`, 0.001, 1);
  if (crop.x + crop.width > 1.000001 || crop.y + crop.height > 1.000001) {
    throw new Error(`Layer "${id}" crop extends outside the source image.`);
  }
  const { width, height } = await sharp(input).metadata();
  const left = Math.round(crop.x * width!);
  const top = Math.round(crop.y * height!);
  const right = Math.min(width!, Math.round((crop.x + crop.width) * width!));
  const bottom = Math.min(height!, Math.round((crop.y + crop.height) * height!));
  if (right <= left || bottom <= top) throw new Error(`Layer "${id}" crop is smaller than one pixel.`);
  return sharp(input).extract({ left, top, width: right - left, height: bottom - top }).png().toBuffer();
}

function textFor(layer: TextLayer, options: CompositionOptions) {
  if (typeof layer.text === 'string') return layer.text;
  if ('locales' in layer.text) {
    const text = layer.text.locales[options.locale];
    if (text === undefined) throw new Error(`Layer "${layer.id}" has no text for locale "${options.locale}".`);
    return text;
  }
  const caption = options.captions[layer.text.screen];
  if (!caption) throw new Error(`Layer "${layer.id}" references missing captions for "${layer.text.screen}".`);
  return caption[layer.text.caption] ?? '';
}

async function fitText(layer: TextLayer, options: CompositionOptions) {
  const text = layer.uppercase ? textFor(layer, options).toUpperCase() : textFor(layer, options);
  if (!text.trim()) return undefined;
  const width = Math.max(1, Math.round(layer.width * options.output.width));
  const height = Math.max(1, Math.round(layer.height * options.output.height));
  const size = (layer.fontSize ?? 0.07) * options.output.width;
  const min = Math.ceil((layer.minFontSize ?? (layer.fontSize ?? 0.07) * 0.72) * options.output.width);
  for (let current = Math.max(1, Math.round(size)); current >= min; current -= 1) {
    const style: TextStyle = {
      family: layer.font ?? options.canvas.titleFont ?? options.canvas.sansFont,
      fontFile: layer.fontFile ? resolve(options.assetRoot ?? '.', layer.fontFile) : undefined,
      size: current, weight: layer.weight ?? options.canvas.titleWeight ?? 700,
      letterSpacing: current * (layer.letterSpacing ?? -0.025),
      colour: layer.color ?? options.canvas[options.theme].title,
      align: layer.align ?? 'left', lineSpacing: current * (layer.lineSpacing ?? 0),
    };
    const lines = await wrap(text, style, width);
    if (lines.length > (layer.maxLines ?? 3)) continue;
    if ((await Promise.all(lines.map((line) => measureLine(line, style)))).some((w) => w > width)) continue;
    const result = await typesetCaption(lines.join('\n'), style);
    if (result.width > width || result.height > height) continue;
    return { ...result, fontSize: current };
  }
  throw new Error(`Text layer "${layer.id}" does not fit. Shorten its text or increase its box, maxLines, or font-size range.`);
}

async function renderText(layer: TextLayer, result: Awaited<ReturnType<typeof fitText>>, output: Size) {
  if (!result) return undefined;
  const width = Math.max(1, Math.round(layer.width * output.width));
  const height = Math.max(1, Math.round(layer.height * output.height));
  const horizontal = layer.align === 'right' ? 1 : layer.align === 'center' ? 0.5 : 0;
  const vertical = layer.verticalAlign === 'bottom' ? 1 : layer.verticalAlign === 'center' ? 0.5 : 0;
  return sharp({ create: { width, height, channels: 4, background: transparent } })
    .composite([{ input: result.buffer, left: Math.round((width - result.width) * horizontal), top: Math.round((height - result.height) * vertical) }])
    .png().toBuffer();
}

async function renderImage(layer: DeviceLayer | ImageLayer, options: CompositionOptions) {
  const source = layer.kind === 'device'
    ? await options.resolveDevice(layer)
    : { image: await readFile(resolve(options.assetRoot ?? '.', layer.path)), appleArtwork: false };
  let input = source.image;
  if (layer.crop) input = await cropImage(input, layer.crop, layer.id);
  const width = Math.max(1, Math.round(layer.width * options.output.width));
  const height = layer.height === undefined ? undefined : Math.max(1, Math.round(layer.height * options.output.height));
  input = await sharp(input).resize({ width, height,
    fit: layer.kind === 'device' ? 'inside' : layer.fit ?? 'contain', background: transparent,
  }).png().toBuffer();
  if (layer.radius) {
    const size = await sharp(input).metadata();
    input = await sharp(input).ensureAlpha().composite([{
      input: shapeBuffer({ width: size.width!, height: size.height! }, '#fff', undefined, layer.radius * options.output.width),
      blend: 'dest-in',
    }]).png().toBuffer();
  }
  return { image: input, appleArtwork: source.appleArtwork };
}

async function clippedOverlay(input: Buffer, left: number, top: number, size: Size): Promise<OverlayOptions | undefined> {
  const { width, height } = await sharp(input).metadata();
  const x = Math.max(0, left), y = Math.max(0, top);
  const w = Math.min(left + width!, size.width) - x;
  const h = Math.min(top + height!, size.height) - y;
  if (w <= 0 || h <= 0) return undefined;
  return {
    input: await sharp(input).extract({ left: x - left, top: y - top, width: w, height: h }).png().toBuffer(),
    left: x, top: y,
  };
}

async function shadowOverlay(input: Buffer, layer: LayerPlacement, left: number, top: number, panel: Size, size: Size) {
  const shadow = layer.shadow!;
  const sigma = Math.max(0.3, (shadow.blur ?? 0.025) * panel.width / 2);
  const padding = Math.ceil(sigma * 3);
  const alpha = await sharp(input).ensureAlpha().extend({ top: padding, bottom: padding, left: padding, right: padding, background: transparent })
    .extractChannel('alpha').png().toBuffer();
  // Extract first: sharp applies colour operations before channel extraction.
  const blurred = await sharp(alpha).blur(sigma).png().toBuffer();
  const { width, height } = await sharp(alpha).metadata();
  const paint = toPaint(shadow.color ?? '#000000');
  const background = await sharp({ create: { width: width!, height: height!, channels: 3, background: paint.color } })
    .joinChannel(blurred).png().toBuffer();
  return clippedOverlay(await withOpacity(background, paint.opacity * (shadow.opacity ?? 0.25)),
    left - padding + Math.round((shadow.x ?? 0) * panel.width),
    top - padding + Math.round((shadow.y ?? 0.012) * panel.height), size);
}

/** Renders one shared scene, then slices it at exact integer pixel boundaries. */
export async function renderComposition(options: CompositionOptions): Promise<CompositionResult> {
  const { output, composition } = options;
  for (const [name, value] of Object.entries(output)) {
    if (!Number.isInteger(value) || value < 1) throw new Error(`Output ${name} must be a positive integer.`);
  }
  if (!options.screens.length || options.screens.length > 10) throw new Error('A composition needs 1–10 panels.');
  const size = { width: output.width * options.screens.length, height: output.height };
  if (size.width * size.height > 180_000_000) throw new Error('Composition exceeds 180 megapixels; use smaller panorama groups.');
  const templates = compositionLayers(composition, options).filter((layer) => !layer.hidden);
  templates.forEach(validateLayer);
  const text = new Map(await Promise.all(templates.filter((layer): layer is TextLayer => layer.kind === 'text')
    .map(async (layer) => [layer.id, await fitText(layer, options)] as const)));
  const captionMetrics = Object.fromEntries([...text].map(([id, result]) => [id, {
    width: result?.width ?? 0, height: result?.height ?? 0, fontSize: result?.fontSize ?? 0,
  }]));
  const layers = compositionLayers(composition, { ...options, captionMetrics }).filter((layer) => !layer.hidden);
  layers.forEach(validateLayer);
  const notices: CompositionNotice[] = [];
  const overlays: OverlayOptions[] = [];
  const background = composition.background;
  if (background?.image) {
    const image = await sharp(await readFile(resolve(options.assetRoot ?? '.', background.image)))
      .resize(size.width, size.height, { fit: background.fit ?? 'cover', background: transparent }).png().toBuffer();
    overlays.push({ input: await withOpacity(image, number(background.opacity ?? 1, 'background.opacity', 0, 1)), left: 0, top: 0 });
  }
  for (const layer of [...layers].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))) {
    let input: Buffer | undefined;
    let appleArtwork = false;
    if (layer.kind === 'text') input = await renderText(layer, text.get(layer.id), output);
    else if (layer.kind === 'shape') {
      input = await sharp(shapeBuffer({ width: Math.max(1, Math.round(layer.width * output.width)), height: Math.max(1, Math.round(layer.height * output.height)) },
        layer.fill, layer, (layer.radius ?? 0) * output.width, (layer.strokeWidth ?? 0) * output.width)).png().toBuffer();
    } else if (layer.kind === 'device' || layer.kind === 'image') {
      const rendered = await renderImage(layer, options);
      input = rendered.image;
      appleArtwork = rendered.appleArtwork ?? false;
    } else throw new Error(`Unknown layer kind "${(layer as CompositionLayer).kind}".`);
    if (!input) continue;
    if (layer.scale !== undefined && layer.scale !== 1) {
      const meta = await sharp(input).metadata();
      input = await sharp(input).resize(Math.max(1, Math.round(meta.width! * layer.scale)), Math.max(1, Math.round(meta.height! * layer.scale))).png().toBuffer();
    }
    input = await withOpacity(input, layer.opacity ?? 1);
    const before = await sharp(input).metadata();
    const rotation = layer.rotation ?? 0;
    if (rotation) input = await sharp(input).rotate(rotation, { background: transparent }).png().toBuffer();
    const after = await sharp(input).metadata();
    const radians = rotation * Math.PI / 180;
    const dx = (0.5 - (layer.anchor?.x ?? 0.5)) * before.width!;
    const dy = (0.5 - (layer.anchor?.y ?? 0.5)) * before.height!;
    const left = Math.round(layer.x * output.width + dx * Math.cos(radians) - dy * Math.sin(radians) - after.width! / 2);
    const top = Math.round(layer.y * output.height + dx * Math.sin(radians) + dy * Math.cos(radians) - after.height! / 2);
    const clipped = left < 0 || top < 0 || left + after.width! > size.width || top + after.height! > size.height;
    const crossesSeam = Array.from({ length: options.screens.length - 1 }, (_, i) => (i + 1) * output.width)
      .some((seam) => left < seam && left + after.width! > seam);
    if (layer.kind === 'text' && (clipped || crossesSeam)) notices.push({ layer: layer.id, message: 'Text crosses an export edge or panorama seam; review at gallery size.' });
    if (appleArtwork && (rotation || clipped || crossesSeam || layer.shadow || (layer.opacity ?? 1) < 1 || ('radius' in layer && layer.radius))) notices.push({ layer: layer.id, message: 'This transforms or splits Apple product artwork. Use an unframed screen or generic frame for this treatment.' });
    if (layer.shadow) {
      const shadow = await shadowOverlay(input, layer, left, top, output, size);
      if (shadow) overlays.push(shadow);
    }
    const overlay = await clippedOverlay(input, left, top, size);
    if (overlay) overlays.push(overlay);
    else notices.push({ layer: layer.id, message: 'Layer is entirely outside the exported canvas.' });
  }
  const backdrop = shapeBuffer(size, background?.fill ?? options.canvas[options.theme].sweep);
  const image = await sharp(backdrop).composite(overlays).png().toBuffer();
  const panels: Buffer[] = [];
  for (let i = 0; i < options.screens.length; i += 1) {
    panels.push(await sharp(image).extract({ left: i * output.width, top: 0, ...output }).png().toBuffer());
  }
  return { image, panels, notices };
}
