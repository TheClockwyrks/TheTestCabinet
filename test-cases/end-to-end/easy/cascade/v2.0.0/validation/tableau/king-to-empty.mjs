// Automated validation for the Tableau sub-item `king-to-empty`.
//
// Only a King may be moved onto an empty column. A King is accepted onto an empty
// column. The real move runs and the column is read back.
//
// The board is a precondition (`arrange`); the move is the behavior under test, so
// it and the column the King now heads are what `act` films.

import { actShoot, card, pose } from "../_helpers.mjs";

export default function item() {
  let ok;
  let s;

  return {
    id: "tableau.king-to-empty",

    // Column 0 is empty (no tableau given); a King is on the waste.
    async arrange(api) {
      await pose(api, { waste: [card("spades", 13, true)] }, 1);
    },

    async act(api) {
      ok = await api.call(
        "move",
        { pile: "waste" },
        { pile: "tableau", column: 0 },
      );
      s = await api.snapshot();
      await actShoot(api, "king");
    },

    async assert(api, check) {
      check.expectEq("a King is accepted onto an empty column", ok, true);
      check.expectEq("the column now holds one card", s.tableau[0].length, 1);
      check.expectEq("that card is the King", s.tableau[0][0].rank, 13);
    },
  };
}
