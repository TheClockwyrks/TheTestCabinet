// instrumentation/fish-cadence-gate — `setFishCadence(false)` holds the bonus
// catch's own cadence, and turning it back on puts one in a bay.
//
// specs/instrumentation.md fixes the gate: "The bonus catch's own cadence: one
// appearing in an open bay, lingering, and moving on. A bonus catch posed through
// the surface still scores when its bay is filled." specs/bays.md fixes the cadence
// it gates: a level "opens with no bonus catch out, and the first appears"
// `FISH_INTERVAL` (`8` s) "after the level is laid out".
//
// SO THE GATED CROSSING IS LEFT RUNNING FOR SIXTY SECONDS, seven times the interval
// the specification names, and `fishBay` must still be `null` at the end of it —
// and the gate is then opened over a live crossing with five open bays, where one
// must appear.
//
// EVERY OTHER SCENARIO IN THIS SUITE RESTS ON THE FIRST HALF. `startCrossing` shuts
// this gate, and a build that ignored it would drop a bonus catch into the bay a
// scoring check was aiming at, silently adding `SCORE_BONUS_CATCH` to a crossing
// that never earned it — under a heading about scoring rather than about the gate.
//
// THE CROSSING IS LIVE AND EMPTY. The screen is `playing`, the critter stands on
// the near shore, both rosters are cleared and the crossing timer is held, so over
// the whole minute nothing on the strait can end the crossing, fill a bay, or score
// — and `fishBay` can change for exactly one reason.
//
// WHAT THIS DOES NOT DECIDE. Not WHEN a bonus catch appears, which is
// `bays/fish-interval`'s, not which bay it chooses, which is
// `bays/fish-appears-in-open-bay`'s, and not how long it lingers, which is
// `bays/fish-lingers`'. The window below is deliberately wider than the figure, so
// a build whose cadence is slow keeps this point and loses those.

import { afterEach, beforeEach, it } from "vitest";
import { BAY_COUNT, FISH_INTERVAL } from "../constants";
import { assertEqual, assertNotNull, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";

/**
 * How long the gated crossing is watched for, in seconds: the sixty this item
 * names, which is seven and a half times `FISH_INTERVAL` (`8` s, specs/bays.md).
 */
const WATCH_SECONDS = 60;

/**
 * How long the ungated crossing is given to produce one, in seconds.
 *
 * Twice `FISH_INTERVAL` with two seconds over, so a build whose cadence is slower
 * than the figure still produces one here and is graded on the figure by
 * `bays/fish-interval`.
 */
const APPEAR_SECONDS = 2 * FISH_INTERVAL + 2;

/** How much game time separates two samples of either watch, in seconds. */
const POLL_SECONDS = 0.25;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("keeps the bonus catch away while the cadence is gated, and puts one out when it is not", async () => {
  startCrossing(h);
  h.debug.setFishCadence(false);

  const posed = h.snapshot();
  assertEqual(
    posed.screen,
    "playing",
    "the crossing the cadence is watched over is live",
  );
  assertEqual(posed.fishBay, null, "the bonus catch out before the watch");
  assertEqual(
    posed.bays.filter(Boolean).length,
    0,
    `the bays standing filled before the watch — all ${BAY_COUNT} are open, so ` +
      `a cadence that ran would have somewhere to put one (specs/bays.md)`,
  );

  const gated = await h.until((s) => s.fishBay !== null, {
    maxFrames: ticksFor(WATCH_SECONDS),
    poll: ticksFor(POLL_SECONDS),
  });
  assertEqual(
    gated.hit,
    false,
    `a bonus catch appearing over ${WATCH_SECONDS} s of a live crossing with ` +
      `setFishCadence(false) — seven times the FISH_INTERVAL (${FISH_INTERVAL} s) ` +
      `specs/bays.md puts the first one out after`,
  );

  h.debug.setFishCadence(true);
  const running = await h.until((s) => s.fishBay !== null, {
    maxFrames: ticksFor(APPEAR_SECONDS),
    poll: ticksFor(POLL_SECONDS),
  });
  await h.advance(1);
  // Before the assertions, so a build whose cadence never ran still leaves the
  // picture of the far shore it left empty.
  captureStill(h, "gate");

  assertTrue(
    running.hit,
    `a bonus catch to appear within ${APPEAR_SECONDS} s of ` +
      `setFishCadence(true) on a crossing with five open bays (specs/bays.md)`,
  );
  assertNotNull(
    running.snapshot.fishBay,
    "the bay holding the bonus catch once the cadence is running again",
  );
});
