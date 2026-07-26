// Automated validation for the Tableau sub-item `reject-nonking-empty`.
//
// Only a King may start an empty column: any lower card is rejected there. A Queen
// onto an empty column must not be accepted. The real move runs and the still-empty
// column is read back.
//
// The board is a precondition (`arrange`); the attempted move is the behavior under
// test, so it and the column that stays empty are what `act` films.

import { actShoot, card, pose } from "../_helpers.mjs";

export default function item() {
  let rejected;
  let s;

  return {
    id: "tableau.reject-nonking-empty",

    async arrange(api) {
      await pose(api, { waste: [card("spades", 12, true)] }, 1);
    },

    async act(api) {
      rejected = await api.call(
        "move",
        { pile: "waste" },
        { pile: "tableau", column: 0 },
      );
      s = await api.snapshot();
      await actShoot(api, "nonking");
    },

    async assert(api, check) {
      check.expectEq(
        "a Queen is rejected onto an empty column",
        rejected,
        false,
      );
      check.expectEq("the column stays empty", s.tableau[0].length, 0);
      check.expectEq("the Queen stays on the waste", s.waste.length, 1);
    },
  };
}
