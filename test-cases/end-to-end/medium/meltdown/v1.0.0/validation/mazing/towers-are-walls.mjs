// Automated validation for the Mazing sub-item `towers-are-walls`.
//
// Every tower is also a wall: placing towers across the direct route forces the
// surge to path the long way around (specs/playfield.md). We read the left vent's
// shortest route to its exhaust before and after building a wall across the straight
// lane — it lengthens.

import { newGame, build, spawn } from "../_helpers.mjs";

export default function item() {
  let before;
  let after;

  return {
    id: "mazing.towers-are-walls",

    // The baseline route length across the empty floor.
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      before = (await api.snapshot()).paths.left.length;
    },

    // Build the wall and re-read the route, then release two Motes so the clip shows
    // what the lengthened route means in practice: units routing the long way around.
    async act(api) {
      // A vertical wall across mid-field, blocking the straight left->right lane.
      for (const row of [14, 16, 18, 20]) await build(api, "arc", 25, row);
      after = (await api.snapshot()).paths.left.length;

      await spawn(api, "mote", "left");
      await spawn(api, "mote", "left");
      await api.advance(120);
    },

    async assert(api, check) {
      check.expectGt(
        "a wall across the lane lengthens the left vent's route",
        after,
        before,
      );
    },
  };
}
