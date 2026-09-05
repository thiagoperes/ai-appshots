import sharp from 'sharp';

import {
  captureSize,
  assertScreenAspect,
  loadFrameitFrame,
  loadImageFrame,
  renderFramedDevice,
  statusBarSize,
} from './frames';
import { renderCssBezel } from './render/bezel';
import { renderWindowFrame } from './render/window';
import { formFactorFor } from './devices';
import { renderCanvas } from './render/canvas';
import { renderComposition } from './render/composition';
import { compositionLayers } from './render/presets';
import type { CompositionSpec, DeviceLayer } from './composition-types';
import {
  foregroundFor,
  renderStatusBar,
  sampleTopColor,
} from './render/status-bar';
import { STORE_POLICIES } from './targets';
import type { CanvasTheme, Caption, CaptionBundle, FrameSpec, TargetSpec, ThemeName } from './types';

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

  try {
    assertScreenAspect({ width, height }, expected, `Capture for "${target.id}"`);
  } catch {
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
  const screen = captureSize(target);
  const strip = statusBarSize(target);
  const { width, height } = await sharp(capture).metadata();
  if (strip.height < 0 || strip.height >= screen.height) throw new Error(`Invalid status-bar height for "${target.id}".`);
  if (width !== screen.width || height !== screen.height - strip.height) {
    throw new Error(`Browser capture for "${target.id}" is ${width}x${height}; expected ` +
      `${screen.width}x${screen.height - strip.height} before adding the status bar. Check the viewport and device scale.`);
  }
  if (target.statusBarHeight <= 0) {
    return capture;
  }

  const background = await sampleTopColor(capture);
  const statusBar = await renderStatusBar({
    size: strip,
    style: { background, foreground: foregroundFor(background) },
    platform: target.platform,
    glyph: Math.round(target.statusBarTextSize * target.deviceScaleFactor),
    font,
    layout: target.statusBar ?? {
      style: target.platform === 'android' ? 'android' : formFactorFor(target) === 'tablet' ? 'ios-tablet' : 'ios-phone',
    },
  });

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

async function frameScreen(screen: Buffer, target: TargetSpec, frame: FrameSpec, cacheDir: string, font: string, theme: ThemeName, assetRoot?: string) {
  switch (frame.kind) {
    case 'none': return screen;
    case 'css': return renderCssBezel(screen, frame, Math.min(captureSize(target).width, captureSize(target).height));
    case 'window': return renderWindowFrame(screen, { ...frame, appearance: frame.appearance ?? theme }, font);
    case 'image': return renderFramedDevice(screen, await loadImageFrame(target, frame, assetRoot));
    case 'frameit': return renderFramedDevice(screen, await loadFrameitFrame(target, frame, cacheDir));
  }
}

export interface ComposeCompositionOptions {
  readonly target: TargetSpec;
  readonly captures: Readonly<Record<string, Buffer>>;
  readonly screens: readonly string[];
  readonly captions: CaptionBundle;
  readonly composition: CompositionSpec;
  readonly theme: ThemeName;
  readonly canvas: CanvasTheme;
  readonly locale: string;
  readonly frameCacheDir: string;
  readonly includesStatusBar: boolean;
  readonly assetRoot?: string;
}

/** Prepares each capture/frame once, even when reused in several layers. */
export async function composeComposition(options: ComposeCompositionOptions) {
  const { target, canvas } = options;
  const screens = new Map<string, Promise<Buffer>>();
  const devices = new Map<string, Promise<Buffer>>();
  const resolveDevice = async (layer: DeviceLayer) => {
    const frame = layer.frame ?? target.frame;
    if (layer.crop && frame.kind !== 'none') {
      throw new Error(`Layer "${layer.id}" crops the screen; set its frame to kind "none".`);
    }
    let screen = screens.get(layer.screen);
    if (!screen) {
      const capture = options.captures[layer.screen];
      if (!capture) throw new Error(`Missing capture for composition source "${layer.screen}".`);
      screen = options.includesStatusBar
        ? normalize(capture, target)
        : buildScreen(target, capture, canvas.sansFont);
      screens.set(layer.screen, screen);
    }
    const key = `${layer.screen}|${JSON.stringify(frame)}`;
    let device = devices.get(key);
    if (!device) {
      device = screen.then((buffer) => frameScreen(buffer, target, frame, options.frameCacheDir, canvas.sansFont, options.theme, options.assetRoot));
      devices.set(key, device);
    }
    return { image: await device, appleArtwork: frame.kind === 'frameit' && target.platform !== 'android' };
  };
  const context = { ...options, output: target.output, captionScale: target.captionScale, captionGapRatio: target.captionGapRatio,
    formFactor: formFactorFor(target), deviceSize: captureSize(target) };
  const deviceSizes: Record<string, { width: number; height: number }> = {};
  // Measure the selected hardware, including frame overrides, before placing
  // presets. A laptop's keyboard/base changes its shape substantially.
  for (const layer of compositionLayers(options.composition, context)) {
    if (layer.kind !== 'device' || layer.hidden || !/^device-\d+$/.test(layer.id)) continue;
    const { width = 0, height = 0 } = await sharp((await resolveDevice(layer)).image).metadata();
    deviceSizes[layer.id] = { width, height };
  }
  return renderComposition({ ...context, deviceSizes, resolveDevice });
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
  readonly assetRoot?: string;
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

  const device = await frameScreen(screen, target, frame, options.frameCacheDir, canvas.sansFont, theme, options.assetRoot);

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
