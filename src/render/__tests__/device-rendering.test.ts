import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';

import { renderStatusBar } from '../status-bar.ts';
import { renderWindowFrame } from '../window.ts';
import { renderComposition } from '../composition.ts';
import { createDeviceTarget } from '../../devices.ts';
import { DEFAULT_THEME } from '../../theme.ts';
import type { FormFactor, Size } from '../../types.ts';
import type { LayoutPreset } from '../../composition-types.ts';

const solid = (size: Size, background: string) => sharp({ create: { ...size, channels: 3, background } }).png().toBuffer();

test('status-bar placement distinguishes Pixel camera clearance, Galaxy and iPad', async () => {
  const leading = async (id: string) => {
    const target = createDeviceTarget(id);
    const image = await renderStatusBar({
      size: { width: 1000, height: 70 }, platform: target.platform, layout: target.statusBar,
      glyph: 30, font: 'sans-serif', style: { background: { r: 255, g: 255, b: 255 }, foreground: '#000000' },
    });
    const pixels = await sharp(image).removeAlpha().raw().toBuffer();
    for (let x = 0; x < 500; x += 1) {
      for (let y = 0; y < 70; y += 1) if (pixels[(y * 1000 + x) * 3]! < 100) return x;
    }
    throw new Error('Missing clock');
  };
  const pixel = await leading('pixel-5'), galaxy = await leading('galaxy-s21'), ipad = await leading('ipad-pro-11');
  assert.ok(pixel > galaxy + 90, 'The Pixel clock must clear its left camera');
  assert.ok(ipad < galaxy, 'iPad uses tablet edge spacing');
});

test('status-bar caches include foreground and reject glyphs that cannot fit', async () => {
  const options = { size: { width: 480, height: 36 }, platform: 'android' as const,
    glyph: 16, font: 'sans-serif', style: { background: { r: 255, g: 255, b: 255 }, foreground: '#ff0000' } };
  const red = await renderStatusBar(options);
  const blue = await renderStatusBar({ ...options, style: { ...options.style, foreground: '#0000ff' } });
  assert.notDeepEqual(red, blue);
  await assert.rejects(renderStatusBar({ ...options, glyph: 80 }), /fit within/);
});

test('Mac window chrome adds space above the app and clips only the outside corners', async () => {
  const capture = await solid({ width: 600, height: 375 }, '#2463eb');
  const image = await renderWindowFrame(capture, { kind: 'window', title: 'Workspace', appearance: 'light', titleBarRatio: 0.05 }, 'sans-serif');
  const metadata = await sharp(image).metadata();
  assert.equal(metadata.width, 600);
  assert.equal(metadata.height, 405);
  const sample = async (left: number, top: number) => [...await sharp(image).extract({ left, top, width: 1, height: 1 }).ensureAlpha().raw().toBuffer()];
  assert.deepEqual(await sample(300, 35), [36, 99, 235, 255], 'The first app rows remain visible below chrome');
  assert.equal((await sample(0, 0))[3], 0);
  assert.notDeepEqual(image, await renderWindowFrame(capture, { kind: 'window', appearance: 'dark' }, 'sans-serif'));
  await assert.rejects(renderWindowFrame(capture, { kind: 'window', titleBarRatio: -1 }, 'sans-serif'), /titleBarRatio/);
});

test('all presets fit multi-paragraph captions across phones, tablets, desktops and landscape', async () => {
  const formats: { formFactor: FormFactor; output: Size; source: Size; captionScale: number }[] = [
    { formFactor: 'phone', output: { width: 240, height: 520 }, source: { width: 90, height: 180 }, captionScale: 0.078 },
    { formFactor: 'tablet', output: { width: 480, height: 640 }, source: { width: 150, height: 200 }, captionScale: 0.06 },
    { formFactor: 'desktop', output: { width: 640, height: 400 }, source: { width: 320, height: 184 }, captionScale: 0.045 },
    { formFactor: 'phone', output: { width: 520, height: 240 }, source: { width: 180, height: 90 }, captionScale: 0.078 },
    { formFactor: 'tablet', output: { width: 640, height: 480 }, source: { width: 200, height: 150 }, captionScale: 0.06 },
  ];
  for (const format of formats) {
    const source = await solid(format.source, '#ff0000');
    for (const preset of ['classic', 'side-aligned', 'feature-closeup', 'tilted-panorama'] as LayoutPreset[]) {
      const result = await renderComposition({
        ...format, deviceSize: format.source, screens: ['one', 'two', 'three'],
        canvas: { ...DEFAULT_THEME, light: { ...DEFAULT_THEME.light, title: '#0000ff' } },
        captions: Object.fromEntries(['one', 'two', 'three'].map((id) => [id, { title: 'Make room\nfor what matters.', kicker: 'A little more focus' }])),
        theme: 'light', locale: 'en', composition: { preset }, resolveDevice: async () => ({ image: source }),
      });
      assert.equal(result.panels.length, 3);
      assert.ok(!result.notices.some((notice) => /title|kicker/.test(notice.layer)), `${format.formFactor}/${preset} put text across an edge`);
      if (preset === 'classic') {
        const { width, height } = format.output;
        const pixels = await sharp(result.panels[0]).removeAlpha().raw().toBuffer();
        const deviceRows: number[] = [];
        const titleRows: number[] = [];
        for (let y = 0; y < height; y += 1) {
          const at = (y * width + Math.floor(width / 2)) * 3;
          if (pixels[at]! > 240 && pixels[at + 1]! < 15 && pixels[at + 2]! < 15) deviceRows.push(y);
          for (let x = 0; x < width; x += 1) {
            const p = (y * width + x) * 3;
            if (pixels[p]! < 15 && pixels[p + 1]! < 15 && pixels[p + 2]! > 240) titleRows.push(y);
          }
        }
        assert.ok(titleRows.length > 0 && deviceRows.length > 0, 'Caption and device must both be visible');
        assert.ok(deviceRows[0]! > titleRows.at(-1)! + height * 0.02, 'Device overlaps the rendered caption');
        assert.ok(deviceRows.at(-1)! < height * 0.96, 'Device loses its bottom bezel');
      }
    }
  }
});
