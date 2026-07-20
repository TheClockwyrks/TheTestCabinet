// Automated validation (Warhead) for the Torpedo item `recharge-persists-respawn`: the
// recharge is a property of the weapon, not the ship, so it keeps counting through a death
// and respawn rather than resetting. A torpedo is fired and the recharge advanced; the ship
// is then destroyed and respawned, after which the recharge must have continued from where
// it was (not reset to empty or full).

import { newGame, poseShip, stepUntil, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("torpedo.recharge-persists-respawn");

  await newGame(api);
  await api.call("clearRocks");
  await api.call("removeSaucer");
  await poseShip(api, { x: 300, y: 500, vx: 0, vy: 0, angle: 0 });
  await api.call("setTorpedoReady", true);
  await api.call("press", "KeyF"); // fire, starting the recharge

  await api.step(3.6); // let the fired torpedo expire and the recharge advance
  await api.call("clearRocks"); // clear the wave that respawned meanwhile
  const before = (await api.snapshot()).torpedoRecharge;

  // Destroy the ship and respawn it (lives remain), then advance a little more.
  await api.call("setLives", 3);
  await api.call("setInvuln", 0);
  await poseShip(api, { x: 300, y: 300, vx: 0, vy: 0, angle: 0 });
  await api.call("addRock", "small", { x: 300, y: 300, vx: 0, vy: 0 });
  await stepUntil(api, (s) => s.lives < 3, 1);
  await api.call("clearRocks");
  await api.step(0.5);
  const after = await api.snapshot();

  check.expectEq("the recharge is not reset to ready by the respawn", after.torpedoReady, false);
  check.expectGt("the recharge kept counting through the death and respawn", after.torpedoRecharge, before);
  check.expectLt("it is still recharging (not refilled by the respawn)", after.torpedoRecharge, 1);

  await liveClip(api, 700);
  return check.verdict();
}
