// diagnostics/held — the two readings the overlay points share. CASE-PROVIDED.
//
// WHAT THE OVERLAY ADDED. Under `none` the overlay is text on the same canvas as
// the HUD, so what is the overlay's is what the frame drew with it open that the
// frame drew without it did not: a multiset difference of the logical runs, so a
// build that letter-spaces a figure still reports it as one figure rather than
// as a column of digits a `|` apart.
//
// WHAT "CHANGES NOTHING" IS HELD TO. specs/instrumentation.md has every source be
// "a pure read, so watching the overlay leaves the simulation as it is", and the
// reading is the whole snapshot before against the whole snapshot after. The two
// are a few ticks of live play apart, though — the frame that reads the overlay
// is a driven frame, and so is the press that opens it — so two clocks the
// specification lets a playing tick move are held apart from the rest:
//
//   * `simTime`, which "every tick adds its own length" to, "whatever the
//     screen" (specs/state.md).
//   * `drifterIn`, the bonus-drifter cadence. specs/gameplay.md fixes the
//     cadence only "while plankton remain in the maze", and specs/state.md fixes
//     the countdown's top and its reset from each admission and says nothing of
//     what it does once no plankton are left — the one silence it names, "the
//     cadence's own business", is a maze already holding `DRIFTER_MAX`, not a
//     plankton-free board. So on the plankton-free board these points pose,
//     during `"playing"` ticks that advance everything else, a build whose
//     countdown keeps running and one whose countdown stands still are both
//     reading the specification honestly. What either owes is that the countdown
//     moved by no more than the ticks the harness itself drove, and never upward:
//     a source that re-armed it, or ran it down on its own, still fails here.

import { assertBetween, assertEqual } from "../assert";
import { SIM_TIME_EPS, TICK_DT } from "../constants";
import type { FathomSnapshot } from "../harness";

/**
 * The runs `opened` drew that `shut` did not, counted rather than set-matched,
 * upper-cased and joined with ` | ` for matching.
 */
export function added(
  shut: readonly string[],
  opened: readonly string[],
): string {
  const left = [...shut];
  const extra: string[] = [];
  for (const run of opened) {
    const at = left.indexOf(run);
    if (at >= 0) left.splice(at, 1);
    else extra.push(run);
  }
  return extra.join(" | ").toUpperCase();
}

/** The whole snapshot with the two per-tick clocks taken out: what must not move. */
function still(snapshot: FathomSnapshot): string {
  return JSON.stringify({ ...snapshot, simTime: 0, drifterIn: 0 });
}

/**
 * Hold `after` to `before` across `ticks` driven ticks of a parked, plankton-free
 * board, allowing only what the specification has run on every tick.
 *
 * `what` names the stretch the two readings bracket, for the failure.
 */
export function assertHeld(
  before: FathomSnapshot,
  after: FathomSnapshot,
  ticks: number,
  what: string,
): void {
  assertEqual(
    still(after),
    still(before),
    `the whole snapshot across ${what}, which every diagnostic source leaves ` +
      "as it is (specs/instrumentation.md)",
  );
  assertBetween(
    after.drifterIn,
    before.drifterIn - ticks * TICK_DT - SIM_TIME_EPS,
    before.drifterIn + SIM_TIME_EPS,
    `the bonus-drifter countdown across ${what}, which may run down by the ` +
      `${String(ticks)} ticks the harness drove and no further, and never ` +
      "upward — the overlay poses nothing (specs/instrumentation.md, " +
      "specs/gameplay.md)",
  );
}
