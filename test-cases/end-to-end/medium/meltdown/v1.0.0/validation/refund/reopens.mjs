// Automated validation for the Refund sub-item `reopens`.
//
// Selling a tower reopens every tile in its footprint and re-paths the surge
// (specs/towers.md), so a route it lengthened shortens again. We measure the left
// vent's route, wall the lane (lengthening it), then sell the wall and confirm the
// route returns to its original length.

import { newGame, build } from "../_helpers.mjs";

export default function item() {
  let before;
  let walled;
  let after;

  return {
    id: "refund.reopens",

    // The baseline route length, measured on the empty floor before anything is built.
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      before = (await api.snapshot()).paths.left.length;
    },

    // Wall the lane and then sell the wall back off. This IS the clip the old script
    // appended by hand: the route lengthens as the wall goes up and reopens as it
    // comes down.
    async act(api) {
      const ids = [];
      for (const row of [14, 16, 18, 20])
        ids.push(await build(api, "arc", 25, row));
      walled = (await api.snapshot()).paths.left.length;

      for (const id of ids) await api.call("sellTower", id);
      after = (await api.snapshot()).paths.left.length;
    },

    async assert(api, check) {
      check.expectGt("the wall lengthened the route", walled, before);
      check.expectEq(
        "selling the wall reopens the route to its original length",
        after,
        before,
      );
    },
  };
}
