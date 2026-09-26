// screens/title-ignores-left-and-right — neither `left` nor `right` does anything
// on the title.
//
// THE RULE, `specs/controls.md`, What each screen reads. The title's row is
// "`up` and `down` move the highlight; `confirm` takes it; `mute`", and beneath
// the table: "An action a row omits does nothing on that screen." `left` and
// `right` are omitted from that row — `specs/controls.md`'s Navigation table
// gives them to the how-to's pages and to the tape cursor, neither of which is on
// screen here — so on the title they are dead keys. `specs/ui.md` says the same
// from the other side: the title's own paragraph gives the menu `up`, `down`,
// `confirm` and `back`, and Menu navigation reserves `left` and `right` for the
// how-to: "`left` and `right` turn the `howto` pages."
//
// THE CONFIGURATION is the title with the highlight posed OFF its arrival value,
// onto the second entry of `TITLE_ITEMS`, and one press of each key in turn, each
// read back on its own so the failure names which of the two moved something.
// The pose is what makes the point decidable: with the highlight left at `0`, a
// build that answered either key by re-entering the title would be
// indistinguishable from one that ignored them.
//
// THE VERDICT. After the `left` press, and again after the `right` press, the
// screen is still `title` and `menuIndex` is still `1`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  openTitle,
  pressAction,
  type Harness,
} from "../harness";

/** Where the highlight is left standing: anywhere but the arrival value. */
const HELD = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the screen and the highlight untouched by left and by right", async () => {
  assertGreaterThan(
    TITLE_ITEMS.length,
    HELD,
    "TITLE_ITEMS carries an entry the highlight can be held on, away from 0",
  );

  await openTitle(h);
  await h.debug.setMenuIndex(HELD);
  await h.advance(1);

  const before = await h.snapshot();
  assertEqual(
    before.screen,
    "title",
    "the presses this point reads are delivered on the title screen",
  );
  assertEqual(
    before.menuIndex,
    HELD,
    `the highlight is held on ${TITLE_ITEMS[HELD]}, away from the value an ` +
      "arrival at the title would set",
  );

  const afterLeft = await pressAction(h, "left");
  const afterRight = await pressAction(h, "right");
  await captureStill(h, "unchanged");

  assertEqual(
    afterLeft.screen,
    "title",
    "left is omitted from the title's row, so it does not leave the screen",
  );
  assertEqual(
    afterLeft.menuIndex,
    HELD,
    "left is omitted from the title's row, so it does not move the highlight",
  );
  assertEqual(
    afterRight.screen,
    "title",
    "right is omitted from the title's row, so it does not leave the screen",
  );
  assertEqual(
    afterRight.menuIndex,
    HELD,
    "right is omitted from the title's row, so it does not move the highlight",
  );
});
