// Automated validation for foes.corruptor-slams: the corruptor slams every node it
// passes straight to critical (charge 3), leaving a dive-lane cluster.
//
// Inert nodes along a row and a corruptor crossing them are the preconditions; the
// slams are produced by the real updateFoe corruptor branch (game.slamNode) as it
// crosses each column, read back as the nodes reaching critical.

import { chargeAt, freshBoard, tileCX } from "../_helpers.mjs";

const ROW = 3;
const COLS_HIT = [10, 12, 14];

export default function item() {
  let snap;

  return {
    id: "foes.corruptor-slams",

    async arrange(api) {
      await freshBoard(api);
      for (const c of COLS_HIT) await api.call("setNode", c, ROW, 0); // inert nodes in its path
      await api.call("spawnFoe", "corruptor", {
        row: ROW,
        x: tileCX(8),
        vx: 130,
      });
    },

    // The crossing IS the clip: the reviewer watches each node go critical as the
    // corruptor passes over it, which is exactly what the assertions read.
    async act(api) {
      await api.advance(240); // 240 ticks = the old 2.0s, enough to cross all three columns
      snap = await api.snapshot();
      // The snapshot is captured; the sim runs on only so the finished cluster is
      // legible at the end of the clip.
      await api.advance(60); // 0.5s of visible aftermath
    },

    async assert(api, check) {
      for (const c of COLS_HIT) {
        check.expectEq(
          `the node at column ${c} is slammed to critical`,
          chargeAt(snap, c, ROW),
          3,
        );
      }
    },
  };
}
