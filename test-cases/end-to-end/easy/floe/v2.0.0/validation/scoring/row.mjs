// Automated validation for the Scoring item `row`.
//
// Advancing to a new row scores ten points per net new row. Three real up-hops are
// driven from the near shore across cleared ice tiles, and the score read back. See
// validation/_helpers.mjs.

import { startCrossing, ROW_NEAR } from "../_helpers.mjs";

export default function item() {
  // The state after the three hops.
  let after;

  return {
    id: "scoring.row",

    // Zero the score and clear the four ice rows above the near shore, so three
    // up-hops meet no traffic and the score reads exactly the rows advanced.
    async arrange(api) {
      await startCrossing(api);
      await api.call("setScore", 0);
      for (const r of [15, 16, 17, 18])
        await api.call("setLane", r, { cols: [] });
    },

    // Three discrete presses, one row each. The old clip tail instead HELD ArrowUp for
    // a continuous climb — a different scenario from the one the assertions drive, so
    // it is dropped: the clip shows the three counted hops that are actually checked.
    async act(api) {
      for (let i = 0; i < 3; i += 1) {
        await api.call("press", "ArrowUp");
        await api.advance(18); // 0.15 s, just past the hop cooldown, so each press lands
      }
      after = await api.snapshot();
    },

    async assert(api, check) {
      check.expectEq("advanced three rows", ROW_NEAR - after.critter.row, 3);
      check.expectEq("each row advanced scores ten points", after.score, 30);
    },
  };
}
