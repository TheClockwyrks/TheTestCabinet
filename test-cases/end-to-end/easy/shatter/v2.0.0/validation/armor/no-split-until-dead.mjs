// Automated validation (Warhead) for the Armor item `no-split-until-dead`: a non-fatal hit
// spends the bullet and lowers the rock's health but does NOT split it or score. A full-
// health Large is posed and struck once; the field must still hold that single Large, now at
// 2 health, with no score awarded.

import { newGame, fireUntilGone, stepUntil, ROCK_RADIUS, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("armor.no-split-until-dead");

  await newGame(api);
  await api.call("setScore", 0);
  await api.call("addRock", "large", { x: 380, y: 220, vx: 0, vy: 0 });

  // One real bullet into the full-health Large.
  const before = (await api.snapshot()).rocks[0];
  await api.call("addBullet", { x: before.x - (ROCK_RADIUS.large + 22), y: before.y, vx: 860, vy: 0 });
  await stepUntil(api, (s) => s.bullets.length === 0, 0.7);
  const snap = await api.snapshot();

  check.expectEq("a non-fatal hit does not split the rock (still one Large)", snap.rocks.length, 1);
  check.expectEq("the struck rock is still Large", snap.rocks[0] ? snap.rocks[0].size : "gone", "large");
  check.expectEq("a non-fatal hit lowers its health by one (3 -> 2)", snap.rocks[0] ? snap.rocks[0].health : -1, 2);
  check.expectEq("a non-fatal hit scores nothing", snap.score, 0);

  // Finish it off for a satisfying clip.
  await fireUntilGone(api, "large");
  await liveClip(api, 700);
  return check.verdict();
}
