// Automated validation for difficulty.select-menu: after MAP SELECT a DIFFICULTY SELECT lets
// the player pick Easy / Medium / Hard. This confirms the screen is reachable and captures it;
// how each entry reads what it changes is left to the reviewer.
//
// Only the reset is arranged; NAVIGATING to the screen is the behavior under test, so the two
// confirms and the reads between them are the act, and the clip walks the menu the way a player
// would.

import { snap } from "../_helpers.mjs";

// A menu screen is PAINTED, not simulated, and `advance` moves the simulation. On a menu the
// debug API's `step` does nothing at all (`specs/instrumentation.md`), and in the validate pass
// `advance` is an instant `step` — so advancing between two menu confirms paints no frame and
// lets no time pass. A build that reads its menu geometry from the last rendered frame (a
// perfectly ordinary way to lay a menu out, and how the panel read in
// `build/combine-actions-only` works) then sees the SECOND confirm before it has drawn the
// screen the first one moved to, and re-activates the entry it was already on. The screen never
// advances and a build whose menus a player walks without trouble fails.
//
// `settle` is what this needs and what it always meant: a real pause in both passes, which is
// the only thing that gives the build's own frame loop a chance to draw. Keep it to a paint
// settle — nothing here should move the game.
// Generous on purpose: a headless browser may throttle its frame loop, so this is sized to
// buy several repaints even then rather than the one or two a tighter pause assumes.
const SETTLE_MS = 300;

export default function item() {
  // The screen after each confirm, read by `assert`.
  let atMap;
  let atDifficulty;

  return {
    id: "difficulty.select-menu",

    async arrange(api) {
      await api.reset();
    },

    async act(api) {
      await api.settle(SETTLE_MS);

      await api.call("press", "Enter"); // title -> map select
      atMap = (await snap(api)).screen;
      await api.settle(SETTLE_MS); // let map select draw before confirming on it

      await api.call("press", "Enter"); // choose the first map -> difficulty select
      atDifficulty = (await snap(api)).screen;

      await api.settle(SETTLE_MS); // let the difficulty screen paint before the still
      await api.screenshot("select");
    },

    async assert(api, check) {
      check.expectEq("the map-select screen is reached", atMap, "mapselect");
      check.expectEq(
        "the difficulty-select screen is reachable",
        atDifficulty,
        "difficultyselect",
      );
    },
  };
}
