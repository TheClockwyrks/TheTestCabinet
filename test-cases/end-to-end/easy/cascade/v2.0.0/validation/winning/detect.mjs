// Automated validation for the Winning sub-item `detect`.
//
// Completing all four foundations (all 52 cards home) is detected as a win: normal
// play stops and the victory cascade begins. The board is posed one card short of a
// win and that last card is moved home through the real move op, so the game's own
// win check fires. The pre- and post-move snapshots confirm the transition.
//
// The near-win board is the precondition (`arrange`, which also owns the reset). The
// move that wins, and the cascade it fires, are the behavior under test — so they are
// what `act` films: the old script's separate `setAutoStep` + `wait(2500)` clip tail
// is gone, replaced by advancing the cascade the same 2.5 s, which the record pass
// plays in real time.

import { card, suitRun, ticksFor } from "../_helpers.mjs";

// The old clip tail's 2.5 s of live cascade, in ticks: 2500 ms x 120 Hz = 300 exactly.
const CLIP_TICKS = ticksFor(2500);

export default function item() {
  let before;
  let after;

  return {
    id: "winning.detect",

    async arrange(api) {
      await api.reset({ seed: 2 });
      await api.call("setBoard", {
        foundations: [
          suitRun("spades", 1, 12),
          suitRun("hearts", 1, 13),
          suitRun("diamonds", 1, 13),
          suitRun("clubs", 1, 13),
        ],
        waste: [card("spades", 13, true)],
      });
      before = await api.snapshot();
    },

    async act(api) {
      // The final card home completes the last foundation.
      await api.call(
        "move",
        { pile: "waste" },
        { pile: "foundation", index: 0 },
      );
      after = await api.snapshot();

      // Let the cascade run, so the clip shows it launching.
      await api.advance(CLIP_TICKS);
    },

    async assert(api, check) {
      check.expectEq(
        "play is live before the last card goes home",
        before.screen,
        "playing",
      );
      check.expectEq("not yet won", before.won, false);

      check.expectEq("all 52 home is detected as a win", after.won, true);
      check.expectEq("normal play stops (the won screen)", after.screen, "won");
      check.expectNe("the victory cascade has begun", after.cascade, null);
    },
  };
}
