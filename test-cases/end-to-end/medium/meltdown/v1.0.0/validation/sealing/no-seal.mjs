// Automated validation for the Sealing sub-item `no-seal`.
//
// A placement that would leave a vent with no route to its exhaust is refused and
// shown invalid (specs/reactor.md). We wall column 25 top to bottom leaving a single
// two-tile gap at rows 16-17 — the last route across — then check that placing a
// tower to fill that gap is refused (canPlace false) and builds nothing.

import { newGame, build } from "../_helpers.mjs";

export default function item() {
  let countBefore;
  let countAfter;
  let can;

  return {
    id: "sealing.no-seal",

    // A full vertical wall at column 25 with a two-tile gap at rows 16-17 — the only
    // way across the floor left open.
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      for (const row of [
        0, 2, 4, 6, 8, 10, 12, 14, 18, 20, 22, 24, 26, 28, 30, 32, 34,
      ]) {
        await build(api, "arc", 25, row);
      }
      countBefore = (await api.snapshot()).towers.length;
    },

    // Try to close the last gap, both through the validator and through the real
    // placement path, then let a frame land for the still.
    async act(api) {
      can = await api.call("canPlace", "arc", 25, 16, 0);
      await api.call("placeTower", "arc", 25, 16, 0);
      countAfter = (await api.snapshot()).towers.length;
      await api.settle(80);
      await api.screenshot("seal");
    },

    async assert(api, check) {
      check.expectEq("filling the last route is refused (invalid)", can, false);
      check.expectEq(
        "nothing is built by a sealing placement",
        countAfter,
        countBefore,
      );
    },
  };
}
