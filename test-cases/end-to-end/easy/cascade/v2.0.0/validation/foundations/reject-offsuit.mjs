// Automated validation for the Foundations sub-item `reject-offsuit`.
//
// A foundation is a single suit: a next-rank card of the WRONG suit is rejected.
// On the Ace of spades, the 2 of hearts (right rank, wrong suit) must not be
// accepted. The real move runs and the unchanged pile is read back.
//
// The board is a precondition (`arrange`); the attempted move is the behavior under
// test, so it — and the pile it leaves untouched — is what `act` films.

import { actShoot, card, pose } from "../_helpers.mjs";

export default function item() {
  let rejected;
  let s;

  return {
    id: "foundations.reject-offsuit",

    async arrange(api) {
      await pose(
        api,
        {
          foundations: [[card("spades", 1)]],
          waste: [card("hearts", 2, true)],
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
      await actShoot(api, "offsuit");
    },

    async assert(api, check) {
      check.expectEq(
        "the 2 of hearts is rejected onto the Ace of spades (wrong suit)",
        rejected,
        false,
      );
      check.expectEq(
        "the foundation is unchanged (still just the Ace)",
        s.foundations[0].length,
        1,
      );
      check.expectEq("the 2 of hearts stays on the waste", s.waste.length, 1);
    },
  };
}
