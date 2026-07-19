// Automated validation for the Stages sub-item `challenge-perfect-bonus`.
//
// Destroying every drone in a challenge stage scores per drone (100 each, 40 drones)
// plus a large perfect bonus (10000), for 14000 total. A real challenge stage is
// run and every drone destroyed with a matching-band shot as it sweeps across; the
// real scoring and the real perfect-clear path produce the total, read back at the
// stage-cleared screen. (Only a full clear yields 14000; a miss scores less.)

import { startStageClean, clip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("stages.challenge-perfect-bonus");

  await startStageClean(api, 3, { clear: false });
  await api.call("setScore", 0);

  let done = false;
  for (let i = 0; i < 800 && !done; i += 1) {
    const s = await api.snapshot();
    if (s.screen !== "inWave") {
      done = true;
      break;
    }
    // Fire a matching-band shot at every live drone; the real collision destroys it.
    for (const d of s.drones) {
      await api.call("spawnPlayerBullet", { x: d.x, y: d.y, band: d.band, vy: -200 });
    }
    await api.step(0.03);
  }

  const final = await api.snapshot();
  check.expectEq("the challenge ends on the stage-cleared screen", final.screen, "stageCleared");
  check.expectEq("a perfect clear scores 40x100 + a 10000 bonus", final.score, 14000);

  await clip(api, 1500);
  return check.verdict();
}
