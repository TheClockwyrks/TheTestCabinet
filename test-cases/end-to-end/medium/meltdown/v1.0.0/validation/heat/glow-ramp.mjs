// Automated validation for the Heat sub-item `glow-ramp`.
//
// A tower's glow tracks its heat from cold blue up to white-hot (specs/heat.md).
// The check samples the pixels the build actually RENDERS on a Lance's body cold and
// hot — the fill must shift from blue-dominant to warm/white with a much higher red
// channel. Reading the rendered pixel means a build cannot pass by claiming a color
// it does not draw.

import { newGame, build, tower, sampleTowerBody } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("heat.glow-ramp");

  await newGame(api, "containment", "medium", 100000);
  const id = await build(api, "lance", 6, 8);

  await api.call("setHeat", id, 0);
  await api.wait(90);
  const cold = await sampleTowerBody(api, await tower(api, id));

  await api.call("setHeat", id, 95);
  await api.wait(90);
  const hot = await sampleTowerBody(api, await tower(api, id));

  check.expectGt("a cold tower reads blue (blue channel above red)", cold.b, cold.r + 15);
  check.expectGt("a hot tower reads warm/white (red channel far above cold)", hot.r, cold.r + 60);
  check.expectGt("a hot tower's red channel dominates its blue", hot.r, hot.b + 30);

  await api.screenshot("glow");
  return check.verdict();
}
