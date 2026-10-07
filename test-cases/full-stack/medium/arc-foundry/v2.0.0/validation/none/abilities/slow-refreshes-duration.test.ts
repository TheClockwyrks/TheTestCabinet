// abilities/slow-refreshes-duration — a fresh slow resets the clock either way.
//
// specs/enemies.md fixes both halves of the rule, and this is the half the amount
// does not decide: applying a slow sets "`slowUntil = now + dur`" whatever the
// amount was, and "a fresh hit refreshes the duration". So a weak slow landing on
// a strong one keeps the strong AMOUNT and takes the weak one's DURATION, which is
// the case a build gets wrong by treating the whole effect as one thing that a
// weaker hit either replaces or is discarded by.
//
// A strong, short slow is applied and then a weak, long one over it. Three things
// are read: `slowUntil` moved out to the second slow's own duration, the unit is
// still slowed well past the moment the first one would have run out, and the
// factor it is still slowed by is the stronger one's.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertCloseTo, assertEqual } from "../assert";
import { tileCenter } from "../constants";
import {
  captureReplay,
  createHarness,
  openYard,
  parkUnit,
  unitById,
  type Harness,
} from "../harness";

/** The strong, short slow, and the weak, long one applied over it. */
const STRONG = { amount: 0.6, seconds: 0.4 };
const WEAK = { amount: 0.2, seconds: 3 };

/** Where the unit is sampled: well past the first slow, well inside the second. */
const SAMPLED = 1.5;

/** How far `slowUntil` may sit from the clock at the call. */
const STAMP_SLACK = 0.05;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("carries the weaker slow's duration and the stronger slow's amount", async () => {
  await openYard(h, { wave: 1 });
  const unit = await parkUnit(h, "dynamo", tileCenter(20, 20), {
    slow: STRONG,
  });

  const refreshed = await captureReplay(h, "refresh", async () => {
    await h.debug.setUnitSlow(unit, WEAK.amount, WEAK.seconds);
    const second = await h.snapshot();
    await h.advanceSeconds(SAMPLED);
    return { at: second.simTime, second, late: await h.snapshot() };
  });

  assertBetween(
    unitById(refreshed.second, unit).slowUntil,
    refreshed.at + WEAK.seconds - STAMP_SLACK,
    refreshed.at + WEAK.seconds + STAMP_SLACK,
    `slowUntil after a ${WEAK.seconds}s slow landed on a ` +
      `${STRONG.seconds}s one: the clock at the call plus the FRESH slow's ` +
      `own duration (specs/enemies.md)`,
  );

  const late = unitById(refreshed.late, unit);
  assertEqual(
    late.slowFactor < 1,
    true,
    `the unit still slowed ${SAMPLED}s in, well past the ${STRONG.seconds}s ` +
      `the first slow alone would have held it`,
  );
  assertCloseTo(
    late.slowFactor,
    1 - STRONG.amount,
    6,
    `the factor it is still slowed by: the stronger of the two amounts`,
  );
});
