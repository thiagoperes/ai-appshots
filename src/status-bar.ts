import type { Browser } from 'playwright';
import sharp from 'sharp';

import type { Size, StatusBarPlatform } from './types';

/**
 * Apple has shown 9:41 in iPhone marketing since the original keynote, and a
 * full battery avoids implying the app drains one. Android has no equivalent
 * convention, so it uses the same values for a consistent set.
 *
 * @see https://developer.apple.com/design/human-interface-guidelines/going-full-screen
 */
const MARKETING_TIME = '9:41';

export interface StatusBarStyle {
  readonly background: { r: number; g: number; b: number };
  readonly foreground: string;
}

/**
 * Reads the average colour of a capture's top row.
 *
 * The strip has to disappear into whatever the app renders behind it, and that
 * varies by theme and by route, so sampling beats hardcoding a token. The top
 * row sits above the header's content padding, so it is background only.
 */
export async function sampleTopColor(capture: Buffer) {
  const { width } = await sharp(capture).metadata();

  const { data } = await sharp(capture)
    .extract({ left: 0, top: 0, width: width ?? 1, height: 1 })
    .resize(1, 1, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  return { r: data[0] ?? 0, g: data[1] ?? 0, b: data[2] ?? 0 };
}

export function foregroundFor(background: StatusBarStyle['background']) {
  const luminance =
    (0.299 * background.r + 0.587 * background.g + 0.114 * background.b) / 255;

  return luminance > 0.55 ? '#000000' : '#FFFFFF';
}

function icons(height: number) {
  const scale = height / 14;

  return `
    <svg width="${17 * scale}" height="${11 * scale}" viewBox="0 0 17 11" fill="currentColor">
      <rect x="0" y="7.5" width="3" height="3.5" rx="1" />
      <rect x="4.6" y="5.4" width="3" height="5.6" rx="1" />
      <rect x="9.2" y="2.9" width="3" height="8.1" rx="1" />
      <rect x="13.8" y="0" width="3" height="11" rx="1" />
    </svg>
    <svg width="${16 * scale}" height="${11 * scale}" viewBox="0 0 16 11" fill="none"
      stroke="currentColor" stroke-width="1.7" stroke-linecap="round">
      <path d="M1 3.4A11 11 0 0 1 15 3.4" />
      <path d="M3.7 6.3A7 7 0 0 1 12.3 6.3" />
      <path d="M6.4 9.1A3 3 0 0 1 9.6 9.1" />
    </svg>
    <svg width="${25 * scale}" height="${12 * scale}" viewBox="0 0 25 12" fill="none">
      <rect x="0.6" y="0.6" width="21" height="10.8" rx="3.1"
        stroke="currentColor" stroke-opacity="0.42" stroke-width="1.1" />
      <rect x="2.2" y="2.2" width="17.8" height="7.6" rx="1.9" fill="currentColor" />
      <path d="M23.2 4.1v3.8a2 2 0 0 0 0-3.8Z" fill="currentColor" fill-opacity="0.42" />
    </svg>
  `;
}

export interface StatusBarOptions {
  readonly size: Size;
  readonly style: StatusBarStyle;
  readonly platform: StatusBarPlatform;
  /** Clock size in pixels, already multiplied by the device scale factor. */
  readonly glyph: number;
  readonly font: string;
}

function buildStatusBarHtml(options: StatusBarOptions) {
  const { size, style, platform, glyph, font } = options;
  const { r, g, b } = style.background;
  // iOS clears the curved top edge and sits either side of the Dynamic Island.
  // The Pixel bezel puts a hole-punch camera in the top left, so the Android
  // clock starts to the right of it rather than underneath it.
  const leadingInset = platform === 'ios' ? 0.083 : 0.185;
  const leading = Math.round(size.width * leadingInset);
  const trailing = Math.round(size.width * (platform === 'ios' ? 0.083 : 0.05));
  const nudge = platform === 'ios' ? size.height * 0.16 : 0;

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }

      html, body {
        width: ${size.width}px;
        height: ${size.height}px;
        overflow: hidden;
      }

      body {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: ${nudge}px ${trailing}px 0 ${leading}px;
        background: rgb(${r}, ${g}, ${b});
        color: ${style.foreground};
        font-family: ${font};
        -webkit-font-smoothing: antialiased;
      }

      .time {
        font-size: ${glyph}px;
        font-weight: 600;
        letter-spacing: ${platform === 'ios' ? '-0.01em' : '0'};
        line-height: 1;
      }

      .icons {
        display: flex;
        align-items: center;
        gap: ${Math.round(glyph * 0.28)}px;
      }
    </style>
  </head>
  <body>
    <span class="time">${MARKETING_TIME}</span>
    <span class="icons">${icons(glyph)}</span>
  </body>
</html>`;
}

const cache = new Map<string, Promise<Buffer>>();

/**
 * Renders the status bar strip that sits above the captured page.
 *
 * The app runs in a WKWebView below the status bar, so a browser capture never
 * contains one and the framed device reads as a mockup. Rendering it as a
 * separate strip, rather than overlaying the capture, means no app content is
 * hidden behind it.
 */
export function renderStatusBar(browser: Browser, options: StatusBarOptions) {
  const { size, style, platform, glyph } = options;
  const { r, g, b } = style.background;
  const key = `${platform}|${size.width}x${size.height}|${glyph}|${r},${g},${b}`;
  const cached = cache.get(key);

  if (cached) {
    return cached;
  }

  const pending = (async () => {
    const context = await browser.newContext({
      viewport: size,
      deviceScaleFactor: 1,
    });

    try {
      const page = await context.newPage();

      await page.setContent(buildStatusBarHtml(options), {
        waitUntil: 'load',
      });
      await page.evaluate(() => document.fonts.ready);

      return await page.screenshot({ type: 'png' });
    } finally {
      await context.close();
    }
  })();

  cache.set(key, pending);

  return pending;
}
