// Deepcore — notices/lava-notice-is-raised: the first burn that hurts the
// miner raises the lava card.
//
// `specs/hazards.md`: "The first ... lava burn that does [damage the miner],
// each raise a one-time notice card ... Each fires at most once per
// expedition."
//
// This point decides that the card ARRIVES: a `lava` card on screen, and
// `noticesFired.lava` armed.
//
// THAT IT NEVER ARRIVES AGAIN IS ITS OWN POINT, `notices/lava-notice-fires-once`.
// A build that raises the card on every burn has a teaching device that has
// become a nuisance, and it must grade differently from one that never teaches
// anything at all.
//
// The cell sits in the deepstone, the band `specs/world.md` first places lava
// in, so the lump is the one that band really deals: a lava cell drills "exactly
// like its band's rock" and deals its lump "once, as the cell breaks".
//
// The hull lost is read too, because the card is owed to a burn that DAMAGED
// the miner: without that reading a build that raised the card on a harmless one
// would pass.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertNotNull } from "../assert";
import { NOTICE_DELAY } from "../constants";
import { captureReplay, createHarness, type Harness } from "../harness";
import {
  burnOnLava,
  elapse,
  FIRST_COL,
  lavaRow,
  openNoticeScene,
} from "./notice-scene";

/** Past the delay, so a card that was going to be raised is on screen. */
const PAST_DELAY = NOTICE_DELAY + 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises the lava card on the first damaging burn", async () => {
  await openNoticeScene(h);
  const row = lavaRow(await h.snapshot());

  const run = await captureReplay(h, "card", async () => {
    const first = await burnOnLava(h, FIRST_COL, row);
    await elapse(h, PAST_DELAY);
    return { first, raised: await h.snapshot() };
  });

  // The burn really happened, and it really hurt.
  assertEqual(run.first.cut.broke, true, "the first lava cell cleared");
  assertGreaterThan(
    run.first.hullBefore - run.first.hullAfter,
    0,
    "hull the first burn cost",
  );

  // So the card is owed, and the one-time flag is armed.
  assertNotNull(run.raised.notice, "a card after the first burn");
  assertEqual(run.raised.notice?.hazard, "lava");
  assertEqual(run.raised.notice?.shown, true);
  assertEqual(run.raised.noticesFired.lava, true);
});
