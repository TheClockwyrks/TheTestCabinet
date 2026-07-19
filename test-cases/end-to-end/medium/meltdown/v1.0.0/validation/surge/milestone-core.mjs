// Automated validation for the Surge sub-item `milestone-core`.
//
// The milestone waves — the midpoint and the finale — each include a Core boss
// (specs/surge.md, waves.md). On Medium the run is 20 waves, so the midpoint is wave
// 10 and the finale wave 20. We jump to each, start it, and confirm a Core spawns.

import { newGame, stepUntil, liveClip } from "../_helpers.mjs";

async function waveHasCore(api, wave) {
  await newGame(api, "containment", "medium", 100000);
  await api.call("setLives", 1000000);
  await api.call("setWave", wave);
  await api.call("startWave");
  return stepUntil(api, (s) => s.surge.some((u) => u.type === "core"), 14, 0.25);
}

export default async function drive(api, ttc) {
  const check = ttc.checkOne("surge.milestone-core");

  const mid = await waveHasCore(api, 10);
  check.expectOk("the midpoint wave (10) carries a Core", mid.hit);

  const finale = await waveHasCore(api, 20);
  check.expectOk("the final wave (20) carries a Core", finale.hit);

  await liveClip(api, 2000);
  return check.verdict();
}
