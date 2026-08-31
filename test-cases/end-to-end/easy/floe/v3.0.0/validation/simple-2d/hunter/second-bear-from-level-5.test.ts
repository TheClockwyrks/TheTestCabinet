// hunter/second-bear-from-level-5 — a second bear hunts from level 5.
//
// specs/hunter.md: "A level below `SECOND_BEAR_LEVEL` (`5`) has one slot, and a
// level from `SECOND_BEAR_LEVEL` up has `MAX_BEARS` (`2`)". The second slot's two
// conditions are the first's plus its stagger: `BEAR_EMERGE_ADVANCE +
// BEAR_SECOND_ADVANCE` (6) rows of advance and `BEAR_EMERGE_DELAY +
// BEAR_SECOND_DELAY` (2.0 s) since it fell empty.
//
// The advance is posed with `setBestRow` at six rows, so both slots' advance
// conditions are met from the start and the DELAY is the only condition left: the
// roster holds one bear a whisker before two seconds and two a whisker after.
// A build that opened the second slot on the first slot's delay would already hold
// two at the earlier reading; a build with one slot at every level holds one at
// both.
//
// The level is set by `startCrossing`, which sets it BEFORE it empties the strait,
// because `setLevel` re-lays all sixteen lanes.

import { afterEach, beforeEach, it } from "vitest";
import {
  BEAR_EMERGE_ADVANCE,
  BEAR_EMERGE_DELAY,
  BEAR_SECOND_ADVANCE,
  BEAR_SECOND_DELAY,
  ROW_NEAR,
  SECOND_BEAR_LEVEL,
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

/** The row six rows of advance puts the critter on: `ROW_NEAR - 6` is 13. */
const ADVANCED_ROW = ROW_NEAR - (BEAR_EMERGE_ADVANCE + BEAR_SECOND_ADVANCE);

/** The seconds the second slot needs since it fell empty. */
const SECOND_DELAY = BEAR_EMERGE_DELAY + BEAR_SECOND_DELAY;

/** Ticks of slack allowed either side of that delay, as in emerges-after-advance. */
const DELAY_SLACK_TICKS = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens the second slot on its own delay at SECOND_BEAR_LEVEL", async () => {
  startCrossing(h, SECOND_BEAR_LEVEL);
  h.debug.setCritterTile(START_COL, ADVANCED_ROW);
  h.debug.setBestRow(ADVANCED_ROW);
  h.debug.setBearEmergence(true);

  const { before, after } = await captureReplay(h, "two", async () => {
    await h.advance(ticksFor(SECOND_DELAY) - DELAY_SLACK_TICKS);
    const early = h.snapshot();
    await h.advance(2 * DELAY_SLACK_TICKS);
    return { before: early, after: h.snapshot() };
  });

  assertLength(
    before.bears,
    1,
    `the hunt a whisker before the second slot's ${SECOND_DELAY} s ran out`,
  );
  assertLength(
    after.bears,
    2,
    `the hunt a whisker after the second slot's ${SECOND_DELAY} s ran out`,
  );
});
