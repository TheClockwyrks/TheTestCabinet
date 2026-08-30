// Automated validation for the Turning sub-item `perpendicular-only`.
//
// Only a turn perpendicular to the current direction is accepted; a request to keep
// going straight is a no-op. While moving right: a straight request (ArrowRight) is
// ignored and the snake keeps its heading, while the two perpendicular requests
// (ArrowUp, ArrowDown) are accepted. Each case is posed fresh moving right (a
// precondition), given a beat to run so the steering reads against established
// motion, then the steering key is injected through the real handling and the facing
// is read back after one real tick.
//
// Only the round can be opened ahead of time: each of the three cases re-poses the
// snake and then consumes ticks, so the whole three-case sweep is `act` — and it is
// the clip, three steering attempts back to back. Re-posing there uses setSnake /
// setPellet, control ops that set state without touching the clock.

import {
  actLeadIn,
  actPlayOn,
  hLane,
  PARK_PELLET,
  beginRound,
} from "../_helpers.mjs";

// Five ticks of run-in per case rather than the usual eight, for the geometry the
// DOWN case leaves behind: it is the last one filmed, and the tail below descends
// from wherever the lead-in left the head. In the Maze variant the row-13 obstacle bar
// spans cols 16-21 (`MAZE_OBSTACLES`), so an eight-tick run-in (col 18) would drop the
// snake straight onto it. Five leaves the head at col 15, clear in both variants.
const LEAD_TICKS = 5;

// Ticks the snake runs ON ITS NEW HEADING before the next case re-poses it. Without
// this the turn is on screen for the single 125 ms tick that applied it and then the
// snake teleports back to the pose — so the UP and DOWN cases, the two that actually
// change the heading, read as a one-frame flicker rather than as a turn. Three tiles of
// travel is what makes each attempt legible as its own little scenario.
//
// It is bounded by the vertical cases, which spend board: the turn leaves the head at
// row 7 (up) or row 9 (down) in col 15, and the interior is rows 1-16, so three ticks
// land on row 4 or row 12 — clear of both walls, and clear of the Maze bars at row 4
// (cols 8-13) and row 13 (cols 16-21), neither of which reaches col 15.
const POST_TURN_TICKS = 3;

// The DOWN case is filmed last and its tail continues the descent: from row 12 a
// two-tick tail stops at row 14, two clear of the wall at row 17. Lower than it once
// was because POST_TURN_TICKS now spends most of that budget inside the case, where it
// is doing the work the tail used to.
const HOLD_TICKS = 2;

/**
 * Pose the snake fresh moving right, let it run for a readable beat, inject one
 * steering key, report the direction after the single tick that would apply it, and
 * then let it run ON that heading for a few tiles. Runs in `act`: it consumes ticks.
 *
 * The lead-in is inside the case rather than once in front of all three, so every
 * attempt is filmed the same way — established motion, then the key, then the result —
 * instead of only the first one being legible. It cannot disturb the reading: the pose
 * is re-applied at the top of each case, so each attempt starts from the same posed
 * state whatever the previous one did, and the key is pressed AFTER the run-in so the
 * tick that follows is the one that resolves it.
 *
 * The direction is read BEFORE the post-turn run so the value the assertions score is
 * the one the turn tick produced, not whatever the snake is doing three tiles later.
 * Nothing steers it in between, so the two agree — but reading it at the moment the
 * item is about keeps that a fact rather than an assumption.
 */
async function turnResult(api, code) {
  await api.call("setSnake", hLane(10, 8, 3), "right");
  await api.call("setPellet", PARK_PELLET);
  await actLeadIn(api, LEAD_TICKS);
  await api.call("press", code);
  await api.advance(1); // the tick that applies (or drops) the request
  const dir = (await api.snapshot()).dir;
  // Travel on the new heading, so the turn reads as a change of course.
  await api.advance(POST_TURN_TICKS);
  return dir;
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
