// Automated validation for the Growth & Pellets sub-item `grows-by-one`.
//
// Eating a pellet grows the snake by exactly one cell (the tail does not retract that
// tick); a following normal tick keeps the length constant. The snake is posed with a
// pellet one cell ahead (a precondition), one real tick runs the head into it, and the
// length is read back — then the pellet is parked away and a normal tick confirms the
// length holds.
//
// The pose is instant (`arrange`); the eat tick, the re-park, and the following normal
// tick all consume time, so they are `act` — which is exactly the two ticks the
// assertions read. Parking the pellet mid-`act` is a control op, not a clock change, so
// it is legal there.

import { actPlayOn, hLane, PARK_PELLET, beginRound } from "../_helpers.mjs";

// After the two asserted ticks the head is at col 12 with the pellet parked at the far
// corner. Keep it running for a beat so the clip reads as a snake eating and moving on
// rather than two frames — 10 ticks reaches col 22, still six columns clear of the
// wall, so the round cannot end on camera.
const HOLD_TICKS = 10;

export default function item() {
  // The length before the eat, and the states after the eat and the following tick.
  let startLength;
  let eaten;
  let after;

  return {
    id: "growth.grows-by-one",

    async arrange(api) {
      await beginRound(api);
      await api.call("setSnake", hLane(10, 8, 3), "right"); // length 3
      await api.call("setPellet", { col: 11, row: 8 }); // one cell ahead
      startLength = (await api.snapshot()).length;
    },

    async act(api) {
      await api.advance(1); // 1 tick = the old step(TICK_DT); eat
      eaten = await api.snapshot();

      await api.call("setPellet", PARK_PELLET); // no eat on the next tick
      await api.advance(1); // a normal tick
      after = await api.snapshot();

      await actPlayOn(api, HOLD_TICKS);
    },

    async assert(api, check) {
      check.expectEq("the snake starts at length 3", startLength, 3);
      check.expectEq("eating grew the snake by exactly one", eaten.length, 4);
      check.expectEq(
        "the head advanced into the pellet cell",
        eaten.snake[0].col,
        11,
      );
      check.expectEq(
        "a following normal tick keeps the length constant",
        after.length,
        4,
      );
    },
  };
}
