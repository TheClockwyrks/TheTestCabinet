// Automated validation for states.howto: the how-to-play state is reachable from the title.
//
// HOW TO PLAY is clicked on the main menu, on the entry's own reported rectangle
// (`menuButtons()`), so the click lands wherever this build drew it.
//
// WHY THE MOUSE AND NOT `ArrowDown` + `Enter`. This used to move the highlight down and confirm.
// `specs/controls.md` makes the pointer the primary path and the keyboard "an alternative", so a
// build that binds no menu keys is conformant — and one failed this item, reporting the screen as
// unreachable when a player reaches it in one click. The keyboard route was also the more fragile
// of the two here: it depended on HOW TO PLAY being the SECOND entry and on the moved highlight
// having painted before the confirm, neither of which the spec fixes beyond the entry order. A
// click asks for the entry by name. See `clickMenu` in `_helpers.mjs`.
//
// Only the reset is arranged; NAVIGATING to the state is the behavior under test, so the click is
// the act.

import { clickMenu, snap } from "../_helpers.mjs";

// A real pause so the arrived-at screen has painted before the still is taken.
const PAINT_MS = 300;

export default function item() {
  // The entry that was clicked and the screen it landed on, both read by `assert`.
  let entry;
  let screen;

  return {
    id: "states.howto",

    async arrange(api) {
      await api.reset();
    },

    async act(api) {
      entry = await clickMenu(api, "howto");
      screen = (await snap(api)).screen;

      await api.settle(PAINT_MS); // let the screen paint before the still
      await api.screenshot("howto");
    },

    async assert(api, check) {
      check.expectOk("the title menu offers HOW TO PLAY as a clickable choice", Boolean(entry));
      check.expectEq("the how-to-play screen is reachable", screen, "howto");
    },
  };
}
