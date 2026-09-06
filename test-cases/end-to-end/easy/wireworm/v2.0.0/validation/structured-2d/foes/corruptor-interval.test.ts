// foes/corruptor-interval — the corruptor's clock is drawn inside its interval.
//
// `specs/foes.md`: "From that level on, the corruptor's clock is drawn
// uniformly between CORRUPTOR_MIN_INTERVAL (14.0 s) and CORRUPTOR_MAX_INTERVAL
// (22.0 s)", and, under The spawner clocks, "a clock standing at `0` is drawn
// at the start of the next update of active play, to the value each kind's
// section below states, and a clock above `0` counts down against each
// update's delta".
//
// THE DRAW IS MADE TO HAPPEN, AND ITS VALUE IS READ OFF THE DECLARED STATE.
// `setSpawnTimer("corruptor", 0)` stands the clock at zero, one update of
// active play draws it afresh, and `snapshot().corruptorTimer` reports what was
// drawn. The range is the whole of what the point holds a draw to, and the
// range holds for EVERY draw a conforming build makes, so the point never fails
// on chance: a build that draws inside `14..22` passes on each of the five
// draws, and a build that draws outside it, or never draws, fails on the first
// that shows it.
//
// THE DRAWS ARE ALSO HELD TO DIFFER. `specs/foes.md` draws the clock uniformly
// over a continuous interval, so five draws of a conforming build never
// coincide, and a build that stands its clock at one fixed value inside the
// interval is named by the sample holding fewer than two distinct values.
//
// The band's lower end gives back the one update the clock may already have
// counted down: the draw happens at the start of the update and the countdown
// against that update's delta may follow inside it, so a clock drawn at exactly
// `CORRUPTOR_MIN_INTERVAL` may read one delta under it. The upper end is exact.
//
// Nothing else is posed: `startPlaying` leaves the board empty and quiet, and
// foe spawning is turned back on because the clock this point reads runs only
// while it is. The glitch and dropper spawners run alongside it at this level —
// that is what `foeSpawning` gates — and the point reads the corruptor's clock
// alone.

import { afterEach, beforeEach, it } from "vitest";
import {
  CORRUPTOR_FROM_LEVEL,
  CORRUPTOR_MAX_INTERVAL,
  CORRUPTOR_MIN_INTERVAL,
} from "../constants";
import { assertBetween, assertGreaterThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  resetTo,
  startPlaying,
  TICK_HZ,
  type Harness,
} from "../harness";

/** The level the clock is drawn at: the one corruptors begin at. */
const LEVEL = CORRUPTOR_FROM_LEVEL;

/** The fresh draws read. Each is one draw of the same rule. */
const DRAWS = [1, 2, 3, 4, 5];

/**
 * The distinct values the five draws must hold between them: two. The clock is
 * drawn uniformly over a continuous interval, so five draws of a conforming
 * build coincide with a probability of zero, and a build that returns one
 * fixed value inside the interval is what this names.
 */
const DISTINCT_DRAWS = 2;

/** The delta of the one update that draws the clock, in seconds. */
const UPDATE_SECONDS = 1 / TICK_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the corruptor's clock between its shortest and longest interval", async () => {
  resetTo(h);
  startPlaying(h);
  h.debug.setLevel(LEVEL);
  h.debug.setFoeSpawning(true);

  const drawn: { draw: number; clock: number }[] = [];
  for (const draw of DRAWS) {
    h.debug.setSpawnTimer("corruptor", 0);
    await h.advance(1);
    drawn.push({ draw, clock: h.snapshot().corruptorTimer });
  }
  // Before the assertions, so a failing draw still leaves the picture of the
  // board the clocks were drawn on.
  captureStill(h, "drawn");

  for (const { draw, clock } of drawn) {
    assertBetween(
      clock,
      CORRUPTOR_MIN_INTERVAL - UPDATE_SECONDS,
      CORRUPTOR_MAX_INTERVAL,
      `snapshot().corruptorTimer one update after ` +
        `setSpawnTimer("corruptor", 0) at level ${LEVEL}, draw ` +
        `${draw} of ${DRAWS.length} — the clock is drawn uniformly ` +
        `between CORRUPTOR_MIN_INTERVAL (${CORRUPTOR_MIN_INTERVAL} s) and ` +
        `CORRUPTOR_MAX_INTERVAL (${CORRUPTOR_MAX_INTERVAL} s), less at most ` +
        `the one update's delta it may have counted down (specs/foes.md)`,
    );
  }

  assertGreaterThanOrEqual(
    new Set(drawn.map(({ clock }) => clock)).size,
    DISTINCT_DRAWS,
    `distinct values among the ${DRAWS.length} clocks drawn at level ` +
      `${LEVEL} — the clock is drawn uniformly between CORRUPTOR_MIN_INTERVAL ` +
      `(${CORRUPTOR_MIN_INTERVAL} s) and CORRUPTOR_MAX_INTERVAL (${CORRUPTOR_MAX_INTERVAL} s), ` +
      `so it varies from draw to draw (specs/foes.md)`,
  );
});
