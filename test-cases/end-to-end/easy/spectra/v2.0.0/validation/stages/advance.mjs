// Automated validation for the Stages sub-item `advance`.
//
// Destroying the whole formation clears the wave and advances to the next stage. A
// single formation drone is posed (once assembled, the real stage-end check fires
// when the field empties); a matching shot clears it, the wave ends, and the real
// progression advances the stage.

import { startStageClean, spawnDrone, shootDrone, stepUntil, clip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("stages.advance");

  await startStageClean(api, 1);
  const id = await spawnDrone(api, { kind: "shard", band: "cyan", x: 640, y: 200, phase: "formation" });
  await api.step(0.1); // let the formation register as assembled (arms stage-end)

  await shootDrone(api, id, "cyan");
  const cleared = await stepUntil(api, (s) => s.screen === "stageCleared", 2);
  check.expectOk("clearing the formation clears the wave", cleared.hit);
  check.expectEq("the stage has not yet incremented at the interstitial", cleared.snap.stage, 1);

  // The interstitial then advances to the next stage.
  const next = await stepUntil(api, (s) => s.stage === 2, 4);
  check.expectOk("the cleared wave advances to the next stage", next.hit);

  await clip(api, 1500);
  return check.verdict();
}
