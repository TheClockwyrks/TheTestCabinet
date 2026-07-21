// Automated validation for the Stock-and-waste sub-item `top-waste-only`.
//
// Only the top card of the waste is playable; playing it exposes the card beneath.
// A waste holds three cards with the 2 of spades on top; sending it home (onto the
// Ace) leaves the next card as the new top. The real move runs and the waste is
// read back before and after.
//
// The posed waste and its pre-move reading are the precondition (`arrange`); playing
// the top card is the behavior under test, so that move and the newly exposed card
// are what `act` films.

import { actShoot, card, pose } from "../_helpers.mjs";

export default function item() {
  let before;
  let ok;
  let after;

  return {
    id: "stock.top-waste-only",

    // The waste's top (last) card is the 2 of spades; foundation 0 holds its Ace.
    async arrange(api) {
      await pose(
        api,
        {
          foundations: [[card("spades", 1)]],
          waste: [
            card("hearts", 5, true),
            card("diamonds", 9, true),
            card("spades", 2, true),
          ],
        },
        1,
      );
      before = await api.snapshot();
    },

    async act(api) {
      // Playing the top card sends it home; the card beneath becomes the new top.
      ok = await api.call(
        "move",
        { pile: "waste" },
        { pile: "foundation", index: 0 },
      );
      after = await api.snapshot();
      await actShoot(api, "top");
    },

    async assert(api, check) {
      const topBefore = before.waste[before.waste.length - 1];
      check.expectEq(
        "the playable top waste card is the 2 of spades",
        topBefore.rank,
        2,
      );

      check.expectEq("the top waste card played home", ok, true);
      check.expectEq("the foundation grew", after.foundations[0].length, 2);
      check.expectEq(
        "the waste now holds one fewer card",
        after.waste.length,
        2,
      );
      const topAfter = after.waste[after.waste.length - 1];
      check.expectEq(
        "the newly exposed top card is the 9 of diamonds",
        topAfter.rank,
        9,
      );
    },
  };
}
