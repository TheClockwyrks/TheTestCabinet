// Automated validation for the Game States sub-item `gameover`.
//
// A death ends the round on the game-over screen. A real death is driven (the head
// runs into a wall), the end state is read back, and the screen is captured so a
// reviewer sees the actual game-over panel (final score and BEST, play again / menu).
//
// The pose is instant (`arrange`); the fatal tick and the settle the capture needs are
// `act`.

import { actPlayOn, actSettleShot, hLane, beginRound } from "../_helpers.mjs";

// The death lands on the first tick, so the panel would otherwise flash by. Hold on it
// for a beat (8 ticks = 1 s) after the capture; the round is over, so these ticks
// advance nothing.
const HOLD_TICKS = 8;

export default function item() {
  // The state `act` read back after the fatal tick, checked by `assert`.
  let s;

  return {
    id: "states.gameover",

    async arrange(api) {
      await beginRound(api);
      await api.call("setScore", 70); // a non-zero score to show on the panel
      await api.call("setSnake", hLane(28, 8, 3), "right"); // head at the last interior col
      await api.call("setPellet", { col: 5, row: 1 });
    },

    async act(api) {
      await api.advance(1); // 1 tick = the old step(TICK_DT); run into the wall -> death
      s = await api.snapshot();
      // settleMs 200 = the old trailing api.wait(200) before the capture.
      await actSettleShot(api, "gameover", { settleMs: 200 });
      await actPlayOn(api, HOLD_TICKS);
    },

    async assert(api, check) {
      check.expectEq(
        "a death reaches the game-over screen",
        s.screen,
        "gameover",
      );
      check.expectEq("the end reason is death", s.endReason, "dead");
    },
  };
}
