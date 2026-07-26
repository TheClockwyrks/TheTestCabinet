// Automated validation for the Auto-move-and-flip sub-item `facedown-not-draggable`.
//
// A face-down card is never draggable. This drives the game the way a player does —
// through injected pointer input (pointerDown / pointerMove, see
// specs/instrumentation.md) — pressing on a buried face-down card's exposed strip
// and dragging: nothing must lift. As a contrast (so a build that lifts nothing at
// all does not pass by accident), it then grabs the column's face-up bottom card,
// which MUST lift. The beats between the pointer ops give the video output visible
// motion.
//
// Those beats are `advance`, not `settle`: dragging resolves instantly in Cascade
// (the build's `step` is a no-op off a running cascade), so an advance moves no game
// state and is purely clip pacing — a real pause while recording, free while
// validating. Nothing here reads the canvas, so no paint settle is needed.

import {
  card,
  pose,
  tableauCardCenter,
  tableauCardTopLeft,
  ticksFor,
} from "../_helpers.mjs";

export default function item() {
  // The column as dealt, and the drag state after each half.
  let cards;
  let s1;
  let s2;

  return {
    id: "moves.facedown-not-draggable",

    // Column 0: two buried face-down cards under a face-up 7.
    async arrange(api) {
      const col = [
        card("clubs", 9, false),
        card("clubs", 8, false),
        card("spades", 7, true),
      ];
      await pose(api, { tableau: [col] }, 1);
      cards = (await api.snapshot()).tableau[0];
    },

    async act(api) {
      // Press on the exposed strip of the upper face-down card (index 1) and drag.
      const downTL = tableauCardTopLeft(0, cards, 1);
      await api.call("pointerDown", downTL.x + 50, downTL.y + 10);
      await api.advance(ticksFor(250));
      await api.call("pointerMove", 700, 400);
      await api.advance(ticksFor(350));
      await api.call("pointerMove", 900, 300);
      await api.advance(ticksFor(300));
      s1 = await api.snapshot();
      await api.call("pointerUp", 900, 300);
      await api.advance(ticksFor(200));

      // Contrast: the face-up bottom card (index 2) IS draggable.
      const upCenter = tableauCardCenter(0, cards, 2);
      await api.call("pointerDown", upCenter.x, upCenter.y);
      await api.advance(ticksFor(200));
      await api.call("pointerMove", 650, 420);
      await api.advance(ticksFor(350));
      s2 = await api.snapshot();
      await api.call("pointerUp", 650, 420);
      await api.advance(ticksFor(200));
    },

    async assert(api, check) {
      check.expectEq("pressing a face-down card lifts nothing", s1.drag, null);

      check.expectNe(
        "the face-up bottom card DOES lift when dragged",
        s2.drag,
        null,
      );
      check.expectEq(
        "and it is the face-up 7",
        s2.drag ? s2.drag.cards[0].rank : 0,
        7,
      );
    },
  };
}
