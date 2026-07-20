// Automated validation for worm.drop-reverse-node: blocked by a chargeable node the
// worm drops one row and reverses its horizontal heading (and charges the node).
//
// A node ahead of the worm is the precondition; the drop-and-reverse is produced by
// the real stepWorm block path and read back.

import {
  chargeAt,
  freshBoard,
  head,
  liveClip,
  setWorm,
  straightWorm,
  wormStep,
} from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("worm.drop-reverse-node");

  await freshBoard(api);
  await api.call("setNode", 10, 5, 0);
  await setWorm(api, straightWorm(9, 5, 5, 1), 1, 1); // heading right into the node

  const before = (await api.snapshot()).worms[0];
  check.expectEq("the worm starts heading right", before.dh, 1);

  const snap = await wormStep(api);
  check.expectEq("the worm drops one row when blocked", head(snap).r, 6);
  check.expectEq("the worm reverses its heading", snap.worms[0].dh, -1);
  check.expectEq("the blocking node is charged", chargeAt(snap, 10, 5), 1);

  await freshBoard(api);
  await api.call("setNode", 10, 5, 0);
  await setWorm(api, straightWorm(7, 5, 6, 1), 1, 1);
  await liveClip(api, 1400);

  return check.verdict();
}
