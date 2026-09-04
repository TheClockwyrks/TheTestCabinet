// controls/menu-down-wraps — `down` moves the menu highlight by one entry and
// wraps at the end.
//
// `specs/ui.md` § The screens: "On every menu `up` and `down` move the highlight
// by one entry and wrap at both ends". `specs/controls.md` § The actions binds
// `down` to `ArrowDown` and gives it "menu navigation".
//
// THE TITLE MENU, BECAUSE IT IS TWO ENTRIES. `specs/ui.md` § Title: the menu is
// `TITLE_ITEMS` (`SITES`, `HOW TO PLAY`), "with `menuIndex` `0` on arriving", and
// the game opens on `title`. Two entries is the shortest menu the game has, so
// three presses read `1`, `0`, `1`: the first is the move, the second is the wrap
// off the end, and the third shows the wrap left the menu somewhere it can go on
// moving from rather than stuck.
//
// THE WRAP IS THE POINT AND IS WHY THREE PRESSES ARE ONE REQUIREMENT: a build
// that clamps at the last entry passes the first press and fails the second, and
// a build that runs the index past the end fails the second as well. Reading only
// the first press would grade neither.
//
// Nothing is posed on the way: the harness's opening `reset` leaves "the `title`
// screen with `menuIndex` `0`" (`specs/instrumentation.md`), which is the state
// this scenario needs.

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
