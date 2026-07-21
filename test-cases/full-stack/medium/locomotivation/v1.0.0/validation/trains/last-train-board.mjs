// Trains: with the quota met, stepping onto a rideable flat-top car boards the last train,
// awards the bonus, and moves the worker to a boarding state while the sim runs on. The
// quota is pre-satisfied; a last train is posed with a flat-top over the worker; a real step
// boards it through the last-train collision code.

import {
  startFresh,
  arrangePrimeQuota,
  actLatchQuota,
  SCORE,
  TICK,
} from "../_helpers.mjs";

export default function item() {
  // The state after the quota latched, after the board, and after the ride ran on.
  let latched;
  let boarded;
  let riding;

  return {
    id: "trains.last-train-board",

    // Pose the quota counters only. The quota-satisfied LATCH is a real rule resolved by
    // the next simulation step, and the train and worker are posed in `act` after it —
    // otherwise the latch tick and the boarding tick would collapse into one and the
    // "quota met but not yet won" reading would come back already boarded.
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
      latched = await actLatchQuota(api);

      await api.call("clearCarried");

      // A last train with a flat-top car (spanning x 240..320) over the worker at x=280.
      await api.call("spawnTrain", {
        line: 8,
        orientation: "horizontal",
        dir: "east",
        kind: "freight",
        headPos: 400,
        isLast: true,
        consist: ["engine", "flat-top", "flat-top-half", "flat-top"],
      });
      await api.call("setWorker", { x: 280, y: 420 });

      await api.advance(TICK); // resolve the board through the real collision code
      boarded = await api.snapshot();

      // Let the ride run on — the item is partly about the sim NOT stopping when the
      // worker boards. 18 ticks = the old 0.3s.
      await api.advance(18);
      riding = await api.snapshot();

      // Hold on the departing train for the clip. 54 ticks = the old 900ms clip hold.
      await api.advance(54);
    },

    async assert(api, check) {
      check.expectEq(
        "the quota is met (but not yet won, a last train is due)",
        latched.level.quotaMet,
        true,
      );
      check.expectEq(
        "stepping onto the flat-top boards the last train",
        boarded.phase,
        "boarding",
      );
      check.expectEq(
        "boarding awards the last-train bonus",
        boarded.level.scoreParts.lastTrain,
        SCORE.lastTrain,
      );
      check.expectGt(
        "the simulation keeps running while the worker rides off",
        riding.simTime,
        boarded.simTime,
      );
    },
  };
}
