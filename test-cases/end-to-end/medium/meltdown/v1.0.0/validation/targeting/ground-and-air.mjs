// Automated validation for the Targeting sub-item `ground-and-air`.
//
// A general emitter (not the air-only Flak) can damage both a ground unit and a flyer
// in range (specs/towers.md). We confirm a plain Arc damages a ground Hulk, then a
// Drift flyer.

import { newGame, build, spawn, stepUntil, liveClip } from "../_helpers.mjs";

async function arcDamages(api, surgeType) {
  await newGame(api, "containment", "medium", 100000);
  await api.call("setLives", 100000);
  const arc = await build(api, "arc", 10, 17);
  await api.call("setHeat", arc, 80);
  const id = await spawn(api, surgeType, "left");
  return stepUntil(api, (s) => s.surge.some((u) => u.id === id && u.hp < u.maxHp), 8);
}

export default async function drive(api, ttc) {
  const check = ttc.checkOne("targeting.ground-and-air");

  const ground = await arcDamages(api, "hulk");
  check.expectOk("the Arc damages a ground unit", ground.hit);

  const air = await arcDamages(api, "drift");
  check.expectOk("the Arc damages an air unit", air.hit);

  await api.call("setLives", 100000);
  await spawn(api, "hulk", "left");
  await spawn(api, "drift", "left");
  await liveClip(api, 1800);
  return check.verdict();
}
