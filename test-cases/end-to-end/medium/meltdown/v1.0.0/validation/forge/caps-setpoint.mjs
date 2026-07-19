// Automated validation for the Forge sub-item `caps-setpoint`.
//
// The Forge warms an emitter only toward its setpoint, never past it (specs/heat.md),
// so it can never push a gun to the trip on its own. A level-I Forge's setpoint is
// 72%. An Arc posed below the setpoint is warmed by a real Forge and stepped forward
// for a long time; its heat rises but settles below the setpoint and never exceeds
// it.

import { newGame, build, heatOf, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("forge.caps-setpoint");

  await newGame(api, "containment", "medium", 100000);
  const arc = await build(api, "arc", 12, 12);
  await build(api, "forge", 12, 14);
  await api.call("setHeat", arc, 50); // below the level-I setpoint of 72

  const start = await heatOf(api, arc);
  let maxSeen = start;
  for (let i = 0; i < 40; i += 1) {
    await api.step(0.25);
    maxSeen = Math.max(maxSeen, await heatOf(api, arc));
  }
  const settled = await heatOf(api, arc);

  check.expectGt("the Forge warms the gun above where it started", settled, start);
  check.expectLt("the Forge never pushes the gun past its 72% setpoint", maxSeen, 72);

  await newGame(api, "containment", "medium", 100000);
  const c = await build(api, "arc", 12, 12);
  await build(api, "forge", 12, 14);
  await api.call("setHeat", c, 30);
  await liveClip(api, 1800);
  return check.verdict();
}
