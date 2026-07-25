# storeshot

Replicable, agent-programmable App Store and Google Play screenshots.

Point it at a running app, describe the screens you want in a config file, and
get back store-ready assets: real captures of your app, clipped into real device
bezels, laid out under marketing copy, at the exact pixel sizes Apple and Google
accept, staged for `fastlane deliver` and `supply`.

No design tool in the loop. The whole set is one command, so it can run in CI,
and an agent can change the copy or add a screen by editing one file.

## Why

Store screenshots are usually made by hand, in a design tool, from stale
mockups. They drift the moment the product changes, nobody can reproduce them,
and the copy is whatever fit the artboard. storeshot treats them as build
output: same input, same pixels, reviewable in a pull request.

## Install

It runs a real browser and reads real device frames, so both are fetched on
first use.

```bash
npm install --save-dev github:thiagoperes/storeshot
npx playwright install chromium webkit
```

Node 20 or newer.

## Quick start

Create `storeshot.config.ts` next to your app:

```ts
import { defineConfig } from 'storeshot';

export default defineConfig({
  baseUrl: 'http://localhost:3000',
  screens: [
    { id: 'home', path: '/', theme: 'dark', waitFor: ['[data-ready]'] },
    { id: 'search', path: '/search', theme: 'dark' },
  ],
  captions: {
    en: {
      home: { kicker: 'Overview', title: 'Everything in one place' },
      search: { kicker: 'Search', title: 'Find it in a keystroke' },
    },
  },
});
```

Then, with your app running:

```bash
npx storeshot
```

Assets land in `screenshots/framed/<locale>/<target>/` and are copied into
`fastlane/` in the layout `deliver` and `supply` expect.

## What comes out

Four targets are built in, chosen to satisfy both stores with the smallest
possible set. Apple scales the 6.9" iPhone and 13" iPad sets down for every
smaller device, so those two cover the App Store.

| Target            | Store  | Output      | Frame                  |
| ----------------- | ------ | ----------- | ---------------------- |
| `ios-iphone-6.9`  | Apple  | 1320 × 2868 | iPhone 17 Pro Max      |
| `ios-ipad-13`     | Apple  | 2064 × 2752 | iPad Pro 12.9"         |
| `android-phone`   | Google | 1080 × 1920 | Pixel 5                |
| `android-tablet`  | Google | 1440 × 2560 | Neutral CSS bezel      |

Every asset is flattened to 24-bit PNG and checked before it is written: wrong
dimensions, a leftover alpha channel, or a file over Google's 8 MB cap fails the
run rather than the upload.

Store rules are encoded, not left to the author. Apple requires product bezels
to be shown uncropped with copy beside the device rather than on it, so App
Store targets keep the device whole and use a background bloom instead of a drop
shadow. Play has no such rule, so those targets may bleed the device off the
bottom edge.

## How it works

1. **Capture.** Playwright loads each screen at the device's exact viewport,
   using WebKit for iOS targets and Chromium for Android, freezes animations and
   carets, waits for your `waitFor` selectors, and shoots the page.
2. **Status bar.** The page is captured shorter by the height of the status bar,
   which is then rendered separately and stacked on top. The strip samples the
   colour of your app's top row so it disappears into the design, and no app
   content ends up hidden behind it.
3. **Frame.** The capture is composited into a device bezel from
   [`fastlane/frameit-frames`](https://github.com/fastlane/frameit-frames),
   clipped through a mask traced from the frame's own alpha channel so the
   rounded corners and the Dynamic Island cut the screenshot exactly the way the
   hardware does.
4. **Compose.** The framed device and its caption are laid out as an HTML page
   and screenshotted at the store's output size. Layout is CSS, so captions
   reflow per locale instead of being baked into a fixed-width bitmap.
5. **Deliver.** Assets are flattened, validated, and staged under `fastlane/`.

## Configuration

Everything below `baseUrl`, `screens`, and `captions` is optional.

```ts
import { defineConfig } from 'storeshot';

import en from './captions/en.json' with { type: 'json' };

export default defineConfig({
  baseUrl: process.env.APP_URL ?? 'http://localhost:3000',

  // Where output and caches go. Relative to the config file.
  outDir: 'screenshots',
  fastlaneDir: 'fastlane',

  screens: [
    {
      id: 'dashboard',
      path: '/app/dashboard',
      theme: 'dark',
      // Nothing is captured until these are visible, so no skeletons.
      waitFor: ['[data-slot="card"]'],
      // Hidden before the shot, on top of the global `hide` list.
      hide: ['.cookie-banner'],
      // Skip a form factor the screen makes no sense on.
      excludeTargets: ['ios-ipad-13'],
    },
  ],

  captions: { en },

  // Any subset. The rest falls back to a neutral built-in theme.
  theme: {
    dark: {
      base: '#000000',
      sweep: 'linear-gradient(176deg, #0F1053 0%, #070826 44%, #000000 100%)',
      halo: '#1A2BC3',
      title: '#FFFFFF',
      kicker: '#A6D8FD',
    },
    sansFont: '"Inter", -apple-system, sans-serif',
    showIndex: true,
  },

  // Signs in once; the session is reused for every target.
  async auth({ page }) {
    await page.goto('/login');
    await page.getByLabel('Email').fill(process.env.DEMO_EMAIL!);
    await page.getByLabel('Password').fill(process.env.DEMO_PASSWORD!);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL((url) => !url.pathname.startsWith('/login'));
  },

  // Runs before each screen navigates. Cookies, storage, network stubs.
  async prepare({ context, page, screen }) {
    await context.addCookies([
      { name: 'theme', value: screen.theme, domain: 'localhost', path: '/' },
    ]);
    await page.route('**/api/telemetry', (route) => route.abort());
  },
});
```

`targets` can be overridden too, if you need a device the defaults do not cover.
Import `DEFAULT_TARGETS` and spread it, or write your own `TargetSpec[]`.

## CLI

```
storeshot [options]

  --config <path>    Config file. Default: nearest storeshot.config.ts.
  --target <id>      Only this target (repeatable). Default: all.
  --screen <id>      Only this screen (repeatable). Default: all.
  --locale <code>    Caption locale (repeatable). Default: all configured.
  --skip-capture     Recompose from the existing raw captures.
  --skip-compose     Capture only.
  --fresh-auth       Ignore the cached session and sign in again.
```

`--skip-capture` is the one to know: iterating on copy or colours reuses the
captures already on disk, so the loop is seconds rather than minutes.

## Working with an agent

The config is the whole interface, which makes this a good tool to hand to a
coding agent. Useful things to ask for:

- "Add a screen for the billing page and write a caption for it."
- "Rewrite the captions to lead with the benefit, keep them under six words."
- "Try the halo in our accent colour and show me the iPhone set."

Each is a small edit to one file followed by `storeshot --skip-capture`, and the
diff is reviewable as images in a pull request. The library API is exported too,
if you would rather script the pipeline than shell out:

```ts
import { loadConfig, parseOptions, run } from 'storeshot';
```

Note that the package ships TypeScript source and is loaded through
[jiti](https://github.com/unjs/jiti), so importing it from plain Node without a
TypeScript loader will not work. The CLI handles this for you.

## Prior art

[fastlane](https://fastlane.tools) `snapshot` and `frameit` solve the same
problem for native apps driven by UI tests. storeshot targets web-rendered
apps — anything served over HTTP, including Capacitor, Cordova, and Electron
wrappers — and does the marketing composition in CSS rather than ImageMagick.
The device bezels come from fastlane's own frame set.

## License

MIT
