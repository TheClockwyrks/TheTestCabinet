// Automated validation for charge.discharge-chains: a detonation arcs to charged
// nodes within 2 tiles and chains onward through the connected cluster, clearing
// the whole swath; a charged node beyond reach survives.
//
// The cluster (a critical node and two charged nodes each within 2 of the previous)
// plus one far charged node are the preconditions; the chain is produced by the real
// detonate BFS when the shot lands, read back from the snapshot. Arcs recorded in
// the same snapshot confirm the discharge fired.

import { chargeAt, fireAndResolve, freshBoard, tileCX } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("charge.discharge-chains");

  await freshBoard(api);
  // A connected charged cluster along row 5: crit at 10, charged at 12 and 14 (each
  // a Chebyshev 2 from the previous), and a far charged node at 20 (out of reach).
  await api.call("setNode", 10, 5, 3);
  await api.call("setNode", 12, 5, 1);
  await api.call("setNode", 14, 5, 2);
  await api.call("setNode", 20, 5, 2);
  await api.call("setCursor", tileCX(10), 688);

  const snap = await fireAndResolve(api);

  check.expectEq("the shot node clears", chargeAt(snap, 10, 5), -1);
  check.expectEq("a charged node within reach chains and clears (12)", chargeAt(snap, 12, 5), -1);
  check.expectEq("the chain carries onward through the cluster (14)", chargeAt(snap, 14, 5), -1);
  check.expectEq("a charged node beyond reach survives (20)", chargeAt(snap, 20, 5), 2);
  check.expectGt("discharge arcs are drawn between the chained nodes", snap.arcs.length, 0);

  // A live clip of the chain-arc clearing the cluster.
  await freshBoard(api);
  await api.call("setNode", 10, 5, 3);
  await api.call("setNode", 12, 5, 1);
  await api.call("setNode", 14, 5, 2);
  await api.call("setNode", 20, 5, 2);
  await api.call("setCursor", tileCX(10), 688);
  await api.call("setAutoStep", true);
  await api.call("fire");
  await api.wait(800);

  return check.verdict();
}
