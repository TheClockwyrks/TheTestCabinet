// Automated validation for foes.corruptor-slams: the corruptor slams every node it
// passes straight to critical (charge 3), leaving a dive-lane cluster.
//
// Inert nodes along a row and a corruptor crossing them are the preconditions; the
// slams are produced by the real updateFoe corruptor branch (game.slamNode) as it
// crosses each column, read back as the nodes reaching critical.

import { chargeAt, freshBoard, liveClip, tileCX } from "../_helpers.mjs";

const ROW = 3;
const COLS_HIT = [10, 12, 14];

export default async function drive(api, ttc) {
  const check = ttc.checkOne("foes.corruptor-slams");

  await freshBoard(api);
  for (const c of COLS_HIT) await api.call("setNode", c, ROW, 0); // inert nodes in its path
  await api.call("spawnFoe", "corruptor", { row: ROW, x: tileCX(8), vx: 130 });

  await api.step(2.0); // let it cross all three columns
  const snap = await api.snapshot();
  for (const c of COLS_HIT) {
    check.expectEq(`the node at column ${c} is slammed to critical`, chargeAt(snap, c, ROW), 3);
  }

  await freshBoard(api);
  for (const c of COLS_HIT) await api.call("setNode", c, ROW, 0);
  await api.call("spawnFoe", "corruptor", { row: ROW, x: tileCX(6), vx: 130 });
  await liveClip(api, 2000);

  return check.verdict();
}
