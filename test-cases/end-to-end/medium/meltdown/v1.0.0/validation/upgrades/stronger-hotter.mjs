// Automated validation for the Upgrades sub-item `stronger-hotter`.
//
// Upgrading an emitter makes it hit harder AND run hotter (specs/towers.md). At a
// fixed heat, the upgraded emitter reports higher per-shot damage; and when firing at
// a real target from the same start, a maxed emitter heats up faster (more heat per
// shot, faster fire rate).

import { newGame, build, spawn, tower, heatOf, liveClip } from "../_helpers.mjs";

// Heat gained by an Arc upgraded to `level` after 1s of firing at a Core from heat 40.
async function heatGainFiring(api, level) {
  await newGame(api, "containment", "medium", 100000);
  await api.call("setLives", 100000);
  const arc = await build(api, "arc", 3, 20);
  for (let l = 1; l < level; l += 1) await api.call("upgradeTower", arc);
  await spawn(api, "core", "left");
  await api.call("setHeat", arc, 40);
  const before = await heatOf(api, arc);
  await api.step(1);
  return (await heatOf(api, arc)) - before;
}

export default async function drive(api, ttc) {
  const check = ttc.checkOne("upgrades.stronger-hotter");

  // Stronger: damage at a fixed heat climbs with each upgrade.
  await newGame(api, "containment", "medium", 100000);
  const arc = await build(api, "arc", 12, 12);
  await api.call("setHeat", arc, 80);
  const d1 = (await tower(api, arc)).damage;
  await api.call("upgradeTower", arc);
  await api.call("setHeat", arc, 80);
  const d2 = (await tower(api, arc)).damage;
  await api.call("upgradeTower", arc);
  await api.call("setHeat", arc, 80);
  const d3 = (await tower(api, arc)).damage;
  check.expectGt("level II hits harder than level I", d2, d1);
  check.expectGt("level III hits harder than level II", d3, d2);

  // Hotter: a maxed emitter heats faster when firing.
  const gainL1 = await heatGainFiring(api, 1);
  const gainL3 = await heatGainFiring(api, 3);
  check.expectGt("a maxed emitter heats faster under fire than a level-I one", gainL3, gainL1);

  await newGame(api, "containment", "medium", 100000);
  await api.call("setLives", 100000);
  const c = await build(api, "arc", 3, 20);
  await api.call("upgradeTower", c);
  await api.call("upgradeTower", c);
  await spawn(api, "core", "left");
  await liveClip(api, 1800);
  return check.verdict();
}
