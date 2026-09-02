// Orrery — the surface a SIMPLE 2D build returns beside its state, as types.
// CASE-PROVIDED.
//
// `specs/instrumentation.md` under this engine: "the build's `initialize` returns
// the finished surface beside the state it built, as the pair `[state, debug]`",
// and every operation is "written in the shape of `update`, because the engine
// holds the state by value and nothing holds a writable one". So a pose is
// `(state, ...args) => OrreryState` and a reading is `(state, ...args) => value`.
//
// THE ROWS ARE NOT RESTATED HERE. `driver.ts` carries one member per row of
// `specs/instrumentation.md`, taking exactly the arguments that row names, and
// the two mapped types below are the mechanical translation of that into this
// engine's spelling: a state parameter in front, and the promise dropped. Writing
// the fifty-one rows out a second time is how the two would drift, and a drift
// between them is a check calling an operation with the wrong arguments and
// nothing saying so.
//
// This file is the ONLY description of the surface this project reads. The build's
// own `OrreryDebugApi` is never imported: what a check holds a build to is the
// specification, and this is the specification. `harness.ts` casts the build's
// game to it, so an operation the build spelled differently is caught where a
// check reaches for it rather than by the build's own compiler.

import type { DeepReadonly } from "ts-essentials";
import { READINGS, STATE_OPS, type OrreryDriver } from "./driver";

/** The three operations that read rather than pose. */
type ReadingName = (typeof READINGS)[number] &
  ("snapshot" | "readSolution" | "referenceSolution");

/** The two operations no engine build carries, which this engine's does not. */
type ClockName = "setAutoStep" | "advance";

/** A pose: the current state in front of the row's own arguments, the next out. */
type Pose<S, F> = F extends (...args: infer A) => Promise<unknown>
  ? (state: DeepReadonly<S>, ...args: A) => S
  : never;

/** A reading: the current state in front, what it read out, and nothing changed. */
type Reading<S, F> = F extends (...args: infer A) => Promise<infer R>
  ? (state: DeepReadonly<S>, ...args: A) => R
  : never;

/**
 * The surface `initialize` returns beside the state, and `engine.debug` hands
 * back unchanged, over the state type `S` the build declared.
 */
export type OrrerySurface<S> = {
  /** `ORRERY_DEBUG_VERSION` (`1`), a plain number. */
  readonly version: number;
} & {
  [K in Exclude<keyof OrreryDriver, ReadingName | ClockName>]-?: Pose<
    S,
    OrreryDriver[K]
  >;
} & {
  [K in ReadingName]-?: Reading<S, OrreryDriver[K]>;
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
