// Automated validation for movement.no-drill-up.
//
// The ceiling is solid: thrusting up into rock above never removes a tile (the only way up is
// the jetpack through tunnels already carved). We set a rock ceiling, hold thrust, run the real
// physics forward, and confirm the tile above is untouched and no upward cut ever begins.

import {
  K,
  newRun,
  standAt,
  solid,
  TOPSOIL_ROW,
  SPAWN_COL,
} from "../_helpers.mjs";

export default function item() {
  const col = SPAWN_COL;
  const row = TOPSOIL_ROW;
  let pre;
  let above;
  let snap;

  return {
    id: "movement.no-drill-up",

    // Grounded with a rock ceiling directly overhead.
    async arrange(api) {
      await newRun(api);
      await standAt(api, col, row);
      await solid(api, col, row - 1); // a rock ceiling directly above
      pre = await api.call("tileAt", col, row - 1);
    },

    // The sustained thrust into the ceiling is the behavior, and the clip shows the miner pinned
    // against rock that never gives.
    async act(api) {
      await api.call("keyDown", K.thrust);
      await api.advance(60); // 60 ticks = 1 s of thrust up into the ceiling
      await api.call("keyUp", K.thrust);

      above = await api.call("tileAt", col, row - 1);
      snap = await api.snapshot();
    },

    async assert(api, check) {
      check.expectOk(
        "the ceiling starts as solid rock",
        pre && pre.kind === "rock",
      );
      check.expectEq(
        "the ceiling tile is never removed",
        above ? above.kind : null,
        "rock",
      );
      check.expectEq(
        "no cut is ever directed upward",
        snap.miner.drilling,
        null,
      );
    },
  };
}
