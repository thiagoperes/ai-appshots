import { access } from 'node:fs/promises';

import { chromium, webkit } from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';

import { pageViewport } from './frames';
import { info, warn } from './log';
import { ensureParentDir } from './paths';
import type {
  BrowserEngine,
  ResolvedConfig,
  ScreenSpec,
  TargetSpec,
} from './types';

/**
 * Animations and blinking carets are the main source of diff noise between
 * runs, and a half-played transition looks like a rendering bug in a store
 * listing.
 */
const FREEZE_STYLES = `
  *, *::before, *::after {
    animation-duration: 0s !important;
    animation-delay: 0s !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0s !important;
    transition-delay: 0s !important;
    caret-color: transparent !important;
    scroll-behavior: auto !important;
  }
`;

const ENGINES = { webkit, chromium } as const;

export async function launchBrowser(engine: BrowserEngine): Promise<Browser> {
  return ENGINES[engine].launch();
}

async function hasStoredAuth(config: ResolvedConfig) {
  try {
    await access(config.paths.authState);

    return true;
  } catch {
    return false;
  }
}

/**
 * Runs the config's `auth` hook once and persists its cookies so each target
 * does not repeat the flow. The saved state holds a live session for whichever
 * account you captured with, so it belongs in an ignored directory.
 */
export async function createAuthState(
  engine: BrowserEngine,
  config: ResolvedConfig,
  reuseAuth: boolean,
) {
  if (!config.auth) {
    return;
  }

  if (reuseAuth && (await hasStoredAuth(config))) {
    info('reusing cached auth state');

    return;
  }

  const browser = await launchBrowser(engine);

  try {
    const context = await browser.newContext({ baseURL: config.baseUrl });
    const page = await context.newPage();

    await config.auth({ page, baseUrl: config.baseUrl });

    await ensureParentDir(config.paths.authState);
    await context.storageState({ path: config.paths.authState });
    await context.close();

    info('signed in');
  } finally {
    await browser.close();
  }
}

export async function createContext(
  browser: Browser,
  target: TargetSpec,
  config: ResolvedConfig,
): Promise<BrowserContext> {
  return browser.newContext({
    baseURL: config.baseUrl,
    viewport: pageViewport(target),
    deviceScaleFactor: target.deviceScaleFactor,
    isMobile: target.deliveryKind !== 'tablet',
    hasTouch: true,
    reducedMotion: 'reduce',
    storageState: (await hasStoredAuth(config))
      ? config.paths.authState
      : undefined,
  });
}

/**
 * Hides chrome that has no place in a store listing. Done in CSS rather than by
 * removing nodes, so anything that mounts late — a dev overlay, a consent
 * banner on a timer — is covered too.
 */
function hideStyles(config: ResolvedConfig, screen: ScreenSpec) {
  const selectors = [...config.hide, ...(screen.hide ?? [])];

  if (!selectors.length) {
    return '';
  }

  return `${selectors.join(', ')} { display: none !important; }`;
}

async function settle(page: Page, screen: ScreenSpec, config: ResolvedConfig) {
  for (const selector of screen.waitFor ?? []) {
    await page.locator(selector).first().waitFor({
      state: 'visible',
      timeout: 45_000,
    });
  }

  await page.evaluate(() => {
    window.scrollTo(0, 0);

    return document.fonts.ready;
  });
  await page.waitForLoadState('networkidle').catch(() => undefined);
  // Lets late layout shifts from charts and images settle before shooting.
  await page.waitForTimeout(config.settleDelay);
}

/**
 * Warns when a screen did not end up where it was pointed. Usually an expired
 * session bouncing the run to a login page, which otherwise produces a set of
 * perfectly framed sign-in forms.
 */
function checkLanding(page: Page, screen: ScreenSpec, config: ResolvedConfig) {
  const landed = new URL(page.url()).pathname;
  const requested = new URL(screen.path, config.baseUrl).pathname;

  if (landed === requested) {
    return;
  }

  warn(
    `"${screen.id}" redirected to ${landed}, expected ${requested}. ` +
      `A cached session may have expired — rerun with --fresh-auth.`,
  );
}

export async function captureScreen(
  context: BrowserContext,
  screen: ScreenSpec,
  target: TargetSpec,
  config: ResolvedConfig,
): Promise<Buffer> {
  const page = await context.newPage();

  try {
    await page.emulateMedia({ colorScheme: screen.theme });

    await config.prepare?.({
      context,
      page,
      screen,
      target,
      baseUrl: config.baseUrl,
    });

    await page.goto(screen.path, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await page.addStyleTag({
      content: `${FREEZE_STYLES}\n${hideStyles(config, screen)}`,
    });
    await settle(page, screen, config);

    checkLanding(page, screen, config);

    return await page.screenshot({ type: 'png', animations: 'disabled' });
  } finally {
    await page.close();
  }
}
