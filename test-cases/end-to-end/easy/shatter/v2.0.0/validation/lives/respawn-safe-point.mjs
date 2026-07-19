// Automated validation for the Lives item `respawn-safe-point`: losing a ship (with lives
// left) respawns the next at the safe point below the star, facing up, with a brief
// invulnerability. Invulnerability is cleared and a rock is placed on the ship; the real
// collision code kills it, and the respawned ship's pose is read back.

import { newGame, poseShip, SAFE_X, SAFE_Y, FACE_UP, stepUntil, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("lives.respawn-safe-point");

  await newGame(api);
  await api.call("setLives", 3);
  await api.call("setInvuln", 0);
  await poseShip(api, { x: 300, y: 300, vx: 0, vy: 0, angle: 0 });
  await api.call("addRock", "small", { x: 300, y: 300, vx: 0, vy: 0 }); // sitting on the ship

  const { snap } = await stepUntil(api, (s) => s.lives < 3, 1);

  check.expectEq("losing a ship drops a life (respawn, not game over)", snap.lives, 2);
  check.expectEq("the game keeps playing after a respawn", snap.screen, "playing");
  check.expectClose("the ship respawns at the safe point (x)", snap.ship.x, SAFE_X, 0.5);
  check.expectClose("the ship respawns at the safe point (y, below the star)", snap.ship.y, SAFE_Y, 0.5);
  check.expectClose("the respawned ship faces up", snap.ship.angle, FACE_UP, 1e-6);
  check.expectGt("the respawn grants a brief invulnerability", snap.invuln, 0);

  await liveClip(api, 800);
  return check.verdict();
}
