// Wireworm — instrumentation/worm-entry-gate: with the level's own worm entry
// gated off, a banner giving way to live play brings in no worm; with it on, one
// is on the board.
//
// specs/instrumentation.md gives the gate exactly one faculty:
// `setWormEntry(enabled)` gates "The level's and the respawn's entry of a worm.
// Off, no worm appears unless one is added. A worm already on the board steps as
// usual." specs/progression.md fixes the moment it gates: "When the `banner`
// phase's timer runs out, the phase becomes `active` and the level's worm
// enters... The worm enters at that moment and at no other."
//
// SO THE SCENARIO IS THAT MOMENT, DRIVEN TWICE. The board is posed on the
// `banner` phase with `BANNER_TIME` (`1.3` s) on its timer and left to run: the
// timer counts down against the delta of each update (specs/progression.md), the
// phase gives way on the game's own clock, and what happens next is the whole of
// what this point reads.
//
// WITHOUT IT, EVERY OTHER POINT IS AT THE MERCY OF A BANNER. Any scenario that
// touches the phase — and a great many do, because a banner is how a level opens
// and a respawn is how a life is lost — would otherwise have a level's worm
// materialise inside it, at the level's own length, stepping. So the points that
// pose a phase rest on this gate, and this point is where it is decided.
//
// TEN SECONDS IS SEVEN BANNERS. `BANNER_TIME` is `1.3` s, so the gated half runs
// long past the moment a worm would have entered — and long past the moment a
// build with a slower banner would have brought one in — before reading an empty
// roster.
//
// THE ON HALF IS READ LOOSELY AND ON PURPOSE. It is asserted only that A worm
// arrived, inside three banners. That it enters along row `0`, at the level's
// own length, from an edge, is `worm/enters-top-row` and `worm/length-per-level`.
//
// THE BOARD IS OTHERWISE EMPTY AND QUIET. `startPlaying` clears all four rosters
// and holds foe spawning and the cursor's contact off, so a worm that turns up
// over either span came from the level's own entry and from nothing else.

import { afterEach, beforeEach, it } from "vitest";
import { BANNER_TIME } from "../../src/constants";
import { assertLength, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** How long the gated board is played for, in seconds. */
const GATED_SECONDS = 10;

/**
 * How long the ungated board is given to bring a worm in, in seconds.
 *
 * Three `BANNER_TIME`s (`1.3` s each, specs/progression.md), so a build whose
 * banner runs long still gives way inside the window and the reading is of the
 * gate rather than of the timer. `progression/banner-time` grades the figure.
 */
const UNGATED_SECONDS = 3 * BANNER_TIME;

/** Put the board back on a fresh banner, which is the moment a worm enters. */
function openBanner(h: Harness): void {
  h.debug.setPhase("banner");
  h.debug.setPhaseTimer(BANNER_TIME);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("brings in no worm when a banner gives way while the gate is off", async () => {
  startPlaying(h);
  h.debug.setWormEntry(false);
  openBanner(h);

  await h.advanceSeconds(GATED_SECONDS);
  // Before the assertions, so a failing gate still leaves the picture of the
  // active level a worm entered.
  captureStill(h, "gated");

  assertLength(
    h.snapshot().worms,
    0,
    `the worms on the board ${GATED_SECONDS} s after a banner was posed with ` +
      `setWormEntry(false) held — that is ` +
      `${Math.floor(GATED_SECONDS / BANNER_TIME)} BANNER_TIMEs ` +
      `(${BANNER_TIME} s each), so the phase gave way long ago ` +
      `(specs/progression.md)`,
  );

  // And the control: the level really would have brought one in.
  h.debug.setWormEntry(true);
  h.debug.clearWorms();
  openBanner(h);
  const entered = await h.until((s) => s.worms.length > 0, {
    maxFrames: ticksFor(UNGATED_SECONDS),
  });
  assertTrue(
    entered.hit,
    `a worm to be on the board within ${UNGATED_SECONDS.toFixed(1)} s of a ` +
      `banner posed with setWormEntry(true) — without one, an empty roster ` +
      `while the gate was off says nothing about the gate`,
  );
});
