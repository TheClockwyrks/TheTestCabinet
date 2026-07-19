// Automated validation (Warhead) for the Torpedo item `recharge`: after firing, the torpedo
// recharges over ~10 seconds, then is ready again. A torpedo is fired; halfway through the
// recharge it is still not ready (the HUD charge reads ~half), and after the full recharge
// it is ready.

import { newGame, poseShip, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("torpedo.recharge");

  await newGame(api);
  await api.call("clearRocks");
  await api.call("removeSaucer");
  await poseShip(api, { x: 300, y: 500, vx: 0, vy: 0, angle: 0 });
  await api.call("setTorpedoReady", true);
  await api.call("press", "KeyF"); // fire, starting the recharge

  await api.step(5); // halfway through the 10 s recharge
  const half = await api.snapshot();
  check.expectEq("the torpedo is not ready mid-recharge", half.torpedoReady, false);
  check.expectClose("the HUD charge reads about half", half.torpedoRecharge, 0.5, 0.12);

  await api.step(5.2); // past the full recharge
  check.expectEq("after ~10 s the torpedo is ready again", (await api.snapshot()).torpedoReady, true);

  await liveClip(api, 700);
  return check.verdict();
}
