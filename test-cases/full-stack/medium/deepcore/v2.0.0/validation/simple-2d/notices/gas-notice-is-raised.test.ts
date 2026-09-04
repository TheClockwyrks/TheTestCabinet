// Deepcore — notices/gas-notice-is-raised: the first detonation that hurts the
// miner raises the gas card.
//
// `specs/hazards.md`: "The first gas detonation that damages the miner in an
// expedition ... raise[s] a one-time notice card ... Each fires at most once per
// expedition."
//
// This point decides that the card ARRIVES: a `gas` card on screen, and
// `noticesFired.gas` armed.
//
// THAT IT NEVER ARRIVES AGAIN IS ITS OWN POINT, `notices/gas-notice-fires-once`.
// A build that raises the card on every detonation has a teaching device that has
// become a nuisance, and it must grade differently from one that never teaches
// anything at all.
//
// The pocket sits in the rockbed, the band gas first appears in, and it is
// broken by the game's own drill from a miner standing on it, so it is a
// detonation the game resolved rather than a card the check posed.
//
// The hull lost is read too, because the card is owed to a detonation that DAMAGED
// the miner: without that reading a build that raised the card on a harmless one
// would pass.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertNotNull } from "../assert";
import { NOTICE_DELAY } from "../constants";
import { captureReplay, createHarness, type Harness } from "../harness";
import {
  detonateGas,
  elapse,
  FIRST_COL,
  gasRow,
  openNoticeScene,
} from "./notice-scene";

/** Past the delay, so a card that was going to be raised is on screen. */
const PAST_DELAY = NOTICE_DELAY + 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("raises the gas card on the first damaging detonation", async () => {
  openNoticeScene(h);
  const row = gasRow(h.snapshot());

  const run = await captureReplay(h, "card", async () => {
    const first = await detonateGas(h, FIRST_COL, row);
    await elapse(h, PAST_DELAY);
    return { first, raised: h.snapshot() };
  });

  // The detonation really happened, and it really hurt.
  assertEqual(run.first.cut.broke, true, "the first pocket detonated");
  assertGreaterThan(
    run.first.hullBefore - run.first.hullAfter,
    0,
    "hull the first detonation cost",
  );

  // So the card is owed, and the one-time flag is armed.
  assertNotNull(run.raised.notice, "a card after the first detonation");
  assertEqual(run.raised.notice?.hazard, "gas");
  assertEqual(run.raised.notice?.shown, true);
  assertEqual(run.raised.noticesFired.gas, true);
});
