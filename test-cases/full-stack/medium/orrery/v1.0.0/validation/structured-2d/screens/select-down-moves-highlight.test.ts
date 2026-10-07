// screens/select-down-moves-highlight — `down` moves the select highlight one row
// down the list.
//
// THE RULE. "`up` and `down` move the highlight by one row, wrapping at both
// ends" (`specs/modes/campaign.md`, The select screen), and the Extras take that
// screen unchanged: "The highlight, its movement, its resting position on
// arrival, the records a solved row shows, and `confirm` and `back` are as
// `specs/modes/campaign.md` states them" (`specs/modes/extras.md`). The select
// row of `specs/controls.md`'s What each screen reads grants the key — "`up` and
// `down` move the highlight" — and the navigation table gives `down` the
// downward one: "Menus and select lists: moves the highlight down". This point
// decides the step DOWN from the first row; the wrap past the last row is
// `select-down-wraps`'s.
//
// THE POSE. Both modes, each on a fresh session, because the two share one screen
// and a build may have written the movement once or twice. The highlight is put
// on row `0` with `setSelectIndex`, the faculty gate `specs/instrumentation.md`
// names for it ("Sets the highlighted row of the current mode's select screen"),
// so the pose costs no press and the only press is the one under test. Nothing
// else is posed: the campaign's locking is untouched, since the highlight "move[s]
// by one row" over the list rather than over the rows a mode will open — locking
// bears on `confirm` alone.
//
// THE VERDICT. `selectIndex` is `1` after the press, in each mode, and the game
// is still on the select screen: moving the highlight is not leaving it.

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

it("moves selectIndex from 0 to 1 on one down press, in both modes", async () => {
  for (const mode of MODES) {
    await openTitle(h);
    await openSelect(h, mode);
    await h.debug.setSelectIndex(0);

    const posed = await h.snapshot();
    assertEqual(
      posed.screen,
      "select",
      `the press under test is made on the ${mode} select screen`,
    );
    assertGreaterThan(
      progressOf(posed, mode).count,
      1,
      `the ${mode} list holds more than one row, so there is a row below the first`,
    );
    assertEqual(
      posed.selectIndex,
      0,
      `the ${mode} highlight stands on row 0 before the press`,
    );

    const after = await pressAction(h, "down");
    await captureStill(h, "moved");

    assertEqual(
      after.screen,
      "select",
      `down moves the ${mode} highlight rather than leaving the screen`,
    );
    assertEqual(
      after.selectIndex,
      1,
      `down moves the ${mode} highlight by one row, so row 0 becomes row 1`,
    );
  }
});
