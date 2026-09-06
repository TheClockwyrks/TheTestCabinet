// foes/glitch-interval — the glitch's clock is drawn inside its interval.
//
// `specs/foes.md`: "From that level on, the glitch's clock is drawn uniformly
// between GLITCH_MIN_INTERVAL (7.0 s) and GLITCH_MAX_INTERVAL (12.0 s)", and,
// under The spawner clocks, "a clock standing at `0` is drawn at the start of
// the next update of active play, to the value each kind's section below
// states, and a clock above `0` counts down against each update's delta".
//
// THE DRAW IS MADE TO HAPPEN, AND ITS VALUE IS READ OFF THE DECLARED STATE.
// `setSpawnTimer("glitch", 0)` stands the clock at zero, one update of active
// play draws it afresh, and `snapshot().glitchTimer` reports what was drawn. The
// range is the whole of what the point holds a draw to, and the range holds for
// EVERY draw a conforming build makes, so the point never fails on chance: a
// build that draws inside `7..12` passes on each of the five draws, and a build
// that draws outside it, or never draws, fails on the first that shows it.
//
// The band's lower end gives back the one update the clock may already have
// counted down: the draw happens at the start of the update and the countdown
// against that update's delta may follow inside it, so a clock drawn at exactly
// `GLITCH_MIN_INTERVAL` may read one delta under it. The upper end is exact.
//
// Nothing else is posed: `startPlaying` leaves the board empty and quiet, foe
// spawning is turned back on because the clock this point reads runs only while
// it is, and at level 2 the glitch's clock is the only one running.

import { afterEach, beforeEach, it } from "vitest";
import {
  GLITCH_FROM_LEVEL,
  GLITCH_MAX_INTERVAL,
  GLITCH_MIN_INTERVAL,
} from "../constants";
import { assertBetween } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  TICK_HZ,
  type Harness,
} from "../harness";

/** The level the clock is drawn at: the one glitches begin at. */
const LEVEL = GLITCH_FROM_LEVEL;

/** The fresh draws read. Each is one draw of the same rule. */
const DRAWS = [1, 2, 3, 4, 5];

/** The delta of the one update that draws the clock, in seconds. */
const UPDATE_SECONDS = 1 / TICK_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the glitch's clock between its shortest and longest interval", async () => {
  startPlaying(h);
  h.debug.setLevel(LEVEL);
  h.debug.setFoeSpawning(true);

  const drawn: { draw: number; clock: number }[] = [];
  for (const draw of DRAWS) {
    h.debug.setSpawnTimer("glitch", 0);
    await h.advance(1);
    drawn.push({ draw, clock: h.snapshot().glitchTimer });
  }
  // Before the assertions, so a failing draw still leaves the picture of the
  // board the clocks were drawn on.
  captureStill(h, "drawn");

  for (const { draw, clock } of drawn) {
    assertBetween(
      clock,
      GLITCH_MIN_INTERVAL - UPDATE_SECONDS,
      GLITCH_MAX_INTERVAL,
      `snapshot().glitchTimer one update after setSpawnTimer("glitch", 0) at ` +
        `level ${LEVEL}, draw ${draw} of ${DRAWS.length} — the clock ` +
        `is drawn uniformly between GLITCH_MIN_INTERVAL ` +
        `(${GLITCH_MIN_INTERVAL} s) and GLITCH_MAX_INTERVAL ` +
        `(${GLITCH_MAX_INTERVAL} s), less at most the one update's delta it ` +
        `may have counted down (specs/foes.md)`,
    );
  }
});
