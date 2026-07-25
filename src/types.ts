import type { BrowserContext, Page } from 'playwright';

export type StoreId = 'app-store' | 'play-store';

export type BrowserEngine = 'webkit' | 'chromium';

export type ThemeName = 'light' | 'dark';

export type StatusBarPlatform = 'ios' | 'android';

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

export type FrameSpec = FrameitFrame | CssFrame;

export interface TargetSpec {
  readonly id: string;
  readonly store: StoreId;
  readonly engine: BrowserEngine;
  /**
   * CSS viewport of the device screen. Multiplied by `deviceScaleFactor` this
   * must equal the pixel size the frame expects, which the frame loader asserts
   * at runtime.
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
   * Height of the synthetic status bar, in CSS pixels. The page is captured
   * this much shorter so the strip completes the screen rather than covering
   * the app's own header. Set to 0 to disable.
   */
  readonly statusBarHeight: number;
  /**
   * Status bar text size in CSS pixels. It does not follow from the strip
   * height: a notched iPhone reserves 59pt for a 17pt clock, while an iPad fits
   * a 13pt clock into 24pt.
   */
  readonly statusBarTextSize: number;
  readonly statusBarPlatform: StatusBarPlatform;
  /** Subdirectory used when arranging assets for fastlane. */
  readonly deliveryKind: 'ios' | 'phone' | 'tablet';
}

export interface ScreenSpec {
  readonly id: string;
  /** Path relative to the app base URL. */
  readonly path: string;
  readonly theme: ThemeName;
  /** Targets to skip, for screens that only make sense on one form factor. */
  readonly excludeTargets?: readonly string[];
  /**
   * Selectors that must be visible before capturing. Prevents shooting a
   * skeleton or a half-loaded chart.
   */
  readonly waitFor?: readonly string[];
  /** Selectors hidden before capture, e.g. cookie banners or debug overlays. */
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

export interface StoreshotConfig {
  /** Origin of the running app, e.g. `http://localhost:3000`. */
  readonly baseUrl: string;
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
   * theme cookies, seed local storage, or stub network calls.
   */
  readonly prepare?: (context: PrepareContext) => Promise<void>;
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

export interface ResolvedConfig extends StoreshotConfig {
  readonly targets: readonly TargetSpec[];
  readonly theme: CanvasTheme;
  readonly hide: readonly string[];
  readonly storeLocales: Readonly<Record<string, string>>;
  readonly settleDelay: number;
  readonly paths: ResolvedPaths;
}
