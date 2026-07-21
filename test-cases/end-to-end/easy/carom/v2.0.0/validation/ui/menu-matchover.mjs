// Automated validation for the UI sub-item `state-matchover`: the match-over screen
// is reachable, and the debug API captures it so a reviewer sees the actual screen.
//
// A real match is driven to its end (10-0, then a real point across the goal to
// 11-0); the screen is read back and a screenshot captured as the reviewer's proof.
// Whether the screen (winner, final score, play again / menu) reads well is judged by
// eye from the capture. See validation/_helpers.mjs.
//
// Posing the match at 10-0 with the winning point aimed across the goal is all control
// ops, so it is `arrange`; playing that point out through the real scoring code is what
// consumes time, so it is `act`. The point is played for real rather than fabricated,
// so the match-over screen is reached the way a player reaches it.

import { arrangeMatchOver, actMatchOver } from "../_helpers.mjs";

// Let the match-over screen settle before capturing it: 200ms x 120 Hz = 24 ticks
// exactly. Screens of this kind often animate in, so the capture waits for it to land.
const SETTLE_TICKS = 24;

export default function item() {
  // The snapshot at the instant the match ended, checked by `assert`.
  let end;

  return {
    id: "ui.state-matchover",

    async arrange(api) {
      await arrangeMatchOver(api, "versus");
    },

    async act(api) {
      end = await actMatchOver(api);
      await api.advance(SETTLE_TICKS);
      await api.screenshot("matchover");
    },

    async assert(api, check) {
      check.expectEq(
        "winning a match opens the match-over screen",
        end.screen,
        "matchover",
      );
    },
  };
}
