// Automated validation for states.mapselect: the map-select state is reachable from the title.
//
// SALVAGE is clicked on the main menu the way a player clicks it — on the entry's own reported
// rectangle (`menuButtons()`), so the click lands wherever this build drew it.
//
// WHY THE MOUSE AND NOT `Enter`. This used to press `Enter` at the title. `specs/controls.md`
// makes the pointer the primary path and the keyboard "an alternative", so a build that binds no
// menu keys is conformant — and one failed this item, reporting the map-select screen as
// unreachable when it is reachable by mouse in a single click. The claim here is that the STATE is
// reachable, so the check takes the path the spec guarantees. See `clickMenu` in `_helpers.mjs`.
//
// Only the reset is arranged; NAVIGATING to the state is the behavior under test, so the click is
// the act and the clip shows the menu being walked.

import { clickMenu, snap } from "../_helpers.mjs";

// A real pause so the arrived-at screen has painted before the still is taken.
const PAINT_MS = 300;

export default function item() {
  // The entry that was clicked and the screen it landed on, both read by `assert`.
  let entry;
  let screen;

  return {
    id: "states.mapselect",

    async arrange(api) {
      await api.reset();
    },

    async act(api) {
      entry = await clickMenu(api, "salvage"); // confirm SALVAGE at the title
      screen = (await snap(api)).screen;

      await api.settle(PAINT_MS); // let the screen paint before the still
      await api.screenshot("mapselect");
    },

    async assert(api, check) {
      check.expectOk("the title menu offers SALVAGE as a clickable choice", Boolean(entry));
      check.expectEq("the map-select screen is reachable", screen, "mapselect");
    },
  };
}
