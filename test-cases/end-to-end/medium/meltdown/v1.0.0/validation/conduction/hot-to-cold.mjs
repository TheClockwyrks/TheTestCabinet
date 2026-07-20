// Automated validation for the Conduction sub-item `hot-to-cold`.
//
// When two emitters touch, heat conducts from the hotter into the cooler across the
// shared edge (specs/heat.md). We place a hot Arc against a cold one, step the real
// heat model forward with no firing, and confirm the cold one heats up while the hot
// one cools — they converge.

import { newGame, build, tower, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("conduction.hot-to-cold");

  await newGame(api, "containment", "medium", 100000);
  const hot = await build(api, "arc", 12, 12);
  const cold = await build(api, "arc", 12, 14); // touching the hot Arc's south face
  await api.call("setHeat", hot, 90);
  await api.call("setHeat", cold, 0);

  await api.step(1);
  const h = await tower(api, hot);
  const c = await tower(api, cold);

  check.expectGt("the cool neighbor heats up from conduction", c.heat, 5);
  check.expectLt("the hot tower cools toward its neighbor", h.heat, 90);
  check.expectGt("the hot tower is still hotter than the cool one", h.heat, c.heat);

  await newGame(api, "containment", "medium", 100000);
  const a = await build(api, "arc", 12, 12);
  const b = await build(api, "arc", 12, 14);
  await api.call("setHeat", a, 95);
  await api.call("setHeat", b, 0);
  await liveClip(api, 1600);
  return check.verdict();
}
