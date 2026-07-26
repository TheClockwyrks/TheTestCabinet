// Cargo: taking a dispenser's package marks it not-ready, and it replenishes after its
// short refill delay — so the level can never soft-lock. Level 1's red dispenser (3,13)
// is one tile from the spawn (3,14); a real E press takes its package.

import { actPressStep, setTile, startFresh } from "../_helpers.mjs";

export default function item() {
  // The dispenser before the take, right after it, and after the refill delay.
  let readyBefore;
  let taken;
  let readyAfterDelay;

  return {
    id: "cargo.dispenser-refill",

    // Pose the worker beside level 1's red dispenser and read its starting state.
    async arrange(api) {
      await startFresh(api, 1);
      await setTile(api, 3, 14);
      readyBefore = (await api.snapshot()).dispensers[0].ready;
    },

    // Take the package, then let the refill delay elapse. Both halves are the behavior
    // under test and both are filmed, so the clip shows the dispenser empty and then
    // restocking.
    async act(api) {
      taken = await actPressStep(api, "KeyE");

      // 96 ticks = the old 1.6s, comfortably past the ~1.5 s refill delay.
      await api.advance(96);
      readyAfterDelay = (await api.snapshot()).dispensers[0].ready;
    },

    async assert(api, check) {
      check.expectEq("the dispenser starts ready", readyBefore, true);
      check.expectEq(
        "taking its package carries one",
        taken.worker.carried.length,
        1,
      );
      check.expectEq(
        "the dispenser is not ready right after",
        taken.dispensers[0].ready,
        false,
      );
      check.expectEq(
        "the dispenser replenishes after the delay",
        readyAfterDelay,
        true,
      );
    },
  };
}
