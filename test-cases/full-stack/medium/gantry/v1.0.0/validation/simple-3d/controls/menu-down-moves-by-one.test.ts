// controls/menu-down-moves-by-one — `down` moves the menu highlight to the next
// entry.
//
// `specs/ui.md` § The screens: "On every menu `up` and `down` move the
// highlight by one entry and wrap at both ends". `specs/controls.md` § The
// actions binds `down` to `ArrowDown` and gives it "menu navigation".
//
// THE MOVE ALONE, AND ONE PRESS DECIDES IT. What happens off the last entry is
// `controls/menu-down-wraps`, and the two are separate points because the two
// are separately failable: a build that clamps at the end still moves the
// highlight everywhere else, and must not grade as one whose `down` does
// nothing at all.
//
// THE TITLE MENU, BECAUSE IT IS WHERE THE GAME OPENS. `specs/ui.md` § Title:
// the menu is `TITLE_ITEMS` (`SITES`, `HOW TO PLAY`), "with `menuIndex` `0` on
// arriving", so the opening state is already an entry with somewhere below it,
// and one press reads `1`.
//
// Nothing is posed on the way: the harness's opening `reset` leaves "the
// `title` screen with `menuIndex` `0`" (`specs/instrumentation.md`), which is
// the state this scenario needs.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS, TITLE_ITEMS } from "../constants";
import { createHarness, type Harness } from "../harness";

/** The `down` action's binding, as `specs/controls.md` fixes it. */
const DOWN = BINDINGS.down[0]!;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("moves the title menu's highlight to the next entry", async () => {
  const opening = await h.snapshot();
  assertEqual(opening.screen, "title", "the menu screen the press lands on");
  assertEqual(opening.menuIndex, 0, "the entry the title menu opens on");
  assertEqual(
    TITLE_ITEMS.length,
    2,
    "the entries the title menu carries (specs/ui.md § Title)",
  );

  await h.press(DOWN);

  const after = await h.snapshot();

  await h.advance(1);
  await h.capture("state", "the title menu after down moved to the next entry");

  assertEqual(
    after.menuIndex,
    1,
    `menuIndex after ${DOWN} on the first entry of a menu of ` +
      `${TITLE_ITEMS.length}, which moves the highlight by one entry ` +
      "(specs/ui.md § The screens)",
  );
});
