// Automated validation for the Growth & Pellets sub-item `grows-by-one`.
//
// Eating a pellet grows the snake by exactly one cell (the tail does not retract that
// tick); a following normal tick keeps the length constant. The snake is posed a short
// run short of a pellet (a precondition), normal ticks close the gap, one real tick
// runs the head into it, and the length is read back — then the pellet is parked away
// and a normal tick confirms the length holds.
//
// The pose is instant (`arrange`); the approach, the eat tick, the re-park, and the
// following normal tick all consume time, so they are `act` — which contains exactly
// the two ticks the assertions read. Parking the pellet mid-`act` is a control op, not
// a clock change, so it is legal there.
//
// Two things here are about the CLIP rather than the verdict. The approach exists
// because a pose that already touches the pellet puts the whole eat in the opening
// frame: the recording then reads as a snake gliding away from a pellet parked in the
// far corner, and a reviewer has no moment of "it ran at that and grew". And the eat is
// WAITED FOR before the pellet is parked (`actAwait`) — the record pass runs on the
// build's own clock, so parking on a fixed wall-clock schedule can move the pellet out
// from under a tick that has not run yet, filming a snake that walks over a pellet
// without eating it while the exact validate pass correctly reports the growth.

import {
  actAwait,
  actPlayOn,
  hLane,
  PARK_PELLET,
  beginRound,
} from "../_helpers.mjs";

// Normal ticks run before the eat so the clip opens on a snake running AT a pellet.
// The head starts at col 4 and these bring it to col 10, the cell before the pellet;
// nothing is eaten on the way. 6 ticks is 0.75 s of run-up — long enough to read as an
// approach after the recording's own lead-in, short enough to keep the eat early in a
// clip a reviewer is scrubbing.
const APPROACH_TICKS = 6;

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
      await api.call("setSnake", hLane(4, 8, 3), "right"); // length 3
      await api.call("setPellet", { col: 11, row: 8 }); // APPROACH_TICKS + 1 cells ahead
      startLength = (await api.snapshot()).length;
    },

    async act(api) {
      await api.advance(APPROACH_TICKS); // run up to the pellet, eating nothing
      await api.advance(1); // 1 tick = the old step(TICK_DT); eat
      // Hold until the eat has actually resolved, so the park below cannot land on a
      // tick that has not run yet. A no-op in the validate pass, where the exact step
      // has already eaten. See `actAwait`.
      eaten = await actAwait(api, (s) => s.length > startLength);

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
