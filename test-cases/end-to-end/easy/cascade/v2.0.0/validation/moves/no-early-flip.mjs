// Automated validation for the Auto-move-and-flip sub-item `no-early-flip`.
//
// The complement of `flip-exposed`: a buried card is turned face-up only when a move
// COMMITS, never merely because the card above it was lifted. A common bug flips the
// newly exposed card the instant a lift detaches the card over it; then, if that lift
// is returned (an illegal drop snaps back), the column ends up with two face-up cards
// in an impossible order — the just-revealed card face-up UNDER the returned one.
//
// The check drives real pointer input: it presses a column's lone face-up card
// (sitting on a face-down card), drags it out over an empty column (which rejects a
// non-King, so there is no legal target), and releases so the card snaps back. It
// reads the buried card WHILE the lift is held and again AFTER the snap-back. The
// buried card must stay face-down throughout, and the column must return exactly to
// its two-card, one-face-up starting shape.
//
// The posed column and its pre-lift reading are the precondition (`arrange`); the
// lift, the illegal hover, and the snap-back are the behavior under test, so they are
// what `act` films. The beats between the pointer ops are `advance`, not `settle`: a
// drag and its release resolve instantly (the build's `step` is a no-op off a running
// cascade), so an advance moves no game state and is purely clip pacing. Nothing here
// reads the canvas.

import {
  card,
  cardCenter,
  COLS_X,
  pose,
  TABLEAU_Y,
  tableauCardCenter,
  ticksFor,
} from "../_helpers.mjs";

export default function item() {
  // The board before the lift, while the card is held, and after the snap-back.
  let before;
  let grab;
  let held;
  let s;

  return {
    id: "moves.no-early-flip",

    // Column 0: a buried face-down 9 of diamonds under a lone face-up 6 of spades.
    // No red 7 and no ace anywhere, so the 6 has no legal home and must snap back.
    async arrange(api) {
      await pose(
        api,
        {
          tableau: [[card("diamonds", 9, false), card("spades", 6, true)]],
        },
        1,
      );
      before = await api.snapshot();
      // The center of the face-up top card (index 1) of column 0.
      grab = tableauCardCenter(0, before.tableau[0], 1);
    },

    async act(api) {
      await api.call("pointerDown", grab.x, grab.y);
      await api.advance(ticksFor(150)); // 18 ticks

      // Drag the 6 out over an empty column (an illegal target for a non-King),
      // detaching it from column 0, and read the board while it is held.
      const over = cardCenter(COLS_X[3], TABLEAU_Y);
      await api.call("pointerMove", over.x, over.y);
      await api.advance(ticksFor(350)); // 42 ticks
      held = await api.snapshot();

      // Release over the empty column: no legal target, so the 6 snaps back.
      await api.call("pointerUp", over.x, over.y);
      await api.advance(ticksFor(300)); // 36 ticks
      s = await api.snapshot();
    },

    async assert(api, check) {
      check.expectEq(
        "the buried card starts face-down",
        before.tableau[0][0].faceUp,
        false,
      );

      // While the top card is held, the exposed card beneath must NOT flip up.
      check.expectNe("the 6 is held after the lift", held.drag, null);
      check.expectEq(
        "the held card is the 6 of spades",
        held.drag ? held.drag.cards[0].rank : 0,
        6,
      );
      check.expectEq(
        "the buried card stays face-down while the card above it is held",
        held.tableau[0][0].faceUp,
        false,
      );

      // After the snap-back the column is exactly its starting shape: two cards,
      // the buried 9 still face-down under the returned 6 — never two face-up.
      check.expectEq("nothing is held after the release", s.drag, null);
      check.expectEq(
        "the column holds both cards again",
        s.tableau[0].length,
        2,
      );
      check.expectEq(
        "the buried card is still face-down after the snap-back",
        s.tableau[0][0].faceUp,
        false,
      );
      check.expectEq("the buried card is still the 9", s.tableau[0][0].rank, 9);
      check.expectEq(
        "the returned top card is face-up",
        s.tableau[0][1].faceUp,
        true,
      );
      check.expectEq(
        "exactly one card in the column is face-up",
        s.tableau[0].filter((c) => c.faceUp).length,
        1,
      );
    },
  };
}
