// hunter/emerges-after-advance — a bear joins the hunt once the critter has
// advanced far enough and the slot's delay has run out.
//
// specs/hunter.md: the first slot fills the moment BOTH its conditions hold —
// the critter has advanced `BEAR_EMERGE_ADVANCE` (3) rows, which is
// `ROW_NEAR - bestRow`, and `BEAR_EMERGE_DELAY` (0.6 s) have passed since the
// slot fell empty, which for a fresh crossing is when the crossing began. The
// advance is posed with `setBestRow` and the delay is then the only condition
// left outstanding, so what this reads is the DELAY: the roster is empty a whisker
// before it and holds a bear a whisker after.
//
// Emergence is the one faculty this item is about, so it is the one gate
// `startCrossing` shut that is opened again.

import { afterEach, beforeEach, it } from "vitest";
import {
  BEAR_EMERGE_ADVANCE,
  BEAR_EMERGE_DELAY,
  ROW_NEAR,
  START_COL,
} from "../../src/constants";
import { assertLength } from "../assert";
import {
  captureReplay,
  createHarness,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";

/** The row three rows of advance puts the critter on: `ROW_NEAR - 3` is 16. */
const ADVANCED_ROW = ROW_NEAR - BEAR_EMERGE_ADVANCE;

/**
 * Ticks of slack allowed either side of the delay.
 *
 * `BEAR_EMERGE_DELAY` is `0.6` s, which is 72 whole ticks of the fixed `1/120` s
 * step. A build that tests the condition at the top of its tick rather than the
 * bottom lands one tick from a build that tests it at the other, and a clock
 * summed tick by tick lands a few parts in a quadrillion short of a figure that
 * is not exact in binary. Two ticks — a sixtieth of a second — covers both and
 * nothing larger: the readings below are taken 4 ticks apart, so no build can
 * satisfy both by emerging at a time the specification does not fix.
 */
const DELAY_SLACK_TICKS = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("emerges a bear once the advance is made and the delay has passed", async () => {
  startCrossing(h);
  // Three rows of advance, posed rather than hopped: what the rule reads is
  // `bestRow`, and where the critter is standing now is not a condition of it.
  h.debug.setCritterTile(START_COL, ADVANCED_ROW);
  h.debug.setBestRow(ADVANCED_ROW);
  h.debug.setBearEmergence(true);

  const { before, after } = await captureReplay(h, "emerge", async () => {
    await h.advance(ticksFor(BEAR_EMERGE_DELAY) - DELAY_SLACK_TICKS);
    const early = h.snapshot();
    await h.advance(2 * DELAY_SLACK_TICKS);
    return { before: early, after: h.snapshot() };
  });

  assertLength(before.bears, 0, "the hunt a whisker before the delay ran out");
  assertLength(after.bears, 1, "the hunt a whisker after the delay ran out");
});
