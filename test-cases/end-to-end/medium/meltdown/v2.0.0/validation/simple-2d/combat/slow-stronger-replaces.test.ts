// Meltdown — combat/slow-stronger-replaces: a stronger slow takes over.
//
// specs/combat.md's three flat cases, first row: an incoming slow "Stronger than the
// live one" gives "The factor becomes `f` and the timer is set to `SLOW_TIME`."
//
// HOW THE PAIR OF SLOWS IS ARRANGED. The live one is POSED — `setUnitSlow(id, 0.20)`
// and `setUnitSlowTimer(id, 0.9)` set the fraction and the seconds left and nothing
// else (specs/instrumentation.md) — and the incoming one is LANDED BY A REAL RIME,
// because applying a slow is the act this rule governs. A level-I Rime pinned at heat
// `0` applies its cold ceiling of `0.55` (specs/combat.md), which is nearly three
// times the live figure.
//
// THE READING IS TAKEN ON THE FRAME THE REPLACEMENT HAPPENS, found by sweeping one
// frame at a time until the mark's factor rises above the posed one. The timer is what
// makes that necessary: `SLOW_TIME` is set on the frame the shot resolves and counts
// down from there, so a reading taken at the end of a fixed drive would be `SLOW_TIME`
// less however much of an interval happened to be left, and the check would be
// asserting the fire rate as well as the refresh rule.
//
// THE SWEEP IS BOUNDED BY ONE INTERVAL AND A HALF, which is short enough that the
// posed `0.9`-second live slow cannot expire inside it. Were it allowed to, the
// incoming slow would land on a unit carrying nothing at all — the fourth case of the
// rule ("A unit carrying no slow takes an incoming one with its timer at `SLOW_TIME`")
// — and the check would pass while measuring a different row of the table.
//
// THE POSED TIMER IS SHORT ON PURPOSE. At `0.9` seconds it is well under the `1.5` the
// rule sets, so a build that swaps the factor and leaves the old clock running reads
// `0.9` where `1.5` is required.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertGreaterThan } from "../assert";
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

/** The weaker slow the mark already carries, and the seconds left on it. */
const LIVE_FACTOR = 0.2;
const LIVE_TIMER = 0.9;

/** How far the sweep may run: one fire interval and a half. */
const MAX_TICKS = ticksForShots(1, fireRateOf(TOWER, LEVEL));

/**
 * How close the two readings must come, as decimal places.
 *
 * Four places on the factor is `0.00005`: the replacement is the incoming figure
 * unchanged, so a conformant build reads `0.55` exactly, and the bound excludes the
 * live `0.20` and every blend of the two. Two places on the timer is `0.005` seconds,
 * which is more than half a frame at the suite's 120 Hz — the room a build needs if it
 * counts the timer down after resolving its shots rather than before — and it excludes
 * the `0.9` a build that kept the old clock would report by a factor of a hundred.
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

it("A stronger slow takes over", async () => {
  poseGun(h, TOWER, HEAT, LEVEL);
  const mark = poseMarkEast(h, TOWER, MARK, NEAR_UNITS);
  h.debug.setUnitSlow(mark, LIVE_FACTOR);
  h.debug.setUnitSlowTimer(mark, LIVE_TIMER);

  const opened = readHp(h, mark);
  const swept = await h.until(
    (snapshot) => {
      const unit = snapshot.surge.find((each) => each.id === mark);
      return unit !== undefined && unit.slowFactor > LIVE_FACTOR;
    },
    { poll: 1, maxFrames: MAX_TICKS },
  );
  captureStill(h, "replaced");
  const hit = unitOf(swept.snapshot, mark);

  assertGreaterThan(
    opened - hit.hp,
    0,
    "precondition: hp the Rime's shot removed, so a slow was applied at all",
  );
  assertCloseTo(
    hit.slowFactor,
    INCOMING_FACTOR,
    FACTOR_DIGITS,
    `the slow on the mark after a stronger ${INCOMING_FACTOR} landed on the live ` +
      `${LIVE_FACTOR}`,
  );
  assertCloseTo(
    hit.slowTimer,
    SLOW_TIME,
    TIMER_DIGITS,
    `the seconds left on the slow on the frame the stronger one replaced the live ` +
      `one, whose own timer was posed at ${LIVE_TIMER}`,
  );
});
