import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';
import { fullScreenDeviceLayer } from '../../full-screen.ts';
import { renderComposition } from '../composition.ts';
import { DEFAULT_THEME } from '../../theme.ts';

const source = { width: 240, height: 480 };
const options = { id: 'complete', screen: 'one', source, output: source,
  area: { x: 0, y: 0, width: 1, height: 1 } };
const layer = fullScreenDeviceLayer(options);
const pixels = Buffer.alloc(source.width * source.height * 3, 27);
for (const [x, y, channel] of [[0, 0, 0], [239, 0, 1], [0, 479, 2], [239, 479, 0]]) {
  pixels[(y! * source.width + x!) * 3 + channel!] = 255;
}
const image = sharp(pixels, { raw: { ...source, channels: 3 } }).png().toBuffer();
const render = (device = layer) => renderComposition({
  output: source, screens: ['one'], captions: {}, locale: 'en', theme: 'dark', canvas: DEFAULT_THEME,
  captionScale: 0.1, composition: { preset: 'blank', readability: true, layers: [device] },
  resolveDevice: async () => ({ image: await image }),
});

test('preserves every source pixel including all four screen edges', async () => {
  const result = await render();
  assert.deepEqual(await sharp(result.image).removeAlpha().raw().toBuffer(), pixels);
  assert.equal(layer.crop, undefined);
  assert.equal(layer.height, undefined);
});

test('rejects cropped, rotated, clipped, or miniaturized full app screens', async () => {
  await assert.rejects(render({ ...layer, crop: { x: 0, y: 0.5, width: 1, height: 0.5 } }), /entire upright/);
  await assert.rejects(render({ ...layer, rotation: 5 }), /entire upright/);
  await assert.rejects(render({ ...layer, x: 0.8 }), /hide app UI/);
  await assert.rejects(render({ ...layer, scale: 0.5 }), /too small/);
  assert.throws(() => fullScreenDeviceLayer({ ...options,
    area: { x: 0.1, y: 0.3, width: 0.8, height: 0.6 },
  }), /too small/);
});

test('fits the whole portrait desktop window by height inside a landscape export', () => {
  const desktop = fullScreenDeviceLayer({ ...options,
    output: { width: 2880, height: 1800 }, source: { width: 934, height: 1440 },
    area: { x: 0.52, y: 0.035, width: 0.46, height: 0.93 }, minimumCoverage: 0.92,
  });
  assert.equal(desktop.crop, undefined);
  assert.equal(desktop.rotation, undefined);
  assert.ok(desktop.width * 2880 * 1440 / 934 >= 1800 * 0.92);
});
