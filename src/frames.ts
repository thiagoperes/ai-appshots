import { access, readFile, writeFile } from 'node:fs/promises';

import sharp from 'sharp';

import { ensureDir } from './paths';
import { info } from './log';
import type { FrameAsset, FrameitFrame, Size, TargetSpec } from './types';

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

async function download(fileName: string, cacheDir: string) {
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
  await writeFile(cachePath, Buffer.from(await response.arrayBuffer()));

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
 * screen. Partial alpha is preserved so the rounded corners stay antialiased.
 */
function buildScreenMask(
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
      const coverage = outside[source] ? 0 : 255 - pixels[source * 4 + 3]!;

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

/**
 * Resolves a frameit bezel and asserts the target's capture fits its screen
 * cutout exactly. Getting this wrong silently produces a screenshot that is
 * offset or scaled inside the bezel, so it is worth failing loudly.
 */
const frameCache = new Map<string, Promise<FrameAsset>>();

export function loadFrameitFrame(
  target: TargetSpec,
  frame: FrameitFrame,
  cacheDir: string,
) {
  const key = `${frame.file}|${target.id}`;
  const cached = frameCache.get(key);

  if (cached) {
    return cached;
  }

  const pending = resolveFrameitFrame(target, frame, cacheDir);

  frameCache.set(key, pending);

  return pending;
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
  const screenSize = captureSize(target);

  if (entry.width !== screenSize.width) {
    throw new Error(
      `Target ${target.id} captures at ${screenSize.width}px wide but frame ` +
        `"${frame.file}" expects ${entry.width}px. Adjust viewport or ` +
        `deviceScaleFactor so their product is ${entry.width}.`,
    );
  }

  const overflowX = screenOffset.x + screenSize.width - size.width;
  const overflowY = screenOffset.y + screenSize.height - size.height;

  if (overflowX > 0 || overflowY > 0) {
    throw new Error(
      `Capture ${screenSize.width}x${screenSize.height} at offset ` +
        `+${screenOffset.x}+${screenOffset.y} does not fit frame ` +
        `"${frame.file}" (${size.width}x${size.height}).`,
    );
  }

  return {
    path,
    size,
    screenOffset,
    screenSize,
    screenMask: buildScreenMask(pixels, size, screenOffset, screenSize),
  };
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
      { input: asset.path, left: 0, top: 0 },
    ])
    .png()
    .toBuffer();
}
