// Automated validation (Warhead) for the Torpedo item `flies-true`: being self-propelled, a
// torpedo flies true through the gravity well instead of curving like a bullet. With no
// targets on the field, a torpedo is launched horizontally to pass just above the star; after
// stepping it must hold its heading and its height — it neither homes nor is bent by gravity.

import { newGame, poseShip, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("torpedo.flies-true");

  await newGame(api);
  await api.call("clearRocks");
  await api.call("removeSaucer");
  await poseShip(api, { x: 200, y: 260, vx: 0, vy: 0, angle: 0 }); // passes above the core
  await api.call("setTorpedoReady", true);
  await api.call("press", "KeyF");
  const launch = (await api.snapshot()).torpedoes[0];
  check.expectClose("the torpedo launches straight (heading 0)", launch.heading, 0, 1e-6);

  await api.step(0.8); // fly it past the star
  const t = (await api.snapshot()).torpedoes[0];
  check.expectOk("the torpedo is still in flight past the star", Boolean(t));
  check.expectClose("its heading is unchanged — no homing, no curve", t.heading, 0, 0.02);
  check.expectClose("gravity does not bend it (no vertical velocity)", t.vy, 0, 5);
  check.expectClose("it holds its height, flying true through the well", t.y, 260, 5);

  await newGame(api);
  await api.call("clearRocks");
  await api.call("removeSaucer");
  await poseShip(api, { x: 200, y: 260, vx: 0, vy: 0, angle: 0 });
  await api.call("setTorpedoReady", true);
  await api.call("press", "KeyF");
  await liveClip(api, 900);
  return check.verdict();
}
