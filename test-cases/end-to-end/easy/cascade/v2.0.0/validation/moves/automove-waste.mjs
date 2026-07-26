// Automated validation for the Auto-move-and-flip sub-item `automove-waste`.
//
// Double-clicking the top of the waste sends it straight to its foundation when
// that move is legal. The 2 of spades on the waste, with the Ace of spades home,
// auto-moves onto the foundation. The real auto-move runs and the piles are read.
//
// The board is a precondition (`arrange`); the auto-move is the behavior under test,
// so it and the piles it leaves are what `act` films.

import { actShoot, card, pose } from "../_helpers.mjs";

export default function item() {
  let ok;
  let s;

  return {
    id: "moves.automove-waste",

    async arrange(api) {
      await pose(
        api,
        {
          foundations: [[card("spades", 1)]],
          waste: [card("spades", 2, true)],
        },
        1,
      );
    },

    async act(api) {
      ok = await api.call("autoMove", { pile: "waste" });
      s = await api.snapshot();
      await actShoot(api, "waste");
    },

    async assert(api, check) {
      check.expectEq(
        "the waste's top card auto-moves home when legal",
        ok,
        true,
      );
      check.expectEq(
        "the foundation grew to two cards",
        s.foundations[0].length,
        2,
      );
      check.expectEq(
        "its top card is the 2",
        s.foundations[0][s.foundations[0].length - 1].rank,
        2,
      );
      check.expectEq("the waste is now empty", s.waste.length, 0);
    },
  };
}
