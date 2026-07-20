// Automated validation for the Scoring sub-item `high-score-persists`.
//
// The BEST score persists across sessions via localStorage. This check confirms the
// automatable half — a BEST established by real play survives returning to the title
// within the session and still reads back — and captures the title so the reviewer can
// spot-check that it also survives a real page reload (the full cross-session
// persistence a script cannot force in one page).
//
// The BEST is established by real play in `act` and the title is reached with
// `api.reset()`, exactly as before the two-pass migration. The runtime hands the clock
// back after a reset (see validation.mjs), so returning to the title mid-`act` neither
// freezes the recording nor forces this check to reach the title some other way —
// driving the pause menu would have coupled a persistence check to the menu's ORDER,
// so a build that ordered its pause entries differently would fail here for a reason
// having nothing to do with localStorage.

import {
  actEatSequence,
  actSettleShot,
  arrangeEatLane,
  beginRound,
} from "../_helpers.mjs";

// A beat of visible play before returning to the title, so the clip shows the score
// being earned rather than jumping straight to a menu.
const BEAT_TICKS = 4;

export default function item() {
  // The BEST real play established, and the state read back at the title.
  let best0;
  let s;

  return {
    id: "scoring.high-score-persists",

    async arrange(api) {
      await beginRound(api);
      await arrangeEatLane(api); // the lane the old eatSequence posed for itself
    },

    async act(api) {
      await actEatSequence(api, { count: 3 });
      best0 = (await api.snapshot()).best;
      await api.advance(BEAT_TICKS); // let the earned score sit on screen for a moment

      await api.reset(); // return to the title

      // settleMs 120 = the old trailing api.wait(120) before the capture. The returned
      // snapshot is the title the capture just filmed.
      s = await actSettleShot(api, "persist", { settleMs: 120 });
    },

    async assert(api, check) {
      check.expectGt("a BEST was established by real play", best0, 0);
      check.expectEq("BEST survives returning to the title", s.best, best0);
      check.expectEq("the title is showing", s.screen, "title");
    },
  };
}
