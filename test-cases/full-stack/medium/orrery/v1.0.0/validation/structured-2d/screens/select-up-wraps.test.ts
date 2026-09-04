// screens/select-up-wraps — `up` on the first row wraps the select highlight round
// to the last.
//
// THE RULE. "`up` and `down` move the highlight by one row, WRAPPING AT BOTH
// ENDS" (`specs/modes/campaign.md`, The select screen), which the Extras take
// unchanged (`specs/modes/extras.md`). This point decides the wrap at the TOP;
// the wrap at the bottom is `select-down-wraps`'s.
//
// THE POSE. Both modes, each on a fresh session, the highlight on row `0` — the
// row an arrival lands on with nothing entered — put there with `setSelectIndex`
// so the pose costs no press. The row it must reach is read from the snapshot:
// `campaign.count` is "how many challenges the shipped course holds", which the
// build chooses between `CAMPAIGN_MIN` (`8`) and `CAMPAIGN_MAX` (`16`), and
// `extras.count` is `EXTRA_COUNT` (`10`).
//
// THE VERDICT. `selectIndex` is the list's last row after the press, in each
// mode, rather than standing still at `0` or falling below it. The game is still
// on the select screen.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { MODES } from "../constants";
import {
  captureStill,
  createHarness,
  openSelect,
  openTitle,
  pressAction,
  progressOf,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("moves selectIndex from 0 to the last row on one up press, in both modes", async () => {
  for (const mode of MODES) {
    await openTitle(h);
    await openSelect(h, mode);
    await h.debug.setSelectIndex(0);

    const posed = await h.snapshot();
    const count = progressOf(posed, mode).count;
    assertEqual(
      posed.screen,
      "select",
      `the press under test is made on the ${mode} select screen`,
    );
    assertGreaterThan(
      count,
      1,
      `the ${mode} list holds more than one row, so wrapping is a move rather ` +
        "than standing still",
    );
    assertEqual(
      posed.selectIndex,
      0,
      `the ${mode} highlight stands on the list's first row before the press`,
    );

    const after = await pressAction(h, "up");
    await captureStill(h, "wrapped");

    assertEqual(
      after.screen,
      "select",
      `the wrap moves the ${mode} highlight rather than leaving the screen`,
    );
    assertEqual(
      after.selectIndex,
      count - 1,
      `up on the ${mode} list's first row wraps the highlight round to its last`,
    );
  }
});
