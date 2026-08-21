import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import sharp from 'sharp';

import { buildScreenMask, renderFramedDevice } from '../frames.ts';
import type { Size } from '../types.ts';

/**
 * Synthetic edge-to-edge frame, 32x32. The device spans (4,4)-(27,27) with a
 * 1px opaque bezel, a 1px partial-alpha ring just inside it (the antialiased
 * inner edge), and a transparent screen. The four outer corner pixels are cut
 * away and touch the exterior, like a rounded device silhouette.
 */
const SIZE: Size = { width: 32, height: 32 };
const DEVICE = { min: 4, max: 27 };
const SCREEN: Size = { width: 24, height: 24 };
const OFFSET = { x: DEVICE.min, y: DEVICE.min };
const EDGE_ALPHA = 96;

function frameAlphaAt(x: number, y: number): number {
  const { min, max } = DEVICE;

  if (x < min || y < min || x > max || y > max) {
    return 0;
  }

  const corner = (x === min || x === max) && (y === min || y === max);

  if (corner) {
    return 0;
  }

  if (x === min || y === min || x === max || y === max) {
    return 255;
  }

  if (x === min + 1 || y === min + 1 || x === max - 1 || y === max - 1) {
    return EDGE_ALPHA;
  }

  return 0;
}

function buildFramePixels(): Buffer {
  const pixels = Buffer.alloc(SIZE.width * SIZE.height * 4);

  for (let y = 0; y < SIZE.height; y += 1) {
    for (let x = 0; x < SIZE.width; x += 1) {
      pixels[(y * SIZE.width + x) * 4 + 3] = frameAlphaAt(x, y);
    }
  }

  return pixels;
}

async function renderOnSyntheticFrame() {
  const dir = await mkdtemp(join(tmpdir(), 'ai-appshots-frames-'));

  after(() => rm(dir, { recursive: true, force: true }));

  const framePixels = buildFramePixels();
  const framePath = join(dir, 'frame.png');

  await sharp(framePixels, {
    raw: { width: SIZE.width, height: SIZE.height, channels: 4 },
  })
    .png()
    .toFile(framePath);

  const capture = await sharp({
    create: {
      width: SCREEN.width,
      height: SCREEN.height,
      channels: 4,
      background: { r: 255, g: 0, b: 0, alpha: 1 },
    },
  })
    .png()
    .toBuffer();

  const framed = await renderFramedDevice(capture, {
    path: framePath,
    size: SIZE,
    screenOffset: OFFSET,
    screenSize: SCREEN,
    screenMask: buildScreenMask(framePixels, SIZE, OFFSET, SCREEN),
  });

  return sharp(framed).ensureAlpha().raw().toBuffer();
}

function alphaAt(pixels: Buffer, x: number, y: number): number {
  return pixels[(y * SIZE.width + x) * 4 + 3]!;
}

test('screen and bezel sum to full coverage at antialiased edges', async () => {
  const framed = await renderOnSyntheticFrame();

  // The frame is only partially opaque along its inner edge. The mask must
  // keep the screen solid underneath, so bezel-over-screen composites to full
  // coverage. Feathering the mask by the frame's alpha leaves these pixels at
  // 1 - f + f^2 < 1 coverage, a light hairline once a canvas shows through.
  for (let x = DEVICE.min + 1; x <= DEVICE.max - 1; x += 1) {
    assert.equal(alphaAt(framed, x, DEVICE.min + 1), 255);
    assert.equal(alphaAt(framed, x, DEVICE.max - 1), 255);
    assert.equal(alphaAt(framed, DEVICE.min + 1, x), 255);
    assert.equal(alphaAt(framed, DEVICE.max - 1, x), 255);
  }

  // Interior of the screen is plain full-coverage capture.
  assert.equal(alphaAt(framed, 16, 16), 255);
});

test('capture does not bleed past the device silhouette', async () => {
  const framed = await renderOnSyntheticFrame();

  // The capture covers the corner pixels, but they are cut out of the device
  // and flood-filled as exterior, so nothing may poke out there.
  assert.equal(alphaAt(framed, DEVICE.min, DEVICE.min), 0);
  assert.equal(alphaAt(framed, DEVICE.max, DEVICE.min), 0);
  assert.equal(alphaAt(framed, DEVICE.min, DEVICE.max), 0);
  assert.equal(alphaAt(framed, DEVICE.max, DEVICE.max), 0);

  // And the exterior proper stays empty.
  assert.equal(alphaAt(framed, 0, 0), 0);
  assert.equal(alphaAt(framed, 2, 16), 0);
});
