// Trains: the last train's engine and sealed cars are lethal like any train, even with the
// quota met — only its flat-tops are rideable. Same posed last train as the board check, but
// the worker sits under the ENGINE car, so the real collision kills rather than boards.

import {
  startFresh,
  arrangePrimeQuota,
  actLatchQuota,
  TICK,
} from "../_helpers.mjs";

export default function item() {
  // The snapshot the collision produced.
  let snap;

  return {
    id: "trains.last-train-lethal",

    // Pose the quota counters only; the latch and the train are `act` work, in that
    // order, so the lethal hit resolves on its own step rather than sharing the latch's.
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

      // Engine spans x 320..400; the worker sits at x=360, on the sealed engine.
      await api.call("spawnTrain", {
        line: 8,
        orientation: "horizontal",
        dir: "east",
        kind: "freight",
        headPos: 400,
        isLast: true,
        consist: ["engine", "flat-top", "flat-top-half", "flat-top"],
      });
      await api.call("setWorker", { x: 360, y: 420 });

      await api.advance(TICK);
      snap = await api.snapshot();

      // Hold on the aftermath so the clip shows the death rather than the frame of
      // contact. 42 ticks = the old 700ms clip hold.
      await api.advance(42);
    },

    async assert(api, check) {
      check.expectEq(
        "the sealed engine is lethal even with the quota met",
        snap.level.lives,
        2,
      );
      check.expectOk(
        "the worker died rather than boarded",
        snap.phase !== "boarding",
      );
    },
  };
}
