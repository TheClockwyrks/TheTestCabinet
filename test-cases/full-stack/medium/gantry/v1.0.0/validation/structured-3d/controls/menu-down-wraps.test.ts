// controls/menu-down-wraps — `down` wraps the menu highlight off the last
// entry.
//
// `specs/ui.md` § The screens: "On every menu `up` and `down` move the
// highlight by one entry and wrap at both ends". `specs/controls.md` § The
// actions binds `down` to `ArrowDown` and gives it "menu navigation".
//
// THE WRAP ALONE. That `down` moves by one is
// `controls/menu-down-moves-by-one`; what this one asks is where the highlight
// goes when there is no next entry, so a build that clamps at the end fails
// here and passes there.
//
// THE HIGHLIGHT IS POSED ON THE LAST ENTRY RATHER THAN WALKED THERE. The title
// menu is two entries — `specs/ui.md` § Title gives it as `TITLE_ITEMS`
// (`SITES`, `HOW TO PLAY`) "with `menuIndex` `0` on arriving" — so reaching the
// end by pressing would make the reading turn on the move as well: two presses
// read `0` on a wrapping build and `0` on a build whose `down` does nothing,
// and the two would grade the same. Posed on the last entry, one press
// separates all three readings — `0` wraps, `1` clamps, and a build that runs
// the index past the end lands somewhere no entry stands.
//
// `setMenuIndex` "sets the highlighted entry of the menu on the screen showing"
// (`specs/instrumentation.md`), and index `1` is inside a two-entry menu.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS, TITLE_ITEMS } from "../constants";
import { createHarness, type Harness } from "../harness";

/** The `down` action's binding, as `specs/controls.md` fixes it. */
const DOWN = BINDINGS.down[0]!;

/** What the highlight reads after each press of `down` from `0`. */
const EXPECTED = [1, 0, 1];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("moves the title menu's highlight by one and wraps off the last entry", async () => {
  const opening = await h.snapshot();
  assertEqual(opening.screen, "title", "the menu screen the presses land on");
  assertEqual(opening.menuIndex, 0, "the entry the title menu opens on");
  assertEqual(
    TITLE_ITEMS.length,
    2,
    "the entries the title menu carries (specs/ui.md § Title)",
  );

  for (const [press, index] of EXPECTED.entries()) {
    await h.press(DOWN);
    assertEqual(
      (await h.snapshot()).menuIndex,
      index,
      `menuIndex after press ${press + 1} of ${DOWN} on a menu of ` +
        `${TITLE_ITEMS.length} entries, which moves the highlight by one and ` +
        "wraps at both ends (specs/ui.md § The screens)",
    );
  }

  await h.advance(1);
  await h.capture("state", "the title menu after down wrapped off its end");
});
