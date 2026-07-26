// Automated validation for the Movement item `refuse-edge`.
//
// A hop that would leave the strait is refused — the critter does not move and
// does not die. Two edges are checked through the real play code: a leftward hop
// from the leftmost column, and a downward hop from the near shore. See
// validation/_helpers.mjs.

import { startCrossing, ICE_TOP, ROW_NEAR } from "../_helpers.mjs";

export default function item() {
  // The state after each refused hop.
  let sLeft;
  let sDown;

  return {
    id: "movement.refuse-edge",

    // Pose the left edge: a cleared ice lane so nothing but the strait boundary can
    // stop the hop, and the critter on its leftmost tile.
    async arrange(api) {
      await startCrossing(api);
      await api.call("setLane", ICE_TOP, { cols: [] });
      await api.call("placeCritter", 0, ICE_TOP); // leftmost ice tile
    },

    // Both edges in one run: the leftward hop off the side, then the downward hop
    // below the near shore. The move between them is `placeCritter` alone — a control
    // op, so the clock stays with the runtime and the recording keeps rolling.
    async act(api) {
      await api.call("press", "ArrowLeft");
      await api.advance(18); // 0.15 s, just past the hop cooldown
      sLeft = await api.snapshot();

      // Below the near shore.
      await api.call("placeCritter", 20, ROW_NEAR);
      await api.call("press", "ArrowDown");
      await api.advance(18);
      sDown = await api.snapshot();
    },

    async assert(api, check) {
      check.expectEq(
        "a hop off the left edge is refused (column unchanged)",
        sLeft.critter.col,
        0,
      );
      check.expectEq(
        "no death from a refused edge hop",
        sLeft.screen,
        "playing",
      );
      check.expectNe("still crossing", sLeft.phase, "dying");
      check.expectEq(
        "a hop below the near shore is refused (row unchanged)",
        sDown.critter.row,
        ROW_NEAR,
      );
      check.expectEq("no death", sDown.screen, "playing");
    },
  };
}
