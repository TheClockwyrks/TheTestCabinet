// Automated validation for worm.shot-leaves-node: a worm segment killed by a bolt
// leaves a fresh inert node in the tile where it died, thickening the field.
//
// A straight worm on a low row (empty board) is the precondition; the node is left
// by the real hitWorm -> leaveNode path and read back at the killed segment's tile.

import { chargeAt, fireAndResolve, freshBoard, setWorm, straightWorm, tileCX } from "../_helpers.mjs";

const KILL_C = 8;
const R = 15;

export default async function drive(api, ttc) {
  const check = ttc.checkOne("worm.shot-leaves-node");

  await freshBoard(api);
  await setWorm(api, straightWorm(12, R, 5, 1), 1, 1); // tail at column 8, row 15
  await api.call("setCursor", tileCX(KILL_C), 688);

  check.expectEq("the tile is empty before the shot", chargeAt(await api.snapshot(), KILL_C, R), -1);
  const snap = await fireAndResolve(api);
  check.expectEq("a shot-killed segment leaves a fresh inert node", chargeAt(snap, KILL_C, R), 0);

  await freshBoard(api);
  await setWorm(api, straightWorm(12, R, 5, 1), 1, 1);
  await api.call("setCursor", tileCX(KILL_C), 688);
  await api.call("setAutoStep", true);
  await api.call("fire");
  await api.wait(900);

  return check.verdict();
}
