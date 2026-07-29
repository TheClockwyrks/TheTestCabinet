// Automated validation for states.howto: the how-to-play state is reachable from the title.
//
// Only the reset is arranged; NAVIGATING to the state is the behavior under test, so the menu
// move and the confirm are the act.

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
  // The screen the navigation landed on, read by `assert`.
  let screen;

  return {
    id: "states.howto",

    async arrange(api) {
      await api.reset();
    },

    async act(api) {
      await api.settle(SETTLE_MS);
      await api.call("press", "ArrowDown"); // move to HOW TO PLAY
      await api.settle(SETTLE_MS); // let the moved highlight draw before confirming on it
      await api.call("press", "Enter");
      screen = (await snap(api)).screen;

      await api.settle(SETTLE_MS); // let the screen paint before the still
      await api.screenshot("howto");
    },

    async assert(api, check) {
      check.expectEq("the how-to-play screen is reachable", screen, "howto");
    },
  };
}
