import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';

import { readabilityPolicy, readableDeviceLayer } from '../../readability.ts';
import { renderComposition } from '../composition.ts';
import type { CompositionOptions } from '../composition.ts';
import { DEFAULT_THEME } from '../../theme.ts';

const output = { width: 1600, height: 1000 };
const window = { width: 1392, height: 1112 };
const capture = sharp({ create: { ...window, channels: 4, background: '#f4efe6' } }).png().toBuffer();
const base: CompositionOptions = {
  output, screens: ['one'], captions: { one: { title: 'Readable' } }, locale: 'en',
  theme: 'light', canvas: DEFAULT_THEME, captionScale: 0.05, formFactor: 'desktop',
  composition: { preset: 'blank', readability: true },
  resolveDevice: async () => ({ image: await capture }),
};

async function inkHeight(image: Buffer) {
  const { data, info } = await sharp(image).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let top = info.height, bottom = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * 3]! < 128) { top = Math.min(top, y); bottom = y; break; }
    }
  }
  return bottom - top + 1;
}

test('desktop previews allow smaller native UI but hold captions to a large floor', () => {
  assert.deepEqual(readabilityPolicy(true), { previewWidth: 390, minTextSize: 14, minCaptionSize: 14 });
  assert.deepEqual(readabilityPolicy(true, 'tablet'), { previewWidth: 390, minTextSize: 14, minCaptionSize: 14 });
  assert.deepEqual(readabilityPolicy(true, 'desktop'), { previewWidth: 800, minTextSize: 9, minCaptionSize: 20 });
  // An explicit UI minimum keeps its old meaning for captions too.
  assert.equal(readabilityPolicy({ minTextSize: 12 }, 'desktop')!.minCaptionSize, 12);
  assert.equal(readabilityPolicy({ minCaptionSize: 28 }, 'desktop')!.minCaptionSize, 28);
  assert.throws(() => readabilityPolicy({ minCaptionSize: 6 }, 'desktop'), /minCaptionSize/);
});

test('small desktop captions grow to the caption floor rather than render as fine print', async () => {
  const fine = {
    id: 'fine', kind: 'text' as const, text: 'Fine print', x: 0.1, y: 0.1, width: 0.6, height: 0.03,
    fontSize: 0.01, maxLines: 1, color: '#000000', anchor: { x: 0, y: 0 },
  };
  // 20px at an 800px preview is 40px on this canvas, which a 30px box cannot hold.
  await assert.rejects(renderComposition({ ...base, composition: { ...base.composition, layers: [fine] } }), /does not fit/);
  await renderComposition({ ...base, composition: { preset: 'blank', layers: [fine] } });
});

test('desktop UI is measured against the Mac App Store preview', async () => {
  const layer = (width: number) => ({
    id: 'window', kind: 'device' as const, screen: 'one', frame: { kind: 'none' as const },
    x: 0.5, y: 0.5, width, sourceTextSize: 18,
  });
  // 18px source text at 870px wide is 9px when the canvas is shown 800px wide.
  await renderComposition({ ...base, composition: { ...base.composition, layers: [layer(1392 / 1600)] } });
  await assert.rejects(renderComposition({ ...base, composition: { ...base.composition, layers: [layer(0.7)] } }),
    /800px store preview/);
  assert.throws(() => readableDeviceLayer({
    id: 'ui', screen: 'one', source: window, output, sourceTextSize: 18, formFactor: 'desktop',
    crop: { x: 0, y: 0, width: 1, height: 1 }, area: { x: 0, y: 0, width: 0.6, height: 1 },
  }), /800px store preview/);
});

test('titles set their own line height, independent of the font', async () => {
  const title = (lineHeight: number) => ({
    id: 'title', kind: 'text' as const, text: 'Line one\nLine two', x: 0, y: 0, width: 1, height: 1,
    fontSize: 0.08, minFontSize: 0.08, maxLines: 2, color: '#000000', anchor: { x: 0, y: 0 }, lineHeight,
  });
  const render = async (lineHeight: number) => inkHeight((await renderComposition({ ...base,
    composition: { preset: 'blank', background: { fill: '#ffffff' }, layers: [title(lineHeight)] } })).image);
  const tight = await render(0.95);
  const loose = await render(1.5);
  // The second baseline moves by exactly the change in leading: 0.55 × 128px.
  assert.ok(Math.abs(loose - tight - 0.55 * 128) <= 2, `${tight} → ${loose}`);
  await assert.rejects(renderComposition({ ...base, composition: { preset: 'blank', layers: [title(0.2)] } }), /lineHeight/);
});

test('backgrounds stack a glow over a flat tone', async () => {
  const { image } = await renderComposition({ ...base, composition: { preset: 'blank',
    background: { fill: 'radial-gradient(circle closest-side at 50% 50%, #ff0000, #ff000000), #0000ff' } } });
  const pixel = async (left: number, top: number) =>
    [...(await sharp(image).extract({ left, top, width: 1, height: 1 }).removeAlpha().raw().toBuffer())];
  assert.deepEqual(await pixel(800, 500), [255, 0, 0]);
  assert.deepEqual(await pixel(2, 2), [0, 0, 255]);
});
