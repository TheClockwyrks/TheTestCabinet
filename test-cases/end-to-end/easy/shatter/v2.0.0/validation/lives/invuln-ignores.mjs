// Automated validation for the Lives item `invuln-ignores`: during the post-respawn
// invulnerability window the ship ignores all collisions. A long invulnerability is set
// and a rock is placed on the ship; after the real sim runs, no life is lost and the game
// is still in play.

import { newGame, poseShip, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("lives.invuln-ignores");

  await newGame(api);
  await api.call("setLives", 3);
  await api.call("setInvuln", 5); // a wide open invulnerability window
  await poseShip(api, { x: 300, y: 300, vx: 0, vy: 0, angle: 0 });
  await api.call("addRock", "small", { x: 300, y: 300, vx: 0, vy: 0 }); // sitting on the ship

  await api.step(1.0);
  const snap = await api.snapshot();

  check.expectEq("an invulnerable ship loses no life to a collision", snap.lives, 3);
  check.expectEq("the game keeps playing (the hit was ignored)", snap.screen, "playing");

  await liveClip(api, 700);
  return check.verdict();
}
