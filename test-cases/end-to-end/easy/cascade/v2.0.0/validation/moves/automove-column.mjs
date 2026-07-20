// Automated validation for the Auto-move-and-flip sub-item `automove-column`.
//
// Double-clicking a column's bottom face-up card sends it straight to its
// foundation when legal. The 2 of hearts on a column, with the Ace of hearts home,
// auto-moves onto the foundation. The real auto-move runs and the piles are read.
//
// The board is a precondition (`arrange`); the auto-move is the behavior under test,
// so it and the piles it leaves are what `act` films.

import { actShoot, card, pose } from "../_helpers.mjs";

export default function item() {
  let ok;
  let s;

  return {
    id: "moves.automove-column",

    async arrange(api) {
      await pose(
        api,
        {
          foundations: [[], [card("hearts", 1)]],
          tableau: [[card("hearts", 2, true)]],
        },
        1,
      );
    },

    async act(api) {
      ok = await api.call("autoMove", { pile: "tableau", column: 0 });
      s = await api.snapshot();
      await actShoot(api, "column");
    },

    async assert(api, check) {
      check.expectEq(
        "a column's bottom card auto-moves home when legal",
        ok,
        true,
      );
      check.expectEq(
        "the hearts foundation grew to two cards",
        s.foundations[1].length,
        2,
      );
      check.expectEq(
        "its top card is the 2",
        s.foundations[1][s.foundations[1].length - 1].rank,
        2,
      );
      check.expectEq("the source column is now empty", s.tableau[0].length, 0);
    },
  };
}
