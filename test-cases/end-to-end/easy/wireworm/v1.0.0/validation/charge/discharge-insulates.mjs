// Automated validation for charge.discharge-insulates: an inert node does not
// detonate and does not carry the chain.
//
// The scene poses a critical node, a charged node next to it (which chains and
// clears), an inert node just past the blast, and a charged node reachable only
// THROUGH that inert node. The real detonate BFS decides what clears: the inert
// node stays standing (it is not charged, so it never detonates) and the far
// charged node survives (the chain cannot hop through the inert gap).

import { chargeAt, fireAndResolve, freshBoard, tileCX } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("charge.discharge-insulates");

  await freshBoard(api);
  await api.call("setNode", 10, 5, 3); // critical (shot)
  await api.call("setNode", 11, 5, 2); // charged, within reach -> chains, clears
  await api.call("setNode", 12, 5, 0); // inert, inside the blast radius -> stays
  await api.call("setNode", 14, 5, 2); // charged, only reachable through the inert -> survives
  await api.call("setCursor", tileCX(10), 688);

  const snap = await fireAndResolve(api);

  check.expectEq("the critical node clears", chargeAt(snap, 10, 5), -1);
  check.expectEq("a charged node within reach chains and clears (11)", chargeAt(snap, 11, 5), -1);
  check.expectEq("the inert node inside the blast stays standing (12)", chargeAt(snap, 12, 5), 0);
  check.expectEq("a charged node behind the inert node survives (14)", chargeAt(snap, 14, 5), 2);

  // A live clip of the insulated discharge.
  await freshBoard(api);
  await api.call("setNode", 10, 5, 3);
  await api.call("setNode", 11, 5, 2);
  await api.call("setNode", 12, 5, 0);
  await api.call("setNode", 14, 5, 2);
  await api.call("setCursor", tileCX(10), 688);
  await api.call("setAutoStep", true);
  await api.call("fire");
  await api.wait(800);

  return check.verdict();
}
