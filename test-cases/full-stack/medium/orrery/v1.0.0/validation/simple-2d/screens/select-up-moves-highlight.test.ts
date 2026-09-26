// screens/select-up-moves-highlight — `up` moves the select highlight one row up
// the list.
//
// THE RULE. "`up` and `down` move the highlight by one row, wrapping at both
// ends" (`specs/modes/campaign.md`, The select screen), which the Extras take
// unchanged: "The highlight, its movement ... are as `specs/modes/campaign.md`
// states them" (`specs/modes/extras.md`). The select row of
// `specs/controls.md`'s What each screen reads grants the key, and the navigation
// table gives `up` the upward one: "Menus and select lists: moves the highlight
// up". This point decides the step UP from the second row; the wrap past the
// first row is `select-up-wraps`'s.
//
// THE POSE. Both modes, each on a fresh session, because the two share one screen
// and a build may have written the movement once or twice. The highlight is put
// on row `1` with `setSelectIndex`, the faculty gate for it, so the pose costs no
// press and there is a row above the highlight to reach without any wrap.
//
// THE VERDICT. `selectIndex` is `0` after the press, in each mode, and the game
// is still on the select screen.

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

it("moves selectIndex from 1 to 0 on one up press, in both modes", async () => {
  for (const mode of MODES) {
    await openTitle(h);
    await openSelect(h, mode);
    await h.debug.setSelectIndex(1);

    const posed = await h.snapshot();
    assertEqual(
      posed.screen,
      "select",
      `the press under test is made on the ${mode} select screen`,
    );
    assertGreaterThan(
      progressOf(posed, mode).count,
      1,
      `the ${mode} list holds more than one row, so the highlight can stand on ` +
        "the second",
    );
    assertEqual(
      posed.selectIndex,
      1,
      `the ${mode} highlight stands on row 1 before the press`,
    );

    const after = await pressAction(h, "up");
    await captureStill(h, "moved");

    assertEqual(
      after.screen,
      "select",
      `up moves the ${mode} highlight rather than leaving the screen`,
    );
    assertEqual(
      after.selectIndex,
      0,
      `up moves the ${mode} highlight by one row, so row 1 becomes row 0`,
    );
  }
});
