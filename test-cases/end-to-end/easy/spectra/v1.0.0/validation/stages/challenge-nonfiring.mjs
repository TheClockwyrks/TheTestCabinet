// Automated validation for the Stages sub-item `challenge-nonfiring`.
//
// A challenge stage is a non-firing flyover: no enemy bullets are fired and no life
// is lost across the whole stage. A real challenge stage (every third stage) is
// started and stepped through to completion; the enemy-bullet count and lives are
// watched the whole way.

import { startStageClean, enemyBullets } from "../_helpers.mjs";

const SAMPLES = 200;
const SAMPLE_TICKS = 12; // 12 ticks = the old 0.1 s between reads

export default function item() {
  // Whether the stage really is a challenge, and the extremes seen across it.
  let isChallenge;
  let maxEnemy = 0;
  let minLives = 3;

  return {
    id: "stages.challenge-nonfiring",

    // A real challenge stage with the wave the game builds. The challenge flag is
    // read here, instantly: if stage 3 were not a challenge the rest of the check
    // would be measuring the wrong thing entirely.
    async arrange(api) {
      await startStageClean(api, 3, { clear: false });
      await api.call("setLives", 3);
      isChallenge = (await api.snapshot()).isChallenge;
    },

    // Watch the whole flyover. Both facts under test are NEGATIVE — nothing fired,
    // nothing lost — so they can only be established by sampling continuously rather
    // than reading one end state, and the film is the flyover itself.
    async act(api) {
      for (let i = 0; i < SAMPLES; i += 1) {
        await api.advance(SAMPLE_TICKS);
        const s = await api.snapshot();
        maxEnemy = Math.max(maxEnemy, enemyBullets(s).length);
        minLives = Math.min(minLives, s.lives);
        if (s.screen !== "inWave") break;
      }
    },

    async assert(api, check) {
      check.expectOk("stage 3 is a challenge stage", isChallenge === true);
      check.expectEq(
        "no enemy bullet is ever fired in the challenge",
        maxEnemy,
        0,
      );
      check.expectEq("no life is lost in the challenge", minLives, 3);
    },
  };
}
