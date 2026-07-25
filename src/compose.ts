import type { Browser } from 'playwright';
import sharp from 'sharp';

import {
  captureSize,
  loadFrameitFrame,
  renderFramedDevice,
  statusBarSize,
} from './frames';
import { foregroundFor, renderStatusBar, sampleTopColor } from './status-bar';
import { STORE_POLICIES } from './targets';
import { buildCompositionHtml } from './template';
import type {
  CanvasTheme,
  Caption,
  TargetSpec,
  ThemeName,
} from './types';

function toDataUrl(buffer: Buffer) {
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

/**
 * Stacks the status bar strip above the captured page to rebuild the full
 * device screen. The page was captured short by exactly the strip's height, so
 * the result matches the bezel's screen cutout.
 */
async function buildScreen(
  browser: Browser,
  target: TargetSpec,
  capture: Buffer,
  font: string,
) {
  if (target.statusBarHeight <= 0) {
    return capture;
  }

  const strip = statusBarSize(target);
  const background = await sampleTopColor(capture);
  const statusBar = await renderStatusBar(browser, {
    size: strip,
    style: { background, foreground: foregroundFor(background) },
    platform: target.statusBarPlatform,
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
 * Wraps a raw capture in its device bezel and lays it out under the caption on
 * a canvas the exact size the store expects.
 *
 * The composition is plain HTML rendered by Chromium rather than an image
 * pipeline, so the layout uses the same tokens as the product and captions can
 * reflow per locale instead of being baked into a fixed-width bitmap.
 */
export async function composeScreenshot(options: {
  readonly browser: Browser;
  readonly target: TargetSpec;
  readonly capture: Buffer;
  readonly caption: Caption;
  readonly theme: ThemeName;
  readonly canvas: CanvasTheme;
  /** Directory the downloaded device bezels are cached in. */
  readonly frameCacheDir: string;
  /** 1-based position in the set, shown as the `[ 01 ]` eyebrow index. */
  readonly index: number;
}): Promise<Buffer> {
  const { browser, target, capture, caption, canvas, theme, index } = options;
  const policy = STORE_POLICIES[target.store];
  const frame = target.frame;

  const screen = await buildScreen(browser, target, capture, canvas.sansFont);

  const deviceBuffer =
    frame.kind === 'css'
      ? screen
      : await renderFramedDevice(
          screen,
          await loadFrameitFrame(target, frame, options.frameCacheDir),
        );

  const html = buildCompositionHtml({
    output: target.output,
    caption,
    theme,
    canvas,
    captionScale: target.captionScale,
    captionGapRatio: target.captionGapRatio,
    allowBleed: policy.allowDeviceBleed,
    allowShadow: policy.allowDeviceShadow,
    deviceDataUrl: toDataUrl(deviceBuffer),
    cssFrame: frame.kind === 'css' ? frame : undefined,
    captureWidth: captureSize(target).width,
    index,
  });

  const context = await browser.newContext({
    viewport: target.output,
    deviceScaleFactor: 1,
  });

  try {
    const page = await context.newPage();

    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);

    return await page.screenshot({ type: 'png' });
  } finally {
    await context.close();
  }
}
