import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';

import { DEFAULT_THEME } from '../../theme.ts';
import { createDeviceTarget } from '../../devices.ts';
import type { LayoutPreset } from '../../composition-types.ts';
import { renderComposition } from '../composition.ts';
import { renderCanvas } from '../canvas.ts';

const canvas = { ...DEFAULT_THEME, light: {
  ...DEFAULT_THEME.light, sweep: 'linear-gradient(0deg, #ffffff 0%, #ffffff 100%)', title: '#ff0000', kicker: '#0000ff',
} };
const device = sharp({ create: { width: 90, height: 180, channels: 3, background: '#00ff00' } }).png().toBuffer();
const base = {
  output: { width: 300, height: 652 }, screens: ['one'],
  captions: { one: { title: 'Make room\nfor what matters.', kicker: 'A little more focus' } },
  canvas, theme: 'light' as const, locale: 'en', captionScale: 0.078,
  deviceSize: { width: 90, height: 180 }, resolveDevice: async () => ({ image: await device }),
};

// Inspect painted glyphs, rather than the transparent boxes that hid this bug.
async function bounds(image: Buffer, channel: number) {
  const { data, info } = await sharp(image).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let left = info.width, top = info.height, right = -1, bottom = -1;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const at = (y * info.width + x) * info.channels;
      if (data[at + channel]! > 220 && data[at + (channel + 1) % 3]! < 80 && data[at + (channel + 2) % 3]! < 80) {
        left = Math.min(left, x); top = Math.min(top, y);
        right = Math.max(right, x); bottom = Math.max(bottom, y);
      }
    }
  }
  assert.ok(right >= left, 'Expected visible ink');
  return { left, top, right, bottom };
}

test('rendered label-to-title gaps stay compact across Pixel and iPhone proportions, fonts and presets', async () => {
  for (const preset of ['classic', 'side-aligned', 'tilted-panorama', 'feature-closeup'] as LayoutPreset[]) {
    for (const font of ['sans-serif', 'serif']) {
      let previousTop: number | undefined;
      for (const height of [533, 652]) {
        const result = await renderComposition({ ...base, output: { width: 300, height },
          canvas: { ...canvas, titleFont: font, kickerFont: font, titleWidthRatio: 0.78 },
          screens: ['one', 'two'], captions: { ...base.captions,
            two: { title: base.captions.one.title, kicker: 'A little\nmore focus' },
          }, composition: { preset },
        });
        const titles = [];
        for (const panel of result.panels) {
          const title = await bounds(panel, 0), kicker = await bounds(panel, 2);
          const gap = title.top - kicker.bottom - 1;
          assert.ok(gap >= 6 && gap <= 11, `${preset}/${font}/${height}: ${gap}px gap at 300px gallery width`);
          if (preset === 'side-aligned' || preset === 'tilted-panorama') {
            assert.ok(Math.abs(title.left - kicker.left) <= 1, 'Caption rows must share a left edge');
          }
          titles.push(title);
        }
        assert.equal(titles[0]!.top, titles[1]!.top, 'A wrapped kicker must not shift the headline');
        if (preset !== 'side-aligned' && previousTop !== undefined) {
          assert.equal(titles[0]!.top, previousTop, 'Extra canvas height must not stretch the header');
        }
        previousTop = titles[0]!.top;
      }
    }
  }
});

test('the visible title-to-device gap follows the content across devices, copy lengths and width limits', async () => {
  for (const [id, height] of [['pixel-5', 533], ['iphone-17-pro-max', 652]] as const) {
    const target = createDeviceTarget(id, { output: { width: 300, height } });
    for (const caption of [base.captions.one, { title: 'Focus' },
      { title: 'Make room\nfor everything that matters.', kicker: 'More time for you' }]) {
      for (const deviceWidthRatio of [0.88, 0.4]) {
        const result = await renderComposition({ ...base, output: target.output,
          captionGapRatio: target.captionGapRatio, captions: { one: caption },
          canvas: { ...canvas, deviceWidthRatio }, composition: { preset: 'classic' },
        });
        const title = await bounds(result.image, 0), device = await bounds(result.image, 1);
        const gap = device.top - title.bottom - 1;
        assert.ok(gap >= 23 && gap <= 26, `${id}/${caption.title}: ${gap}px gap after the visible headline`);
        const first = 'kicker' in caption ? await bounds(result.image, 2) : title;
        assert.ok(Math.abs(first.top - 30) <= 2, 'Top padding starts at the first visible caption row');
      }
    }
  }
});

test('short, wrapped and missing captions retain a common device grid', async () => {
  const result = await renderComposition({ ...base, screens: ['one', 'two', 'three'],
    captions: { ...base.captions, two: { title: 'Focus' }, three: { title: 'Make space for what matters', kicker: 'Your time' } },
    composition: { preset: 'classic' },
  });
  const devices = await Promise.all(result.panels.map((panel) => bounds(panel, 1)));
  assert.deepEqual(devices[0], devices[1]);
  assert.deepEqual(devices[1], devices[2]);
});

test('caption spacing is customizable in both renderers and explicit layer placement wins', async () => {
  for (const kickerGapEm of [0.45, 0.9]) {
    const customized = { ...canvas, captionTopRatio: 0.08, kickerGapEm };
    const composition = await renderComposition({ ...base, canvas: customized, composition: { preset: 'classic' } });
    const legacy = await renderCanvas({ ...base, canvas: customized, caption: base.captions.one,
      captionGapRatio: 0.04, allowBleed: false, allowShadow: false, device: await device, index: 1,
    });
    for (const image of [composition.image, legacy]) {
      const title = await bounds(image, 0), kicker = await bounds(image, 2);
      const gap = title.top - kicker.bottom - 1;
      assert.ok(Math.abs(gap - Math.round(kickerGapEm * 23)) <= 2, `Configured gap was lost: ${gap}px`);
    }
  }
  const result = await renderComposition({ ...base, composition: { preset: 'classic', overrides: {
    'title-1': { x: 0.1, y: 0.5, align: 'left' }, 'kicker-1': { hidden: true }, 'device-1': { hidden: true },
  } } });
  const title = await bounds(result.image, 0);
  assert.ok(Math.abs(title.left - 30) <= 1, 'Explicit x must place the visible title within one antialiased edge pixel');
  assert.ok(Math.abs(title.top - 326) <= 1, 'Explicit y must place the visible title within one antialiased edge pixel');
  const noCaption = await renderComposition({ ...base, composition: { preset: 'classic', overrides: {
    'title-1': { hidden: true }, 'kicker-1': { hidden: true },
  } } });
  assert.equal((await bounds(noCaption.image, 1)).top, 30, 'Hidden captions must not leave an empty caption gap');
  await assert.rejects(renderComposition({ ...base, canvas: { ...canvas, kickerGapEm: -1 }, composition: { preset: 'classic' } }), /kickerGapEm/);
  await assert.rejects(renderCanvas({ ...base, canvas: { ...canvas, captionTopRatio: NaN }, caption: base.captions.one,
    captionGapRatio: 0.04, allowBleed: false, allowShadow: false, device: await device, index: 1,
  }), /captionTopRatio/);
});
