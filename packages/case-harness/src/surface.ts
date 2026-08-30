// The debug and automation surface a build was told to install, and what a check
// lands on when it did not.

import type { Page } from "playwright";
import { fail } from "./assert";

/**
 * How long the surface is waited for before the build is called non-conformant.
 *
 * Generous against a conformant build and cheap against one: the wait is a poll
 * that returns the instant the global appears, and a build installs it while its
 * entry module runs, so a page that has fired `load` has either installed it
 * already or is not going to. What the ceiling really bounds is the cost of a
 * build with no surface at all, which pays it once per harness — and there is a
 * cap on the whole suite run, so a wait long enough to exhaust it would turn
 * "every point this decides failed" into "the validators did not run", which
 * tells a reviewer far less. A case that loads a produced asset set before it
 * installs the surface raises it in its own config.
 */
export { DEFAULT_SURFACE_TIMEOUT_MS as SURFACE_TIMEOUT_MS } from "./config";

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
 */
export async function readSurfaceFault(
  page: Page,
  handle: string,
  requiredOps: readonly string[],
  timeoutMs: number,
): Promise<string | null> {
  try {
    await page.waitForFunction(
      (name) =>
        typeof (window as never)[name] === "object" &&
        (window as never)[name] !== null,
      handle,
      { timeout: timeoutMs },
    );
  } catch {
    return `window.${handle} was still absent ${timeoutMs / 1000}s after the page loaded`;
  }
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
