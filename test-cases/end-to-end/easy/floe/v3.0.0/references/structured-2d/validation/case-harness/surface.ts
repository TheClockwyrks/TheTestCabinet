// The debug and automation surface a build was told to install, and what a check
// lands on when it did not.
//
// NOTHING IN THIS MODULE MAY IMPORT THE TEST RUNTIME. Both halves of a validator
// project look for the same global on a page of the same build, and neither can
// import the other: `harness.ts` runs inside a suite worker and imports vitest's
// per-test runtime, while `global-setup.ts` runs once in the runner's own
// process, before any of that runtime exists, where importing it is not allowed.
// So the ceilings, the poll and the two readings live here, where the worker and
// the runner read the same numbers rather than each keeping a copy that drifts.
//
// NONE OF THE CEILINGS HERE IS A MEASUREMENT. Each ends the instant the thing it
// waits for happens, so a conformant build pays none of them however high they
// are set, and what they really bound is the cost of a build that will never
// answer. They are set well past what a loaded machine costs rather than close to
// what an idle one does, because a build failed for crossing one has been failed
// for the load average.

import type { Page } from "playwright";
import { fail } from "./assert";

/**
 * How long the surface is waited for before the build is called non-conformant.
 *
 * Generous against a conformant build and cheap against one: the wait is a poll
 * that returns the instant the global appears, and a build installs it while its
 * entry module runs, so a page that has fired `load` has either installed it
 * already or is not going to — which is why {@link readSurfaceFault} takes one
 * look that does not wait at all before it reaches for this ceiling. A case that
 * loads a produced asset set before it installs the surface raises it in its own
 * config.
 *
 * WHAT PAYS IT, AND HOW OFTEN, is the whole reason the two mechanisms below
 * exist. A ceiling generous enough to survive a loaded host is fatal if every
 * harness of a surfaceless build pays it: Carom's project is 147 suite files and
 * more harnesses than that, so 15s apiece over eight workers is some five minutes
 * of pure waiting, and Gantry, whose ceiling is 90s, would spend nearly half an
 * hour. There is a cap on the whole validator run, and a run that blows it has
 * every point recorded as `ran=false` — "the validators did not run" rather than
 * "a hundred and six requirements went unmet", which tells a reviewer far less.
 * So the ceiling is paid at most once per worker ({@link SURFACE_RETRY_TIMEOUT_MS})
 * and, where a project's `globalSetup` was given the handle, once for the whole
 * run instead (`global-setup.ts`'s `probeSurfaceAbsent`).
 */
export { DEFAULT_SURFACE_TIMEOUT_MS as SURFACE_TIMEOUT_MS } from "./config";

/**
 * How often a wait for the surface looks, in milliseconds.
 *
 * WHY IT IS NOT PLAYWRIGHT'S DEFAULT. Playwright schedules `waitForFunction` on
 * the PAGE's own `requestAnimationFrame` unless it is told otherwise, and a page
 * the host has starved of processor is a page that is starved of animation
 * frames. That makes the OBSERVATION of a surface as slow as the machine is: a
 * build can have installed its global promptly and still be seen to install it
 * late, purely because nothing was scheduling the look — and worse, a build that
 * wedged or never scheduled a frame of its own would never be looked at again,
 * so the ceiling above would charge the build for a stall in its own rAF. The
 * reading is meant to be of the build, so it is taken on a timer of its own.
 *
 * A tenth of a second, which is far finer than any ceiling here and costs a
 * healthy build one look.
 */
export const SURFACE_POLL_MS = 100;

/**
 * The ceiling used once this worker has already watched the full one expire on
 * this build.
 *
 * The first harness of a surfaceless build pays the full wait; every harness
 * after it in the same worker pays this instead. Without it a build that installs
 * nothing would spend the whole suite run waiting, and "every point this decides
 * failed" would turn into "the validators did not run", which tells a reviewer
 * far less.
 *
 * Two seconds rather than nothing at all, because the claim it acts on is a claim
 * about the BUILD and this is what is left of the doubt: a page that installs its
 * surface a moment after `load` still gets twenty polls to do it in.
 */
export const SURFACE_RETRY_TIMEOUT_MS = 2_000;

/**
 * How many looks at a freshly loaded page it takes to conclude there is no
 * surface, for the run-wide answer `global-setup.ts` settles.
 *
 * TWO, BECAUSE THIS ONE ANSWER STANDS IN FOR ALL OF THEM. A per-harness ceiling
 * that goes off wrongly costs one point; a run-wide one that goes off wrongly
 * fails every point in the project, so it is worth a second look before it is
 * believed. Each look is a page of its own, loaded from scratch and given the
 * whole of the case's ceiling, so two of them is two full ceilings of a build
 * declining to install a global its entry module installs synchronously. A
 * healthy build never reaches the second, because the first returns the instant
 * the global appears.
 */
export const ABSENCE_LOOKS = 2;

/**
 * Whether a wait for the surface has already expired in this worker.
 *
 * It is a claim about the BUILD, so it stands only as long as nothing disproves
 * it: the next page that does produce a surface clears it, and the full ceiling
 * is back for every harness after that. Left latched it would be a claim about
 * the machine instead — one page that took too long on a busy host would cut
 * every later page's ceiling to two seconds, and a build whose surface arrives a
 * moment after `load` would lose points it had already earned.
 *
 * Module state, which is per WORKER: vitest runs each suite file in a worker that
 * shares no memory with the others, so the latch is only ever read by harnesses
 * that watched the wait it records. The run-wide answer is a different mechanism
 * with a different owner — see {@link ABSENCE_LOOKS}.
 */
let surfaceKnownAbsent = false;

/** Whether `page` carries the surface RIGHT NOW: one look, no waiting. */
async function surfaceInstalled(page: Page, handle: string): Promise<boolean> {
  return (
    page
      .evaluate(
        (name) =>
          typeof (window as never)[name] === "object" &&
          (window as never)[name] !== null,
        handle,
      )
      // A look that could not be TAKEN is not an answer. A page still navigating
      // has no execution context to ask, which says nothing about whether the
      // build installs a surface; the polled wait is what settles that, and it
      // survives a navigation where a single evaluation does not.
      .catch(() => false)
  );
}

/**
 * Wait for `page` to install the surface, and say whether it did.
 *
 * The wait is a poll rather than a sleep, so it ends the instant the global
 * appears and a conforming build pays none of the ceiling — and it is polled on
 * {@link SURFACE_POLL_MS} rather than on animation frames, so a page whose frames
 * are starved is still seen the moment it installs.
 *
 * Exported because `global-setup.ts`'s run-wide probe makes exactly this reading
 * on pages of its own, and the two must not drift apart.
 */
export async function waitForSurface(
  page: Page,
  handle: string,
  timeoutMs: number,
): Promise<boolean> {
  try {
    await page.waitForFunction(
      (name) =>
        typeof (window as never)[name] === "object" &&
        (window as never)[name] !== null,
      handle,
      { timeout: timeoutMs, polling: SURFACE_POLL_MS },
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * What the specification requires of the surface: the `Expected:` line of the
 * failure a build with no usable surface lands on every check that reaches for
 * it, beside the fault that says what was found.
 */
export function surfaceRequirement(handle: string, specPath: string): string {
  return (
    `a usable debug and automation surface on window.${handle} as soon as the ` +
    `game has initialized, carrying every operation ${specPath} requires`
  );
}

/**
 * Fail the running check on a fault — the harness's account of what is wrong with
 * the build's surface — paired with what the specification requires.
 */
export function makeFailSurface(requirement: string): (fault: string) => never {
  return (fault: string): never => fail(requirement, fault);
}

/**
 * What is wrong with the surface this page installed, or `null` when nothing is:
 * the surface never appeared, or it appeared without an operation the
 * specification requires.
 *
 * `loaded` is whether the page's navigation actually fired `load` before the
 * reading was taken, and it changes only what the fault SAYS. A page that never
 * fired `load` is not a page that loaded, and a reading that claimed otherwise
 * would send a reviewer looking for the wrong fault. It defaults to `true`, which
 * is the reading a caller that does not know makes today.
 *
 * `runWideAbsent` is the answer `global-setup.ts` already bought for the whole
 * run, injected by the caller (this module may not import the test runtime — see
 * the header). When it is set, the run has already looked {@link ABSENCE_LOOKS}
 * times, on pages of its own and for the whole of the ceiling, and waiting again
 * here would buy the same answer once per harness.
 */
export async function readSurfaceFault(
  page: Page,
  handle: string,
  requiredOps: readonly string[],
  timeoutMs: number,
  loaded = true,
  runWideAbsent = false,
): Promise<string | null> {
  if (runWideAbsent) {
    // The pages that spent the ceiling were the probe's, not this one, and they
    // did fire `load` — a navigation the probe could not complete makes it answer
    // "inconclusive" rather than "absent". So this sentence is about them.
    return `window.${handle} was still absent ${timeoutMs / 1000}s after the page loaded, on each of the ${ABSENCE_LOOKS} pages this run opened to settle it`;
  }
  // Said as it happened. A page that never fired `load` is not a page that
  // loaded, and a reading that claimed otherwise would send a reviewer looking
  // for the wrong fault. The figure the deadline that gave up on the navigation
  // was set to is `harness.ts`'s (`PAGE_DEADLINE_MS`) and is deliberately not
  // quoted here: this module cannot see it without importing the harness it is
  // imported BY, and a ceiling quoted from memory is how a comment starts lying.
  const since = loaded
    ? "after the page loaded"
    : "after the page was requested, which had not fired `load` by the time " +
      "the surface was asked for";
  // The common case, and the one that must not depend on how busy the machine
  // is: `load` has fired, so a build that installs its surface from its entry
  // module has already installed it, and one look settles it with no wait. A page
  // that never fired `load` gets the same look, and then the same wait: what this
  // reading requires is the surface, not the event.
  if (!(await surfaceInstalled(page, handle))) {
    const timeout = surfaceKnownAbsent ? SURFACE_RETRY_TIMEOUT_MS : timeoutMs;
    if (!(await waitForSurface(page, handle, timeout))) {
      surfaceKnownAbsent = true;
      // With the ceiling that was actually spent rather than the one the case
      // configured: after the first expiry in this worker that is two seconds,
      // and a fault that claimed fifteen would misdescribe the reading.
      return `window.${handle} was still absent ${timeout / 1000}s ${since}`;
    }
  }
  // A surface turned up, so whatever the earlier wait was, it was not a build
  // that installs none: the shortened ceiling is withdrawn.
  surfaceKnownAbsent = false;
  const missing = await page.evaluate(
    ([name, ops]) => {
      const target = (
        window as unknown as Record<string, Record<string, unknown>>
      )[name];
      return ops.filter((op) => typeof target?.[op] !== "function");
    },
    [handle, [...requiredOps]] as const,
  );
  if (missing.length > 0) {
    return `window.${handle} is installed but carries no ${missing
      .map((op) => `${op}()`)
      .join(", ")}`;
  }
  return null;
}

/**
 * A stand-in for a surface that is missing or incomplete: every operation on it
 * fails the check that reached for it, with the fault named.
 *
 * A proxy rather than a hand-written stub, so a check that reaches for anything
 * at all on a missing surface lands on the same named fault, rather than on a
 * `TypeError` several calls later.
 *
 * Keys that belong to the MACHINERY rather than to a check are answered with
 * `undefined` instead: awaiting a value probes `then`, and vitest's own error
 * formatting probes symbols and `constructor`. Failing those would replace the
 * verdict with noise from the machinery that was trying to report it.
 */
export function unexposedSurface<D extends object>(
  reason: string,
  failSurface: (fault: string) => never,
): D {
  return new Proxy({} as D, {
    get: (_target, property): unknown => {
      if (typeof property === "symbol") return undefined;
      if (property === "then" || property === "constructor") return undefined;
      return () => failSurface(reason);
    },
  });
}
