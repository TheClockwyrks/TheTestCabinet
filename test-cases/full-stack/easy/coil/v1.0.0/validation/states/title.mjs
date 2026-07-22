// Automated validation for the Game States sub-item `title`.
//
// The title / main menu is the initial screen. A reset returns the game to it; the
// screen is read back and captured so a reviewer sees the actual menu (paired against
// the reference build's own title).
//
// The reset is instant, so it is `arrange`. The output is a still, but `act` still has
// to be the meaningful part: it holds long enough for the title to paint and then takes
// the capture, so the still shows a drawn menu rather than a blank first frame.

import { actSettleShot } from "../_helpers.mjs";

export default function item() {
  // The screen `act` read once the title had painted, checked by `assert`.
  let s;

  return {
    id: "states.title",

    async arrange(api) {
      await api.reset();
    },

    async act(api) {
      // settleMs 120 = the old api.wait(120). A REAL repaint pause in both passes, not
      // simulation time — no amount of instant stepping paints a frame.
      s = await actSettleShot(api, "title", { settleMs: 120 });
    },

    async assert(api, check) {
      check.expectEq("the title is the initial screen", s.screen, "title");
    },
  };
}
