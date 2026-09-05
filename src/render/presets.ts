import type { CompositionLayer, CompositionSpec, DeviceLayer, LayoutPreset, TextLayer } from '../composition-types';
import type { CanvasTheme, FormFactor, Size, ThemeName } from '../types';
import { captionLayout } from './caption-layout.ts';

export interface PresetContext {
  readonly screens: readonly string[];
  readonly output: Size;
  readonly canvas: CanvasTheme;
  readonly theme: ThemeName;
  readonly captionScale: number;
  readonly captionGapRatio?: number;
  readonly formFactor?: FormFactor;
  readonly deviceSize?: Size;
  /** Measured framed dimensions, keyed by preset layer ID. */
  readonly deviceSizes?: Readonly<Record<string, Size>>;
  /** Fitted glyph extents in output pixels, before placing any layers. */
  readonly captionMetrics?: Readonly<Record<string, Size & { readonly fontSize: number }>>;
}

function fittedSize(width: number, height: number, source: Size, output: Size) {
  const scale = Math.min(width * output.width / source.width, height * output.height / source.height);
  return { width: source.width * scale / output.width, height: source.height * scale / output.height };
}

function rotatedSize(size: Size, rotation: number, output: Size) {
  const angle = Math.abs(rotation) * Math.PI / 180;
  return {
    width: size.width * Math.cos(angle) + size.height * output.height / output.width * Math.sin(angle),
    height: size.height * Math.cos(angle) + size.width * output.width / output.height * Math.sin(angle),
  };
}

/** Returns fresh, editable layers. No preset is baked into a bitmap. */
export function createPreset(preset: LayoutPreset, context: PresetContext): CompositionLayer[] {
  if (preset === 'blank') return [];
  if (!['classic', 'tilted-panorama', 'feature-closeup', 'side-aligned'].includes(preset)) {
    throw new Error(`Unknown composition preset "${preset}".`);
  }
  const { canvas, theme, screens } = context;
  const palette = canvas[theme];
  const layers: CompositionLayer[] = [];
  const { output } = context;
  const landscape = output.width > output.height;
  const factor = context.formFactor ?? 'phone';
  const titleWidth = canvas.titleWidthRatio ?? 0.8;
  const metrics = context.captionMetrics;
  const titleMetrics = screens.map((_, i) => metrics?.[`title-${i + 1}`]);
  const kickerMetrics = screens.map((_, i) => metrics?.[`kicker-${i + 1}`]);
  // A panorama uses the tallest actual caption in its set. Separate fitting
  // capacity must never turn into extra padding in the final composition.
  const caption = captionLayout(context, metrics ? {
    titleHeight: Math.max(0, ...titleMetrics.map((text) => text?.height ?? 0)),
    kickerHeight: Math.max(0, ...kickerMetrics.map((text) => text?.height ?? 0)),
    titleSize: Math.max(0, ...titleMetrics.map((text) => text?.fontSize ?? 0)),
  } : undefined);
  const titleSize = caption.titleSize / output.width;
  const kickerSize = caption.kickerSize / output.width;
  const titleY = caption.titleTop / output.height;
  const titleHeight = Math.max(0.001, caption.titleBlockHeight / output.height);
  const contentTop = caption.stageTop / output.height;
  const bottom = 1 - caption.bottomPadding / output.height;
  if (contentTop >= bottom) throw new Error('Caption leaves no space for the device.');
  const margin = (1 - titleWidth) / 2;
  for (const [i, screen] of screens.entries()) {
    const n = i + 1;
    const title: TextLayer = {
      id: `title-${n}`, kind: 'text', text: { screen, caption: 'title' },
      x: i + margin, y: titleY, width: titleWidth, height: titleHeight,
      anchor: { x: 0, y: 0 }, align: 'center', verticalAlign: 'top',
      font: canvas.titleFont ?? canvas.sansFont, fontFile: canvas.titleFontFile,
      fontSize: titleSize, minFontSize: titleSize * (canvas.titleMinScale ?? 0.72),
      weight: 700, letterSpacing: -0.025, maxLines: canvas.titleLines ?? 2, color: palette.title, zIndex: 10,
    };
    const kicker: TextLayer = {
      id: `kicker-${n}`, kind: 'text', text: { screen, caption: 'kicker' },
      x: i + margin, y: caption.topPadding / output.height, width: titleWidth, height: Math.max(0.001, caption.kickerHeight / output.height),
      anchor: { x: 0, y: 0 }, align: 'center', verticalAlign: 'bottom',
      font: canvas.kickerFont ?? canvas.sansFont, fontFile: canvas.kickerFontFile,
      fontSize: kickerSize, minFontSize: kickerSize * 0.9, weight: 600, maxLines: 2,
      letterSpacing: 0.01, color: palette.kicker, zIndex: 10,
    };
    const source = context.deviceSizes?.[`device-${n}`] ?? context.deviceSize ??
      (factor === 'desktop' ? { width: 16, height: 10 } : factor === 'tablet' ? { width: 3, height: 4 } : { width: 9, height: 19.5 });
    const wideDevice = source.width > source.height;
    const fit = fittedSize(canvas.deviceWidthRatio ?? 0.88, bottom - contentTop, source, output);
    const device: DeviceLayer = {
      id: `device-${n}`, kind: 'device', screen, x: i + 0.5, y: contentTop + fit.height / 2, ...fit,
    };
    if (preset === 'side-aligned') {
      if (wideDevice || landscape) {
        const kickerY = 0.20;
        const headlineY = kickerY + (caption.kickerHeight + caption.kickerGap) / output.height;
        layers.push(
          { ...kicker, x: i + margin, y: kickerY, width: 0.29, align: 'left' },
          { ...title, x: i + margin, y: headlineY, width: 0.29, height: metrics ? titleHeight : caption.titleSize * 6 / output.height,
            maxLines: 5, align: 'left' },
          { ...device, x: i + 0.69, y: 0.57, ...fittedSize(0.56, 0.74, source, output), rotation: -4 },
        );
      } else if (factor === 'tablet') {
        layers.push(
          { ...kicker, align: 'left' },
          { ...title, align: 'left' },
          { ...device, x: i + 0.72, y: 0.64, ...fittedSize(0.88, 0.64, source, output), rotation: -5 },
        );
      } else {
        const kickerY = 0.18;
        const headlineY = kickerY + (caption.kickerHeight + caption.kickerGap) / output.height;
        layers.push(
          { ...kicker, x: i + margin, y: kickerY, width: 0.35, align: 'left' },
          { ...title, x: i + margin, y: headlineY, width: 0.35, height: metrics ? titleHeight : caption.titleSize * 6 / output.height,
            maxLines: 5, align: 'left' },
          { ...device, x: i + 0.83, y: 0.65, ...fittedSize(0.65, 0.70, source, output), rotation: -5 },
        );
      }
    } else if (preset === 'feature-closeup') {
      const wide = wideDevice && landscape;
      const rotation = wide ? 3 : 6;
      let fit = fittedSize(0.70, wide ? 0.51 : bottom - contentTop, source, output);
      let bounds = rotatedSize(fit, rotation, output);
      const shrink = Math.min(1, (bottom - contentTop) / bounds.height);
      fit = { width: fit.width * shrink, height: fit.height * shrink };
      bounds = rotatedSize(fit, rotation, output);
      layers.push(kicker, title,
        { ...device, x: i + (wide ? 0.63 : 0.70), y: contentTop + bounds.height / 2,
          ...fit, rotation },
        { ...device, id: `detail-${n}`, x: i + (wide ? 0.28 : 0.40),
          y: Math.min(bottom - (wide ? 0.29 : 0.30) / 2, contentTop + bounds.height * 0.78),
          width: wide ? 0.40 : 0.66, height: wide ? 0.29 : 0.30,
          frame: { kind: 'none' }, crop: wide
            ? { x: 0.36, y: 0.22, width: 0.60, height: 0.46 }
            : { x: 0.04, y: 0.24, width: 0.92, height: factor === 'tablet' ? 0.36 : 0.42 },
          radius: wide ? 0.015 : 0.03, zIndex: 5, shadow: { blur: 0.022, y: 0.012, opacity: 0.23 } },
      );
    } else if (preset === 'tilted-panorama') {
      layers.push({ ...kicker, align: 'left' }, { ...title, align: 'left' });
      // One oversized device straddles each pair; an odd final panel stands alone.
      if (i % 2 === 0) {
        const paired = i + 1 < screens.length;
        const rotation = wideDevice ? -6 : factor === 'tablet' ? -9 : -12;
        let fit = fittedSize(paired ? 1.38 : 0.86, paired ? 0.94 : bottom - contentTop, source, output);
        let bounds = rotatedSize(fit, rotation, output);
        if (!paired) {
          const shrink = Math.min(1, 0.88 / bounds.width, (bottom - contentTop) / bounds.height);
          fit = { width: fit.width * shrink, height: fit.height * shrink };
          bounds = rotatedSize(fit, rotation, output);
        }
        layers.push({
          ...device, x: i + (paired ? 1 : 0.5), y: contentTop + bounds.height / 2,
          ...fit, rotation, shadow: { blur: 0.03, y: 0.012, opacity: 0.23 },
        });
      }
    } else {
      layers.push(kicker, title, device);
    }
  }
  return layers;
}

/** Overrides are keyed by ID, so reordering a preset never changes their target. */
export function compositionLayers(spec: CompositionSpec, context: PresetContext): CompositionLayer[] {
  const layers = [...createPreset(spec.preset ?? 'classic', context), ...(spec.layers ?? [])];
  const ids = new Set<string>();
  for (const layer of layers) {
    if (!layer.id || ids.has(layer.id)) throw new Error(`Duplicate or empty layer ID "${layer.id}".`);
    ids.add(layer.id);
  }
  for (const id of Object.keys(spec.overrides ?? {})) {
    if (!ids.has(id)) throw new Error(`Layer override "${id}" does not match a layer.`);
  }
  return layers.map((layer) => ({
    ...layer, ...spec.overrides?.[layer.id], id: layer.id, kind: layer.kind,
  }) as CompositionLayer);
}
