// Automated validation for the Ordered-runs sub-item `king-run-empty`.
//
// A run headed by a King may move onto an empty column (the empty-column rule
// applies to the run's head). Grabbing a King-Queen run and dropping it onto an
// empty column moves both. The real move runs and both columns are read back.
//
// The two columns are the precondition (`arrange`); the run move is the behavior
// under test, so it and the columns it leaves are what `act` films.

import { actShoot, card, pose } from "../_helpers.mjs";

export default function item() {
  let ok;
  let s;

  return {
    id: "runs.king-run-empty",

    // Column 0 holds a King-Queen run (black K, red Q); column 1 is empty.
    async arrange(api) {
      await pose(
        api,
        { tableau: [[card("spades", 13, true), card("hearts", 12, true)]] },
        1,
      );
    },

    async act(api) {
      ok = await api.call(
        "move",
        { pile: "tableau", column: 0, row: 0 },
        { pile: "tableau", column: 1 },
      );
      s = await api.snapshot();
      await actShoot(api, "king-run");
    },

    async assert(api, check) {
      check.expectEq(
        "the King-headed run is accepted onto the empty column",
        ok,
        true,
      );
      check.expectEq("the source column is now empty", s.tableau[0].length, 0);
      check.expectEq("both cards moved onto column 1", s.tableau[1].length, 2);
      check.expectEq("the King leads", s.tableau[1][0].rank, 13);
      check.expectEq("the Queen follows", s.tableau[1][1].rank, 12);
    },
  };
}
