import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import sharp from 'sharp';

import { buildScreenMask, loadFrameitFrame, loadImageFrame, renderFramedDevice } from '../frames.ts';
import type { FrameitFrame, Size, TargetSpec } from '../types.ts';

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

async function frameFixture(colour = '#151922') {
  const dir = await mkdtemp(join(tmpdir(), 'appshots-geometry-'));
  after(() => rm(dir, { recursive: true, force: true }));
  // An asymmetric bezel makes incorrect rotation offsets observable.
  const path = join(dir, 'hardware.png');
  await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="90" height="150">
    <path fill="${colour}" fill-rule="evenodd" d="M5 5H85V145H5Z M14 18H74V138H14Z"/></svg>`)).png().toFile(path);
  await writeFile(join(dir, 'offsets.json'), JSON.stringify({ portrait: { Test: { offset: '+14+18', width: 60 } } }));
  const frame: FrameitFrame = { kind: 'frameit', file: 'hardware.png', offsetKey: 'Test' };
  const target: TargetSpec = {
    id: 'reused-id', store: 'play-store', platform: 'android', frame,
    viewport: { width: 60, height: 120 }, deviceScaleFactor: 1, output: { width: 240, height: 480 },
    captionScale: 0.07, captionGapRatio: 0.04, statusBarHeight: 0, statusBarTextSize: 0, deliveryKind: 'phone',
  };
  return { dir, path, frame, target };
}

test('frame height is inferred from the PNG, never from a mismatched capture', async () => {
  const { dir, frame, target } = await frameFixture();
  const asset = await loadFrameitFrame(target, frame, dir);
  assert.deepEqual(asset.screenSize, { width: 60, height: 120 });
  // Same ID and width, but the wrong height: the old cache hid this mismatch.
  await assert.rejects(loadFrameitFrame({ ...target, viewport: { width: 60, height: 110 } }, frame, dir), /cannot be stretched/);
  await assert.rejects(loadFrameitFrame(target, { ...frame, screenSize: { width: 60, height: 119 - 5 } }, dir), /not the declared/);
  const smaller = await loadFrameitFrame({ ...target, viewport: { width: 30, height: 60 } }, frame, dir);
  assert.deepEqual(smaller.screenSize, asset.screenSize);
});

test('frame caches distinguish directories and offset keys and recover after failed loads', async () => {
  const first = await frameFixture('#ff0000');
  const second = await frameFixture('#0000ff');
  const a = await loadFrameitFrame(first.target, first.frame, first.dir);
  const b = await loadFrameitFrame(first.target, first.frame, second.dir);
  assert.notEqual(a.path, b.path);
  await assert.rejects(loadFrameitFrame(first.target, { ...first.frame, offsetKey: 'Missing' }, first.dir), /No offsets entry/);
  const broken = { ...first.frame, screenSize: { width: 60, height: 118 } };
  await assert.rejects(loadFrameitFrame(first.target, broken, first.dir), /not the declared/);
  await writeFile(join(first.dir, 'offsets.json'), JSON.stringify({ portrait: {
    Test: { offset: '+14+18', width: 60 }, Missing: { offset: '+14+18', width: 60 },
  } }));
  assert.ok(await loadFrameitFrame(first.target, { ...first.frame, offsetKey: 'Missing' }, first.dir));
});

test('hardware rotations transform offsets and masks while leaving app content upright', async () => {
  const { dir, frame, target } = await frameFixture();
  for (const [rotation, offset] of [[90, { x: 12, y: 14 }], [180, { x: 16, y: 12 }], [270, { x: 18, y: 16 }]] as const) {
    const viewport = rotation === 180 ? target.viewport : { width: 120, height: 60 };
    const asset = await loadFrameitFrame({ ...target, viewport }, { ...frame, rotation }, dir);
    assert.deepEqual(asset.screenOffset, offset);
    assert.deepEqual(asset.screenSize, viewport);
    const leftHalf = await sharp({ create: { width: viewport.width / 2, height: viewport.height, channels: 3, background: '#f00' } }).png().toBuffer();
    const capture = await sharp({ create: { ...viewport, channels: 3, background: '#00f' } })
      .composite([{ input: leftHalf, left: 0, top: 0 }]).png().toBuffer();
    const rendered = await renderFramedDevice(capture, asset);
    const sample = (x: number) => sharp(rendered).extract({ left: offset.x + x, top: offset.y + 20, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
    assert.deepEqual([...await sample(10)], [255, 0, 0]);
    assert.deepEqual([...await sample(viewport.width - 10)], [0, 0, 255]);
  }
});

test('local PNG frames resolve from the asset root and reject invalid cutouts', async () => {
  const { dir, target } = await frameFixture();
  const frame = { kind: 'image' as const, path: 'hardware.png', screen: { x: 14, y: 18, width: 60, height: 120 } };
  const asset = await loadImageFrame(target, frame, dir);
  assert.deepEqual(asset.screenSize, { width: 60, height: 120 });
  await assert.rejects(loadImageFrame(target, { ...frame, screen: { ...frame.screen, x: 40 } }, dir), /does not fit/);
  await assert.rejects(loadImageFrame(target, { ...frame, screen: { x: 5, y: 5, width: 4, height: 8 } }, dir), /opaque/);
  const wrongShape = await sharp({ create: { width: 60, height: 100, channels: 3, background: '#fff' } }).png().toBuffer();
  await assert.rejects(renderFramedDevice(wrongShape, asset), /cannot be stretched/);
});
