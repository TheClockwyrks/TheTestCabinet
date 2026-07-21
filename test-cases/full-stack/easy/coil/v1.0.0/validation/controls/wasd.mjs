// Automated validation for the Controls sub-item `wasd`.
//
// W/A/S/D steer the snake identically to the arrow keys. A round is started from the
// title with injected keys, then W -> A -> S -> D are pressed in turn from valid
// facings (each flowing through the real key handling), and one real tick applies each
// turn, read back from the snapshot. Chaining up -> left -> down -> right exercises all
// four keys without a reversal.
//
// Menu navigation is a single instant press, so starting the round is `arrange`; the
// four steer-and-tick pairs consume time and are the clip.

import { actPlayOn, actSteer, startWithKeys } from "../_helpers.mjs";

// The four turns take four ticks (0.5 s). Play on afterwards so the clip does not cut
// on the last turn. It ends facing right near mid-board with the pellet parked
// off-lane, so 10 ticks cannot reach a wall, and every direction is already captured.
const HOLD_TICKS = 10;

export default function item() {
  // The direction the snake was moving after each key, checked by `assert`.
  let up;
  let left;
  let down;
  let right;

  return {
    id: "controls.wasd",

    async arrange(api) {
      await startWithKeys(api); // snake starts moving right
    },

    async act(api) {
      // actSteer presses the key and advances the single tick that applies the
      // buffered turn (1 tick = the old step(TICK_DT)).
      up = await actSteer(api, "KeyW");
      left = await actSteer(api, "KeyA");
      down = await actSteer(api, "KeyS");
      right = await actSteer(api, "KeyD");
      await actPlayOn(api, HOLD_TICKS);
    },

    async assert(api, check) {
      check.expectEq("W steers up (from right)", up, "up");
      check.expectEq("A steers left (from up)", left, "left");
      check.expectEq("S steers down (from left)", down, "down");
      check.expectEq("D steers right (from down)", right, "right");
    },
  };
}
