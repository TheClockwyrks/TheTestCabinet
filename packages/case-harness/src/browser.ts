// The browser this worker drives, and the pages it opens in it.
//
// ONE SERVER, ONE BROWSER, ONE PAGE PER HARNESS. A case's `globalSetup` starts
// the server and the browser once for the whole project; this module connects to
// them from inside each suite's worker and opens a page per harness, so every
// check drives a build that has just started and no check can be affected by what
// the one before it pressed, opened or muted.
//
// THE INJECTED SCRIPTS COME FROM THIS PACKAGE, AND ONLY THE EXTRAS COME FROM THE
// CASE. The recorder and the audio probe are the HARNESS's own instrumentation,
// so they are read relative to this module and a case cannot end up injecting a
// stale copy of its own. Anything a case adds is read relative to the CASE's
// project root, which is the only directory it can name.

import { readFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inject } from "vitest";
import type { Browser, BrowserContext, Page } from "playwright";
import { connectChromium } from "./chromium";
import { PROVIDE_WS_KEY, type ResolvedConfig } from "./config";

/** This module's own directory, which is where {@link PAGE_SCRIPTS} sit. */
const PACKAGE_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * The scripts injected before any of the build's own script runs.
 *
 * Read with `readFileSync(join(...))` rather than through
 * `new URL("./page/…", import.meta.url)`: the bundler that loads this module has
 * a dedicated transform for that exact expression, and which branch it takes is
 * not something the harness should have to find out.
 */
const PAGE_SCRIPTS = ["recorder-init.js", "audio-init.js"] as const;

/** The window a context fixes: its CSS size and its device pixel ratio. */
export interface WindowShape {
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly dpr: number;
}

let browserPromise: Promise<Browser> | null = null;

/** The one browser this worker talks to, connected to on first use. */
async function sharedBrowser(config: ResolvedConfig): Promise<Browser> {
  browserPromise ??= connectChromium(inject(PROVIDE_WS_KEY), {
    slug: config.slug,
  });
  return browserPromise;
}

/**
 * One browser context per WINDOW SHAPE, shared by every harness of that shape in
 * this worker, and one PAGE per harness inside it.
 *
 * The split is what the init scripts force and what correctness wants. The
 * recorder and the audio probe are installed on the CONTEXT, so every page it
 * opens is instrumented before a line of the build's script runs, and a context
 * is also where the viewport and the device pixel ratio are fixed — which is the
 * one thing a check about the stage fit varies. Everything else about a harness
 * is the page: a fresh one opens on a build that has just started, with no key
 * held, no audio context opened, and the mute preference back off, which is a
 * stronger guarantee than any reset the surface offers, since `reset()`
 * deliberately leaves muting alone.
 *
 * A page per harness rather than a page reused between them, because a check may
 * legitimately hold two harnesses at once, and a harness whose page had been
 * taken over by a later one would read someone else's game while looking exactly
 * like it worked.
 */
const contexts = new Map<string, BrowserContext>();

/** Every page this worker opened, so none is left behind in the shared browser. */
export const openPages = new Set<Page>();

/**
 * The key a context is held under.
 *
 * The case's slug leads it because the scripts a context carries are the case's
 * as well as the shape's, and a key that named only the shape would hand a second
 * case's harness a context instrumented for the first.
 */
function shapeKey(slug: string, shape: WindowShape): string {
  return `${slug}:${shape.cssWidth}x${shape.cssHeight}@${shape.dpr}`;
}

/** Every script a context injects, in the order it injects them. */
function initScripts(config: ResolvedConfig): string[] {
  const own = PAGE_SCRIPTS.map((name) => join(PACKAGE_DIR, "page", name));
  const extra = config.extraInitScripts.map((name) =>
    isAbsolute(name) ? name : join(config.projectRoot, name),
  );
  return [...own, ...extra];
}

/** The context for a window of this shape, opened and instrumented on demand. */
export async function contextFor(
  shape: WindowShape,
  config: ResolvedConfig,
): Promise<BrowserContext> {
  const key = shapeKey(config.slug, shape);
  const existing = contexts.get(key);
  if (existing !== undefined) return existing;

  const browser = await sharedBrowser(config);
  const context = await browser.newContext({
    viewport: { width: shape.cssWidth, height: shape.cssHeight },
    deviceScaleFactor: shape.dpr,
  });
  for (const path of initScripts(config)) {
    await context.addInitScript(readFileSync(path, "utf8"));
  }
  contexts.set(key, context);
  return context;
}

/**
 * Shut everything this worker opened.
 *
 * Registered from a case's `setup.ts` as an `afterAll`, so a suite file never has
 * to think about it and a worker cannot leave a page behind in the shared
 * browser.
 */
export async function closeWorkerBrowser(): Promise<void> {
  for (const page of openPages) await page.close().catch(() => undefined);
  openPages.clear();
  for (const context of contexts.values()) {
    await context.close().catch(() => undefined);
  }
  contexts.clear();
  const browser = browserPromise;
  browserPromise = null;
  if (browser !== null) await (await browser).close().catch(() => undefined);
}
