// screens/select-down-wraps — `down` on the last row wraps the select highlight
// round to the first.
//
// THE RULE. "`up` and `down` move the highlight by one row, WRAPPING AT BOTH
// ENDS" (`specs/modes/campaign.md`, The select screen), which the Extras take
// unchanged (`specs/modes/extras.md`). A select list is the opposite of the
// how-to's pages, which "stop" at their ends: here the row after the last is the
// first. This point decides the wrap at the BOTTOM; the wrap at the top is
// `select-up-wraps`'s.
//
// THE POSE. Both modes, each on a fresh session. The list's last row is read from
// the snapshot rather than assumed — `campaign.count` is "how many challenges the
// shipped course holds", which `specs/modes/campaign.md` leaves to the build
// between `CAMPAIGN_MIN` (`8`) and `CAMPAIGN_MAX` (`16`), and `extras.count` is
// `EXTRA_COUNT` (`10`) — and the highlight is put on it with `setSelectIndex`, so
// the pose costs no press.
//
// THE VERDICT. `selectIndex` is `0` after the press, in each mode: the highlight
// came round to the first row rather than stopping on the last or running past
// the end of the list. The game is still on the select screen.

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

it("moves selectIndex from the last row to 0 on one down press, in both modes", async () => {
  for (const mode of MODES) {
    await openTitle(h);
    await openSelect(h, mode);

    const count = progressOf(await h.snapshot(), mode).count;
    assertGreaterThan(
      count,
      1,
      `the ${mode} list holds more than one row, so wrapping is a move rather ` +
        "than standing still",
    );
    await h.debug.setSelectIndex(count - 1);

    const posed = await h.snapshot();
    assertEqual(
      posed.screen,
      "select",
      `the press under test is made on the ${mode} select screen`,
    );
    assertEqual(
      posed.selectIndex,
      count - 1,
      `the ${mode} highlight stands on the list's last row before the press`,
    );

    const after = await pressAction(h, "down");
    await captureStill(h, "wrapped");

    assertEqual(
      after.screen,
      "select",
      `the wrap moves the ${mode} highlight rather than leaving the screen`,
    );
    assertEqual(
      after.selectIndex,
      0,
      `down on the ${mode} list's last row wraps the highlight round to row 0`,
    );
  }
});
