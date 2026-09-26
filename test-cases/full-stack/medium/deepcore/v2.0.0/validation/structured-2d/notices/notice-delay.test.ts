// Deepcore — notices/notice-delay: the card waits out the beat between the blast
// and its appearance.
//
// `specs/hazards.md`: "The card appears `NOTICE_DELAY` (`1.5`) seconds after the
// hit, so the detonation, the screen shake, and the hull drop land first."
// `specs/instrumentation.md` fixes what a check reads: "`notice.shown` is `true`
// only while the card is drawn, so it is `false` over the `NOTICE_DELAY` between
// the hit and the card appearing."
//
// So the notice is sampled either side of the delay, from the frame the pocket
// broke: a quarter of a second short of it, where a card must be armed and not
// yet drawn, and a quarter of a second past it, where it must be drawn. The
// quarter second is the tolerance — six times the frame the scene is clocked at,
// and a sixth of the delay it brackets — so a build that lands the card anywhere
// near the stated moment passes and one that raises it instantly or a second late
// does not.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { NOTICE_DELAY } from "../constants";
import { captureReplay, createHarness, type Harness } from "../harness";
import {
  detonateGas,
  elapse,
  FIRST_COL,
  gasRow,
  openNoticeScene,
} from "./notice-scene";

/** How far either side of the delay the card is sampled. */
const MARGIN = 0.25;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds the card back for the delay after the hit, then shows it", async () => {
  openNoticeScene(h);
  const row = gasRow(h.snapshot());

  const beat = await captureReplay(h, "beat", async () => {
    const blast = await detonateGas(h, FIRST_COL, row);
    await elapse(h, NOTICE_DELAY - MARGIN);
    const early = h.snapshot();
    await elapse(h, 2 * MARGIN);
    const late = h.snapshot();
    return { blast, early, late };
  });

  assertEqual(beat.blast.cut.broke, true, "the pocket detonated");

  // The hit landed first: it is what armed the card.
  assertNotNull(beat.early.notice, "a card armed by the blast");
  assertEqual(beat.early.notice?.hazard, "gas");
  assertEqual(
    beat.early.notice?.shown,
    false,
    `not yet drawn ${MARGIN}s short of NOTICE_DELAY`,
  );

  assertEqual(
    beat.late.notice?.shown,
    true,
    `drawn ${MARGIN}s past NOTICE_DELAY`,
  );
});
