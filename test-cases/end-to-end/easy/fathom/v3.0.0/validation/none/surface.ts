// Fathom — driving a page, and reading the surface off it. CASE-PROVIDED.
//
// WHY THESE FIGURES LIVE IN A MODULE OF THEIR OWN. Both halves of this project
// open pages of the build and look for the same global on them, and neither can
// import the other. `harness.ts` runs inside a suite worker and imports vitest's
// per-test runtime; `globalSetup.ts` runs once in the runner's own process,
// before any of that runtime exists, and importing it there is not allowed. So
// the handle, the ceilings and the poll sit here, where the worker and the runner
// read the same numbers rather than each keeping a copy that can drift.
//
// EVERY CEILING HERE IS A CEILING ON THE HOST. Not one of them is a measurement:
// each ends the instant the thing it waits for happens, so a conforming build
// pays none of them however high they are set, and what they really bound is the
// cost of a build that will never answer. They are set well past what a loaded
// machine costs rather than close to what an idle one does, because a build
// failed for crossing one has been failed for the load average.

import type { Page } from "playwright";

/**
 * The handle an engineless build installs its surface on.
 *
 * `specs/instrumentation.md` fixes the name: the surface is `window.__fathom`,
 * installed on every build and inert during normal play.
 */
export const HANDLE = "__fathom";

/**
 * How long the surface is waited for before the build is called non-conformant.
 *
 * Generous against a conformant build and cheap against one: the wait is a poll
 * that returns the instant the global appears, and a build installs it while its
 * entry module runs, so a page that has fired `load` has either installed it
 * already or is not going to.
 *
 * A MINUTE RATHER THAN FIVE SECONDS, because the ceiling is not really on the
 * build: it is on the host. This project holds four pages of one browser open at
 * once and the machine that runs it is running a model's build under it — and, on
 * a shared machine, whatever else that machine is doing. A page can be starved of
 * processor long enough for a perfectly conforming build's entry module to take
 * tens of seconds of wall clock to run, and a build failed for that has been
 * failed for the load average. Five seconds was observed to fail such a build once
 * in a suite run; fifteen is not obviously enough either, and a minute costs a
 * healthy build nothing at all, because the poll returns the instant the global
 * appears.
 *
 * WHAT PAYS IT, AND HOW OFTEN. A ceiling this generous can only be afforded ONCE
 * for the whole run: a hundred and twenty-five harnesses each waiting a minute is
 * over half an hour of waiting, which is past the cap on the whole validator run —
 * and a build that blows that cap has every point recorded as `ran=false`, which
 * tells a reviewer far LESS than a hundred and six failures would. So
 * `globalSetup.ts`'s `probeSurfaceAbsent` spends the minute once, and a run that
 * establishes there is no surface there refuses the rest immediately instead of
 * buying the same answer a hundred and twenty-five times. See
 * `harness.ts`'s `readSurfaceFault`.
 */
export const SURFACE_TIMEOUT_MS = 60_000;

/**
 * How many looks at a freshly loaded page it takes to conclude there is no
 * surface, for the run-wide answer `globalSetup.ts` settles.
 *
 * TWO, BECAUSE THIS ONE ANSWER STANDS IN FOR ALL OF THEM. A per-harness ceiling
 * that goes off wrongly costs one point; a run-wide one that goes off wrongly
 * fails every point in the project, so it is worth a second look before it is
 * believed. Each look is a page of its own, loaded from scratch and given the
 * whole of {@link SURFACE_TIMEOUT_MS}, so two of them is two full minutes of a
 * build declining to install a global its entry module installs synchronously.
 * A healthy build never reaches the second, because the first returns the instant
 * the global appears.
 */
export const ABSENCE_LOOKS = 2;

/**
 * The ceiling on every operation PLAYWRIGHT itself times against a page.
 *
 * WHY THIS CONSTANT EXISTS. Playwright's library defaults leave a deadline on
 * anything it has to wait for — a navigation, a screenshot — and that default is
 * thirty seconds. Nothing here asked for it, so nothing here reasoned about it,
 * and it is the same mistake {@link SURFACE_TIMEOUT_MS} was raised to correct.
 * `page.goto` runs in the `beforeEach` of every check file in this project, so a
 * host that took a moment too long to serve a static file does not cost one point
 * — it fails the hook, and every point the file decides reads `ran=false`, which
 * tells a reviewer nothing at all. `page.screenshot` is the same shape one still
 * at a time: a build whose canvas the compositor was slow to hand over is a build
 * failed for the load average.
 *
 * A minute, for the reason the surface ceiling is a minute, and inside the hook
 * and test budgets `vitest.config.ts` states, so a page that genuinely never
 * loads still fails there rather than on the runner.
 */
export const PAGE_DEADLINE_MS = 60_000;

/**
 * How often a wait for something in the page looks, in milliseconds.
 *
 * WHY IT IS NOT PLAYWRIGHT'S DEFAULT. Playwright schedules `waitForFunction` on
 * the page's own `requestAnimationFrame` unless it is told otherwise, and a page
 * the host has starved of processor is a page that is starved of animation
 * frames. That makes the OBSERVATION of a surface as slow as the machine is —
 * a build can have installed its global promptly and still be seen to install it
 * late, purely because nothing was scheduling the look. The reading is meant to
 * be of the build, so it is taken on a timer of its own instead.
 *
 * A tenth of a second, which is far finer than any of the ceilings here and
 * costs a healthy build one look.
 */
export const POLL_MS = 100;

/** What a build owes here, as the fault a check reports when it is not owed. */
export function surfaceAbsent(): string {
  return `window.${HANDLE} was still absent ${SURFACE_TIMEOUT_MS / 1000}s after the page loaded`;
}

/**
 * Wait for `page` to install the surface, and say whether it did.
 *
 * The wait is a poll rather than a sleep, so it ends the instant the global
 * appears and a conforming build pays none of the ceiling.
 */
export async function waitForSurface(
  page: Page,
  timeoutMs: number = SURFACE_TIMEOUT_MS,
): Promise<boolean> {
  try {
    await page.waitForFunction(
      (handle) =>
        typeof (window as never)[handle] === "object" &&
        (window as never)[handle] !== null,
      HANDLE,
      { timeout: timeoutMs, polling: POLL_MS },
    );
    return true;
  } catch {
    return false;
  }
}
