// Deepcore — notices/lava-notice-fires-once: no later burn raises the card
// a second time.
//
// `specs/hazards.md`: "The first ... lava burn that does [damage the miner],
// each raise a one-time notice card ... Each fires at most once per
// expedition."
//
// This point decides the ONCE: two real, damaging burns are driven in one
// expedition, and the second must raise nothing.
//
// THAT THE CARD ARRIVES AT ALL IS ITS OWN POINT, `notices/lava-notice-is-raised`.
//
// Both cells sit in the deepstone, the band `specs/world.md` first places lava
// in, so the lump is the one that band really deals: a lava cell drills "exactly
// like its band's rock" and deals its lump "once, as the cell breaks".
//
// The first card is dismissed before the second burn, so what the assertion
// reads is a card that was never raised rather than the first one still hanging
// about. `specs/hazards.md` fixes the press as an immediate dismissal.
//
// The hull lost on the SECOND burn is read as well: without it a build that
// quietly stopped hurting the miner after the first would pass a check that only
// looked for the absence of a card.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertNull } from "../assert";
import { NOTICE_DELAY } from "../constants";
import { captureReplay, createHarness, type Harness } from "../harness";
import {
  burnOnLava,
  elapse,
  FIRST_COL,
  lavaRow,
  openNoticeScene,
  SECOND_COL,
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

it("raises nothing on a later damaging burn", async () => {
  await openNoticeScene(h);
  const row = lavaRow(await h.snapshot());

  const run = await captureReplay(h, "card", async () => {
    await burnOnLava(h, FIRST_COL, row);
    await elapse(h, PAST_DELAY);

    await h.debug.dismissNotice();
    await h.advance(1);
    const cleared = await h.snapshot();

    const second = await burnOnLava(h, SECOND_COL, row);
    await elapse(h, PAST_DELAY);
    return { cleared, second, after: await h.snapshot() };
  });

  // The second burn really happened, and it really hurt.
  assertEqual(run.second.cut.broke, true, "the second lava cell cleared");
  assertGreaterThan(
    run.second.hullBefore - run.second.hullAfter,
    0,
    "hull the second burn cost",
  );

  assertNull(run.cleared.notice, "no card once the first is dismissed");
  assertNull(run.after.notice, "no card after a later lava burn");
  assertEqual(run.after.noticesFired.lava, true);
});
