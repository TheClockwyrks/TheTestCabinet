// Automated validation for charge.discharge-insulates: an inert node does not
// detonate and does not carry the chain.
//
// The scene poses a critical node, a charged node next to it (which chains and
// clears), an inert node just past the blast, and a charged node reachable only
// THROUGH that inert node. The real detonate BFS decides what clears: the inert
// node stays standing (it is not charged, so it never detonates) and the far
// charged node survives (the chain cannot hop through the inert gap).

import {
  actFireAndResolve,
  chargeAt,
  freshBoard,
  tileCX,
} from "../_helpers.mjs";

export default function item() {
  let snap;

  return {
    id: "charge.discharge-insulates",

    async arrange(api) {
      await freshBoard(api);
      await api.call("setNode", 10, 5, 3); // critical (shot)
      await api.call("setNode", 11, 5, 2); // charged, within reach -> chains, clears
      await api.call("setNode", 12, 5, 0); // inert, inside the blast radius -> stays
      await api.call("setNode", 14, 5, 2); // charged, only reachable through the inert -> survives
      await api.call("setCursor", tileCX(10), 688);
    },

    // The shot and the chain it does (and does not) carry are one scenario. This is
    // the clip: the reviewer sees the inert node still standing in the swath.
    async act(api) {
      snap = await actFireAndResolve(api);
      // The snapshot is captured; the sim runs on only so the two survivors are
      // legible at the end of the clip.
      await api.advance(60); // 0.5s of visible aftermath
    },

    async assert(api, check) {
      check.expectEq("the critical node clears", chargeAt(snap, 10, 5), -1);
      check.expectEq(
        "a charged node within reach chains and clears (11)",
        chargeAt(snap, 11, 5),
        -1,
      );
      check.expectEq(
        "the inert node inside the blast stays standing (12)",
        chargeAt(snap, 12, 5),
        0,
      );
      check.expectEq(
        "a charged node behind the inert node survives (14)",
        chargeAt(snap, 14, 5),
        2,
      );
    },
  };
}
