// Deepcore — notices/notice-fades: the card goes away on its own.
//
// `specs/hazards.md`: "The card is non-blocking: the mine keeps running behind
// it, and it fades on its own after `NOTICE_FADE` (`8`) seconds." So a card is
// raised and then nothing at all is done: no key, no click, no dismissal. It is
// read on screen shortly after it appears, and read gone once the fade has had
// its time.
//
// The gone reading is taken at `NOTICE_DELAY + NOTICE_FADE` plus three quarters
// of a second from the hit. That is past the fade whether a build counts the
// eight seconds from the hit or from the moment the card appeared, which the
// specification does not choose between, so every build that fades the card
// within its stated life passes and one that leaves it up does not.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import { NOTICE_DELAY, NOTICE_FADE } from "../../src/constants";
import { captureReplay, createHarness, type Harness } from "../harness";
import {
  detonateGas,
  elapse,
  FIRST_COL,
  gasRow,
  openNoticeScene,
} from "./notice-scene";

/** Comfortably after the card appears, and far short of any reading of the fade. */
const SHOWN_AT = NOTICE_DELAY + 0.5;

/** Past the fade counted from the card appearing, and so past it counted from the hit. */
const FADED_AT = NOTICE_DELAY + NOTICE_FADE + 0.75;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("fades the card on its own with nothing touched", async () => {
  openNoticeScene(h);
  const row = gasRow(h.snapshot());

  const fade = await captureReplay(h, "fade", async () => {
    const blast = await detonateGas(h, FIRST_COL, row);
    await elapse(h, SHOWN_AT);
    const shown = h.snapshot();
    await elapse(h, FADED_AT - SHOWN_AT);
    const gone = h.snapshot();
    return { blast, shown, gone };
  });

  assertEqual(fade.blast.cut.broke, true, "the pocket detonated");
  assertEqual(fade.shown.notice?.shown, true, "the card is up before the fade");
  assertNull(fade.gone.notice, `no card ${FADED_AT}s after the hit`);
});
