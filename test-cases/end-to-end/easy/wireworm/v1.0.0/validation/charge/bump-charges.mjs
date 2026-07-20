// Automated validation for charge.bump-charges: a chargeable node the worm is
// turned by gains one charge.
//
// An inert node and a worm heading into it are the preconditions; the +1 charge is
// produced by the real stepWorm -> chargeNode path when the sim steps, read back
// from the snapshot.

import {
  chargeAt,
  freshBoard,
  liveClip,
  setWorm,
  straightWorm,
  wormStep,
} from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("charge.bump-charges");

  await freshBoard(api);
  await api.call("setNode", 20, 5, 0); // an inert node
  await setWorm(api, straightWorm(19, 5, 5, 1), 1, 1); // head at (19,5), heading right into it

  check.expectEq("the node starts inert", chargeAt(await api.snapshot(), 20, 5), 0);
  const snap = await wormStep(api);
  check.expectEq("the bumped node gains one charge", chargeAt(snap, 20, 5), 1);

  // A live clip of a worm ricocheting off a node, charging it.
  await freshBoard(api);
  await api.call("setNode", 20, 5, 0);
  await setWorm(api, straightWorm(17, 5, 6, 1), 1, 1);
  await liveClip(api, 1400);

  return check.verdict();
}
