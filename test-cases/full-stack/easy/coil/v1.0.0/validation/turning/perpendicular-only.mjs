// Automated validation for the Turning sub-item `perpendicular-only`.
//
// Only a turn perpendicular to the current direction is accepted; a request to keep
// going straight is a no-op. While moving right: a straight request (ArrowRight) is
// ignored and the snake keeps its heading, while the two perpendicular requests
// (ArrowUp, ArrowDown) are accepted. Each case is posed fresh moving right (a
// precondition), the steering key is injected through the real handling, and the
// facing is read back after one real tick.
//
// Only the round can be opened ahead of time: each of the three cases re-poses the
// snake and then consumes a tick, so the whole three-case sweep is `act` — and it is
// the clip, three steering attempts back to back. Re-posing there uses setSnake /
// setPellet, control ops that set state without touching the clock.

import { actPlayOn, hLane, PARK_PELLET, beginRound } from "../_helpers.mjs";

// The last case leaves the head at (10,9) heading DOWN with the interior ending at row
// 16, so cap the tail at 6 ticks (row 15) — the clip must not end in a wall death.
const HOLD_TICKS = 6;

/**
 * Pose the snake fresh moving right, inject one steering key, and report the direction
 * after the single tick that would apply it. Runs in `act`: it consumes a tick.
 */
async function turnResult(api, code) {
  await api.call("setSnake", hLane(10, 8, 3), "right");
  await api.call("setPellet", PARK_PELLET);
  await api.call("press", code);
  await api.advance(1); // 1 tick = the old step(TICK_DT)
  return (await api.snapshot()).dir;
}

export default function item() {
  // The direction after each of the three steering attempts.
  let straight;
  let up;
  let down;

  return {
    id: "turning.perpendicular-only",

    async arrange(api) {
      await beginRound(api);
    },

    async act(api) {
      straight = await turnResult(api, "ArrowRight");
      up = await turnResult(api, "ArrowUp");
      down = await turnResult(api, "ArrowDown");
      await actPlayOn(api, HOLD_TICKS);
    },

    async assert(api, check) {
      check.expectEq(
        "a straight request (ArrowRight) while moving right is a no-op",
        straight,
        "right",
      );
      check.expectEq(
        "a perpendicular request (ArrowUp) while moving right is accepted",
        up,
        "up",
      );
      check.expectEq(
        "a perpendicular request (ArrowDown) while moving right is accepted",
        down,
        "down",
      );
    },
  };
}
