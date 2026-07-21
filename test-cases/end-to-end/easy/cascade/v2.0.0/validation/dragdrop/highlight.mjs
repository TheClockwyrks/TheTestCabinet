// Automated validation for the Drag-and-drop sub-item `highlight`.
//
// A legal drop target under the held card is highlighted; moving off it clears the
// highlight. This drives real pointer input: holding a red 6 over a column showing a
// black 7 (a legal target) reports that column as the highlighted target, and moving
// the card over empty felt clears it. The beats between pointer ops give the video
// output the highlight appearing and clearing.
//
// Those beats are `advance`, not `settle`: hover highlighting resolves instantly in
// Cascade (the build's `step` is a no-op off a running cascade), so an advance moves
// no game state and is purely clip pacing. This item reads the reported highlight,
// not the canvas (the painted highlight is `color/drop-highlight`'s job), so no paint
// settle is needed.

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
  // The reported highlight while over the legal target, and after moving off it.
  let s1;
  let s2;

  return {
    id: "dragdrop.highlight",

    // A red 6 on the waste; column 0 exposes a black 7 (a legal target for it).
    async arrange(api) {
      await pose(
        api,
        {
          tableau: [[card("spades", 7, true)]],
          waste: [card("hearts", 6, true)],
        },
        1,
      );
      top = wasteTopCenter(await api.snapshot());
    },

    async act(api) {
      await api.call("pointerDown", top.x, top.y);
      await api.advance(ticksFor(150)); // 18 ticks

      // Move the held card over column 0's card so the hand overlaps its drop rect.
      const target = cardCenter(COLS_X[0], TABLEAU_Y);
      await api.call("pointerMove", target.x, target.y);
      await api.advance(ticksFor(350)); // 42 ticks
      s1 = await api.snapshot();

      // Move over empty felt: no legal target, so the highlight clears.
      await api.call("pointerMove", 700, 620);
      await api.advance(ticksFor(350));
      s2 = await api.snapshot();

      await api.call("pointerUp", 700, 620);
      await api.advance(ticksFor(150));
    },

    async assert(api, check) {
      check.expectNe("a card is held", s1.drag, null);
      check.expectNe(
        "a legal target under the card is highlighted",
        s1.dropHighlight,
        null,
      );
      check.expectEq(
        "the highlighted target is a tableau column",
        s1.dropHighlight ? s1.dropHighlight.pile : "",
        "tableau",
      );
      check.expectEq(
        "specifically column 0 (the black 7)",
        s1.dropHighlight ? s1.dropHighlight.column : -1,
        0,
      );

      check.expectEq(
        "moving off the target clears the highlight",
        s2.dropHighlight,
        null,
      );
    },
  };
}
