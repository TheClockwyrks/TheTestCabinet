// Automated validation for the Lives item `invuln-ends`: once the invulnerability window
// is over, collisions are lethal again. Invulnerability is cleared and a rock is placed on
// the ship; the real collision code must cost a life.

import { newGame, poseShip, stepUntil, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("lives.invuln-ends");

  await newGame(api);
  await api.call("setLives", 3);
  await api.call("setInvuln", 0); // no invulnerability — collisions are lethal
  await poseShip(api, { x: 300, y: 300, vx: 0, vy: 0, angle: 0 });
  await api.call("addRock", "small", { x: 300, y: 300, vx: 0, vy: 0 }); // sitting on the ship

  const { snap, hit } = await stepUntil(api, (s) => s.lives < 3, 1);

  check.expectOk("with invulnerability over, the collision is lethal", hit);
  check.expectEq("the ship is destroyed and a life is lost", snap.lives, 2);

  await liveClip(api, 700);
  return check.verdict();
}
