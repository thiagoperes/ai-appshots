# ai-appshots

App Store and Google Play screenshots for **iOS, Android, and macOS**. Capture your
app, choose a layout and device frame, customize the design, and export the whole
set from one config file.

| Capability | Options |
| --- | --- |
| Layouts | Centered, side aligned, feature closeups, tilted panoramas, or a blank canvas |
| Device frames | 11 profiles, hardware colors, portrait and landscape, custom PNG frames, and Mac window chrome |
| Design controls | Typography, measured caption spacing, backgrounds, crops, rotation, shadows, and editable layers |
| Capture | iOS Simulator, Android emulator, Playwright, imported PNGs, or a custom driver |
| Delivery | Localized PNGs, gallery previews, size validation, and fastlane staging |
| Runs locally | Open source, no account, no hosted editor; captured screens and frames stay on your machine |

![Classic, side-aligned, feature-closeup, and tilted-panorama designs](https://raw.githubusercontent.com/thiagoperes/ai-appshots/main/docs/screenshots/design-options.webp)

The previews use a sample productivity app. Each design is rendered from the same
capture pipeline; the device frame remains part of the composition.

[Install](#install) · [Design options](#design-options) · [Device frames](#device-frames) ·
[Capture sources](#capture-sources) · [CLI](#cli)

## Install

```bash
npm install --save-dev ai-appshots
```

Node 20.9 or newer. Nothing else, and no browser: the marketing canvas is composed
with [sharp](https://sharp.pixelplumbing.com), so a native app never downloads a
browser binary. Device bezels are fetched on first use and cached.

Capturing from a browser is the one thing that needs more. Playwright is an
optional peer dependency, so add it only for that:

```bash
npm install --save-dev playwright
npx playwright install webkit chromium
```

Installed fonts are shaped with Pango. A desktop or a normal CI runner already
has plenty; a slim Linux image may need a package such as `fonts-dejavu-core`.
For reproducible typography, supply `titleFontFile` and `kickerFontFile` instead. Name real families in your theme —
`-apple-system` and other CSS keywords mean nothing outside a browser and are
skipped over in the stack.

## Design options

### Choose a preset

| Preset | Design |
| --- | --- |
| `classic` | A centered caption above the full device, with spacing measured from the rendered text |
| `side-aligned` | Left-aligned copy with a device offset to the right; wide devices use a side-by-side arrangement |
| `feature-closeup` | A framed device with a separate, enlarged crop of the app in front |
| `tilted-panorama` | One tilted device spans each pair of consecutive screenshots; an odd final panel stands alone |
| `blank` | A background with only the layers you add |

Set `composition` once, then override it per target or screen. This config creates
an iPhone, Android phone, and Mac set with two different layouts:

```ts
import { createDeviceTarget, defineConfig } from 'ai-appshots';

export default defineConfig({
  baseUrl: 'http://localhost:3000',
  targets: [
    createDeviceTarget('iphone-17-pro-max', { color: 'Cosmic Orange' }),
    createDeviceTarget('pixel-5', { color: 'Sorta Sage' }),
    createDeviceTarget('mac-window', { color: 'Light' }),
  ],
  composition: { preset: 'classic' },
  screens: [
    { id: 'overview', path: '/', theme: 'light' },
    { id: 'insights', path: '/insights', theme: 'dark',
      composition: { preset: 'side-aligned' } },
  ],
  captions: {
    en: {
      overview: { kicker: 'A little more focus', title: 'Make room\nfor what matters.' },
      insights: { kicker: 'Your time, reimagined', title: 'Find your\nrhythm.' },
    },
  },
  preview: { width: 300, gap: 12 },
});
```

Omitting `composition` keeps the original centered renderer. Adding a preset
uses editable layers and keeps the target's selected frame.

### A device spanning two screenshots

Add this `panoramas` field to the config above to join the two Android panels:

```ts
panoramas: [
  {
    id: 'focus-story',
    screens: ['overview', 'insights'],
    targets: ['pixel-5'],
    theme: 'dark',
    composition: {
      preset: 'tilted-panorama',
      overrides: {
        'device-1': { rotation: -10 },
      },
    },
  },
],
```

A panorama is rendered as one continuous canvas, then sliced at exact pixel
boundaries. Exported panels have no gutter; the gallery preview adds a display
gap. Groups contain 2–10 consecutive screens. Selecting either panel with
`--screen` regenerates its whole group and preserves unrelated exports.

### Customize the layers

Preset layers have stable IDs: `title-1`, `kicker-1`, `device-1`, and, for a feature
closeup, `detail-1`. The suffix is the panel number inside that composition.
Override their properties without replacing the preset:

```ts
composition: {
  preset: 'feature-closeup',
  background: { fill: 'linear-gradient(160deg, #ede9fe 0%, #dbeafe 100%)' },
  overrides: {
    'title-1': { color: '#29214b', fontSize: 0.08, weight: 700 },
    'device-1': { rotation: 4 },
    'detail-1': {
      x: 0.34,
      crop: { x: 0.06, y: 0.25, width: 0.88, height: 0.30 },
      shadow: { blur: 0.02, y: 0.012, opacity: 0.18 },
    },
  },
},
```

| Control | Properties |
| --- | --- |
| Position and size | `x`, `y`, `width`, `height`, `anchor`, `scale` |
| Appearance | `rotation`, `opacity`, `zIndex`, `hidden`, `shadow` |
| Text | `font`, `fontFile`, `fontSize`, `minFontSize`, `weight`, `letterSpacing`, `lineSpacing`, `maxLines`, `align`, `verticalAlign`, `uppercase` |
| Device | `screen`, `frame`, `crop`, `radius` |
| Additional layers | `text`, `image`, `shape`, or `device` entries in `composition.layers` |
| Background | A solid color, linear gradient, or local image with `fit` and `opacity` |

Positions and dimensions use fractions of **one output panel**, including in
panoramas: `x: 1` is the first seam. Font size uses panel width; rotation uses
degrees. Crop coordinates are fractions of the source image. Device crops require
`frame: { kind: 'none' }`; the closeup preset already does this for its detail layer.

Composition settings merge in this order: config → target → screen, or config →
target → panorama for a grouped export. Overrides merge by layer ID; additional
layer arrays append. A screen's `canvas` or a panorama's `canvas` can override
theme settings for that design.

### Typography and spacing

Caption fitting happens before placement. Unused text rows do not create gaps,
and a narrower device stays anchored below its caption. Panels rendered together
share the tallest measured caption rows so the set remains aligned.

```ts
theme: {
  titleFont: 'Inter, Helvetica Neue, sans-serif',
  kickerFont: 'Inter, Helvetica Neue, sans-serif',
  titleWeight: 700,
  titleWidthRatio: 0.8,
  titleLines: 2,
  captionTopRatio: 0.1,
  kickerGapEm: 0.35,
  deviceWidthRatio: 0.88,
  light: { title: '#16132b', kicker: '#7051d9' },
},
```

| Setting | Meaning and default |
| --- | --- |
| `titleFont`, `kickerFont` | Installed font families; fall back to the legacy font fields |
| `titleFontFile`, `kickerFontFile` | Absolute paths to TTF or OTF files, rendered directly without host font substitution |
| `titleWeight` | Headline weight; `700`. A font file supplies its own face and weight |
| `titleLines`, `titleMinScale` | Up to two lines by default; fit down to `0.72` of the requested font size |
| `titleWidthRatio` | Caption width relative to panel width; `0.8` |
| `captionTopRatio` | Top caption inset relative to the shorter canvas edge; `0.1` |
| `kickerGapEm` | Label-to-headline gap relative to the fitted title size; `0.35` |
| Target `captionScale` | Font size relative to output width; phone `0.078`, tablet `0.06`, desktop `0.045`, capped for landscape |
| Target `captionGapRatio` | Caption-to-device gap relative to canvas height; device profiles default to 8% of the shorter edge |
| `deviceWidthRatio` | Maximum centered device width relative to panel width; `0.88` |
| `bottomMarginRatio` | Bottom inset relative to canvas height; defaults to 10% of the shorter edge |

For exact placement, use layer overrides. The original renderer also supports
`showIndex`, `showRules`, and opt-in `deviceBleed` on targets that permit it.

### Preview before exporting

Gallery previews are written to `screenshots/previews/<locale>/<target>.png` by
default. Set `preview: false` to disable them, or adjust `width` and `gap` as in the
config above. They are separate from the full-resolution PNGs staged for the stores.

```bash
npx ai-appshots --skip-capture
```

Recompose from cached captures after changing a preset, frame color, font, crop,
or spacing. A change to capture geometry requires fresh captures.

## Device frames

Choose hardware with `createDeviceTarget`. Frame selection, capture dimensions,
status-bar placement, and store output size travel together.

| Platform | Profile IDs | Frame colors |
| --- | --- | --- |
| iOS | `iphone-17` | Black, Lavender, Mist Blue, Sage, White |
| iOS | `iphone-17-pro`, `iphone-17-pro-max` | Deep Blue, Cosmic Orange, Silver |
| iPadOS | `ipad-pro-11`, `ipad-pro-12.9` | Space Gray, Silver; the 12.9-inch artwork is 4th generation |
| Android | `pixel-5` | Just Black, Sorta Sage |
| Android | `galaxy-s21` | Black |
| Android | `android-tablet` | Graphite or Silver generic bezel |
| macOS | `macbook-air` | Silver, Space Gray, Gold |
| macOS | `macbook-pro-16` | Space Gray, Silver |
| macOS | `mac-window` | Light, Dark, or None |

![MacBook Air, MacBook Pro, and Mac window frame options](https://raw.githubusercontent.com/thiagoperes/ai-appshots/main/docs/screenshots/mac-options.webp)

```bash
npx ai-appshots --list-devices
```

This lists available profiles, colors, and capture dimensions without needing a
config file. Device profile names describe the frame artwork; store output sizes
are configured separately.

```ts
createDeviceTarget('ipad-pro-11', { color: 'Silver', orientation: 'landscape' });

createDeviceTarget('mac-window', {
  frame: { kind: 'window', appearance: 'dark', title: 'My workspace', titleBarRatio: 0.04 },
});

createDeviceTarget('iphone-17-pro-max', {
  frame: {
    kind: 'image',
    path: 'frames/my-phone.png',
    screen: { x: 72, y: 80, width: 1320, height: 2868 },
  },
});
```

A custom `image` frame is a transparent PNG with its screen cutout specified in
native image pixels. The file path is relative to the config's root. Landscape
rotates the hardware and swaps capture/output dimensions while keeping app
content upright.

| Frame kind | Use |
| --- | --- |
| `frameit` | Named hardware artwork downloaded once and cached locally |
| `css` | A generic bezel with configurable thickness, corner radius, and color |
| `image` | Your own transparent PNG frame with an explicit screen rectangle |
| `window` | Mac window chrome with title, appearance, color, and corner controls |
| `none` | The app screenshot without a frame |

Apple artwork notices are separate from store file validation. Compositions can
tilt, crop, or split a device; use generic frames for those treatments when
following Apple's product-artwork guidance.

## Quick start

The examples below build the real App Store and Play sets for
[Rally](https://getrally.com), a fleet expense platform that ships on both
stores.

### iOS

`ai-appshots.ios.config.ts` — the App Store set, captured from the real build in
the Simulator. Requires macOS with Xcode.

```ts
import { defineConfig, findTarget } from 'ai-appshots';

export default defineConfig({
  // Rally's iOS app is iPhone-only, so the iPad target comes off. Apple scales
  // the 6.9" set down for every smaller iPhone, so one target covers them all.
  targets: [findTarget('ios-iphone-6.9')],
  composition: { preset: 'classic' },

  capture: {
    kind: 'ios-simulator',
    // First name that exists wins, and an already-booted device is preferred.
    device: ['iPhone 17 Pro Max', 'iPhone 16 Pro Max'],
    bundleId: 'com.getrally',
    appPath: 'ios/App/build/Debug-iphonesimulator/App.app',
  },

  // A launch and a route change need longer to settle than a browser does.
  settleDelay: 2500,

  screens: [
    { id: 'platform', theme: 'dark' },
    { id: 'transactions', theme: 'dark' },
    { id: 'cards', theme: 'dark' },
  ],

  captions: {
    en: {
      platform: { kicker: 'Payments', title: 'Every fleet expense, one app' },
      transactions: {
        kicker: 'Transactions',
        title: 'See every purchase as it happens',
      },
      cards: { kicker: 'Cards', title: 'Issue cards in seconds, not days' },
    },
  },
});
```

```bash
npx ai-appshots --config ai-appshots.ios.config.ts
```

Captures come out full-screen, with the device's own status bar, pinned to 9:41
on a full battery. Rally's screens are ordinary in-app routes with no URL scheme
behind them, so this run stops and asks you to navigate before each capture. Give
a screen a `deepLink`, or the config a `navigate` hook, to make it unattended —
see [Navigating a native app](#navigating-a-native-app).

### Android

`ai-appshots.android.config.ts` — the Play set, from the release APK on an
emulator. Requires the Android SDK platform tools on your `PATH`.

```ts
import { defineConfig, findTarget } from 'ai-appshots';

export default defineConfig({
  // Play asks for a phone and a tablet asset separately.
  targets: [findTarget('android-phone'), findTarget('android-tablet')],
  composition: { preset: 'classic' },

  capture: {
    kind: 'android-emulator',
    appId: 'com.getrally.app',
    apkPath: 'android/app/build/outputs/apk/release/app-release.apk',
    // Booted when nothing is already attached. Omit to use `adb`'s only device.
    avd: 'Pixel_5_API_35',
  },

  screens: [
    {
      id: 'platform',
      deepLink: 'https://app.getrally.com/home',
      theme: 'dark',
    },
    {
      id: 'cards',
      deepLink: 'https://app.getrally.com/home/cards',
      theme: 'dark',
    },
  ],

  captions: {
    en: {
      platform: { kicker: 'Payments', title: 'Every fleet expense, one app' },
      cards: { kicker: 'Cards', title: 'Issue cards in seconds, not days' },
    },
  },
});
```

```bash
npx ai-appshots --config ai-appshots.android.config.ts
```

A `deepLink` here is anything `adb shell am start` can open, so an app link like
the one above works without registering a custom scheme, as long as the app
declares the intent filter. Play permits a device to bleed off the bottom edge.
Cropping is an explicit design choice; the centered preset keeps the whole device visible by default.

### A web or hybrid app

Rally is a Capacitor app, so the same screens can be captured headless in
seconds without building either binary — WebKit for iOS targets, Chromium for
Android ones, matching the web view each platform actually runs. This is Rally's
default config, with the two native ones above kept for checking the native shell
before a listing refresh.

```ts
import { defineConfig } from 'ai-appshots';

export default defineConfig({
  baseUrl: process.env.SCREENSHOT_BASE_URL ?? 'http://localhost:3000',
  composition: { preset: 'classic' },
  screens: [
    {
      id: 'platform',
      path: '/home/acme',
      theme: 'dark',
      // Nothing is captured until these are on screen, so no skeletons.
      waitFor: ['[data-slot="card"]'],
    },
  ],
  captions: {
    // as above
  },
  // Signs in once; the session is reused across targets.
  auth: ({ page }) => signIn(page),
});
```

```bash
npx ai-appshots
```

Whichever route you take, assets land in
`screenshots/framed/<locale>/<target>/` and are copied into `fastlane/` in the
layout `deliver` and `supply` expect.

Captions wrap to fit and, at two lines, rebalance so the lines come out close to
equal instead of leaving a stub on the second. Put a `\n` in a title to break it
somewhere specific; a line that is still too wide may wrap further to fit.

## What comes out

Four targets are selected by default, chosen to satisfy both stores with a small
set. The additional profiles above, including macOS, are opt-in. Apple scales the 6.9" iPhone and 13" iPad sets down for
smaller devices, so those two cover the App Store.

| Target           | Store  | Screen      | Output      | Frame             |
| ---------------- | ------ | ----------- | ----------- | ----------------- |
| `ios-iphone-6.9` | Apple  | 1320 × 2868 | 1320 × 2868 | iPhone 17 Pro Max |
| `ios-ipad-13`    | Apple  | 2048 × 2732 | 2064 × 2752 | iPad Pro 12.9"    |
| `android-phone`  | Google | 1080 × 2340 | 1080 × 1920 | Pixel 5           |
| `android-tablet` | Google | 1680 × 2440 | 1440 × 2560 | Neutral CSS bezel |

A target describes its screen in points and a scale factor, which is the same
arithmetic for both worlds: an iPhone 17 Pro Max is 440 × 956pt at 3x, or
1320 × 2868px, whether that comes from a simulator or a browser viewport. If your
device's screenshot is a slightly different size but the same shape — the frame
set's 12.9" iPad cutout is 2048 × 2732 while the simulator shoots 2064 × 2752 — it
is resampled. A genuinely different aspect ratio is refused rather than squashed.

Every asset is flattened to 24-bit PNG and checked before it is written: wrong
dimensions, a leftover alpha channel, or a file over Google's 8 MB cap fails the
run rather than the upload.

A Mac App Store target is available as `findTarget('macos-16:10')`, or select a
Mac profile with `createDeviceTarget`. It exports at 2880 × 1800. macOS captures
can come from a browser, imported screenshots, or a custom driver.

## Capture sources

Capture is a driver behind one interface, so where the pixels come from is a
config choice and nothing downstream changes. Set `capture` once for everything,
or per platform when a native iOS build and a native Android build need different
tooling. Individual targets can override it.

### `ios-simulator`

Drives a real build in the Simulator through `xcrun simctl`. Requires macOS with
Xcode.

```ts
capture: {
  kind: 'ios-simulator',
  device: ['iPhone 17 Pro Max', 'iPhone 16 Pro Max'],
  bundleId: 'com.acme.App',
  appPath: 'build/Debug-iphonesimulator/App.app',
}
```

It prefers a device that is already booted, boots one if not, and creates the
simulator outright when no instance matches — which is the normal state of a
fresh machine or CI runner. Before capturing it pins the status bar to Apple's
canonical marketing state: 9:41, full battery, full signal. Screenshots are the
whole screen, real status bar included.

### `android-emulator`

The same idea over `adb`, against an emulator or an attached device.

```ts
capture: {
  kind: 'android-emulator',
  appId: 'com.acme.app',
  apkPath: 'build/outputs/apk/release/app-release.apk',
  avd: 'Pixel_5_API_34', // booted only if nothing is attached
}
```

SystemUI demo mode stands in for the iOS status bar override, giving a fixed
clock, a full battery and no notification icons.

### `import`

Frames screenshots something else produced — XCUITest, `fastlane snapshot`,
Espresso, or a designer's export.

```ts
capture: {
  kind: 'import',
  dir: 'fastlane/screenshots',
  // Defaults to `<target>/<screen>.png`.
  file: ({ locale, screen }) => `${locale}/iPhone 17 Pro Max-${screen.id}.png`,
}
```

This is the shortest path if you already have UI tests that take screenshots:
keep taking them however you like and adopt only the framing and delivery half of
the pipeline.

### `web`

The default. Playwright loads each screen at the device's exact viewport, using
WebKit for iOS targets and Chromium for Android ones, so the render engine
matches the web view the app will ship in. Suits anything served over HTTP,
including Capacitor, Cordova and Electron wrappers.

### `custom`

Anything else — a device farm, `idb`, an Appium session.

```ts
capture: {
  kind: 'custom',
  includesStatusBar: true,
  open: async ({ target, config }) => ({
    capture: async (screen, locale) => myDeviceFarm.shoot(target.id, screen.id),
    close: async () => myDeviceFarm.release(),
  }),
}
```

## Navigating a native app

A native driver gets your app to each screen in one of three ways, in order of
preference:

1.1 **A deep link** on the screen — `deepLink: 'acme://cards'` — opened with
   `simctl openurl` or an `android.intent.action.VIEW` intent. Best option: fully
   unattended, and most apps that support universal links already have this.

1.2 **A `navigate` hook** in the config, which receives the screen and the device
   handle so it can shell out to `idb`, `adb shell input`, or your own UI
   automation.

1.3 **Nothing**, in which case it prompts you to drive the app by hand and press
   Enter before each capture. Slow, but it gets a listing shipped today and the
   captures are reusable — `--skip-capture` reframes them as often as you like.

Native apps often need longer than the 900 ms default to settle after a launch or
a deep link. Raise `settleDelay` if a capture lands mid-transition.

## How it works

1.1 **Capture.** One of the sources above produces a PNG per screen.

1.2 **Status bar.** Native captures already have a real one. A browser capture has
   none, so the page is captured shorter by exactly the status bar's height and a
   synthetic strip is stacked on top. The strip samples the colour of your app's
   top row so it disappears into the design, and no app content ends up hidden
   behind it.

1.3 **Frame.** The capture is composited into a device bezel from
   [`fastlane/frameit-frames`](https://github.com/fastlane/frameit-frames),
   clipped through a mask traced from the frame's own alpha channel so the
   rounded corners and the Dynamic Island cut the screenshot exactly the way the
   hardware does.

1.4 **Compose.** The framed device and its caption are laid out at the store's
   output size. The backdrop is an SVG rasterised by librsvg, the type is rendered
   from an installed family or a supplied font file and measured before placement, and the device is resampled by
   sharp. Captions reflow and rebalance per locale rather than being baked into a
   fixed-width bitmap, and none of it needs a browser.

1.5 **Deliver.** Assets are flattened, validated, and staged under `fastlane/`.

## Configuration

Everything below `screens` and `captions` is optional.

```ts
import { defineConfig } from 'ai-appshots';

import en from './captions/en.json' with { type: 'json' };

export default defineConfig({
  // Browser captures only.
  baseUrl: process.env.APP_URL ?? 'http://localhost:3000',

  // Where output and caches go. Relative to the config file.
  outDir: 'screenshots',
  fastlaneDir: 'fastlane',

  screens: [
    {
      id: 'dashboard',
      // A path for browser captures, a deepLink for native ones.
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
    // Real installed families. A `linear-gradient` above takes an angle or a
    // `to <side>`, with hex, rgb() or rgba() stops.
    sansFont: '"Inter", "Helvetica Neue", sans-serif',
    showIndex: true,
  },

  // Browser captures: signs in once, and the session is reused per target.
  async auth({ page }) {
    await page.goto('/login');
    await page.getByLabel('Email').fill(process.env.DEMO_EMAIL!);
    await page.getByLabel('Password').fill(process.env.DEMO_PASSWORD!);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL((url) => !url.pathname.startsWith('/login'));
  },

  // Browser captures: runs before each screen navigates.
  async prepare({ context, page, screen }) {
    await context.addCookies([
      { name: 'theme', value: screen.theme, domain: 'localhost', path: '/' },
    ]);
    await page.route('**/api/telemetry', (route) => route.abort());
  },

  // Native captures: drives the app when a screen has no deepLink.
  async navigate({ screen, device, platform }) {
    if (platform === 'ios') {
      await myUiAutomation.tapTab(device, screen.id);
    }
  },
});
```

`targets` can be overridden too, if you need a device the defaults do not cover.
Use `createDeviceTarget`, extend `DEFAULT_TARGETS`, or write your own `TargetSpec[]`.

## CLI

```
ai-appshots [options]

  --config <path>    Config file. Default: nearest ai-appshots.config.ts.
  --base-url <url>   Override the app URL from the config.
  --target <id>      Only this target (repeatable). Default: all.
  --screen <id>      Only this screen (repeatable). Default: all.
  --locale <code>    Caption locale (repeatable). Default: all configured.
  --skip-capture     Recompose from the existing raw captures.
  --skip-compose     Capture only.
  --fresh-auth       Ignore the cached session and sign in again.
  --list-devices     List profiles, frame colors and capture sizes without a config.
```

`--skip-capture` is the one to know: iterating on copy or colours reuses the
captures already on disk, so the loop is seconds rather than minutes. That matters
more for native, where a capture pass means booting a simulator.

To capture the same app two ways — headless for speed, a real simulator to check
fidelity before a listing refresh — keep a second config that overrides only
`capture` and select it with `--config`.

## Working with an agent

The config is the whole interface, which makes this a good tool to hand to a
coding agent. Useful things to ask for:

1.1 "Add a screen for the billing page and write a caption for it."

1.2 "Rewrite the captions to lead with the benefit, keep them under six words."

1.3 "Try the halo in our accent colour and show me the iPhone set."

Each is a small edit to one file followed by `ai-appshots --skip-capture`, and the
diff is reviewable as images in a pull request. The library API is exported too,
if you would rather script the pipeline than shell out:

```ts
import { loadConfig, parseOptions, run } from 'ai-appshots';
```

Note that the package ships TypeScript source and is loaded through
[jiti](https://github.com/unjs/jiti), so importing it from plain Node without a
TypeScript loader will not work. The CLI handles this for you.

## Prior art

[fastlane](https://fastlane.tools) `snapshot` and `frameit` cover the same ground
for native apps, and if you already run them happily there is little reason to
switch. The differences that motivated this: capture is a driver rather than a
requirement, so native, web and pre-made screenshots go through one pipeline;
composition is SVG and Pango through sharp instead of ImageMagick, so captions
reflow and the layout uses your own design tokens; and it needs no UI-test suite
to get started. Deliberately
not reimplemented is running your tests — `xcodebuild test` is fastlane's job, and
the `import` driver consumes whatever it produces. The named hardware bezels come from
fastlane's frame set; custom PNGs, generic bezels, and Mac windows are also supported.

## License

MIT
