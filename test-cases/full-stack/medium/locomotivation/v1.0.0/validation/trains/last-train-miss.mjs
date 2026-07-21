// Trains: not boarding the last train never fails the shift — with the quota met the shift
// still resolves to a WIN when the clock ends. The quota is pre-satisfied, the worker is
// left safely off the lane, and the clock is run out; the real win/fail rule chooses a win.

import {
  startFresh,
  arrangePrimeQuota,
  actLatchQuota,
  setTile,
} from "../_helpers.mjs";

export default function item() {
  // The snapshot once the clock had run out.
  let snap;

  return {
    id: "trains.last-train-miss",

    // Pose the quota counters only; the latch is `act` work.
    async arrange(api) {
      await startFresh(api, 3);
      await arrangePrimeQuota(api, {
        delivered: { red: 1, blue: 3 },
        uniques: ["u-red"],
      });
    },

    async act(api) {
      // One step for the quota-satisfied latch. Level 3 has a last train, so this latches
      // `quotaMet` without winning — running the clock out is what resolves the shift.
      await actLatchQuota(api);

      await setTile(api, 8, 8); // safely off any lane
      await api.call("setClock", 2); // seconds: `setClock` poses the clock, it does not advance it

      await api.advance(150); // 150 ticks = the old 2.5s, running the clock out without ever boarding
      snap = await api.snapshot();

      // Hold on the completion screen for the clip. 36 ticks = the old 600ms clip hold.
      await api.advance(36);
    },

    async assert(api, check) {
      check.expectEq(
        "missing the last train still wins with the quota met",
        snap.phase,
        "won",
      );
      check.expectEq(
        "the shift-complete screen is shown",
        snap.screen,
        "level-complete",
      );
      check.expectEq("it is a win, not a failure", snap.level.failReason, null);
    },
  };
}
