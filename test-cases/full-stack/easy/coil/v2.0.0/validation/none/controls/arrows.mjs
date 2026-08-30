// Automated validation for the Controls sub-item `arrows`.
//
// The arrow keys steer the snake. A round is started from the title with injected keys
// (so the game stays under normal keyboard control), then each arrow is pressed in turn
// from a valid facing — the injected key flows through the real key handling — and one
// real tick applies the turn, which the snapshot reads back. Chaining up -> left ->
// down -> right exercises all four arrows without a reversal.
//
// Menu navigation is a single instant press, so starting the round is `arrange`; the
// four steer-and-tick pairs consume time and are the clip — the snake actually turning
// under each arrow, which is exactly what is checked.

import { actPlayOn, actSteer, startWithKeys } from "../_helpers.mjs";

// The four turns take four ticks (0.5 s). Play on afterwards so the clip shows the
// snake running under the last commanded heading rather than cutting on the turn. It
// ends facing right near mid-board with the pellet parked off-lane, so 10 ticks cannot
// reach a wall — and the four directions are already captured, so this decides nothing.
const HOLD_TICKS = 10;

export default function item() {
  // The direction the snake was moving after each arrow, checked by `assert`.
  let up;
  let left;
  let down;
  let right;

  return {
    id: "controls.arrows",

    async arrange(api) {
      await startWithKeys(api); // snake starts moving right
    },

    async act(api) {
      // actSteer presses the key and advances the single tick that applies the
      // buffered turn (1 tick = the old step(TICK_DT)).
      up = await actSteer(api, "ArrowUp");
      left = await actSteer(api, "ArrowLeft");
      down = await actSteer(api, "ArrowDown");
      right = await actSteer(api, "ArrowRight");
      await actPlayOn(api, HOLD_TICKS);
    },

    async assert(api, check) {
      check.expectEq("ArrowUp steers up (from right)", up, "up");
      check.expectEq("ArrowLeft steers left (from up)", left, "left");
      check.expectEq("ArrowDown steers down (from left)", down, "down");
      check.expectEq("ArrowRight steers right (from down)", right, "right");
    },
  };
}
