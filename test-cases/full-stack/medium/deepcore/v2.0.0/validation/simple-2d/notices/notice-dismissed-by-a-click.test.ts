// Deepcore — notices/notice-dismissed-by-a-click: a press on the card takes it
// away at once.
//
// `specs/hazards.md`: "A click on the card dismisses it at once."
// `specs/controls.md` says the same from the pointer's side: "The first-time
// hazard notice card is dismissed by a press on it."
//
// SO THE PRESS IS A REAL PRESS. `specs/instrumentation.md` has the build report
// where it drew the card, as `controlRect("dismiss-notice", null)`: "The hazard
// notice card on screen". The pointer goes to the middle of the region the build
// named and presses and releases there, so what is graded is the card's own hit
// region and the game's own handling of a contact in it. A build that dismisses
// the card only through its debug operation, or that reports no region for a card
// it is showing, fails this point.
//
// The card is raised by a real detonation and left up only long enough to be on
// screen, then pressed; the notice must be gone on the very next frame. The
// elapsed game time since the card appeared is read alongside it and held well
// under `NOTICE_FADE`, so a build that simply let the card time out cannot pass
// this by waiting.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThan, assertNull } from "../assert";
import { NOTICE_DELAY, NOTICE_FADE } from "../constants";
import { captureReplay, createHarness, type Harness } from "../harness";
import { clickRegion, controlRegion } from "../panels/mouse";
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

afterEach(() => {
  h?.dispose();
});

it("dismisses the card on a press at the region the build reports for it", async () => {
  openNoticeScene(h);
  const row = gasRow(h.snapshot());

  const run = await captureReplay(h, "dismiss", async () => {
    const blast = await detonateGas(h, FIRST_COL, row);
    await elapse(h, SHOWN_AT);
    const shown = h.snapshot();

    await clickRegion(h, controlRegion(h, "dismiss-notice"));
    const dismissed = h.snapshot();

    await elapse(h, 1);
    return { blast, shown, dismissed, settled: h.snapshot() };
  });

  assertEqual(run.blast.cut.broke, true, "the pocket detonated");
  assertEqual(run.shown.notice?.shown, true, "the card is up before the press");

  assertNull(run.dismissed.notice, "no card on the frame after the press");
  assertNull(run.settled.notice, "and none a second later");

  // The card went because it was pressed, not because it timed out: the press
  // landed sooner after the hit than the earliest moment any reading of the fade
  // could have taken the card away.
  assertLessThan(
    run.dismissed.simTime - run.blast.snapshot.simTime,
    NOTICE_FADE,
    "game time between the hit and the press",
  );
});
