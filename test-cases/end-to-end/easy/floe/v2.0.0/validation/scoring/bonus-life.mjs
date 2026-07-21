// Automated validation for the Scoring item `bonus-life`.
//
// Crossing a 10,000-point milestone awards an extra life. The critter climbs to
// just below a bay, the score is set to 9,990 (next milestone at 10,000), and the
// real bay-filling hop pushes the score across the milestone through the normal
// scoring path — awarding a life, which the snapshot reads back. See _helpers.mjs.

import { startCrossing, poseClimb, actClimbByPress } from "../_helpers.mjs";

export default function item() {
  // The life count just before the milestone-crossing hop, and the state after it.
  let before;
  let after;

  return {
    id: "scoring.bonus-life",

    // Build the safe corridor at bay 1's column with the critter at its foot. The
    // score is set inside `act`, after the climb, so the climb's own row points cannot
    // tip the milestone early — the bay-filling hop has to be what crosses it.
    async arrange(api) {
      await startCrossing(api);
      await api.call("setLives", 3);
      await poseClimb(api, 11);
    },

    // The climb, then the bay-filling hop that tips the score over the milestone —
    // the crossing that earns the life, and the clip.
    async act(api) {
      await actClimbByPress(api, "ArrowUp", 2);
      await api.call("setScore", 9990); // next bonus life at 10,000
      before = (await api.snapshot()).lives;
      await api.call("press", "ArrowUp"); // fill the bay -> score crosses 10,000
      await api.advance(24); // 0.2 s, long enough for the fill to resolve
      after = await api.snapshot();
    },

    async assert(api, check) {
      check.expectGe(
        "the score crossed the 10,000-point milestone",
        after.score,
        10000,
      );
      check.expectEq(
        "crossing the milestone awards a life",
        after.lives,
        before + 1,
      );
    },
  };
}
