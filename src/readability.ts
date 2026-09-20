import type { DeviceLayer, ReadabilityPolicy, SourceCrop } from './composition-types';
import type { Size } from './types';

export function readabilityPolicy(value?: boolean | ReadabilityPolicy) {
  if (!value) return undefined;
  const options = value === true ? {} : value;
  const previewWidth = options.previewWidth ?? 390;
  const minTextSize = options.minTextSize ?? 14;
  if (!Number.isFinite(previewWidth) || previewWidth < 240 || previewWidth > 1024) {
    throw new Error('readability.previewWidth must be between 240 and 1024 pixels.');
  }
  if (!Number.isFinite(minTextSize) || minTextSize < 10 || minTextSize > 48) {
    throw new Error('readability.minTextSize must be between 10 and 48 pixels.');
  }
  return { previewWidth, minTextSize };
}

export function assertReadableText(id: string, previewTextSize: number, minimum: number) {
  if (!Number.isFinite(previewTextSize) || previewTextSize + 0.01 < minimum) {
    throw new Error(`Layer "${id}" renders UI text at ${previewTextSize.toFixed(2)}px in the mobile preview; ` +
      `at least ${minimum}px is required. Use a tighter content crop, enlarge the layer, or capture larger native text. ` +
      'Do not shrink the entire device to make it fit.');
  }
}

/** Fits one real UI region at a readable size; never invents or reflows captured UI. */
export function readableDeviceLayer(options: {
  readonly id: string;
  readonly screen: string;
  readonly source: Size;
  readonly output: Size;
  readonly crop: SourceCrop;
  readonly sourceTextSize: number;
  /** Available canvas region, in panel fractions. */
  readonly area: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly readability?: ReadabilityPolicy;
}): DeviceLayer {
  const { source, output, crop, area } = options;
  for (const size of [source, output]) {
    if (![size.width, size.height].every(n => Number.isFinite(n) && n > 0)) throw new Error('Image dimensions must be positive.');
  }
  for (const bounds of [crop, area]) {
    if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) ||
      bounds.x < 0 || bounds.y < 0 || bounds.width <= 0 || bounds.height <= 0 ||
      bounds.x + bounds.width > 1.000001 || bounds.y + bounds.height > 1.000001) {
      throw new Error('Readable content bounds must stay inside their image or canvas.');
    }
  }
  if (!Number.isFinite(options.sourceTextSize) || options.sourceTextSize <= 0) {
    throw new Error('sourceTextSize must describe the smallest important UI text in source pixels.');
  }
  const policy = readabilityPolicy(options.readability ?? true)!;
  const scale = Math.min(area.width * output.width / (source.width * crop.width),
    area.height * output.height / (source.height * crop.height));
  assertReadableText(options.id, options.sourceTextSize * scale * policy.previewWidth / output.width, policy.minTextSize);
  return {
    id: options.id, kind: 'device', screen: options.screen, frame: { kind: 'none' },
    crop, sourceTextSize: options.sourceTextSize,
    x: area.x + area.width / 2, y: area.y + area.height / 2,
    width: source.width * crop.width * scale / output.width,
  };
}
