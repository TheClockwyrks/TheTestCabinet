// Automated validation for the UI sub-item `state-stage-cleared`: the stage-cleared
// interstitial is reachable, and captured for the reviewer.
//
// A single formation drone is posed and destroyed with a matching shot; clearing
// the field ends the wave through the real stage-end path, landing on the
// stage-cleared interstitial, which is read back and captured.

import { startStageClean, spawnDrone, shootDrone, stepUntil } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("ui.state-stage-cleared");

  await startStageClean(api, 1);
  const id = await spawnDrone(api, { kind: "shard", band: "cyan", x: 640, y: 200, phase: "formation" });
  await api.step(0.1); // arm the stage-end check
  await shootDrone(api, id, "cyan");
  const r = await stepUntil(api, (s) => s.screen === "stageCleared", 2);
  check.expectOk("clearing the wave reaches the stage-cleared screen", r.hit);
  await api.wait(120);
  await api.screenshot("cleared");

  return check.verdict();
}
