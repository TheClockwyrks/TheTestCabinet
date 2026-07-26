// Automated validation for the Tableau sub-item `reject-same-color`.
//
// A tableau build must alternate color: a one-lower card of the SAME color is
// rejected. A black 6 onto a black 7 (right rank, same color) must not be
// accepted. The real move runs and the unchanged column is read back.
//
// The board is a precondition (`arrange`); the attempted move is the behavior under
// test, so it and the unchanged column are what `act` films.

import { actShoot, card, pose } from "../_helpers.mjs";

export default function item() {
  let rejected;
  let s;

  return {
    id: "tableau.reject-same-color",

    async arrange(api) {
      await pose(
        api,
        {
          tableau: [[card("spades", 7, true)]],
          waste: [card("clubs", 6, true)],
        },
        1,
      );
    },

    async act(api) {
      rejected = await api.call(
        "move",
        { pile: "waste" },
        { pile: "tableau", column: 0 },
      );
      s = await api.snapshot();
      await actShoot(api, "same-color");
    },

    async assert(api, check) {
      check.expectEq(
        "a black 6 is rejected onto a black 7 (same color)",
        rejected,
        false,
      );
      check.expectEq(
        "the column is unchanged (still just the 7)",
        s.tableau[0].length,
        1,
      );
      check.expectEq("the 6 stays on the waste", s.waste.length, 1);
    },
  };
}
