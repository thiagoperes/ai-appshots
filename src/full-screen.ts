import type { DeviceLayer } from './composition-types';
import type { Size } from './types';

function minimumCoverage(layer: DeviceLayer) {
  const minimum = layer.fullScreen?.minimumCoverage ?? 0.9;
  if (!Number.isFinite(minimum) || minimum < 0.5 || minimum > 1) {
    throw new Error('Full-screen minimumCoverage must be between 0.5 and 1.');
  }
  return minimum;
}

export function validateFullScreenLayer(layer: DeviceLayer) {
  minimumCoverage(layer);
  if (layer.crop || layer.rotation || layer.radius || (layer.opacity ?? 1) !== 1) {
    throw new Error(`Full-screen layer "${layer.id}" must show the entire upright, opaque app without cropping.`);
  }
}

export function assertFullScreenPlacement(layer: DeviceLayer, rendered: Size, output: Size, left: number, top: number) {
  if (left < 0 || top < 0 || left + rendered.width > output.width || top + rendered.height > output.height) {
    throw new Error(`Full-screen layer "${layer.id}" extends beyond the panel and would hide app UI.`);
  }
  // A portrait phone/window in a landscape panel fills its height; a tablet
  // in a portrait panel fills its width. Never reduce both axes to a thumbnail.
  const coverage = Math.max(rendered.width / output.width, rendered.height / output.height);
  if (coverage + 0.002 < minimumCoverage(layer)) {
    throw new Error(`Full-screen layer "${layer.id}" is too small. Reduce marketing space so the entire app can fill the panel.`);
  }
}

/** Fits the whole native screen. Caption readability and native viewport scale are separate policies. */
export function fullScreenDeviceLayer(options: {
  readonly id: string;
  readonly screen: string;
  readonly source: Size;
  readonly output: Size;
  readonly area: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly minimumCoverage?: number;
}): DeviceLayer {
  const { source, output, area } = options;
  if (![source.width, source.height, output.width, output.height].every(n => Number.isFinite(n) && n > 0) ||
    ![area.x, area.y, area.width, area.height].every(Number.isFinite) ||
    area.x < 0 || area.y < 0 || area.width <= 0 || area.height <= 0 ||
    area.x + area.width > 1 || area.y + area.height > 1) {
    throw new Error('Full-screen image dimensions and available canvas bounds must be valid.');
  }
  const scale = Math.min(area.width * output.width / source.width, area.height * output.height / source.height);
  const rendered = { width: Math.round(source.width * scale), height: Math.round(source.height * scale) };
  const layer: DeviceLayer = {
    id: options.id, kind: 'device', screen: options.screen, frame: { kind: 'none' },
    fullScreen: { minimumCoverage: options.minimumCoverage ?? 0.9 },
    x: area.x + area.width / 2, y: area.y + area.height / 2, width: rendered.width / output.width,
  };
  validateFullScreenLayer(layer);
  assertFullScreenPlacement(layer, rendered, output,
    Math.round(layer.x * output.width - rendered.width / 2), Math.round(layer.y * output.height - rendered.height / 2));
  return layer;
}
