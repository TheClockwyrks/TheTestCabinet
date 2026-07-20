// Automated validation for movement.drill-side.
//
// A side (left/right) cut begins only once the miner is flush against the tile edge: pressing
// sideways from mid-tile WALKS first and does not drill on the keypress. We confirm the very
// first tick moves the miner without a cut, then a cut against the wall begins shortly after.

import {
  K,
  newRun,
  standAt,
  solid,
  TOPSOIL_ROW,
  SPAWN_COL,
  TICK,
} from "../_helpers.mjs";

export default function item() {
  const col = SPAWN_COL;
  const row = TOPSOIL_ROW;
  let x0;
  let first;
  let cutting;

  return {
    id: "movement.drill-side",

    // Grounded and centered in its tile, with a rock wall one tile to the right.
    async arrange(api) {
      await newRun(api);
      await standAt(api, col, row); // grounded, centered in its tile
      await solid(api, col + 1, row); // a rock wall to the right to drill into
      x0 = (await api.snapshot()).miner.x;
    },

    // The walk-then-cut sequence is the behavior, and the clip shows it: the miner crosses to the
    // tile edge before the drill ever engages.
    async act(api) {
      await api.call("keyDown", K.right);
      await api.advance(TICK); // one tick: mid-tile, so it should walk, not drill
      first = (await api.snapshot()).miner;

      await api.advance(18); // 18 ticks = 0.3 s: reaches the edge and commits to the cut
      cutting = (await api.snapshot()).miner;
      await api.call("keyUp", K.right);
    },

    async assert(api, check) {
      check.expectEq(
        "no cut on the keypress from mid-tile (walks first)",
        first.drilling,
        null,
      );
      check.expectGt("the miner is walking toward the edge", first.x - x0, 0);
      check.expectOk(
        "a side cut has begun once flush",
        !!cutting.drilling && cutting.drilling.dir === "right",
      );
    },
  };
}
