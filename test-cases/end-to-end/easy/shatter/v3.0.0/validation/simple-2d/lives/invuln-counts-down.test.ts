// lives/invuln-counts-down — the grace runs down with game time, second for
// second.
//
// THE RULE. `specs/progression.md` gives the respawn `INVULN_TIME` (`2.5` seconds)
// of grace and ends it when "the grace reaches `0`"; `specs/simulation.md` states
// that every timer the game keeps counts down by `TICK_DT` on the tick it runs in;
// and `specs/instrumentation.md` reports `ship.invuln` in seconds. Together that
// fixes the rate exactly: the grace left falls by the game time advanced and by
// nothing else.
//
// THE DELTA IS WHAT IS READ, NOT THE ABSOLUTE VALUE. The grace is taken as the
// build reports it on the tick the respawn opened it, and every sample is required
// to be that opening value less the game time advanced since. A build that opens
// its grace at `1.5` seconds fails `invuln-window`, which is the item that owns
// that figure, and passes here — which is what makes a failed grade name the rule
// that is actually broken.
//
// THREE SAMPLES, BECAUSE ONE CANNOT TELL A RATE FROM AN OFFSET. At half a second,
// one second and two seconds, every wrong model reads as a different set of
// numbers. A build that never runs the timer down reads the opening value three
// times. One that counts in TICKS reads a value falling a hundred and twenty times
// too fast and is at zero before the first sample. And one whose timer runs on
// real time rather than game time reads the opening value, because the harness
// supplies the clock and the game advances only when this check says so.
//
// TWO SECONDS IS THE LAST SAMPLE, HALF A SECOND SHORT OF `INVULN_TIME`, so the
// grace is still running at every reading and nothing here is decided by the floor
// at zero — which is `invuln-ends`'s point rather than this one's.
//
// WHY A TICK AND A HALF, and why the field is emptied first: as `invuln-window`
// states.

import { afterEach, beforeEach, it } from "vitest";
import { TICK_DT } from "../constants";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  secondsFor,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import {
  APPROACH_GAP,
  LOSS_TICKS,
  RESPAWN_SETTLE,
  ROCK_DRIFT,
  SHIP_TOUCHES_SMALL,
  arrangeDoomedShip,
  contactNeeded,
  untilGraceOpens,
} from "./scene";

/** Where the grace is sampled, as game time since the respawn opened it. */
const SAMPLE_SECONDS = [0.5, 1.0, 2.0] as const;

/** One tick of the fixed `TICK_HZ` clock, and half of one more for float slack. */
const RATE_TOLERANCE = 1.5 * TICK_DT;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("runs the grace down by exactly the game time advanced", async () => {
  startPlaying(h);
  const before = h.snapshot().lives;
  arrangeDoomedShip(h);

  const respawned = await untilGraceOpens(h, before);
  assertEqual(
    respawned.hit,
    true,
    `a ship destroyed and the next one put up carrying respawn grace, inside ` +
      `${secondsFor(LOSS_TICKS + RESPAWN_SETTLE).toFixed(1)} s of game time; ` +
      contactNeeded(
        "a drifting Small",
        APPROACH_GAP,
        SHIP_TOUCHES_SMALL,
        ROCK_DRIFT,
      ),
  );
  const opened = respawned.snapshot.ship.invuln;
  // Nothing on the field but the graced ship, so no second contact and no wave can
  // reach into the two seconds this reads. `clearRocks` destroys nothing and scores
  // nothing (specs/instrumentation.md).
  h.debug.clearRocks();

  const read: number[] = [];
  let driven = 0;
  for (const seconds of SAMPLE_SECONDS) {
    const wanted = ticksFor(seconds);
    await h.advance(wanted - driven);
    driven = wanted;
    read.push(h.snapshot().ship.invuln);
  }
  captureStill(h, "grace");

  SAMPLE_SECONDS.forEach((seconds, index) => {
    assertLessThanOrEqual(
      Math.abs(read[index] - (opened - seconds)),
      RATE_TOLERANCE,
      `how far the grace stands from the ${opened.toFixed(4)} it opened at less ` +
        `the ${seconds.toFixed(1)} s of game time advanced since; the build ` +
        `reported ${read[index]} (specs/progression.md, specs/simulation.md)`,
    );
  });
});
