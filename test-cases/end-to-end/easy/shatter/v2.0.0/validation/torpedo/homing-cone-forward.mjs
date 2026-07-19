// Automated validation (Warhead) for the Torpedo item `homing-cone-forward`: the homing cone
// only looks forward, so the torpedo never doubles back on a body behind it. A rock is placed
// directly BEHIND the launch heading; after stepping, the torpedo must keep its forward
// heading and keep moving forward, never turning around to chase the rock behind.

import { newGame, poseShip, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("torpedo.homing-cone-forward");

  await newGame(api);
  await api.call("clearRocks");
  // Pose the ship clear of the star (the torpedo launches on its facing, and a body
  // launched into the star core would be absorbed at once). Face +x with a rock placed
  // directly behind the launch heading.
  await poseShip(api, { x: 300, y: 360, vx: 0, vy: 0, angle: 0 }); // facing +x
  await api.call("addRock", "large", { x: 100, y: 360, vx: 0, vy: 0 }); // directly behind
  await api.call("setTorpedoReady", true);
  await api.call("press", "KeyF");
  const launch = (await api.snapshot()).torpedoes[0];

  await api.step(0.3);
  const t = (await api.snapshot()).torpedoes[0];
  check.expectOk("the torpedo is still in flight", Boolean(t));
  check.expectLt("it does not turn around toward the rock behind it", Math.abs(t.heading), 0.1);
  check.expectGt("it keeps flying forward, away from the rock behind", t.x, launch.x);

  await liveClip(api, 800);
  return check.verdict();
}
