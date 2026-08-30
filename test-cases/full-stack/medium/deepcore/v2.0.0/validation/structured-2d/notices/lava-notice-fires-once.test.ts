// Deepcore — notices/lava-notice-fires-once: the first lava burn that hurts the
// miner raises the lava card, and no later one raises it again.
//
// `specs/hazards.md`: "The first ... lava burn that does [damage the miner], each
// raise a one-time notice card ... Each fires at most once per expedition." Two
// real burns are driven in ONE expedition: a lava cell drills "exactly like its
// band's rock" and deals its lump "once, as the cell breaks", so holding `down`
// on a posed deepstone lava cell is a burn the game billed rather than a card the
// check posed.
//
// Both cells sit in the deepstone, the band `specs/world.md` first places lava
// in, so the lump is the one that band really deals. The hull lost on the SECOND
// burn is read too: a build that stopped burning the miner after the first would
// otherwise pass a check that only looked for the absence of a card.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertNotNull,
  assertNull,
} from "../assert";
import { NOTICE_DELAY } from "../../src/constants";
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

afterEach(() => {
  h?.dispose();
});

it("raises the lava card on the first damaging burn and never again", async () => {
  openNoticeScene(h);
  const row = lavaRow(h.snapshot());

  const run = await captureReplay(h, "card", async () => {
    const first = await burnOnLava(h, FIRST_COL, row);
    await elapse(h, PAST_DELAY);
    const raised = h.snapshot();

    h.debug.dismissNotice();
    await h.advance(1);
    const cleared = h.snapshot();

    const second = await burnOnLava(h, SECOND_COL, row);
    await elapse(h, PAST_DELAY);
    const after = h.snapshot();

    return { first, raised, cleared, second, after };
  });

  assertEqual(run.first.cut.broke, true, "the first lava cell cleared");
  assertGreaterThan(
    run.first.hullBefore - run.first.hullAfter,
    0,
    "hull the first burn cost",
  );
  assertEqual(run.second.cut.broke, true, "the second lava cell cleared");
  assertGreaterThan(
    run.second.hullBefore - run.second.hullAfter,
    0,
    "hull the second burn cost",
  );

  assertNotNull(run.raised.notice, "a card after the first burn");
  assertEqual(run.raised.notice?.hazard, "lava");
  assertEqual(run.raised.notice?.shown, true);
  assertEqual(run.raised.noticesFired.lava, true);

  assertNull(run.cleared.notice, "no card once the first is dismissed");
  assertNull(run.after.notice, "no card after a later lava burn");
  assertEqual(run.after.noticesFired.lava, true);
});
