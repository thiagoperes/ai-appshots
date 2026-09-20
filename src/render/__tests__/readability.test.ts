import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';
import { readableDeviceLayer } from '../../readability.ts';
import { renderComposition } from '../composition.ts';
import { DEFAULT_THEME } from '../../theme.ts';
import type { CompositionOptions } from '../composition.ts';

const source = { width: 1200, height: 2400 };
const output = { width: 1200, height: 2400 };
const area = { x: 0.05, y: 0.30, width: 0.90, height: 0.65 };
const crop = { x: 0.1, y: 0.5, width: 0.8, height: 0.4 };
const options = { id: 'ui', screen: 'one', source, output, area, crop, sourceTextSize: 48 };

test('readable content preserves aspect and fits a real crop without a miniature device', () => {
  const layer = readableDeviceLayer(options);
  assert.equal(layer.width, 0.9);
  assert.equal(layer.height, undefined);
  assert.deepEqual(layer.crop, crop);
  assert.equal(layer.rotation, undefined);
  assert.ok(48 * layer.width * 390 / (source.width * crop.width) >= 14);
});

test('rejects full tablet UI and height-constrained shrinkage at phone preview size', () => {
  assert.throws(() => readableDeviceLayer({ ...options,
    source: { width: 2064, height: 2752 }, sourceTextSize: 34,
    crop: { x: 0, y: 0, width: 1, height: 1 },
  }), /mobile preview/);
  assert.throws(() => readableDeviceLayer({ ...options, area: { ...area, height: 0.1 } }), /mobile preview/);
});

test('requires valid measured bounds and source text size', () => {
  assert.throws(() => readableDeviceLayer({ ...options, sourceTextSize: 0 }), /sourceTextSize/);
  assert.throws(() => readableDeviceLayer({ ...options, crop: { ...crop, x: 0.8 } }), /inside/);
  assert.throws(() => readableDeviceLayer({ ...options, readability: { previewWidth: NaN } }), /previewWidth/);
});

const image = sharp({ create: { ...source, channels: 3, background: '#fff' } }).png().toBuffer();
const base: CompositionOptions = {
  output, screens: ['one'], captions: { one: { title: 'Readable' } }, locale: 'en',
  theme: 'light', canvas: DEFAULT_THEME, captionScale: 0.1,
  composition: { preset: 'blank', readability: true },
  resolveDevice: async () => ({ image: await image }),
};

test('renderer rejects manual tiny UI overrides, including a hidden scale reduction', async () => {
  const layer = readableDeviceLayer(options);
  await assert.rejects(renderComposition({ ...base,
    composition: { ...base.composition, layers: [{ ...layer, width: 0.2 }] },
  }), /mobile preview/);
  await assert.rejects(renderComposition({ ...base,
    composition: { ...base.composition, layers: [{ ...layer, scale: 0.5 }] },
  }), /mobile preview/);
  await assert.rejects(renderComposition({ ...base,
    composition: { ...base.composition, layers: [{ ...layer, sourceTextSize: undefined }] },
  }), /needs sourceTextSize/);
  const result = await renderComposition({ ...base,
    composition: { ...base.composition, layers: [layer] },
  });
  assert.equal(result.panels.length, 1);
});

test('small marketing captions grow to the mobile minimum instead of being silently shrunk', async () => {
  await assert.rejects(renderComposition({ ...base,
    composition: { ...base.composition, layers: [{
      id: 'caption', kind: 'text', text: 'This cannot fit at a readable size',
      x: 0.5, y: 0.2, width: 0.10, height: 0.02, fontSize: 0.01, maxLines: 1,
    }] },
  }), /does not fit/);
});
