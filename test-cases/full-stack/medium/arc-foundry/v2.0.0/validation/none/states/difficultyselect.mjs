// Automated validation for states.difficultyselect: the difficulty-select state is reachable
// after a map is chosen.
//
// SALVAGE is clicked at the title and then a map on map select, both on the entries' own reported
// rectangles (`menuButtons()`), so each click lands wherever this build drew that entry.
//
// WHY THE MOUSE AND NOT `Enter`. This used to press `Enter` twice. `specs/controls.md` makes the
// pointer the primary path and the keyboard "an alternative", so a build that binds no menu keys is
// conformant — and one failed this item, reporting the screen as unreachable when a player reaches
// it in two clicks. The claim here is that the STATE is reachable, so the check takes the path the
// spec guarantees. It also removes the paint race the keyboard route had: a click is aimed at a
// rectangle the build has actually reported, so arriving at the second menu is confirmed by
// finding its entries rather than assumed after a pause. See `clickMenu` in `_helpers.mjs`.
//
// Only the reset is arranged; NAVIGATING to the state is the behavior under test, so the two
// clicks are the act and the clip walks the menu the way a player would.

import { clickMenu, snap } from "../_helpers.mjs";

// A real pause so the arrived-at screen has painted before the still is taken.
const PAINT_MS = 300;

export default function item() {
  // Each click's entry and the screen the navigation landed on, read by `assert`.
  let salvage;
  let map;
  let screen;

  return {
    id: "states.difficultyselect",

    async arrange(api) {
      await api.reset();
    },

    async act(api) {
      salvage = await clickMenu(api, "salvage"); // title -> map select
      map = await clickMenu(api, "map-substation"); // choose a map -> difficulty select
      screen = (await snap(api)).screen;

      await api.settle(PAINT_MS); // let the screen paint before the still
      await api.screenshot("difficultyselect");
    },

    async assert(api, check) {
      check.expectOk("the title menu offers SALVAGE as a clickable choice", Boolean(salvage));
      check.expectOk("map select offers a map as a clickable choice", Boolean(map));
      check.expectEq("the difficulty-select screen is reachable", screen, "difficultyselect");
    },
  };
}
