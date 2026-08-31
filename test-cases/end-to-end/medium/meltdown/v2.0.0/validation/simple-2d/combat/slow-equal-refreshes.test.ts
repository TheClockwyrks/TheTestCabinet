// Meltdown — combat/slow-equal-refreshes: an equal slow refreshes the timer.
//
// specs/combat.md's three flat cases, second row: an incoming slow "Equal to the live
// one" gives "The factor is unchanged and the timer is set to `SLOW_TIME`."
//
// THIS IS THE ROW A BUILD IS MOST LIKELY TO MISS, and it is why the table is worth
// three points rather than one. The natural way to write the rule is a single
// comparison — replace when the incoming slow is stronger, otherwise leave it alone —
// which is right for the first and third rows and wrong for this one. A build that
// wrote it that way passes `combat/slow-stronger-replaces` and
// `combat/slow-weaker-is-ignored` and fails only here.
//
// HOW THE PAIR OF SLOWS IS ARRANGED. The live one is POSED at `0.55` with HALF its
// time left — `setUnitSlowTimer(id, 0.75)` — and the incoming one is LANDED BY A REAL
// RIME: a level-I Rime pinned at heat `0` applies its cold ceiling of `0.55`, exactly
// the live figure, so the frame the shot resolves is a frame of the equal case. Half
// the time left is what makes the two outcomes far apart: a refresh reads `1.5` and a
// build that leaves the clock alone reads `0.75` less whatever the drive spent.
//
// THE READING IS TAKEN ON THE FRAME THE SHOT LANDS, found by sweeping one frame at a
// time until the mark's hp falls. The factor cannot say when the shot happened — that
// is the whole point of the equal case, it does not move — so the hp is what marks the
// frame, and the timer is read there rather than at the end of a fixed drive where the
// answer would carry however much of an interval was left over.
//
// THE SWEEP IS BOUNDED BY ONE INTERVAL AND A HALF, which is shorter than the `0.75`
// seconds the live slow has left. Were the sweep allowed to outlast it, the incoming
// slow would land on a unit carrying nothing — the rule's fourth case — and this check
// would pass while measuring a different row of the table.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertTrue } from "../assert";
import { SLOW_TIME } from "../../src/constants";
import {
  captureStill,
  createHarness,
  unitOf,
  type Harness,
} from "../harness";
import {
  NEAR_UNITS,
  fireRateOf,
  poseGun,
  poseMarkEast,
  readHp,
  slowCeilOf,
  ticksForShots,
} from "./duel";

/** The incoming slow: a level-I Rime pinned cold, so its ceiling of 0.55 lands. */
const TOWER = "rime";
const LEVEL = 1;
const HEAT = 0;
const MARK = "mote";

/** specs/combat.md at heat 0: the level-I cold ceiling, 0.55. */
const INCOMING_FACTOR = slowCeilOf(LEVEL);

/** The live slow: the same figure, with half of `SLOW_TIME` left on it. */
const LIVE_FACTOR = INCOMING_FACTOR;
const LIVE_TIMER = SLOW_TIME / 2;

/** How far the sweep may run: one fire interval and a half. */
const MAX_TICKS = ticksForShots(1, fireRateOf(TOWER, LEVEL));

/**
 * How close the two readings must come, as decimal places.
 *
 * Four places on the factor is `0.00005`: an unchanged fraction is the posed one bit
 * for bit. Two places on the timer is `0.005` seconds, which is more than half a frame
 * at the suite's 120 Hz — the room a build needs if it counts the timer down after
 * resolving its shots rather than before — and it excludes the `0.75` a build that
 * left the clock alone would report by a factor of a hundred and fifty.
 */
const FACTOR_DIGITS = 4;
const TIMER_DIGITS = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("An equal slow refreshes the timer", async () => {
  poseGun(h, TOWER, HEAT, LEVEL);
  const mark = poseMarkEast(h, TOWER, MARK, NEAR_UNITS);
  h.debug.setUnitSlow(mark, LIVE_FACTOR);
  h.debug.setUnitSlowTimer(mark, LIVE_TIMER);

  const opened = readHp(h, mark);
  const swept = await h.until(
    (snapshot) => {
      const unit = snapshot.surge.find((each) => each.id === mark);
      return unit !== undefined && unit.hp < opened;
    },
    { poll: 1, maxFrames: MAX_TICKS },
  );
  captureStill(h, "refreshed");
  const hit = unitOf(swept.snapshot, mark);

  assertTrue(
    swept.hit,
    `precondition: a level-${LEVEL} ${TOWER} landed a shot within one fire ` +
      `interval and a half, so an equal slow reached the mark`,
  );
  assertCloseTo(
    hit.slowFactor,
    INCOMING_FACTOR,
    FACTOR_DIGITS,
    `the slow on the mark after an equal ${INCOMING_FACTOR} landed on the live ` +
      `${LIVE_FACTOR}`,
  );
  assertCloseTo(
    hit.slowTimer,
    SLOW_TIME,
    TIMER_DIGITS,
    `the seconds left on the slow on the frame an equal one landed, against the ` +
      `${LIVE_TIMER} it was posed with`,
  );
});
