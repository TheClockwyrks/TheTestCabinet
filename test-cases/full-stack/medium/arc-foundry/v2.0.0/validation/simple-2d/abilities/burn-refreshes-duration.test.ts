// abilities/burn-refreshes-duration — a fresh burn resets the clock either way.
//
// specs/enemies.md fixes both halves of the rule, and this is the half the rate
// does not decide: applying a burn sets "`burnUntil = now + dur`" whatever the
// `dps` was, and "a fresh hit refreshes the duration". So a weak burn landing on a
// strong one keeps the strong RATE and takes the weak one's SPAN, which is the
// case a build gets wrong by treating the whole effect as one thing a weaker hit
// either replaces or is discarded by.
//
// A strong, short burn is applied and then a weak, long one over it. Three things
// are read: `burnUntil` moved out to the second burn's own duration, the unit is
// still losing health well past the moment the first burn would have stopped, and
// the rate it is losing it at is the stronger one's.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertCloseTo } from "../assert";
import {
  captureReplay,
  createHarness,
  openYard,
  parkUnit,
  tileCenter,
  unitById,
  type Harness,
} from "../harness";

/** The strong, short burn, and the weak, long one applied over it. */
const STRONG = { dps: 20, seconds: 0.5 };
const WEAK = { dps: 5, seconds: 4 };

/** The window the health is watched over: it opens past the first burn's end. */
const OPENS = 1;
const WINDOW = 1;

/** What one update of integration can leave either side of the figure. */
const SLACK = STRONG.dps * 0.05;

/** How far `burnUntil` may sit from the clock at the call. */
const STAMP_SLACK = 0.05;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("carries the weaker burn's duration and the stronger burn's rate", async () => {
  openYard(h, { wave: 1 });
  const unit = parkUnit(h, "dynamo", tileCenter(20, 20), {
    burn: STRONG,
  });

  const refreshed = await captureReplay(h, "refresh", async () => {
    h.debug.setUnitBurn(unit, WEAK.dps, WEAK.seconds);
    const second = h.snapshot();
    await h.advanceSeconds(OPENS);
    const opened = unitById(h.snapshot(), unit);
    await h.advanceSeconds(WINDOW);
    return {
      at: second.simTime,
      second: unitById(second, unit),
      opened,
      closed: unitById(h.snapshot(), unit),
    };
  });

  assertBetween(
    refreshed.second.burnUntil,
    refreshed.at + WEAK.seconds - STAMP_SLACK,
    refreshed.at + WEAK.seconds + STAMP_SLACK,
    `burnUntil after a ${WEAK.seconds}s burn landed on a ${STRONG.seconds}s ` +
      `one: the clock at the call plus the FRESH burn's own duration ` +
      `(specs/enemies.md)`,
  );
  assertBetween(
    refreshed.opened.hp - refreshed.closed.hp,
    STRONG.dps * WINDOW - SLACK,
    STRONG.dps * WINDOW + SLACK,
    `the health that left the unit between ${OPENS}s and ` +
      `${OPENS + WINDOW}s — well past the ${STRONG.seconds}s the first burn ` +
      `alone would have run — at the stronger of the two rates`,
  );
  assertCloseTo(
    refreshed.opened.burnDps,
    STRONG.dps,
    6,
    `burnDps ${OPENS}s in, past the first burn's own duration`,
  );
});
