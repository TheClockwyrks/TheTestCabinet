// Automated validation for the Stages sub-item `challenge-nonfiring`.
//
// A challenge stage is a non-firing flyover: no enemy bullets are fired and no life
// is lost across the whole stage. A real challenge stage (every third stage) is
// started and stepped through to completion; the enemy-bullet count and lives are
// watched the whole way.

import { startStageClean, enemyBullets, clip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("stages.challenge-nonfiring");

  await startStageClean(api, 3, { clear: false });
  await api.call("setLives", 3);
  check.expectOk("stage 3 is a challenge stage", (await api.snapshot()).isChallenge === true);

  let maxEnemy = 0;
  let minLives = 3;
  for (let i = 0; i < 200; i += 1) {
    await api.step(0.1);
    const s = await api.snapshot();
    maxEnemy = Math.max(maxEnemy, enemyBullets(s).length);
    minLives = Math.min(minLives, s.lives);
    if (s.screen !== "inWave") break;
  }
  check.expectEq("no enemy bullet is ever fired in the challenge", maxEnemy, 0);
  check.expectEq("no life is lost in the challenge", minLives, 3);

  await clip(api, 2000);
  return check.verdict();
}
