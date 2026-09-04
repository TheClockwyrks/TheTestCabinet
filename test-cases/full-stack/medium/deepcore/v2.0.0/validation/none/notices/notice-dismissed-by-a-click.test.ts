// Deepcore — notices/notice-dismissed-by-a-click: a click takes the card away at
// once.
//
// `specs/hazards.md`: "A click on the card dismisses it at once."
// `specs/instrumentation.md` names the operation that stands for that click,
// `dismissNotice()`, "as a click on it does", so the dismissal runs the game's own
// rule for the control rather than posing the card away.
//
// The card is raised by a real detonation and left up only long enough to be on
// screen, then dismissed; the notice must be gone on the very next frame. The
// elapsed game time since the card appeared is read alongside it and held well
// under `NOTICE_FADE`, so a build that simply let the card time out cannot pass
// this by waiting.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThan, assertNull } from "../assert";
import { NOTICE_DELAY, NOTICE_FADE } from "../constants";
import { captureReplay, createHarness, type Harness } from "../harness";
import {
  detonateGas,
  elapse,
  FIRST_COL,
  gasRow,
  openNoticeScene,
} from "./notice-scene";

/** Long enough for the card to be drawn, far short of the fade. */
const SHOWN_AT = NOTICE_DELAY + 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("dismisses the card at once rather than waiting out the fade", async () => {
  await openNoticeScene(h);
  const row = gasRow(await h.snapshot());

  const run = await captureReplay(h, "dismiss", async () => {
    const blast = await detonateGas(h, FIRST_COL, row);
    await elapse(h, SHOWN_AT);
    const shown = await h.snapshot();

    await h.debug.dismissNotice();
    await h.advance(1);
    const dismissed = await h.snapshot();

    await elapse(h, 1);
    return { blast, shown, dismissed, settled: await h.snapshot() };
  });

  assertEqual(run.blast.cut.broke, true, "the pocket detonated");
  assertEqual(run.shown.notice?.shown, true, "the card is up before the click");

  assertNull(run.dismissed.notice, "no card on the frame after the click");
  assertNull(run.settled.notice, "and none a second later");

  // The card went because it was clicked, not because it timed out: the click
  // landed sooner after the hit than the earliest moment any reading of the fade
  // could have taken the card away.
  assertLessThan(
    run.dismissed.simTime - run.blast.snapshot.simTime,
    NOTICE_FADE,
    "game time between the hit and the click",
  );
});
