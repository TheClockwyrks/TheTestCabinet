// Meltdown — combat/slow-weaker-is-ignored: a weaker slow changes nothing.
//
// `specs/combat.md`'s three flat cases, third row: an incoming slow "Weaker than
// the live one" leaves the result "Neither the factor nor the timer changes."
//
// HOW THE PAIR OF SLOWS IS ARRANGED. The live one is POSED — `setUnitSlow(id,
// 0.55)` and `setUnitSlowTimer(id, 0.9)` set the fraction and the seconds left and
// nothing else (`specs/instrumentation.md`) — and the incoming one is LANDED BY A
// REAL RIME, because applying a slow is the act this rule governs and posing both
// halves would grade nothing. `specs/combat.md` gives the incoming figure as
// `slowCeil * (1 - H / 100)`, so a level-III Rime — ceiling `0.80` — pinned at heat
// `75` applies exactly `0.20`, which is well under the live `0.55`.
//
// THE POSED TIMER IS SHORT ON PURPOSE. At `0.9` seconds it is comfortably under the
// `1.5` a refresh would set, so the two outcomes are far apart: an ignored slow
// leaves the timer running down from `0.9`, and a refreshed one puts it back at
// `1.5`. What the check asserts is the running-down figure — the posed `0.9` less
// exactly the game time the drive spent — so a build that refreshes the timer while
// keeping the factor is caught, which is the wrong model this row of the table
// exists to exclude.
//
// AND THE FACTOR IS ASSERTED AGAINST THE POSED VALUE, not against a formula: what
// the rule requires is that the live slow is left alone, so `0.55` is the number
// this check owns.
//
// THE PRECONDITIONS ARE STATED RATHER THAN ASSUMED. That the Rime's shot landed at
// all is read off the mark's hp, so a Rime that never fires cannot pass by
// inaction; and that the incoming slow really is the weaker of the two is read off
// the tower's own reported `slowFactor` rather than computed, so a build whose slow
// FIGURE is wrong is graded by `combat/rime-slow-degrades-with-heat` and not here.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertGreaterThan, assertLessThan } from "../assert";
import {
  captureStill,
  createHarness,
  framesForShots,
  requireUnit,
  seconds,
  type Harness,
} from "../harness";
import {
  NEAR_UNITS,
  fireRateOf,
  poseGun,
  poseMarkEast,
  readGun,
  readHp,
} from "./duel";

/**
 * The incoming slow: a level-III Rime pinned at heat 75.
 *
 * `specs/combat.md` and `specs/towers.md`: `0.80 * (1 - 75 / 100)` is `0.20`, a
 * whole-number heat that lands a figure well under the live slow below.
 */
const TOWER = "rime";
const LEVEL = 3;
const HEAT = 75;
const MARK = "mote";

/** The slow the mark already carries, and the seconds left on it. */
const LIVE_FACTOR = 0.55;
const LIVE_TIMER = 0.9;

/** How many frames the drive spends, and so how far the live timer runs down. */
const DRIVE_FRAMES = framesForShots(1, fireRateOf(TOWER, LEVEL));
const EXPECTED_TIMER = LIVE_TIMER - seconds(DRIVE_FRAMES);

/**
 * How close the two readings must come, as decimal places.
 *
 * Four places on the factor is `0.00005`: an untouched fraction is the posed one
 * bit for bit, and the bound excludes the incoming `0.20` and every blend of the
 * two. Two places on the timer is `0.005` seconds, which is more than half a frame
 * at the suite's 120 Hz — the room a build needs if it counts the timer down before
 * resolving its shots rather than after — and a hundredth of the way to the `1.5` a
 * refresh would have set.
 */
const FACTOR_DIGITS = 4;
const TIMER_DIGITS = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("A weaker slow neither replaces nor refreshes", async () => {
  const gunId = await poseGun(h, TOWER, HEAT, LEVEL);
  const mark = await poseMarkEast(h, TOWER, MARK, NEAR_UNITS);
  await h.debug.setUnitSlow(mark, LIVE_FACTOR);
  await h.debug.setUnitSlowTimer(mark, LIVE_TIMER);

  const opened = await readHp(h, mark);
  const incoming = (await readGun(h, gunId, "the Rime landing the weaker slow"))
    .slowFactor;

  await h.advance(DRIVE_FRAMES);
  await captureStill(h, "ignored");
  const hit = requireUnit(await h.snapshot(), mark, "the mark after one shot");

  assertLessThan(
    incoming,
    LIVE_FACTOR,
    `precondition: the slow a level-${LEVEL} ${TOWER} at heat ${HEAT} applies, ` +
      `against the ${LIVE_FACTOR} the mark already carries`,
  );
  assertGreaterThan(
    opened - hit.hp,
    0,
    "precondition: hp the Rime's shot removed, so a slow was applied at all",
  );
  assertCloseTo(
    hit.slowFactor,
    LIVE_FACTOR,
    FACTOR_DIGITS,
    `the slow on the mark after a weaker ${incoming} landed on the live ` +
      `${LIVE_FACTOR}`,
  );
  assertCloseTo(
    hit.slowTimer,
    EXPECTED_TIMER,
    TIMER_DIGITS,
    `the seconds left on the live slow after a weaker one landed: the posed ` +
      `${LIVE_TIMER} less the ${seconds(DRIVE_FRAMES)}s the drive spent, and ` +
      `not the SLOW_TIME a refresh would set`,
  );
});
