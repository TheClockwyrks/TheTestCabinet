// Automated validation for the Winning sub-item `no-false-win`.
//
// The win fires only when EVERY foundation is complete: 51 cards home is not a win.
// The board is posed at 50 home and one card is moved home to reach 51 (the last
// foundation still one short), through the real move op, so the real win check runs
// and must return false. The post-move snapshot confirms play continues.
//
// The 50-home board is the precondition (`arrange`, which also owns the reset); the
// 51st card going home — and the table staying in play rather than erupting into a
// cascade — is what `act` films. The pause before the capture is `api.settle`, not
// `api.advance`: a screenshot must read a PAINTED frame, which stepping does not
// produce, and `settle` is real milliseconds in both passes so the 90 ms carries over
// unconverted.

import { card, suitRun } from "../_helpers.mjs";

export default function item() {
  let ok;
  let s;

  return {
    id: "winning.no-false-win",

    // Spades and hearts complete; diamonds and clubs one short each (50 home).
    async arrange(api) {
      await api.reset({ seed: 3 });
      await api.call("setBoard", {
        foundations: [
          suitRun("spades", 1, 13),
          suitRun("hearts", 1, 13),
          suitRun("diamonds", 1, 12),
          suitRun("clubs", 1, 12),
        ],
        waste: [card("diamonds", 13, true)],
      });
    },

    async act(api) {
      // Send the King of diamonds home: diamonds complete (51 total), clubs still short.
      ok = await api.call(
        "move",
        { pile: "waste" },
        { pile: "foundation", index: 2 },
      );
      s = await api.snapshot();

      await api.settle(90);
      await api.screenshot("not-won");
    },

    async assert(api, check) {
      check.expectEq("the 51st card went home", ok, true);
      const total = s.foundations.reduce((n, f) => n + f.length, 0);
      check.expectEq("51 cards are home", total, 51);
      check.expectEq("51 home is NOT a win", s.won, false);
      check.expectEq("play continues", s.screen, "playing");
      check.expectEq("no victory cascade has started", s.cascade, null);
    },
  };
}
