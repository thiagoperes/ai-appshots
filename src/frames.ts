import { access, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

import sharp from 'sharp';

// Extensions so the file also loads under `node --test`'s type stripping,
// which does not resolve extensionless specifiers. jiti accepts both.
import { ensureDir } from './paths.ts';
import { info } from './log.ts';
import type { FrameAsset, FrameitFrame, ImageFrame, Size, TargetSpec } from './types.ts';

const FRAMES_BASE_URL =
  'https://raw.githubusercontent.com/fastlane/frameit-frames/gh-pages/latest';

interface OffsetEntry {
  readonly offset: string;
  readonly width: number;
}

interface OffsetsFile {
  readonly portrait: Readonly<Record<string, OffsetEntry>>;
}

/** Pixel size of the device's full screen, status bar included. */
export function captureSize(target: TargetSpec): Size {
  return {
    width: Math.round(target.viewport.width * target.deviceScaleFactor),
    height: Math.round(target.viewport.height * target.deviceScaleFactor),
  };
}

/**
 * Viewport the page is actually captured at. It is shorter than the screen by
 * the status bar, which is rendered separately and stacked back on top.
 */
export function pageViewport(target: TargetSpec): Size {
  return {
    width: target.viewport.width,
    height: target.viewport.height - target.statusBarHeight,
  };
}

/** Pixel size of the status bar strip for a target. */
export function statusBarSize(target: TargetSpec): Size {
  return {
    width: Math.round(target.viewport.width * target.deviceScaleFactor),
    height: Math.round(target.statusBarHeight * target.deviceScaleFactor),
  };
}

async function exists(path: string) {
  try {
    await access(path);

    return true;
  } catch {
    return false;
  }
}

const downloads = new Map<string, Promise<string>>();

function download(fileName: string, cacheDir: string): Promise<string> {
  const key = resolve(cacheDir, fileName);
  const cached = downloads.get(key);
  if (cached) return cached;
  const pending = downloadFile(fileName, cacheDir).finally(() => downloads.delete(key));
  downloads.set(key, pending);
  return pending;
}

async function downloadFile(fileName: string, cacheDir: string) {
  await ensureDir(cacheDir);

  const cachePath = `${cacheDir}/${fileName}`;

  if (await exists(cachePath)) {
    return cachePath;
  }

  const url = `${FRAMES_BASE_URL}/${encodeURIComponent(fileName)}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Could not download frame "${fileName}" (HTTP ${response.status}). ` +
        `Check the filename against ${FRAMES_BASE_URL}/files.json.`,
    );
  }

  info(`downloaded frame ${fileName}`);
  const temporary = `${cachePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, Buffer.from(await response.arrayBuffer()));
    await rename(temporary, cachePath);
  } finally {
    await rm(temporary, { force: true });
  }

  return cachePath;
}

async function loadOffsets(cacheDir: string): Promise<OffsetsFile> {
  const cachePath = await download('offsets.json', cacheDir);

  return JSON.parse(await readFile(cachePath, 'utf8')) as OffsetsFile;
}

/** Alpha at or above this counts as solid bezel when tracing the silhouette. */
const OPAQUE_THRESHOLD = 128;

/**
 * Builds a mask of the screen cutout by flood-filling transparency inward from
 * the image border.
 *
 * A frame PNG is transparent in two unrelated places: around the outside of the
 * device, and in the screen cutout. Treating "transparent" as "screen" lets the
 * square corners of a capture bleed past the device's rounded screen, which is
 * visible as sharp corners poking out of the bezel. Everything reachable from
 * the border is outside the device; the transparency that survives is the
 * screen. Within the device the mask stays solid — the bezel's own alpha
 * handles the antialiasing where it overlaps the screen.
 *
 * Exported for tests.
 */
export function buildScreenMask(
  pixels: Buffer,
  size: Size,
  offset: { x: number; y: number },
  screen: Size,
): Buffer {
  const { width, height } = size;
  const outside = new Uint8Array(width * height);
  const stack: number[] = [];

  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) {
      return;
    }

    const index = y * width + x;

    if (outside[index] || pixels[index * 4 + 3]! >= OPAQUE_THRESHOLD) {
      return;
    }

    outside[index] = 1;
    stack.push(index);
  };

  for (let x = 0; x < width; x += 1) {
    push(x, 0);
    push(x, height - 1);
  }

  for (let y = 0; y < height; y += 1) {
    push(0, y);
    push(width - 1, y);
  }

  while (stack.length) {
    const index = stack.pop()!;
    const x = index % width;
    const y = (index - x) / width;

    push(x - 1, y);
    push(x + 1, y);
    push(x, y - 1);
    push(x, y + 1);
  }

  const mask = Buffer.alloc(screen.width * screen.height * 4);

  for (let y = 0; y < screen.height; y += 1) {
    for (let x = 0; x < screen.width; x += 1) {
      const source = (y + offset.y) * width + (x + offset.x);
      const target = (y * screen.width + x) * 4;
      // Solid inside the cutout: the screen extends under the bezel's
      // anti-aliased inner edge and the frame blends over it, so screen +
      // frame always sum to full coverage. Feathering the mask by the
      // frame's alpha instead leaves 1 - f + f^2 coverage at edge pixels,
      // which reads as a light hairline against a light canvas.
      const coverage = outside[source] ? 0 : 255;

      mask[target] = 255;
      mask[target + 1] = 255;
      mask[target + 2] = 255;
      mask[target + 3] = coverage;
    }
  }

  return mask;
}

function parseOffset(raw: string) {
  const match = /^\+(\d+)\+(\d+)$/.exec(raw);

  if (!match?.[1] || !match[2]) {
    throw new Error(`Unrecognised frame offset "${raw}", expected "+x+y".`);
  }

  return { x: Number(match[1]), y: Number(match[2]) };
}

const frameCache = new Map<string, Promise<FrameAsset>>();

function cachedFrame(key: string, load: () => Promise<FrameAsset>) {
  const cached = frameCache.get(key);
  if (cached) {
    frameCache.delete(key);
    frameCache.set(key, cached);
    return cached;
  }
  const pending = load().catch((error) => {
    if (frameCache.get(key) === pending) frameCache.delete(key);
    throw error;
  });
  // Native-resolution masks are large. Keep a bounded working set.
  if (frameCache.size >= 8) frameCache.delete(frameCache.keys().next().value!);
  frameCache.set(key, pending);
  return pending;
}

/** Resampling is allowed; changing the shape of the app is not. */
export function assertScreenAspect(actual: Size, expected: Size, label: string) {
  const drift = Math.abs((actual.width / actual.height) / (expected.width / expected.height) - 1);
  if (!Number.isFinite(drift) || actual.width <= 0 || actual.height <= 0 || drift > 0.005) {
    throw new Error(`${label} is ${actual.width}x${actual.height}, but the frame's screen is ` +
      `${expected.width}x${expected.height}. Select a matching device and orientation; the app cannot be stretched to fit.`);
  }
}

function validateCutout(size: Size, offset: { x: number; y: number }, screen: Size) {
  for (const [name, value] of Object.entries({ x: offset.x, y: offset.y, width: screen.width, height: screen.height })) {
    if (!Number.isInteger(value) || value < (name === 'x' || name === 'y' ? 0 : 1)) {
      throw new Error(`Frame screen ${name} must be a ${name === 'x' || name === 'y' ? 'nonnegative' : 'positive'} integer.`);
    }
  }
  if (offset.x + screen.width > size.width || offset.y + screen.height > size.height) {
    throw new Error(`Screen ${screen.width}x${screen.height} at +${offset.x}+${offset.y} does not fit frame ${size.width}x${size.height}.`);
  }
}

/** The upstream offsets file omits height. Trace the actual cutout, not the capture. */
function inferScreenHeight(pixels: Buffer, size: Size, offset: { x: number; y: number }, width: number) {
  const x = offset.x + Math.floor(width / 2);
  let y = offset.y + Math.round(width * 0.2); // Below notches and camera islands.
  if (x >= size.width || y >= size.height || pixels[(y * size.width + x) * 4 + 3]! >= OPAQUE_THRESHOLD) {
    throw new Error('The frame offsets do not identify a transparent screen cutout.');
  }
  while (y < size.height && pixels[(y * size.width + x) * 4 + 3]! < OPAQUE_THRESHOLD) y += 1;
  if (y === size.height) throw new Error('The frame screen cutout has no bottom bezel.');
  return y - offset.y;
}

async function prepareFrame(path: string, screenOffset: { x: number; y: number }, screenSize: Size,
  rotation: number, nativePixels?: { data: Buffer; info: Size }): Promise<FrameAsset> {
  if (![0, 90, 180, 270].includes(rotation)) throw new Error('Hardware rotation must be 0, 90, 180 or 270 degrees.');
  const native = nativePixels ?? await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const size = { width: native.info.width, height: native.info.height };
  validateCutout(size, screenOffset, screenSize);
  const centre = (screenOffset.y + Math.floor(screenSize.height / 2)) * size.width + screenOffset.x + Math.floor(screenSize.width / 2);
  if (native.data[centre * 4 + 3]! >= OPAQUE_THRESHOLD) {
    throw new Error('The frame screen must be transparent; the selected cutout is opaque.');
  }
  const mask = buildScreenMask(native.data, size, screenOffset, screenSize);
  if (!mask.some((value, index) => index % 4 === 3 && value > 0)) {
    throw new Error('The frame does not enclose a screen. Use a transparent PNG with a continuous bezel.');
  }
  if (!rotation) return { path, size, screenOffset, screenSize, screenMask: mask };
  const offset = rotation === 90
    ? { x: size.height - screenOffset.y - screenSize.height, y: screenOffset.x }
    : rotation === 180
      ? { x: size.width - screenOffset.x - screenSize.width, y: size.height - screenOffset.y - screenSize.height }
      : { x: screenOffset.y, y: size.width - screenOffset.x - screenSize.width };
  const swap = (value: Size): Size => rotation === 180 ? value : { width: value.height, height: value.width };
  const [image, screenMask] = await Promise.all([
    sharp(path).rotate(rotation).png().toBuffer(),
    sharp(mask, { raw: { ...screenSize, channels: 4 } }).rotate(rotation).raw().toBuffer(),
  ]);
  return { path, image, size: swap(size), screenOffset: offset, screenSize: swap(screenSize), screenMask };
}

export function loadFrameitFrame(
  target: TargetSpec,
  frame: FrameitFrame,
  cacheDir: string,
) {
  const key = JSON.stringify({ path: resolve(cacheDir), frame, capture: captureSize(target) });
  return cachedFrame(key, () => resolveFrameitFrame(target, frame, cacheDir));
}

async function resolveFrameitFrame(
  target: TargetSpec,
  frame: FrameitFrame,
  cacheDir: string,
): Promise<FrameAsset> {
  const [path, offsets] = await Promise.all([
    download(frame.file, cacheDir),
    loadOffsets(cacheDir),
  ]);

  const entry = offsets.portrait[frame.offsetKey];

  if (!entry) {
    throw new Error(
      `No offsets entry for "${frame.offsetKey}" (target ${target.id}). ` +
        `See ${FRAMES_BASE_URL}/offsets.json for valid keys.`,
    );
  }

  const { data: pixels, info } = await sharp(path)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const size: Size = { width: info.width, height: info.height };
  const screenOffset = parseOffset(entry.offset);
  const screenSize = { width: entry.width, height: inferScreenHeight(pixels, size, screenOffset, entry.width) };
  if (frame.screenSize && (frame.screenSize.width !== screenSize.width || Math.abs(frame.screenSize.height - screenSize.height) > 1)) {
    throw new Error(`Frame "${frame.file}" has a ${screenSize.width}x${screenSize.height} cutout, ` +
      `not the declared ${frame.screenSize.width}x${frame.screenSize.height}.`);
  }
  const asset = await prepareFrame(path, screenOffset, screenSize, frame.rotation ?? 0, { data: pixels, info });
  assertScreenAspect(captureSize(target), asset.screenSize, `Target "${target.id}"`);
  return asset;
}

/** Local frames use explicit geometry and are refreshed when the file changes. */
export async function loadImageFrame(target: TargetSpec, frame: ImageFrame, assetRoot = '.') {
  const path = resolve(assetRoot, frame.path);
  const file = await stat(path);
  const key = JSON.stringify({ path, modified: file.mtimeMs, bytes: file.size, frame, capture: captureSize(target) });
  return cachedFrame(key, async () => {
    const asset = await prepareFrame(path, { x: frame.screen.x, y: frame.screen.y },
      { width: frame.screen.width, height: frame.screen.height }, frame.rotation ?? 0);
    assertScreenAspect(captureSize(target), asset.screenSize, `Target "${target.id}"`);
    return asset;
  });
}

/**
 * Composites a raw capture into its bezel, producing a transparent-background
 * PNG of the whole device. Returned as a buffer so the caller can inline it
 * into the composition page as a data URL.
 */
export async function renderFramedDevice(
  capture: Buffer,
  asset: FrameAsset,
): Promise<Buffer> {
  const { width = 0, height = 0 } = await sharp(capture).metadata();
  assertScreenAspect({ width, height }, asset.screenSize, 'Capture');
  const screen = await sharp(capture)
    .resize(asset.screenSize.width, asset.screenSize.height, { fit: 'fill' })
    .ensureAlpha()
    .composite([
      {
        input: asset.screenMask,
        raw: {
          width: asset.screenSize.width,
          height: asset.screenSize.height,
          channels: 4,
        },
        blend: 'dest-in',
      },
    ])
    .png()
    .toBuffer();

  return sharp({
    create: {
      width: asset.size.width,
      height: asset.size.height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      { input: screen, left: asset.screenOffset.x, top: asset.screenOffset.y },
      { input: asset.image ?? asset.path, left: 0, top: 0 },
    ])
    .png()
    .toBuffer();
}
