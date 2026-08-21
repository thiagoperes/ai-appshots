import type { BrowserContext, Page } from 'playwright';

export type StoreId = 'app-store' | 'play-store';

export type BrowserEngine = 'webkit' | 'chromium';

export type ThemeName = 'light' | 'dark';

export type Platform = 'ios' | 'android' | 'macos';

/** @deprecated Use {@link Platform}. */
export type StatusBarPlatform = Platform;

export interface Size {
  readonly width: number;
  readonly height: number;
}

/**
 * A device bezel sourced from `fastlane/frameit-frames`. The screen area of
 * those PNGs is transparent, and `offsets.json` in the same directory gives the
 * top-left corner and width of that area, which is what we composite into.
 */
export interface FrameitFrame {
  readonly kind: 'frameit';
  /** Exact PNG filename under `latest/`, including the colour suffix. */
  readonly file: string;
  /**
   * Key into the `portrait` map of `offsets.json`. It does not follow from the
   * filename: the iPad frame is stored as `iPad Pro (12.9-inch) (4th
   * generation) Space Gray.png` but keyed as `iPad Pro (12.9 inch) (4th
   * generation)`.
   */
  readonly offsetKey: string;
}

/** A neutral bezel drawn in CSS, for devices with no usable frameit asset. */
export interface CssFrame {
  readonly kind: 'css';
  /** Bezel thickness as a fraction of the screenshot width. */
  readonly bezelRatio: number;
  /** Corner radius as a fraction of the screenshot width. */
  readonly radiusRatio: number;
  readonly color: string;
}

/** Leaves desktop captures unframed. */
export interface NoFrame {
  readonly kind: 'none';
}

export type FrameSpec = FrameitFrame | CssFrame | NoFrame;

export interface TargetSpec {
  readonly id: string;
  readonly store: StoreId;
  readonly platform: Platform;
  /**
   * Where captures for this target come from. Falls back to the config's
   * `capture` setting, and finally to a headless browser.
   */
  readonly capture?: CaptureSpec;
  /**
   * Logical size of the device screen, in points. Multiplied by
   * `deviceScaleFactor` this must equal the pixel size the frame expects, which
   * the frame loader asserts at runtime. The same arithmetic describes a native
   * device: an iPhone 17 Pro Max is 440x956pt at 3x, or 1320x2868px.
   */
  readonly viewport: Size;
  readonly deviceScaleFactor: number;
  /** Final store asset size, in pixels. */
  readonly output: Size;
  readonly frame: FrameSpec;
  /** Caption size as a fraction of output width. */
  readonly captionScale: number;
  /**
   * Space between the bottom of the caption and the top of the device, as a
   * fraction of canvas height. The caption block itself is sized by its content
   * and the device takes everything left over.
   */
  readonly captionGapRatio: number;
  /**
   * Safe-area top inset, in points. A browser capture has no status bar, so the
   * page is captured this much shorter and a synthetic strip completes the
   * screen. Native captures already contain the real one and this is only used
   * to check their height. Set to 0 to disable synthesis entirely.
   */
  readonly statusBarHeight: number;
  /**
   * Synthetic status bar text size, in points. It does not follow from the
   * strip height: a notched iPhone reserves 59pt for a 17pt clock, while an
   * iPad fits a 13pt clock into 24pt.
   */
  readonly statusBarTextSize: number;
  /** Subdirectory used when arranging assets for fastlane. */
  readonly deliveryKind: 'ios' | 'macos' | 'phone' | 'tablet';
}

export interface ScreenSpec {
  readonly id: string;
  /**
   * Where the screen lives. A browser capture reads it as a path relative to
   * `baseUrl`; the import driver reads it as a file name. Native drivers use
   * `deepLink` instead.
   */
  readonly path?: string;
  /**
   * URL that navigates a native app to this screen, opened with `simctl
   * openurl` or an `android.intent.action.VIEW` intent. Without it, native
   * drivers fall back to the config's `navigate` hook, and without that to
   * prompting you to drive the app by hand.
   */
  readonly deepLink?: string;
  readonly theme: ThemeName;
  /** Targets to skip, for screens that only make sense on one form factor. */
  readonly excludeTargets?: readonly string[];
  /**
   * Selectors that must be visible before capturing. Prevents shooting a
   * skeleton or a half-loaded chart. Browser captures only.
   */
  readonly waitFor?: readonly string[];
  /**
   * Selectors hidden before capture, e.g. cookie banners or debug overlays.
   * Browser captures only.
   */
  readonly hide?: readonly string[];
}

export interface Caption {
  readonly kicker?: string;
  readonly title: string;
}

export type CaptionBundle = Readonly<Record<string, Caption>>;

export interface FrameAsset {
  /** Absolute path to the cached bezel PNG. */
  readonly path: string;
  readonly size: Size;
  /** Top-left corner of the transparent screen area within the bezel. */
  readonly screenOffset: { readonly x: number; readonly y: number };
  readonly screenSize: Size;
  /**
   * Raw RGBA mask of the screen cutout, `screenSize` big. Alpha is the coverage
   * of the rounded screen at that pixel, so compositing a capture through it
   * clips the square corners the device does not actually show.
   */
  readonly screenMask: Buffer;
}

/** Colours for one canvas theme. Every value is a CSS colour or gradient. */
export interface CanvasPalette {
  /** Solid fallback behind everything. */
  readonly base: string;
  /** Full-canvas gradient painted over `base`. */
  readonly sweep: string;
  /** Accent colour of the bloom behind the device. */
  readonly halo: string;
  /** Colour of the fine grid overlay. */
  readonly grid: string;
  readonly title: string;
  readonly kicker: string;
  /** Colour of the rules either side of the eyebrow. */
  readonly rule: string;
}

export interface CanvasTheme {
  readonly dark: CanvasPalette;
  readonly light: CanvasPalette;
  readonly monoFont: string;
  readonly sansFont: string;
  /** Renders the `[ 01 ]` index before the kicker. */
  readonly showIndex: boolean;
}

/** Captures a running browser at the target's viewport. */
export interface WebCapture {
  readonly kind: 'web';
  /** Defaults to WebKit for iOS targets and Chromium for Android ones. */
  readonly engine?: BrowserEngine;
}

/** Captures a real iOS build running in the Simulator, via `xcrun simctl`. */
export interface IosSimulatorCapture {
  readonly kind: 'ios-simulator';
  /**
   * Simulator device name, or an ordered list of acceptable names. The first
   * available one wins, and an already-booted device is preferred.
   */
  readonly device: string | readonly string[];
  /** Bundle identifier to launch. Omit to capture whatever is on screen. */
  readonly bundleId?: string;
  /** `.app` bundle to install before launching. */
  readonly appPath?: string;
  /**
   * Creates the simulator when no instance matches, which is the normal state of
   * a fresh machine or CI runner. On by default.
   */
  readonly createIfMissing?: boolean;
  /**
   * Pins the status bar to 9:41, full battery and full signal. Apple has shown
   * that time in iPhone marketing since the original keynote.
   */
  readonly marketingStatusBar?: boolean;
  /** Brings the Simulator window forward. Off by default; capture is headless. */
  readonly showWindow?: boolean;
}

/** Captures a real Android build on an emulator or attached device, via `adb`. */
export interface AndroidEmulatorCapture {
  readonly kind: 'android-emulator';
  /** `adb` device serial. Defaults to the only attached device. */
  readonly serial?: string;
  /** AVD to boot when nothing is attached. */
  readonly avd?: string;
  /** Application id to launch. Omit to capture whatever is on screen. */
  readonly appId?: string;
  /** APK to install before launching. */
  readonly apkPath?: string;
  /**
   * Puts SystemUI into demo mode so the status bar shows a fixed clock, a full
   * battery and no notification icons.
   */
  readonly marketingStatusBar?: boolean;
}

/**
 * Reads screenshots produced elsewhere — XCUITest, `fastlane snapshot`,
 * Espresso, or by hand — and runs them through framing and delivery.
 */
export interface ImportCapture {
  readonly kind: 'import';
  /** Directory holding the source images, relative to the config file. */
  readonly dir: string;
  /**
   * Resolves the file for one screen, relative to `dir`. Defaults to
   * `<target>/<screen>.png`. `fastlane snapshot` names its output
   * `<locale>/<device>-<screen>.png`.
   */
  readonly file?: (context: ImportFileContext) => string;
}

export interface ImportFileContext {
  readonly screen: ScreenSpec;
  readonly target: TargetSpec;
  readonly locale: string;
}

/** Any capture strategy of your own. */
export interface CustomCapture {
  readonly kind: 'custom';
  /** True when the images already contain the device's own status bar. */
  readonly includesStatusBar: boolean;
  readonly open: (context: CaptureContext) => Promise<CaptureSession>;
}

export type CaptureSpec =
  | WebCapture
  | IosSimulatorCapture
  | AndroidEmulatorCapture
  | ImportCapture
  | CustomCapture;

export interface CaptureContext {
  readonly target: TargetSpec;
  readonly config: ResolvedConfig;
}

export interface CaptureSession {
  /**
   * Returns a PNG of one screen. Full-screen when the driver reports
   * `includesStatusBar`, otherwise the app area only.
   */
  readonly capture: (screen: ScreenSpec, locale: string) => Promise<Buffer>;
  readonly close: () => Promise<void>;
}

export interface CaptureDriver {
  readonly kind: CaptureSpec['kind'];
  /** Whether captures already contain the device's own status bar. */
  readonly includesStatusBar: boolean;
  /** Runs once per run, before any target is opened. */
  readonly setup?: (
    config: ResolvedConfig,
    options: { readonly freshAuth: boolean },
  ) => Promise<void>;
  readonly open: (context: CaptureContext) => Promise<CaptureSession>;
}

/**
 * Drives a native app to one screen when it has no deep link. Receives the
 * device handle so it can shell out to `simctl`, `idb`, or `adb`.
 */
export interface NavigateContext {
  readonly screen: ScreenSpec;
  readonly target: TargetSpec;
  readonly locale: string;
  /** Simulator UDID or `adb` serial. */
  readonly device: string;
  readonly platform: Platform;
}

export interface AuthContext {
  readonly page: Page;
  readonly baseUrl: string;
}

export interface PrepareContext {
  readonly context: BrowserContext;
  readonly page: Page;
  readonly screen: ScreenSpec;
  readonly target: TargetSpec;
  readonly baseUrl: string;
}

export interface AiAppshotsConfig {
  /**
   * Origin of the running app, e.g. `http://localhost:3000`. Required for
   * browser captures and unused by every other capture source.
   */
  readonly baseUrl?: string;
  /** Base for relative paths below. Defaults to the config file's directory. */
  readonly rootDir?: string;
  /** Where raw and framed output is written. Default `<rootDir>/screenshots`. */
  readonly outDir?: string;
  /** Frame and session cache. Default `<outDir>/.cache`. */
  readonly cacheDir?: string;
  /** Fastlane directory to stage assets into. Default `<rootDir>/fastlane`. */
  readonly fastlaneDir?: string;
  /** Device and store matrix. Defaults to `DEFAULT_TARGETS`. */
  readonly targets?: readonly TargetSpec[];
  /**
   * Where captures come from, for targets that do not specify their own. Give
   * one spec for everything, or one per platform when a native iOS build and a
   * native Android build need different tooling. Defaults to a headless
   * browser.
   */
  readonly capture?: CaptureSpec | Partial<Record<Platform, CaptureSpec>>;
  readonly screens: readonly ScreenSpec[];
  /** Captions keyed by locale, then by screen id. */
  readonly captions: Readonly<Record<string, CaptionBundle>>;
  readonly theme?: Partial<CanvasTheme>;
  /** Selectors hidden on every screen. Default hides the Next.js dev overlay. */
  readonly hide?: readonly string[];
  /** Maps caption locales to store locale directories. Default `en` → `en-US`. */
  readonly storeLocales?: Readonly<Record<string, string>>;
  /**
   * Signs the browser in. Called once per run against a fresh context whose
   * cookies are then reused for every target. Omit for apps with no login.
   */
  readonly auth?: (context: AuthContext) => Promise<void>;
  /**
   * Runs after the page is created but before it navigates. The place to set
   * theme cookies, seed local storage, or stub network calls. Browser captures
   * only.
   */
  readonly prepare?: (context: PrepareContext) => Promise<void>;
  /**
   * Drives a native app to a screen that has no `deepLink`. Without either,
   * native drivers prompt you to navigate by hand before each capture.
   */
  readonly navigate?: (context: NavigateContext) => Promise<void>;
  /** Extra settle time before each capture, in ms. Default 900. */
  readonly settleDelay?: number;
}

export interface ResolvedPaths {
  readonly root: string;
  readonly raw: string;
  readonly framed: string;
  readonly frameCache: string;
  readonly authState: string;
  readonly fastlane: string;
}

export interface ResolvedConfig extends AiAppshotsConfig {
  readonly baseUrl: string;
  readonly targets: readonly TargetSpec[];
  readonly theme: CanvasTheme;
  readonly hide: readonly string[];
  readonly storeLocales: Readonly<Record<string, string>>;
  readonly settleDelay: number;
  readonly paths: ResolvedPaths;
}
