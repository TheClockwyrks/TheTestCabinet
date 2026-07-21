// Automated validation for the Victory-cascade sub-item `retire`.
//
// Every card carries a minimum horizontal speed, so each drifts off a side edge and
// retires; when all 52 have launched and retired, the cascade completes (specs/
// victory.md). The cascade is run until it reports itself complete and the completed
// state is read back.
//
// The old script filmed a separate 4 s live clip FIRST and only then stepped to
// completion, so the footage and the assertions were of two different runs of the
// cascade. Now there is one: `act` runs the cascade out, the assertions read what that
// run returned, and the record pass replays the same thing in real time. Watching the
// cards fly off and retire IS the check.
//
// The full cascade is longer than the 8 s filming budget, so the record pass is cut
// short partway through — a truncated-looking clip is expected here and is correct:
// the opening of the cascade is what depicts it, and the verdict was already decided
// by the uncapped validate pass.

import { TOTAL_CARDS, actRunCascadeToDone, winBoard } from "../_helpers.mjs";

export default function item() {
  // The cascade's final state, once it reports itself done.
  let s;

  return {
    id: "cascade.retire",

    async arrange(api) {
      await winBoard(api, 9);
    },

    async act(api) {
      // Run it to completion (well past the ~9.4 s of launches plus the last card's
      // flight); `actRunCascadeToDone` stops as soon as `done` is set.
      s = await actRunCascadeToDone(api);
    },

    async assert(api, check) {
      check.expectEq("all 52 cards launched", s.cascade.launched, TOTAL_CARDS);
      check.expectEq("the launch total is 52", s.cascade.total, TOTAL_CARDS);
      check.expectEq(
        "no cards remain in flight (all retired)",
        s.cascade.flyers.length,
        0,
      );
      check.expectEq("the cascade is complete", s.cascade.done, true);
    },
  };
}
