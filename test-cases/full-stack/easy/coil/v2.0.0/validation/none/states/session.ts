// Coil — opening a second session of the same build, for the two points about
// what a FRESHLY LOADED game holds. CASE-PROVIDED.
//
// WHY THIS EXISTS AT ALL. Every other check reads the game through a harness, and
// a harness takes the game off the wall clock and RESETS it before it hands the
// page over, so the first state a check can see through one is the state a reset
// leaves. Two points are about the state a LOAD leaves instead:
// `states/opens-on-title` ("read the screen and the highlight before any input")
// and `scoring/session-starts-fresh` ("nothing about a previous session is
// carried across"). A reset restores the title and a best of `0` whatever the
// build did at load, so reading either after one would decide the reset rather
// than the load.
//
// So this opens a page of its own on the same build, in the same browser context
// as the harness that asked for it — the same origin, the same storage, the same
// everything a build could have used to carry something across — and reads
// `snapshot()` before anything at all touches the game. The page is the caller's
// to close.
//
// It lives beside the `states` suites because that is where the load-time reading
// is chiefly about; `scoring/session-starts-fresh` reaches across for it rather
// than keeping a second copy.

import type { Page } from "playwright";
import {
  HANDLE,
  failSurface,
  type CoilSnapshot,
  type Harness,
} from "../harness";

/** How long a freshly loaded page is given to install its surface. */
const SURFACE_TIMEOUT_MS = 5_000;

/** A second session of the same build, and what it held before anything ran. */
export interface FreshSession {
  /** The page it loaded in. The caller closes it. */
  page: Page;
  /** `snapshot()` as the loaded game reported it, before any input or reset. */
  snapshot: CoilSnapshot;
}

/**
 * Load the build again, in a page of its own, and read what it opened holding.
 *
 * A build that never installs its surface fails through {@link failSurface}, the
 * same verdict every other check reaches on one, rather than timing out.
 */
export async function openFreshSession(h: Harness): Promise<FreshSession> {
  const page = await h.page.context().newPage();
  try {
    await page.goto(h.page.url(), { waitUntil: "load" });
    await page.waitForFunction(
      (handle) =>
        typeof (window as never)[handle] === "object" &&
        (window as never)[handle] !== null,
      HANDLE,
      { timeout: SURFACE_TIMEOUT_MS },
    );
  } catch {
    await page.close().catch(() => undefined);
    return failSurface(
      `a second session of the same build had no window.${HANDLE} ` +
        `${SURFACE_TIMEOUT_MS / 1000}s after the page loaded`,
    );
  }
  const snapshot = (await page.evaluate(
    (handle) =>
      (window as unknown as Record<string, { snapshot(): unknown }>)[
        handle
      ].snapshot(),
    HANDLE,
  )) as CoilSnapshot;
  return { page, snapshot };
}
