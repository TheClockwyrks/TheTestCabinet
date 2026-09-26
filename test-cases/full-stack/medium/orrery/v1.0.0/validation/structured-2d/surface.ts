// Orrery — the surface a STRUCTURED 2D build returns from `initialize`, as types.
// CASE-PROVIDED.
//
// `specs/instrumentation.md` under this engine: "the game instance's `initialize`
// returns the finished surface. The engine holds it and returns it from
// `engine.debug`". Every operation "acts on the live game at the moment it is
// called": a pose takes only the arguments its row names and returns nothing, and
// a reading returns plain data.
//
// THE ROWS ARE NOT RESTATED HERE. `driver.ts` carries one member per row of
// `specs/instrumentation.md`, taking exactly the arguments that row names, and
// the mapped type below is the mechanical translation of that into this engine's
// spelling: the promise dropped and nothing else changed. Writing the fifty-three
// rows out a second time is how the two would drift, and a drift between them is
// a check calling an operation with the wrong arguments and nothing saying so.
//
// This file is the ONLY description of the surface this project reads. The build's
// own `OrreryDebugApi` is never imported: what a check holds a build to is the
// specification, and this is the specification. `harness.ts` casts the build's
// game definition to it, so an operation the build spelled differently is caught
// where a check reaches for it rather than by the build's own compiler.

import { STATE_OPS, type OrreryDriver } from "./driver";

/** The two operations no engine build carries, which this engine's does not. */
type ClockName = "setAutoStep" | "advance";

/** One operation as this engine's build spells it: the promise dropped. */
type Live<F> = F extends (...args: infer A) => Promise<infer R>
  ? (...args: A) => R
  : never;

/** The surface the instance's `initialize` returns, and `engine.debug` holds. */
export type OrrerySurface = {
  /** `ORRERY_DEBUG_VERSION` (`1`), a plain number. */
  readonly version: number;
} & {
  [K in Exclude<keyof OrreryDriver, ClockName>]-?: Live<OrreryDriver[K]>;
};

/**
 * Every operation `specs/instrumentation.md` requires on the surface under this
 * engine, in the order it introduces them.
 *
 * The two clock operations are deliberately absent: under an engine "the clock,
 * the keyboard, the pointer, and the overlay belong to the engine, and the
 * surface carries no operation for any of them".
 */
export const REQUIRED_OPS: readonly string[] = [...STATE_OPS];
