// Automated validation for foes.glitch-eats: the glitch removes any node it passes
// over, of any charge (even a critical node).
//
// A critical node and a glitch posed over it are the preconditions; the eat is
// produced by the real updateFoe glitch branch (game.eatNode) when the sim steps and
// read back as the node's disappearance.

import { chargeAt, freshBoard, liveClip, tileCX, tileCY } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("foes.glitch-eats");

  await freshBoard(api);
  await api.call("setNode", 20, 10, 3); // a critical node
  await api.call("spawnFoe", "glitch", { x: tileCX(20), y: tileCY(10), vx: 0 });

  check.expectEq("the critical node stands before the glitch passes", chargeAt(await api.snapshot(), 20, 10), 3);
  await api.step(0.05);
  check.expectEq("the glitch eats the node, of any charge", chargeAt(await api.snapshot(), 20, 10), -1);

  // A live clip of a glitch skittering over the field, eating nodes.
  await freshBoard(api);
  for (const c of [14, 16, 18, 20, 22]) await api.call("setNode", c, 12, 2);
  await api.call("spawnFoe", "glitch", { x: tileCX(13), y: tileCY(12) });
  await liveClip(api, 1600);

  return check.verdict();
}
