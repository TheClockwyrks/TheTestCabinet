// Automated validation for the Tableau sub-item `reject-rank`.
//
// A tableau build must be exactly one lower in rank: an opposite-color card that is
// not the next-lower rank is rejected. A red 5 onto a black 7 (opposite color, but
// two lower) must not be accepted. The real move runs and the column is read back.
//
// The board is a precondition (`arrange`); the attempted move is the behavior under
// test, so it and the unchanged column are what `act` films.

import { actShoot, card, pose } from "../_helpers.mjs";

export default function item() {
  let rejected;
  let s;

  return {
    id: "tableau.reject-rank",

    async arrange(api) {
      await pose(
        api,
        {
          tableau: [[card("spades", 7, true)]],
          waste: [card("hearts", 5, true)],
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
      await actShoot(api, "rank");
    },

    async assert(api, check) {
      check.expectEq(
        "a red 5 is rejected onto a black 7 (wrong rank)",
        rejected,
        false,
      );
      check.expectEq(
        "the column is unchanged (still just the 7)",
        s.tableau[0].length,
        1,
      );
    },
  };
}
