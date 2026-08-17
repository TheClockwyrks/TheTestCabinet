// Automated validation for the Foundations sub-item `reject-gap`.
//
// A foundation builds up strictly by one: a same-suit card that skips a rank is
// rejected. On the Ace of spades, the 3 of spades (same suit, but not the next
// rank) must not be accepted. The real move runs and the unchanged pile is read.
//
// The board is a precondition (`arrange`); the attempted move is the behavior under
// test, so it — and the pile it leaves untouched — is what `act` films.

import { actShoot, card, pose } from "../_helpers.mjs";

export default function item() {
  let rejected;
  let s;

  return {
    id: "foundations.reject-gap",

    async arrange(api) {
      await pose(
        api,
        {
          foundations: [[card("spades", 1)]],
          waste: [card("spades", 3, true)],
        },
        1,
      );
    },

    async act(api) {
      rejected = await api.call(
        "move",
        { pile: "waste" },
        { pile: "foundation", index: 0 },
      );
      s = await api.snapshot();
      await actShoot(api, "gap");
    },

    async assert(api, check) {
      check.expectEq(
        "the 3 of spades is rejected onto the Ace (skips the 2)",
        rejected,
        false,
      );
      check.expectEq(
        "the foundation is unchanged (still just the Ace)",
        s.foundations[0].length,
        1,
      );
    },
  };
}
