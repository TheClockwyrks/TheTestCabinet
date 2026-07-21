// Automated validation for the Ordered-runs sub-item `reject-illegal`.
//
// A run dropped onto an illegal target is rejected and returns intact — the whole
// run stays in its source column, unchanged. The run's head (red 9) onto a red 10
// (same color) is illegal, so the move must be rejected. The real move runs and
// both columns are read back.
//
// The two columns are the precondition (`arrange`); the attempted run move is the
// behavior under test, so it and the columns it leaves untouched are what `act` films.

import { actShoot, card, pose } from "../_helpers.mjs";

export default function item() {
  let rejected;
  let s;

  return {
    id: "runs.reject-illegal",

    // Column 0 holds a valid run 9-8-7; column 1 exposes a red 10 (illegal target for
    // the red 9 head — same color).
    async arrange(api) {
      await pose(
        api,
        {
          tableau: [
            [
              card("hearts", 9, true),
              card("spades", 8, true),
              card("diamonds", 7, true),
            ],
            [card("hearts", 10, true)],
          ],
        },
        1,
      );
    },

    async act(api) {
      rejected = await api.call(
        "move",
        { pile: "tableau", column: 0, row: 0 },
        { pile: "tableau", column: 1 },
      );
      s = await api.snapshot();
      await actShoot(api, "reject");
    },

    async assert(api, check) {
      check.expectEq(
        "the run is rejected onto the red 10 (same color as its head)",
        rejected,
        false,
      );
      check.expectEq(
        "the run stays intact in its source column",
        s.tableau[0].length,
        3,
      );
      check.expectEq("the target column is unchanged", s.tableau[1].length, 1);
    },
  };
}
