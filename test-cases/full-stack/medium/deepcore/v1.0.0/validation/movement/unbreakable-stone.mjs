// Automated validation for movement.unbreakable-stone.
//
// An unbreakable-stone boulder is not minable: drilling into it makes no progress and never
// clears it. We stand the miner on a stone tile, hold down, run the real drill forward, and
// confirm no cut ever starts and the stone is still there.

import { K, newRun, TOPSOIL_ROW, SPAWN_COL } from "../_helpers.mjs";

export default function item() {
  const col = SPAWN_COL;
  const row = TOPSOIL_ROW;
  let pre;
  let after;
  let snap;

  return {
    id: "movement.unbreakable-stone",

    // Settled on a stone floor — the one tile kind the drill can never take.
    async arrange(api) {
      await newRun(api);
      await api.call("teleport", col, row);
      await api.call("setTile", col, row + 1, { kind: "stone" }); // stone floor to drill into
      await api.call("teleport", col, row); // settle onto the stone
      pre = await api.call("tileAt", col, row + 1);
    },

    // The sustained attempt to drill is the behavior, and the clip shows the stone not budging.
    async act(api) {
      await api.call("keyDown", K.down);
      await api.advance(60); // 60 ticks = 1 s
      await api.call("keyUp", K.down);

      after = await api.call("tileAt", col, row + 1);
      snap = await api.snapshot();
    },

    async assert(api, check) {
      check.expectOk(
        "the tile below is unbreakable stone",
        pre && pre.kind === "stone",
      );
      check.expectEq(
        "stone is never cleared",
        after ? after.kind : null,
        "stone",
      );
      check.expectEq("no cut is ever made on stone", snap.miner.drilling, null);
      check.expectEq("the miner has not descended", snap.miner.row, row);
    },
  };
}
