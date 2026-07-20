// Automated validation for the Bloom sub-item `splash`.
//
// A Bloom shot damages every unit within its splash radius of the impact
// (specs/towers.md), so one shot into a clump hits several units at once. We place a
// Bloom by the lane, spawn a tight clump of real Motes, and confirm more than one is
// damaged.

import { newGame, build, spawn, stepUntil, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("bloom.splash");

  await newGame(api, "containment", "medium", 100000);
  await api.call("setLives", 100000);
  const bloom = await build(api, "bloom", 5, 20);
  await api.call("setHeat", bloom, 40); // moderate power: hits, but does not one-shot Motes
  for (let i = 0; i < 4; i += 1) await spawn(api, "mote", "left");

  const r = await stepUntil(
    api,
    (s) => s.surge.filter((u) => u.hp < u.maxHp).length >= 2,
    5,
  );
  check.expectOk("one Bloom shot damaged more than one unit in the clump", r.hit);

  await api.call("setLives", 100000);
  for (let i = 0; i < 4; i += 1) await spawn(api, "mote", "left");
  await liveClip(api, 1800);
  return check.verdict();
}
