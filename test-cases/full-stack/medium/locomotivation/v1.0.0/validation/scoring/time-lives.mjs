// Scoring: completing a shift adds a time bonus per second of clock left and a bonus per
// unused life. Level 1 is won with the clock pre-set to 30 s and all three lives intact;
// the completion bonuses are the derived amounts.

import { setTile, startFresh, TICK, SCORE } from "../_helpers.mjs";

export default function item() {
  // The snapshot the winning delivery produced.
  let snap;

  return {
    id: "scoring.time-lives",

    // Pose level 1 one delivery short, with 30 s on the clock and all three lives.
    // `setClock` poses the shift clock and is still in SECONDS — only advancing time is
    // counted in ticks.
    async arrange(api) {
      await startFresh(api, 1);
      await api.call("setDelivered", "red", 2);
      await api.call("setClock", 30);
      await api.call("givePackage", {
        color: "red",
        weightClass: "parcel",
        archetype: "dispenser",
      });
    },

    async act(api) {
      await setTile(api, 4, 2); // deliver the winning red
      await api.advance(TICK);
      snap = await api.snapshot();

      // Hold on the completion summary so the clip shows the bonuses tallied rather than
      // cutting on the winning frame. 36 ticks = the old 600ms clip hold.
      await api.advance(36);
    },

    async assert(api, check) {
      check.expectEq("the shift completed", snap.phase, "won");
      check.expectEq(
        "the time bonus is 20 per remaining second (~30 s)",
        snap.level.scoreParts.time,
        30 * SCORE.timePerSec,
      );
      check.expectEq(
        "the lives bonus is 500 per unused life (3)",
        snap.level.scoreParts.lives,
        3 * SCORE.livesEach,
      );
    },
  };
}
