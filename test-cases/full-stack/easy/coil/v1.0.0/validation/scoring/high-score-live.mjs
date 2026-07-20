// Automated validation for the Scoring sub-item `high-score-live`.
//
// The BEST score updates the instant the current score passes it during play, not
// only at the end of the round. A BEST is first established by playing a real round
// (five eats), then a fresh round starts with the score set just below that BEST (a
// precondition) and a real eat drives the score across it — the live update resolves
// through the real tick and is read back the moment it happens.
//
// Only the opening lane can be posed ahead of time, because the second round's score
// is derived from the BEST the first round earns; so `act` runs the establishing eats,
// re-poses the fresh round with control ops, and drives the crossing eat. Re-posing
// mid-`act` uses startRound/setSnake/setScore/setPellet — control ops, which set state
// without touching the clock. (`api.reset()` from `act` is forbidden for exactly that
// reason, and is not needed here.)

import {
  actEatSequence,
  actPlayOn,
  arrangeEatLane,
  hLane,
  beginRound,
} from "../_helpers.mjs";

// The crossing eat resolves in one tick. Play on for a beat so the reviewer can read
// the new BEST in the HUD; the head is at col 11 facing right with 17 clear columns
// ahead, so 10 ticks cannot end the round, and every asserted value is already read.
const HOLD_TICKS = 10;

export default function item() {
  // The BEST the first round established, the BEST the fresh round opened showing, and
  // the state after the eat that crossed it.
  let best0;
  let bestAtNewRound;
  let s;

  return {
    id: "scoring.high-score-live",

    async arrange(api) {
      // A live round with the clear lane the establishing eats need.
      await beginRound(api);
      await arrangeEatLane(api);
    },

    async act(api) {
      // Establish a BEST by really playing a round.
      await actEatSequence(api, { count: 5 });
      best0 = (await api.snapshot()).best;

      // A fresh round, score set just below the established BEST.
      await api.call("startRound");
      await api.call("setSnake", hLane(10, 8, 3), "right");
      await api.call("setScore", best0 - 5);
      await api.call("setPellet", { col: 11, row: 8 }); // one cell ahead
      bestAtNewRound = (await api.snapshot()).best;

      await api.advance(1); // 1 tick = the old step(TICK_DT); a real eat pushes the score past BEST
      s = await api.snapshot();

      await actPlayOn(api, HOLD_TICKS);
    },

    async assert(api, check) {
      check.expectGt("a BEST was established by the first round", best0, 0);
      check.expectEq(
        "the new round's BEST still shows the established value",
        bestAtNewRound,
        best0,
      );
      check.expectGt("the current score crossed the old BEST", s.score, best0);
      check.expectEq("BEST updated live to the new score", s.best, s.score);
      check.expectGt("BEST rose from its old value", s.best, best0);
    },
  };
}
