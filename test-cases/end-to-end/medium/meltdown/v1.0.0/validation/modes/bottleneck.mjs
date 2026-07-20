// Automated validation for the Modes sub-item `bottleneck`.
//
// Bottleneck restricts building to a central zone — placements outside it are refused
// (specs/modes.md). We confirm a placement inside the central zone is valid and one
// in a corner outside it is refused.

import { newGame } from "../_helpers.mjs";

export default function item() {
  let inside;
  let outside;

  return {
    id: "modes.bottleneck",

    async arrange(api) {
      await newGame(api, "bottleneck");
    },

    // Ask the real placement validator about a spot in the zone and a spot outside
    // it, then let a frame land so the still shows the zone the mode draws.
    async act(api) {
      inside = await api.call("canPlace", "arc", 20, 15, 0); // within the central zone
      outside = await api.call("canPlace", "arc", 1, 1, 0); // a corner, outside the zone
      await api.settle(80);
      await api.screenshot("zone");
    },

    async assert(api, check) {
      check.expectEq(
        "a placement inside the central zone is allowed",
        inside,
        true,
      );
      check.expectEq("a placement outside the zone is refused", outside, false);
    },
  };
}
