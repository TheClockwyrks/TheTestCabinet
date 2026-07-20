// Automated validation for the Color sub-item `magenta-distinct`.
//
// A magenta-band drone renders in a distinct, visible color, clearly different from
// a cyan drone and from the field background. The pixels the build actually PAINTS
// are sampled, so a build cannot pass by claiming a color it does not draw.

import { startStageClean, spawnDrone, sampleVivid, colorDistance } from "../_helpers.mjs";

const VISIBLE_MIN = 60;
const DISTINCT_MIN = 40;

export default async function drive(api, ttc) {
  const check = ttc.checkOne("color.magenta-distinct");

  await startStageClean(api, 1);
  await api.call("setShipX", 640);
  await spawnDrone(api, { kind: "shard", band: "cyan", x: 400, y: 300, phase: "formation" });
  await spawnDrone(api, { kind: "shard", band: "magenta", x: 800, y: 300, phase: "formation" });
  await api.wait(120);

  const cyan = await sampleVivid(api, 380, 280, 420, 320);
  const magenta = await sampleVivid(api, 780, 280, 820, 320);
  const bg = await sampleVivid(api, 600, 440, 680, 500);

  check.expectGt("a magenta drone is drawn in a visible color vs the background", colorDistance(magenta, bg), VISIBLE_MIN);
  check.expectGt("a magenta drone is distinct from a cyan drone", colorDistance(magenta, cyan), DISTINCT_MIN);

  await api.screenshot("scene");
  return check.verdict();
}
