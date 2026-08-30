// Automated validation for difficulty.select-menu: after MAP SELECT a DIFFICULTY SELECT lets
// the player pick Easy / Medium / Hard. This confirms the screen is reachable, that it offers all
// three difficulties as choices, and captures it; how each entry reads what it changes is left to
// the reviewer.
//
// The two menus are walked with the mouse, each click aimed at the entry's own reported rectangle
// (`menuButtons()`), so it lands wherever this build drew that entry.
//
// WHY THE MOUSE AND NOT `Enter`. This used to press `Enter` twice. `specs/controls.md` makes the
// pointer the primary path and the keyboard "an alternative", so a build that binds no menu keys
// is conformant — and one failed this item, reporting map select as never even reached when a
// player walks both menus with two clicks. Clicking also retires the paint race the keyboard
// route had to guard against with a fixed settle: an entry is clicked only once the build has
// reported it, which is proof it has drawn. See `clickMenu` in `_helpers.mjs`.
//
// Only the reset is arranged; NAVIGATING to the screen is the behavior under test, so the clicks
// and the reads between them are the act, and the clip walks the menu the way a player would.

import { clickMenu, readMenu, snap } from "../_helpers.mjs";

// A real pause so the difficulty screen has painted before the still is taken.
const PAINT_MS = 300;
// The three difficulties the screen must offer (`specs/modes.md`).
const DIFFICULTIES = ["difficulty-easy", "difficulty-medium", "difficulty-hard"];

export default function item() {
  // The screen after each click, and the choices the difficulty screen offered.
  let atMap;
  let atDifficulty;
  let offered;

  return {
    id: "difficulty.select-menu",

    async arrange(api) {
      await api.reset();
    },

    async act(api) {
      await clickMenu(api, "salvage"); // title -> map select
      atMap = (await snap(api)).screen;

      await clickMenu(api, "map-substation"); // choose the first map -> difficulty select
      atDifficulty = (await snap(api)).screen;

      // Read the entries rather than clicking one: the item is about the screen OFFERING the
      // three difficulties to choose between, and choosing one would leave the screen.
      offered = (await readMenu(api)).map((e) => e.action);

      await api.settle(PAINT_MS); // let the difficulty screen paint before the still
      await api.screenshot("select");
    },

    async assert(api, check) {
      check.expectEq("the map-select screen is reached", atMap, "mapselect");
      check.expectEq(
        "the difficulty-select screen is reachable",
        atDifficulty,
        "difficultyselect",
      );
      for (const action of DIFFICULTIES) {
        check.expectOk(
          `...and offers ${action.replace("difficulty-", "")} as a choice`,
          offered.includes(action),
        );
      }
    },
  };
}
