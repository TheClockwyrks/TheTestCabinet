// Automated validation for the Forge sub-item `warms`.
//
// A Forge touching a cold emitter warms it up over time (specs/heat.md). A cold Arc
// is placed against a Forge and the real heat model is stepped forward with no
// target — its heat must rise from cold.

import { newGame, build, heatOf, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("forge.warms");

  await newGame(api, "containment", "medium", 100000);
  const arc = await build(api, "arc", 12, 12);
  await build(api, "forge", 12, 14); // touching the Arc's south face
  await api.call("setHeat", arc, 0);

  const before = await heatOf(api, arc);
  await api.step(2); // no target: only the Forge acts
  const after = await heatOf(api, arc);

  check.expectClose("the emitter starts cold", before, 0, 0.01);
  check.expectGt("a Forge warms a cold gun", after, 5);

  await newGame(api, "containment", "medium", 100000);
  const c = await build(api, "arc", 12, 12);
  await build(api, "forge", 12, 14);
  await api.call("setHeat", c, 0);
  await liveClip(api, 1800);
  return check.verdict();
}
