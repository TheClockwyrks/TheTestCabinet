// Automated validation for the Ice band item `crush`.
//
// A vehicle that slides INTO the critter's own tile crushes it — a life is lost.
// The critter is stood on an ice tile and a plow is set sliding into it from
// further down the lane; the real motion and collision decide the crush, which the
// snapshot reads back. See validation/_helpers.mjs.
//
// THE PLOW IS GIVEN AN APPROACH TO RUN. Parked one tile away it reached the critter
// in about a tenth of a second, which decides the verdict perfectly well but films
// nothing: the clip opened on a plow already touching the critter and ended on the
// same frame the death landed, so a reviewer got a still and a cut. What makes this
// item legible is watching the plow bear down on a critter that does not move, so
// it starts eight tiles out at a speed that takes about a second and a half to
// close, and the clip keeps rolling for a moment after the crush.

import { startCrossing, ICE_TOP } from "../_helpers.mjs";

// Where the plow starts, how fast it sweeps, and where the critter stands. From
// column 28 the plow's nose has some seven and a half tiles to cover before it
// overlaps the critter's tile, which at 5 tiles/second is about 1.5 s of approach.
const PLOW_COL = 28;
const PLOW_SPEED = 5;
const CRITTER_COL = 20;

// How long the clip keeps filming after the crush resolves, so the death lands on
// camera instead of on the last frame.
const TAIL_TICKS = 96; // 0.8 s

export default function item() {
  // The sweep that waited for the crush.
  let r;

  return {
    id: "ice.crush",

    // Pose the crush: the critter on an ice tile with a plow sweeping left down the
    // lane into it, and a full three lives so the loss reads as a decrement.
    //
    // The bear is taken off the board. The critter stands well up the strait, which
    // is the condition a hunter emerges on (specs/hunter.md), and a hunter that
    // reached it would drive the phase to `dying` — the very reading this item takes
    // for a crush. No bear could cross the strait inside the plow's approach, but
    // removing it costs nothing and leaves the vehicle as the only thing that can
    // kill.
    async arrange(api) {
      await startCrossing(api);
      await api.call("setLives", 3);
      await api.call("setBear", 0, null);
      await api.call("setLane", ICE_TOP, {
        cols: [PLOW_COL],
        speed: PLOW_SPEED,
        dir: -1,
      });
      await api.call("placeCritter", CRITTER_COL, ICE_TOP);
    },

    // The plow sliding down the lane into the critter, the crush resolving, and a
    // moment after it — what is checked, and what the clip shows.
    async act(api) {
      r = await api.until((s) => s.phase === "dying", { max: 360, poll: 6 }); // 3 s
      await api.advance(TAIL_TICKS);
    },

    async assert(api, check) {
      check.expectOk(
        "a vehicle sliding into the critter's tile crushes it",
        r.hit,
      );
      check.expectEq(
        "the phase is dying after the crush",
        r.snap.phase,
        "dying",
      );
      check.expectEq("a life is lost to the crush", r.snap.lives, 2);
    },
  };
}
