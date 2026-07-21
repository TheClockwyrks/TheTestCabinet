// Scoring: boarding the last train awards its one-off bonus. The quota is pre-satisfied, a
// last train is posed with a flat-top over the worker, and a real step boards it.

import {
  startFresh,
  arrangePrimeQuota,
  actLatchQuota,
  SCORE,
  TICK,
} from "../_helpers.mjs";

export default function item() {
  // The snapshot the boarding step produced.
  let snap;

  return {
    id: "scoring.last-train",

    // Pose the quota counters only. The quota-satisfied LATCH is a real rule that
    // resolves on the next simulation step, so it lives in `act` — which is also why the
    // train and the worker are posed there rather than here: if they were already in
    // place, the latch tick and the boarding tick would collapse into one and the two
    // rules would resolve together instead of in the order the old script drove them.
    async arrange(api) {
      await startFresh(api, 3);
      await arrangePrimeQuota(api, {
        delivered: { red: 1, blue: 3 },
        uniques: ["u-red"],
      });
    },

    async act(api) {
      // One step for the quota-satisfied latch. Level 3 has a last train, so this latches
      // `quotaMet` without winning the shift.
      await actLatchQuota(api);

      await api.call("clearCarried");
      await api.call("spawnTrain", {
        line: 8,
        orientation: "horizontal",
        dir: "east",
        kind: "freight",
        headPos: 400,
        isLast: true,
        consist: ["engine", "flat-top", "flat-top-half", "flat-top"],
      });
      await api.call("setWorker", { x: 280, y: 420 }); // over the flat-top car

      await api.advance(TICK); // resolve the board through the real collision code
      snap = await api.snapshot();

      // Hold on the ride so the clip shows the worker actually carried off, rather than
      // cutting on the frame it boarded. 42 ticks = the old 700ms clip hold.
      await api.advance(42);
    },

    async assert(api, check) {
      check.expectEq(
        "boarding awards the last-train bonus",
        snap.level.scoreParts.lastTrain,
        SCORE.lastTrain,
      );
      check.expectGe(
        "the total score includes the bonus",
        snap.level.score,
        SCORE.lastTrain,
      );
    },
  };
}
