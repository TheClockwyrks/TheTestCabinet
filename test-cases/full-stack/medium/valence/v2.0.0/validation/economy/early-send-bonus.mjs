// Automated validation for the Economy sub-item `early-send-bonus`.
//
// Starting the next round early, during a timed between-round countdown, pays a bonus for
// the whole seconds left on the clock. The check clears round 1 to reach a timed build
// phase, empties the bank, reads the countdown, then sends the next round early — the
// bank holds exactly the whole seconds that were left.

import { arrangeNoTowerRound, actNoTowerRound } from "../_helpers.mjs";

export default function item() {
  let built;
  let c;
  let after;

  return {
    id: "economy.early-send-bonus",

    async arrange(api) {
      await arrangeNoTowerRound(api, { round: 1, energy: 0 });
    },

    // Round one clearing to a timed build phase, then the early send. `setEnergy` and
    // `startRound` are control ops, so they are legal here and consume no time — the bank
    // read straight after them is exactly the bonus the send paid.
    async act(api) {
      built = await actNoTowerRound(api);
      // `buildCountdown` is still reported in SECONDS (only `step`'s argument became
      // ticks), so the bonus is compared against whole seconds as before.
      c = built.buildCountdown;

      await api.call("setEnergy", 0);
      await api.call("startRound");
      after = await api.snapshot();
    },

    async assert(api, check) {
      check.expectEq(
        "the round resolved to the build phase",
        built.phase,
        "build",
      );
      check.expectOk(
        "the between-round phase is timed (has a countdown)",
        c != null && c > 0,
      );
      check.expectEq(
        "sending early pays a bonus for the whole seconds left",
        after.energy,
        Math.floor(c),
      );
    },
  };
}
