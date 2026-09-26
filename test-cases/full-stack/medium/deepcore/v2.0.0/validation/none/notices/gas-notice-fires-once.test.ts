// Deepcore — notices/gas-notice-fires-once: no later detonation raises the card
// a second time.
//
// `specs/hazards.md`: "The first gas detonation that damages the miner in an
// expedition ... raise[s] a one-time notice card ... Each fires at most once per
// expedition."
//
// This point decides the ONCE: two real, damaging detonations are driven in one
// expedition, and the second must raise nothing.
//
// THAT THE CARD ARRIVES AT ALL IS ITS OWN POINT, `notices/gas-notice-is-raised`.
//
// Both pockets sit in the rockbed, the band gas first appears in, and both are
// broken by the game's own drill from a miner standing on them, so each is a
// detonation the game resolved rather than a card the check posed.
//
// The first card is dismissed before the second detonation, so what the assertion
// reads is a card that was never raised rather than the first one still hanging
// about. `specs/hazards.md` fixes the press as an immediate dismissal.
//
// The hull lost on the SECOND detonation is read as well: without it a build that
// quietly stopped hurting the miner after the first would pass a check that only
// looked for the absence of a card.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertNull } from "../assert";
import { NOTICE_DELAY } from "../constants";
import { captureReplay, createHarness, type Harness } from "../harness";
import {
  detonateGas,
  elapse,
  FIRST_COL,
  gasRow,
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

it("raises nothing on a later damaging detonation", async () => {
  await openNoticeScene(h);
  const row = gasRow(await h.snapshot());

  const run = await captureReplay(h, "card", async () => {
    await detonateGas(h, FIRST_COL, row);
    await elapse(h, PAST_DELAY);

    await h.debug.dismissNotice();
    await h.advance(1);
    const cleared = await h.snapshot();

    const second = await detonateGas(h, SECOND_COL, row);
    await elapse(h, PAST_DELAY);
    return { cleared, second, after: await h.snapshot() };
  });

  // The second detonation really happened, and it really hurt.
  assertEqual(run.second.cut.broke, true, "the second pocket detonated");
  assertGreaterThan(
    run.second.hullBefore - run.second.hullAfter,
    0,
    "hull the second detonation cost",
  );

  assertNull(run.cleared.notice, "no card once the first is dismissed");
  assertNull(run.after.notice, "no card after a later gas detonation");
  assertEqual(run.after.noticesFired.gas, true);
});
