// Automated validation for the Turning sub-item `reversal-ignored`.
//
// A request to reverse straight back into the neck (the opposite of the current
// direction) is ignored; the snake keeps moving the way it was. The snake is posed
// moving right (a precondition), runs on for a beat, a reversal (ArrowLeft) is
// injected through the real key handling, one real tick is stepped, and the facing and
// head are read back — the snake must still be moving right.
//
// The press sits in `act`, after the lead-in, because a buffered turn is drained by
// the next tick: pressed in `arrange` it would be spent by the first tick of the
// run-in, and the tick the assertions read would be an ordinary one that no reversal
// was ever asked of. It is the absence of a tick between the press and the read that
// carries the point, and nothing advances between them here.
//
// This item is the one where a lead-in earns the most: the checked behavior is that
// NOTHING happens, so without a run-in first there is no established motion for the
// ignored keypress to fail to change.
import { actLeadIn, actPlayOn, hLane, PARK_PELLET, beginRound } from "../_helpers.mjs";

// A full second of run-in. The snake travels along row 8, which carries no obstacle in
// either variant, so the only budget it spends is board: from col 10 the lead-in and
// the reversal tick leave the head at col 19.
const LEAD_TICKS = 8;
const HEAD_COL_AFTER = 10 + LEAD_TICKS + 1; // 19

// The snake keeps heading right from col 19 with 9 clear columns to the wall, so 8
// ticks (col 27) read as "it just carried on" without ending the round on camera.
// Lower than the old 10: the lead-in has already spent 8 of the columns that value
// was chosen against, and 10 here would run the head into the wall at col 29.
const HOLD_TICKS = 8;

export default function item() {
  // The state after the tick that should have ignored the reversal.
  let s;

  return {
    id: "turning.reversal-ignored",

    async arrange(api) {
      await beginRound(api);
      await api.call("setSnake", hLane(10, 8, 3), "right");
      await api.call("setPellet", PARK_PELLET);
    },

    async act(api) {
      // Establish the motion the reversal must fail to change.
      await actLeadIn(api, LEAD_TICKS);

      await api.call("press", "ArrowLeft"); // a reversal back into the neck

      await api.advance(1); // the tick that must ignore it
      s = await api.snapshot();
      await actPlayOn(api, HOLD_TICKS);
    },

    async assert(api, check) {
      check.expectEq(
        "the reversal is ignored — still moving right",
        s.dir,
        "right",
      );
      check.expectEq(
        "the head continued right (col)",
        s.snake[0].col,
        HEAD_COL_AFTER,
      );
      check.expectEq("the head stayed on its row", s.snake[0].row, 8);
      check.expectEq("the round is still live (no self-fold)", s.ended, false);
    },
  };
}
