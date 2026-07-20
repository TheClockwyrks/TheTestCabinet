// Automated validation for worm.drop-reverse-edge: blocked by a side edge the worm
// drops and reverses, but charges nothing (there is no node there to charge).
//
// A worm at the left edge heading into it is the precondition; the turn is produced
// by the real stepWorm edge path. The board stays empty of nodes — the edge turn
// creates none.

import {
  freshBoard,
  head,
  liveClip,
  setWorm,
  straightWorm,
  wormStep,
} from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("worm.drop-reverse-edge");

  await freshBoard(api);
  // Head at column 0 heading left, so the next step runs into the side edge.
  await setWorm(api, straightWorm(0, 5, 4, -1), -1, 1);

  const snap = await wormStep(api);
  check.expectEq("the worm drops one row at the edge", head(snap).r, 6);
  check.expectEq("the worm reverses its heading", snap.worms[0].dh, 1);
  check.expectEq("the edge turn charges nothing (no node created)", snap.nodes.length, 0);

  await freshBoard(api);
  await setWorm(api, straightWorm(2, 5, 5, -1), -1, 1);
  await liveClip(api, 1400);

  return check.verdict();
}
