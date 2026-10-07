// screens/select-ignores-left-and-right — `left` and `right` do nothing on a
// select screen.
//
// THE RULE. The select row of `specs/controls.md`'s What each screen reads table
// is "`up` and `down` move the highlight; `confirm` opens the highlighted
// challenge when the mode's progression allows; `back` returns to `title`;
// `mute`", and the sentence under the table settles what the row's silence means:
// "An action a row omits does nothing on that screen." `left` and `right` are
// omitted, and the navigation table's entries for them name the two places they
// DO act — "How-to: previous page" / "next page" and "Tape focus: moves the
// cursor one cell" — neither of which is a select screen. `specs/ui.md` says it
// once more under Menu navigation: "`up` and `down` move the highlight, `confirm`
// takes the highlighted item, and `back` leaves the screen. `left` and `right`
// turn the `howto` pages."
//
// THE POSE. Both modes, each on a fresh session, with the highlight on row `1` —
// a row with a row on either side of it, so a build that mapped either key onto
// the highlight's movement moves off it whichever way it mapped them, where row
// `0` would hide half of that behind a wrap.
//
// THE VERDICT. After each of the two presses, taken one at a time so the failure
// names the key that broke it, `selectIndex` is still the posed row and `screen`
// is still `select`.

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

/** A row with a row on either side of it, so a move either way is visible. */
const ROW = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the highlight and the screen alone under left and under right", async () => {
  for (const mode of MODES) {
    await openTitle(h);
    await openSelect(h, mode);

    const count = progressOf(await h.snapshot(), mode).count;
    assertGreaterThan(
      count,
      ROW + 1,
      `the ${mode} list holds a row on either side of row ${ROW}, so a move ` +
        "either way would show",
    );
    await h.debug.setSelectIndex(ROW);

    const posed = await h.snapshot();
    assertEqual(
      posed.screen,
      "select",
      `the presses are made on the ${mode} select screen`,
    );
    assertEqual(
      posed.selectIndex,
      ROW,
      `the ${mode} highlight stands on the posed row before the presses`,
    );

    const afterLeft = await pressAction(h, "left");
    const afterRight = await pressAction(h, "right");
    await captureStill(h, "unchanged");

    assertEqual(
      afterLeft.screen,
      "select",
      `left is omitted from the select row, so it does not leave the ${mode} screen`,
    );
    assertEqual(
      afterLeft.selectIndex,
      ROW,
      `left is omitted from the select row, so it moves no ${mode} highlight`,
    );
    assertEqual(
      afterRight.screen,
      "select",
      `right is omitted from the select row, so it does not leave the ${mode} screen`,
    );
    assertEqual(
      afterRight.selectIndex,
      ROW,
      `right is omitted from the select row, so it moves no ${mode} highlight`,
    );
  }
});
