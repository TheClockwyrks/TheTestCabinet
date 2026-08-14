// Automated validation for the Controls item `menu-move`: Up/Down (or W/S) move the title
// menu selection. From the title, Down advances the highlighted entry, Up returns it, and
// S also advances it — each read back from the menu index.
//
// The reset to the title is the precondition (`arrange`); every key press is the behavior, so
// they all live in `act` with a short hold between them, which is what makes the clip legible
// — a reviewer watches the highlight step down, back up, and down again.

import { title } from "../_helpers.mjs";

export default function item() {
  // The menu index at each step, read by `assert`.
  let opening;
  let afterDown;
  let afterUp;
  let afterS;

  return {
    id: "controls.menu-move",

    async arrange(api) {
      await title(api);
    },

    async act(api) {
      opening = (await api.snapshot()).menuIndex;

      // 0.4 s x 120 Hz = 48 ticks between presses: long enough that each move is a
      // distinct beat in the clip, and idle time on the title changes nothing else.
      await api.call("press", "ArrowDown");
      afterDown = (await api.snapshot()).menuIndex;
      await api.advance(48);

      await api.call("press", "ArrowUp");
      afterUp = (await api.snapshot()).menuIndex;
      await api.advance(48);

      await api.call("press", "KeyS");
      afterS = (await api.snapshot()).menuIndex;
      await api.advance(48);
    },

    async assert(api, check) {
      check.expectEq("the title opens on the first entry", opening, 0);
      check.expectEq(
        "Down moves the selection to the next entry",
        afterDown,
        1,
      );
      check.expectEq("Up moves the selection back", afterUp, 0);
      check.expectEq("S also moves the selection down", afterS, 1);
    },
  };
}
