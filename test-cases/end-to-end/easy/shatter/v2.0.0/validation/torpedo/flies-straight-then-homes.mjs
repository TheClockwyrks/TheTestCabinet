// Automated validation (Warhead) for the Torpedo item `flies-straight-then-homes`: the
// torpedo leaves straight on the ship's facing, then homes onto a target within its forward
// cone. A rock is placed ahead and off-axis (but inside the cone); the torpedo launches on
// the ship's heading (0) and, after stepping, must have turned toward the rock.

import { newGame, poseShip, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("torpedo.flies-straight-then-homes");

  await newGame(api);
  await api.call("clearRocks");
  await poseShip(api, { x: 220, y: 360, vx: 0, vy: 0, angle: 0 });
  await api.call("addRock", "large", { x: 700, y: 450, vx: 0, vy: 0 }); // ahead, off-axis, inside the cone
  await api.call("setTorpedoReady", true);
  await api.call("press", "KeyF");

  const launch = (await api.snapshot()).torpedoes[0];
  check.expectClose("the torpedo leaves straight on the ship's facing", launch.heading, 0, 1e-6);

  await api.step(0.3);
  const homing = (await api.snapshot()).torpedoes[0];
  check.expectOk("the torpedo is still in flight", Boolean(homing));
  check.expectGt("the torpedo homes, turning toward the rock below its heading", homing.heading, 0.1);

  await newGame(api);
  await api.call("clearRocks");
  await poseShip(api, { x: 220, y: 360, vx: 0, vy: 0, angle: 0 });
  await api.call("addRock", "large", { x: 700, y: 450, vx: 0, vy: 0 });
  await api.call("setTorpedoReady", true);
  await api.call("press", "KeyF");
  await liveClip(api, 900);
  return check.verdict();
}
