// Automated validation for the Foundations sub-item `ace-only`.
//
// An empty foundation accepts only an Ace and rejects any other rank. Each move is
// the real legal-move check + apply (the same path a drag release uses); the board
// is read back to confirm what the real rules allowed.
//
// Both halves — the rejected 5 and the accepted Ace — are what the item checks, so
// both run in `act` and both are filmed. The second board is re-posed with
// `setBoard` rather than `pose`, because `pose` leads with a `reset` and a reset
// inside `act` would take the clock back mid-phase. `setBoard` leaves every pile it
// does not name empty (specs/instrumentation.md), so naming only the waste restores
// the empty-foundation precondition exactly.

import { actShoot, card, pose } from "../_helpers.mjs";

export default function item() {
  // Each move's result and the board it left behind.
  let rejected;
  let afterReject;
  let accepted;
  let afterAccept;

  return {
    id: "foundations.ace-only",

    // A non-Ace on the waste, over four empty foundations.
    async arrange(api) {
      await pose(api, { waste: [card("hearts", 5, true)] }, 1);
    },

    async act(api) {
      // A non-Ace is rejected onto an empty foundation.
      rejected = await api.call(
        "move",
        { pile: "waste" },
        { pile: "foundation", index: 0 },
      );
      afterReject = await api.snapshot();

      // An Ace is accepted onto an empty foundation.
      await api.call("setBoard", { waste: [card("spades", 1, true)] });
      accepted = await api.call(
        "move",
        { pile: "waste" },
        { pile: "foundation", index: 0 },
      );
      afterAccept = await api.snapshot();

      await actShoot(api, "ace");
    },

    async assert(api, check) {
      check.expectEq(
        "a 5 is rejected onto an empty foundation",
        rejected,
        false,
      );
      check.expectEq(
        "the rejected foundation stays empty",
        afterReject.foundations[0].length,
        0,
      );

      check.expectEq(
        "an Ace is accepted onto an empty foundation",
        accepted,
        true,
      );
      check.expectEq(
        "the foundation now holds one card",
        afterAccept.foundations[0].length,
        1,
      );
      check.expectEq(
        "that card is the Ace",
        afterAccept.foundations[0][0].rank,
        1,
      );
    },
  };
}
