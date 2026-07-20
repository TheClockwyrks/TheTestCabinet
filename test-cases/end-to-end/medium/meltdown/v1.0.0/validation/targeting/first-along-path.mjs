// Automated validation for the Targeting sub-item `first-along-path`.
//
// An emitter fires on the unit furthest along its path (closest to leaking) first,
// rather than the nearest one (specs/towers.md). We let one Hulk get ahead, then
// spawn a second behind it, both in an Arc's range; the leading Hulk takes damage
// while the trailing one is untouched.

import { newGame, build, spawn, unit, stepUntil, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("targeting.first-along-path");

  await newGame(api, "containment", "medium", 100000);
  await api.call("setLives", 100000);
  const arc = await build(api, "arc", 5, 17);
  await api.call("setHeat", arc, 80);

  const lead = await spawn(api, "hulk", "left");
  await stepUntil(api, (s) => s.surge.some((u) => u.id === lead && u.x > 130), 12, 0.1);
  const trail = await spawn(api, "hulk", "left");
  await api.step(1);

  const l = await unit(api, lead);
  const t = await unit(api, trail);
  check.expectOk("both Hulks are on the floor", l !== null && t !== null);
  check.expectLt("the leading Hulk (furthest along) took damage first", l.hp, l.maxHp);
  check.expectClose("the trailing Hulk is still untouched", t.hp, t.maxHp, 0.01);

  await liveClip(api, 1600);
  return check.verdict();
}
