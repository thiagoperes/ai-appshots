import sharp from 'sharp';

import {
  captureSize,
  loadFrameitFrame,
  renderFramedDevice,
  statusBarSize,
} from './frames';
import { renderCssBezel } from './render/bezel';
import { renderCanvas } from './render/canvas';
import {
  foregroundFor,
  renderStatusBar,
  sampleTopColor,
} from './render/status-bar';
import { STORE_POLICIES } from './targets';
import type { CanvasTheme, Caption, TargetSpec, ThemeName } from './types';

/** Aspect ratios within this of each other are treated as the same screen. */
const ASPECT_TOLERANCE = 0.02;

/**
 * Scales a native capture onto the exact pixel grid the bezel expects.
 *
 * Simulator and emulator screenshots are usually already the right size, but not
 * always: the frame set's 12.9" iPad cutout is 2048x2732 while the simulator
 * shoots 2064x2752. Those describe the same screen, so resampling is correct,
 * whereas a genuinely different aspect ratio means the wrong device and is worth
 * refusing rather than silently squashing.
 */
async function normalize(capture: Buffer, target: TargetSpec) {
  const expected = captureSize(target);
  const { width, height } = await sharp(capture).metadata();

  if (!width || !height) {
    throw new Error(`Could not read the dimensions of a ${target.id} capture.`);
  }

  if (width === expected.width && height === expected.height) {
    return capture;
  }

  const drift = Math.abs(width / height - expected.width / expected.height);

  if (drift > ASPECT_TOLERANCE) {
    const statusBar = Math.round(
      target.statusBarHeight * target.deviceScaleFactor,
    );

    throw new Error(
      `Capture for "${target.id}" is ${width}x${height}, which is not the ` +
        `shape of its ${expected.width}x${expected.height} device frame.\n` +
        (height === expected.height - statusBar
          ? `It is short by exactly the ${statusBar}px status bar, so it looks ` +
            `like a browser capture. Those need the "web" capture kind, which ` +
            `synthesises the status bar it is missing.`
          : `Capture from a device matching the target, or point the target at ` +
            `a frame for the device you have.`),
    );
  }

  return sharp(capture)
    .resize(expected.width, expected.height, { fit: 'fill' })
    .png()
    .toBuffer();
}

/**
 * Stacks the status bar strip above the captured page to rebuild the full
 * device screen. The page was captured short by exactly the strip's height, so
 * the result matches the bezel's screen cutout.
 */
async function buildScreen(
  target: TargetSpec,
  capture: Buffer,
  font: string,
) {
  if (target.statusBarHeight <= 0) {
    return capture;
  }

  const strip = statusBarSize(target);
  const background = await sampleTopColor(capture);
  const statusBar = await renderStatusBar({
    size: strip,
    style: { background, foreground: foregroundFor(background) },
    platform: target.platform,
    glyph: Math.round(target.statusBarTextSize * target.deviceScaleFactor),
    font,
  });

  const screen = captureSize(target);

  return sharp({
    create: {
      width: screen.width,
      height: screen.height,
      channels: 4,
      background: { ...background, alpha: 1 },
    },
  })
    .composite([
      { input: statusBar, left: 0, top: 0 },
      { input: capture, left: 0, top: strip.height },
    ])
    .png()
    .toBuffer();
}

/**
 * Wraps a capture in its device bezel and lays it out under the caption on a
 * canvas the exact size the store expects.
 *
 * Nothing here needs a browser: the backdrop is SVG rasterised by librsvg, the
 * type is shaped by Pango, and the device is resampled by sharp. That keeps a
 * native run free of browser binaries entirely.
 */
export async function composeScreenshot(options: {
  readonly target: TargetSpec;
  readonly capture: Buffer;
  readonly caption: Caption;
  readonly theme: ThemeName;
  readonly canvas: CanvasTheme;
  /** Directory the downloaded device bezels are cached in. */
  readonly frameCacheDir: string;
  /**
   * True when the capture is a full device screen, as a simulator, emulator or
   * imported screenshot produces. False for a browser capture, which has no
   * status bar of its own and needs a synthetic one.
   */
  readonly includesStatusBar: boolean;
  /** 1-based position in the set, shown as the `[ 01 ]` eyebrow index. */
  readonly index: number;
}): Promise<Buffer> {
  const { target, capture, caption, canvas, theme, index } = options;
  const policy = STORE_POLICIES[target.store];
  const frame = target.frame;

  const screen = options.includesStatusBar
    ? await normalize(capture, target)
    : await buildScreen(target, capture, canvas.sansFont);

  const device =
    frame.kind === 'css'
      ? await renderCssBezel(screen, frame, captureSize(target).width)
      : await renderFramedDevice(
          screen,
          await loadFrameitFrame(target, frame, options.frameCacheDir),
        );

  return renderCanvas({
    output: target.output,
    caption,
    theme,
    canvas,
    captionScale: target.captionScale,
    captionGapRatio: target.captionGapRatio,
    allowBleed: policy.allowDeviceBleed,
    allowShadow: policy.allowDeviceShadow,
    device,
    index,
  });
}
