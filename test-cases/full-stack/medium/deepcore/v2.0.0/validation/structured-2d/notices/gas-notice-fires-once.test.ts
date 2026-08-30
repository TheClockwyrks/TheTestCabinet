// Deepcore — notices/gas-notice-fires-once: the first gas detonation that hurts
// the miner raises the gas card, and no later one raises it again.
//
// `specs/hazards.md`: "The first gas detonation that damages the miner in an
// expedition ... raise[s] a one-time notice card ... Each fires at most once per
// expedition." So two real detonations are driven in ONE expedition, both of them
// damaging: the first must raise a `gas` card and set `noticesFired.gas`, and the
// second must raise nothing.
//
// Both pockets sit in the rockbed, the band gas first appears in, and both are
// broken by the game's own drill from a miner standing on them, so each is a
// detonation the game resolved rather than a card the check posed. The hull lost
// on the SECOND blast is read as well: without it a build that quietly stopped
// detonating pockets after the first would pass a check that only looked for the
// absence of a card.
//
// The first card is dismissed before the second blast, so what the second
// assertion reads is a card that was never raised rather than the first one still
// hanging about. `specs/hazards.md` fixes the click as an immediate dismissal.

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

afterEach(() => {
  h?.dispose();
});

it("raises the gas card on the first damaging detonation and never again", async () => {
  openNoticeScene(h);
  const row = gasRow(h.snapshot());

  const run = await captureReplay(h, "card", async () => {
    const first = await detonateGas(h, FIRST_COL, row);
    await elapse(h, PAST_DELAY);
    const raised = h.snapshot();

    h.debug.dismissNotice();
    await h.advance(1);
    const cleared = h.snapshot();

    const second = await detonateGas(h, SECOND_COL, row);
    await elapse(h, PAST_DELAY);
    const after = h.snapshot();

    return { first, raised, cleared, second, after };
  });

  // Both detonations really happened, and both really hurt.
  assertEqual(run.first.cut.broke, true, "the first pocket detonated");
  assertGreaterThan(
    run.first.hullBefore - run.first.hullAfter,
    0,
    "hull the first blast cost",
  );
  assertEqual(run.second.cut.broke, true, "the second pocket detonated");
  assertGreaterThan(
    run.second.hullBefore - run.second.hullAfter,
    0,
    "hull the second blast cost",
  );

  // The first raised the gas card and armed the one-time flag.
  assertNotNull(run.raised.notice, "a card after the first detonation");
  assertEqual(run.raised.notice?.hazard, "gas");
  assertEqual(run.raised.notice?.shown, true);
  assertEqual(run.raised.noticesFired.gas, true);

  // The second raised nothing.
  assertNull(run.cleared.notice, "no card once the first is dismissed");
  assertNull(run.after.notice, "no card after a later gas detonation");
  assertEqual(run.after.noticesFired.gas, true);
});
