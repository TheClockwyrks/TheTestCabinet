// Automated validation for the Drag-and-drop sub-item `follows-cursor`.
//
// A held card follows the cursor and floats above the table (detached from its
// source). This drives real pointer input (pointerDown then pointerMove, see
// specs/instrumentation.md): pressing the waste's top card and moving the cursor,
// the drag's reported position must track the cursor and the card must leave its
// source pile. The beats between pointer ops give the video output the card gliding
// under the cursor.
//
// Those beats are `advance`, not `settle`: a drag resolves instantly in Cascade (the
// build's `step` is a no-op off a running cascade), so an advance moves no game state
// and is purely clip pacing — a real pause while recording, free while validating.
// Nothing here reads the canvas, so no paint settle is needed.

import { card, pose, ticksFor, wasteTopCenter } from "../_helpers.mjs";

// Pressing at the card's center offsets the grab by half the card, so the drag's
// top-left tracks the cursor minus (CARD_W/2, CARD_H/2) = (50, 70).
const GX = 50;
const GY = 70;

export default function item() {
  // The King's resting place, and the drag state at each of the two cursor points.
  let top;
  let s1;
  let s2;

  return {
    id: "dragdrop.follows-cursor",

    async arrange(api) {
      await pose(api, { waste: [card("spades", 13, true)] }, 1);
      const snap = await api.snapshot();
      top = wasteTopCenter(snap);
    },

    async act(api) {
      await api.call("pointerDown", top.x, top.y);
      await api.advance(ticksFor(150)); // 18 ticks

      await api.call("pointerMove", 700, 400);
      await api.advance(ticksFor(300)); // 36 ticks
      s1 = await api.snapshot();

      await api.call("pointerMove", 950, 220);
      await api.advance(ticksFor(300));
      s2 = await api.snapshot();

      await api.call("pointerUp", 950, 220);
      await api.advance(ticksFor(150));
    },

    async assert(api, check) {
      check.expectNe(
        "a card is held after pressing the waste and moving",
        s1.drag,
        null,
      );
      check.expectEq(
        "the held card is the King",
        s1.drag ? s1.drag.cards[0].rank : 0,
        13,
      );
      check.expectEq(
        "the card left its source (waste is now empty while held)",
        s1.waste.length,
        0,
      );
      check.expectClose(
        "the held card's x tracks the cursor",
        s1.drag ? s1.drag.x : NaN,
        700 - GX,
        0.5,
      );
      check.expectClose(
        "the held card's y tracks the cursor",
        s1.drag ? s1.drag.y : NaN,
        400 - GY,
        0.5,
      );

      check.expectClose(
        "the held card follows to a second point (x)",
        s2.drag ? s2.drag.x : NaN,
        950 - GX,
        0.5,
      );
      check.expectClose(
        "the held card follows to a second point (y)",
        s2.drag ? s2.drag.y : NaN,
        220 - GY,
        0.5,
      );
    },
  };
}
