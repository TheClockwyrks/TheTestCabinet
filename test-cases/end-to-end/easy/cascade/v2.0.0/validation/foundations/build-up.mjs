// Automated validation for the Foundations sub-item `build-up`.
//
// A foundation builds up by suit: on an Ace it accepts the next-higher card of the
// same suit (the 2), and on the 2 the 3, and so on. The real move runs and the
// growing pile is read back.
//
// Both moves are the behavior under test, so both run in `act` and both are filmed.
// The second board is re-posed with `setBoard` (a control op, as the original script
// already did) rather than `pose`, whose leading `reset` is not allowed inside `act`.

import { actShoot, card, pose } from "../_helpers.mjs";

export default function item() {
  // Each move's result and the pile it left behind.
  let twoOk;
  let afterTwo;
  let threeOk;
  let afterThree;

  return {
    id: "foundations.build-up",

    // Foundation 0 holds the Ace of spades; the 2 of spades is on the waste.
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
      twoOk = await api.call(
        "move",
        { pile: "waste" },
        { pile: "foundation", index: 0 },
      );
      afterTwo = await api.snapshot();

      // And the 3 of spades onto the 2.
      await api.call("setBoard", {
        foundations: [[card("spades", 1), card("spades", 2)]],
        waste: [card("spades", 3, true)],
      });
      threeOk = await api.call(
        "move",
        { pile: "waste" },
        { pile: "foundation", index: 0 },
      );
      afterThree = await api.snapshot();

      await actShoot(api, "build");
    },

    async assert(api, check) {
      check.expectEq("the 2 of spades is accepted onto the Ace", twoOk, true);
      check.expectEq(
        "the foundation now holds two cards",
        afterTwo.foundations[0].length,
        2,
      );
      check.expectEq(
        "its top card is the 2",
        afterTwo.foundations[0][afterTwo.foundations[0].length - 1].rank,
        2,
      );

      check.expectEq("the 3 of spades is accepted onto the 2", threeOk, true);
      check.expectEq(
        "its top card is now the 3",
        afterThree.foundations[0][afterThree.foundations[0].length - 1].rank,
        3,
      );
    },
  };
}
