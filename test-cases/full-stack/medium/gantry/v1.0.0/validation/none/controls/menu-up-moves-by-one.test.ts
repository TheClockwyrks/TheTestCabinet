// controls/menu-up-moves-by-one — `up` moves the menu highlight to the previous
// entry.
//
// `specs/ui.md` § The screens: "On every menu `up` and `down` move the
// highlight by one entry and wrap at both ends". `specs/controls.md` § The
// actions binds `up` to `ArrowUp` and gives it "menu navigation".
//
// THE MOVE ALONE, AND ONE PRESS DECIDES IT. What happens off the first entry is
// `controls/menu-up-wraps`, and the two are separate points because the two are
// separately failable: a build that clamps at `0` still moves the highlight
// everywhere else, and must not grade as one whose `up` does nothing at all.
//
// SO THE HIGHLIGHT IS POSED ON THE SECOND ENTRY. The title menu is two entries
// — `specs/ui.md` § Title gives it as `TITLE_ITEMS` (`SITES`, `HOW TO PLAY`)
// "with `menuIndex` `0` on arriving" — and the entry the game opens on has
// nothing above it, so the move is only readable from inside the menu.
// `setMenuIndex` "sets the highlighted entry of the menu on the screen showing"
// (`specs/instrumentation.md`), and index `1` is inside a two-entry menu.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS, TITLE_ITEMS } from "../constants";
import { createHarness, type Harness } from "../harness";

/** The `up` action's binding, as `specs/controls.md` fixes it. */
const UP = BINDINGS.up[0]!;

/** The entry the highlight is posed on: the one below the menu's first. */
const POSED = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("moves the title menu's highlight to the previous entry", async () => {
  assertEqual(
    TITLE_ITEMS.length,
    2,
    "the entries the title menu carries (specs/ui.md § Title)",
  );

  await h.debug.setMenuIndex(POSED);
  const posed = await h.snapshot();
  assertEqual(posed.screen, "title", "the menu screen the press lands on");
  assertEqual(posed.menuIndex, POSED, "the entry the highlight is posed on");

  await h.press(UP);

  const after = await h.snapshot();

  await h.advance(1);
  await h.capture(
    "state",
    "the title menu after up moved to the previous entry",
  );

  assertEqual(
    after.menuIndex,
    POSED - 1,
    `menuIndex after ${UP} on an interior entry of a menu of ` +
      `${TITLE_ITEMS.length}, which moves the highlight by one entry ` +
      "(specs/ui.md § The screens)",
  );
});
