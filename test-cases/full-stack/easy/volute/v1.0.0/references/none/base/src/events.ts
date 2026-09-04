// Volute — what a tick reports to the layers outside the simulation.
//
// The simulation decides everything from the state alone (specs/instrumentation.md:
// "Render-free core"), so it cannot reach the speakers or the canvas. Instead each
// tick fills one of these: the cues the tick's events raise, and the places
// something happened that the presentation layer plays an effect over.
//
// A cue name lands in a SET, which is what makes "at most once on that tick" a
// property of the type rather than a rule every call site has to remember.

import type { ChargeId, CueName } from "./constants";

/** One place something happened, for the layer that draws over the hall. */
export interface FxEvent {
  /** What happened. */
  readonly kind: "extract" | "grant" | "bore" | "intake" | "fire";
  /** Where it happened, in logical units. */
  readonly x: number;
  readonly y: number;
  /** The charge involved, where the effect is tinted by one. */
  readonly charge?: ChargeId;
}

/** What one tick raised. */
export interface TickReport {
  /** The cues the tick's events raised, each at most once. */
  readonly cues: Set<CueName>;
  /** The effects the tick's events raised, in the order they happened. */
  readonly fx: FxEvent[];
}

/** A fresh, empty report. */
export function newReport(): TickReport {
  return { cues: new Set<CueName>(), fx: [] };
}
