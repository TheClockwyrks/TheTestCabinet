// Automated validation for the Drag-and-drop sub-item `snap-back`.
//
// Releasing a card over an illegal spot returns it to its origin. This drives real
// pointer input: holding a red 6 over a column showing a RED 7 (an illegal target —
// same color) and releasing there, the card must snap back to the waste, leaving
// both piles unchanged. The beats between pointer ops give the video output the
// pick-up, the illegal hover, and the snap-back.
//
// Those beats are `advance`, not `settle`: a drag and its release resolve instantly
// in Cascade (the build's `step` is a no-op off a running cascade), so an advance
// moves no game state and is purely clip pacing. Nothing here reads the canvas.

import {
  card,
  cardCenter,
  COLS_X,
  pose,
  TABLEAU_Y,
  ticksFor,
  wasteTopCenter,
} from "../_helpers.mjs";

export default function item() {
  let top;
  // The board while the card is held over the illegal target, and after the release.
  let held;
  let s;

  return {
    id: "dragdrop.snap-back",

    // A red 6 on the waste; column 0 exposes a red 7 (an illegal, same-color target).
    async arrange(api) {
      await pose(
        api,
        {
          tableau: [[card("hearts", 7, true)]],
          waste: [card("hearts", 6, true)],
        },
        1,
      );
      top = wasteTopCenter(await api.snapshot());
    },

    async act(api) {
      await api.call("pointerDown", top.x, top.y);
      await api.advance(ticksFor(150)); // 18 ticks

      const target = cardCenter(COLS_X[0], TABLEAU_Y);
      await api.call("pointerMove", target.x, target.y);
      await api.advance(ticksFor(350)); // 42 ticks
      held = await api.snapshot();

      // Release over the illegal target: the card snaps back to the waste.
      await api.call("pointerUp", target.x, target.y);
      await api.advance(ticksFor(300)); // 36 ticks
      s = await api.snapshot();
    },

    async assert(api, check) {
      check.expectEq(
        "no legal target is highlighted over the same-color card",
        held.dropHighlight,
        null,
      );

      check.expectEq("nothing is held after the release", s.drag, null);
      check.expectEq("the card snapped back to the waste", s.waste.length, 1);
      check.expectEq(
        "it is the red 6 again",
        s.waste[s.waste.length - 1].rank,
        6,
      );
      check.expectEq(
        "the illegal target column is unchanged",
        s.tableau[0].length,
        1,
      );
    },
  };
}
