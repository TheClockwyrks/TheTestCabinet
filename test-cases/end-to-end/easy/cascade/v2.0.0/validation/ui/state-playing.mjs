// Automated validation for the Presentation sub-item `state-playing`: the live table
// is reachable, and the debug API captures it. A fresh deal enters play; the screen
// is read back and the dealt table captured. Whether the table reads and lays out
// well is left to the reviewer from the capture.
//
// The deal is instant and begins with a `reset` (arrange-only), so it is posed in
// `arrange`; `act` lets the dealt table paint and captures it. That pause is
// `actShoot`'s `api.settle`, not an advance: a screenshot must read a PAINTED frame,
// and stepping the simulation produces none. `settle` is real milliseconds in both
// passes, so the 120 ms carries over unconverted.

import { actShoot, deal } from "../_helpers.mjs";

export default function item() {
  // The post-deal snapshot.
  let s;

  return {
    id: "ui.state-playing",

    async arrange(api) {
      s = await deal(api, 8);
    },

    async act(api) {
      await actShoot(api, "playing", 120);
    },

    async assert(api, check) {
      check.expectEq("a new game enters the live table", s.screen, "playing");
    },
  };
}
