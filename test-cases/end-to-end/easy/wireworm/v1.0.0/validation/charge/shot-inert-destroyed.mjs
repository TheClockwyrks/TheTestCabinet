// Automated validation for charge.shot-inert-destroyed: a bolt into an inert node
// removes it (and scores), never raising its charge.
//
// An inert node above the cursor is the precondition; the destruction is produced
// by the real resolveBolt -> hitNode path as the bolt travels up and is read back.

import { chargeAt, fireAndResolve, freshBoard, tileCX } from "../_helpers.mjs";

const C = 20;
const R = 10;

export default async function drive(api, ttc) {
  const check = ttc.checkOne("charge.shot-inert-destroyed");

  await freshBoard(api);
  await api.call("setNode", C, R, 0);
  await api.call("setCursor", tileCX(C), 688);

  const before = (await api.snapshot()).score;
  const snap = await fireAndResolve(api);

  check.expectEq("the inert node is destroyed by the bolt", chargeAt(snap, C, R), -1);
  check.expectGt("shooting an inert node scores", snap.score, before);

  // A live clip of the bolt clearing the node.
  await freshBoard(api);
  await api.call("setNode", C, R, 0);
  await api.call("setCursor", tileCX(C), 688);
  await api.call("setAutoStep", true);
  await api.call("fire");
  await api.wait(700);

  return check.verdict();
}
