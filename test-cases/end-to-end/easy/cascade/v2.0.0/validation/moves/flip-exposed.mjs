// Automated validation for the Auto-move-and-flip sub-item `flip-exposed`.
//
// When a move leaves a column's new bottom card face-down, that card is immediately
// turned face-up. A column of [face-down 5, face-up 6]: moving the 6 away exposes
// the 5, which must flip face-up. The real move (and its post-move bookkeeping)
// runs, and the newly exposed card is read back.
//
// The posed column and its pre-move reading are the precondition (`arrange`); the
// move that exposes the buried card is the behavior under test, so it and the
// flipped card are what `act` films.

import { actShoot, card, pose } from "../_helpers.mjs";

export default function item() {
  // The board before the move (the buried card face-down) and after it.
  let before;
  let ok;
  let s;

  return {
    id: "moves.flip-exposed",

    // Column 0: a buried face-down 5 of hearts under a face-up 6 of spades.
    // Column 1: a red 7, a legal home for the black 6.
    async arrange(api) {
      await pose(
        api,
        {
          tableau: [
            [card("hearts", 5, false), card("spades", 6, true)],
            [card("hearts", 7, true)],
          ],
        },
        1,
      );
      before = await api.snapshot();
    },

    async act(api) {
      // Move the black 6 onto the red 7, exposing the 5 beneath it.
      ok = await api.call(
        "move",
        { pile: "tableau", column: 0 },
        { pile: "tableau", column: 1 },
      );
      s = await api.snapshot();
      await actShoot(api, "flip");
    },

    async assert(api, check) {
      check.expectEq(
        "the buried card starts face-down",
        before.tableau[0][0].faceUp,
        false,
      );

      check.expectEq("the 6 moved onto the 7", ok, true);
      check.expectEq(
        "the source column now holds just the exposed card",
        s.tableau[0].length,
        1,
      );
      check.expectEq(
        "the exposed 5 is now face-up",
        s.tableau[0][0].faceUp,
        true,
      );
      check.expectEq("it is the 5 of hearts", s.tableau[0][0].rank, 5);
    },
  };
}
