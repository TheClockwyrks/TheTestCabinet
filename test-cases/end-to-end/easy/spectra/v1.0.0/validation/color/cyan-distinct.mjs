// Automated validation for the Color sub-item `cyan-distinct`.
//
// A cyan-band drone renders in a distinct, visible color, clearly different from a
// magenta drone and from the field background. The pixels the build actually PAINTS
// are sampled (see _helpers.mjs — this reads the canvas, not a value the game
// reports), so a build cannot pass by claiming a color it does not draw. The exact
// hue is the model's own; only the distinctness is scored.

import { startStageClean, spawnDrone, sampleVivid, colorDistance } from "../_helpers.mjs";

const VISIBLE_MIN = 60; // clearly different from the near-black field
const DISTINCT_MIN = 40; // clearly different from the other band

export default async function drive(api, ttc) {
  const check = ttc.checkOne("color.cyan-distinct");

  await startStageClean(api, 1);
  await api.call("setShipX", 640);
  await spawnDrone(api, { kind: "shard", band: "cyan", x: 400, y: 300, phase: "formation" });
  await spawnDrone(api, { kind: "shard", band: "magenta", x: 800, y: 300, phase: "formation" });
  await api.wait(120); // let a frame paint the posed scene

  const cyan = await sampleVivid(api, 380, 280, 420, 320);
  const magenta = await sampleVivid(api, 780, 280, 820, 320);
  const bg = await sampleVivid(api, 600, 440, 680, 500);

  check.expectGt("a cyan drone is drawn in a visible color vs the background", colorDistance(cyan, bg), VISIBLE_MIN);
  check.expectGt("a cyan drone is distinct from a magenta drone", colorDistance(cyan, magenta), DISTINCT_MIN);

  await api.screenshot("scene");
  return check.verdict();
}
