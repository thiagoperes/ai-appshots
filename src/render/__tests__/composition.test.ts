import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import sharp from 'sharp';

import { renderComposition } from '../composition.ts';
import type { CompositionOptions } from '../composition.ts';
import { compositionLayers } from '../presets.ts';
import { renderGallery } from '../gallery.ts';
import { DEFAULT_THEME } from '../../theme.ts';
import type { LayoutPreset } from '../../composition-types.ts';

const source = sharp({ create: { width: 90, height: 180, channels: 4, background: '#2463eb' } }).png().toBuffer();
const base: CompositionOptions = {
  output: { width: 240, height: 480 }, screens: ['one', 'two'],
  captions: { one: { title: 'Own your day', kicker: 'Focus' }, two: { title: 'Make room for more' } },
  locale: 'en', canvas: DEFAULT_THEME, theme: 'dark', captionScale: 0.075,
  composition: { preset: 'blank' }, resolveDevice: async () => ({ image: await source }),
};
const pixels = (buffer: Buffer) => sharp(buffer).ensureAlpha().raw().toBuffer();

test('rotated layers crossing a seam reconstruct the original canvas exactly', async () => {
  const result = await renderComposition({ ...base, composition: { preset: 'blank',
    background: { fill: 'linear-gradient(90deg, #ff8080, #0080ff)' },
    layers: [{ id: 'phone', kind: 'device', screen: 'one', x: 1, y: 0.55, width: 1.3, rotation: -18, shadow: {} }],
  } });
  assert.equal(result.panels.length, 2);
  const joined = await sharp({ create: { width: 480, height: 480, channels: 4, background: '#0000' } })
    .composite(result.panels.map((input, i) => ({ input, left: i * 240, top: 0 }))).png().toBuffer();
  assert.deepEqual(await pixels(joined), await pixels(result.image));
});

test('all presets render bounded text and missing optional kickers', async () => {
  for (const preset of ['classic', 'tilted-panorama', 'feature-closeup', 'side-aligned'] as LayoutPreset[]) {
    const result = await renderComposition({ ...base, composition: { preset } });
    assert.equal(result.panels.length, 2, preset);
    assert.equal((await sharp(result.image).metadata()).width, 480);
    assert.ok(!result.notices.some((notice) => notice.layer.startsWith('title-')), preset);
  }
});

test('overrides retain layer IDs, hide presets, and do not mutate their inputs', () => {
  const spec = { preset: 'classic' as const, overrides: { 'device-1': { x: 0.25, rotation: 9 }, 'kicker-1': { hidden: true } } };
  const before = JSON.stringify(spec);
  const layers = compositionLayers(spec, base);
  assert.equal(layers.find((layer) => layer.id === 'device-1')?.x, 0.25);
  assert.equal(layers.find((layer) => layer.id === 'kicker-1')?.hidden, true);
  assert.equal(JSON.stringify(spec), before);
  assert.throws(() => compositionLayers({ overrides: { typo: { x: 0 } } }, base), /does not match/);
});

test('z-order, opacity and clipping work for partially visible shapes', async () => {
  const result = await renderComposition({ ...base, screens: ['one'], composition: {
    preset: 'blank', background: { fill: '#000' }, layers: [
      { id: 'front', kind: 'shape', fill: '#f00', x: 0.5, y: 0.5, width: 1, height: 1, opacity: 0.5, zIndex: 2 },
      { id: 'back', kind: 'shape', fill: '#00f', x: 0, y: 0.5, width: 2, height: 2 },
    ],
  } });
  const p = await sharp(result.image).extract({ left: 120, top: 240, width: 1, height: 1 }).raw().toBuffer();
  assert.ok(p[0]! >= 127 && p[0]! <= 128);
  assert.ok(p[2]! >= 126 && p[2]! <= 128);
});

test('invalid crop, duplicate layers, and overflowing text fail clearly', async () => {
  await assert.rejects(renderComposition({ ...base, composition: { preset: 'blank', layers: [
    { id: 'bad-crop', kind: 'device', screen: 'one', x: 0.5, y: 0.5, width: 1, crop: { x: 0.9, y: 0, width: 0.5, height: 1 } },
  ] } }), /outside the source/);
  await assert.rejects(renderComposition({ ...base, composition: { preset: 'blank', layers: [
    { id: 'copy', kind: 'text', text: 'W'.repeat(100), x: 0.5, y: 0.2, width: 0.5, height: 0.1 },
  ] } }), /does not fit/);
  await assert.rejects(renderComposition({ ...base, composition: { preset: 'classic', layers: [
    { id: 'device-1', kind: 'shape', fill: '#000', x: 0, y: 0, width: 1, height: 1 },
  ] } }), /Duplicate/);
});

test('Apple artwork notices are independent of store file validation', async () => {
  const result = await renderComposition({ ...base,
    resolveDevice: async () => ({ image: await source, appleArtwork: true }),
    composition: { preset: 'blank', layers: [
      { id: 'artwork', kind: 'device', screen: 'one', x: 1, y: 0.5, width: 1, rotation: 10 },
    ] },
  });
  assert.ok(result.notices.some((notice) => notice.message.includes('Apple product artwork')));
  assert.equal(result.panels.length, 2);
});

test('localized custom text fails when its locale is missing', async () => {
  await assert.rejects(renderComposition({ ...base, locale: 'de', composition: {
    preset: 'blank', layers: [{ id: 'label', kind: 'text', text: { locales: { en: 'Hello' } }, x: 0, y: 0, width: 1, height: 0.2 }],
  } }), /no text for locale/);
});

test('gallery inserts display gaps without modifying exported panels', async () => {
  const before = await source;
  const gallery = await renderGallery([before, before], { width: 100, gap: 10 });
  const metadata = await sharp(gallery).metadata();
  assert.equal(metadata.width, 230);
  assert.equal(metadata.height, 220);
});

test('shadow opacity is applied to its alpha, not to the source colour', async () => {
  const result = await renderComposition({ ...base, output: { width: 100, height: 100 }, screens: ['one'],
    composition: { preset: 'blank', background: { fill: '#fff' }, layers: [
      { id: 'card', kind: 'shape', fill: '#fff', x: 0.5, y: 0.3, width: 0.4, height: 0.2,
        shadow: { y: 0.3, blur: 0, opacity: 0.2 } },
    ] },
  });
  const p = await sharp(result.image).extract({ left: 50, top: 60, width: 1, height: 1 }).raw().toBuffer();
  assert.ok(p[0]! >= 202 && p[0]! <= 205, `Expected a 20% shadow on white, got ${p[0]}`);
});

test('rotation keeps a custom anchor fixed', async () => {
  const result = await renderComposition({ ...base, output: { width: 100, height: 100 }, screens: ['one'],
    composition: { preset: 'blank', background: { fill: '#fff' }, layers: [
      { id: 'anchored', kind: 'shape', fill: '#f00', x: 0.5, y: 0.5, width: 0.2, height: 0.1,
        anchor: { x: 0, y: 0 }, rotation: 90 },
    ] },
  });
  const sample = async (left: number, top: number) => [...await sharp(result.image)
    .extract({ left, top, width: 1, height: 1 }).removeAlpha().raw().toBuffer()];
  assert.deepEqual(await sample(45, 60), [255, 0, 0]);
  assert.deepEqual(await sample(55, 60), [255, 255, 255]);
  assert.deepEqual(await sample(45, 45), [255, 255, 255]);
});

test('local image assets support relative paths, source crops and opacity', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'appshots-image-'));
  try {
    const blue = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#00f' } }).png().toBuffer();
    await writeFile(resolve(root, 'asset.png'), await sharp({ create: { width: 20, height: 10, channels: 3, background: '#f00' } })
      .composite([{ input: blue, left: 10, top: 0 }]).png().toBuffer());
    const result = await renderComposition({ ...base, assetRoot: root, output: { width: 100, height: 100 }, screens: ['one'],
      composition: { preset: 'blank', background: { fill: '#fff' }, layers: [
        { id: 'asset', kind: 'image', path: 'asset.png', x: 0.5, y: 0.5, width: 0.4, height: 0.4,
          crop: { x: 0.5, y: 0, width: 0.5, height: 1 }, opacity: 0.5, radius: 0.04 },
      ] },
    });
    const p = await sharp(result.image).extract({ left: 50, top: 50, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
    assert.ok(p[0]! >= 126 && p[0]! <= 128);
    assert.equal(p[2], 255);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
