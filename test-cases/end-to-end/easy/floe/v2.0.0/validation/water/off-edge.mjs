// Automated validation for the Water band item `off-edge`.
//
// Being carried by a floe off the side edge of the strait is death. A floe near
// the right edge is set drifting outward with the critter aboard; the real drift
// sweeps it off the edge, and the snapshot reads the death back. See
// validation/_helpers.mjs.

import { actFooting, actUntilDeath, startCrossing } from "../_helpers.mjs";

// The lives the crossing starts with, so the loss reads as a decrement.
const LIVES = 3;

// How long the clip keeps filming once the sweep has its answer.
//
// THE DEATH IS THE POINT, AND IT WAS OFF CAMERA. `actUntilDeath` returns on the tick
// the life is spent, and `act` IS the recording — so the clip ended at the instant
// the critter went over the edge and a reviewer saw it reach the boundary and then a
// cut, with no splash, no life coming off the HUD, and nothing to tell a death from a
// clip that simply stopped. This holds on the strait long enough for the loss to land
// and the fresh critter to come back on the near shore.
const TAIL_TICKS = 180; // 1.5 s

export default function item() {
  // The footing as the drift begins (read after a step, see `actFooting`), and the
  // sweep that waited for the death.
  let footing;
  let r;

  return {
    id: "water.off-edge",

    // Pose the ride off the edge: a floe close to the right boundary drifting outward,
    // with the critter aboard and three lives so the loss reads as a decrement.
    async arrange(api) {
      await startCrossing(api);
      await api.call("setLives", LIVES);
      await api.call("setLane", 5, { cols: [38], speed: 6, dir: 1 }); // floe near the right edge, drifting out
      await api.call("placeCritter", 38, 5);
    },

    // The floe carrying the critter off the edge — what is checked, and the clip. The
    // footing is read one tick in, once the simulation has run the tile the critter
    // was placed on (see `actFooting`); the ride to the edge is two tiles away yet, so
    // it is read on a critter that is unambiguously still aboard.
    async act(api) {
      footing = await actFooting(api);
      r = await actUntilDeath(api, LIVES, { max: 240 }); // 2 s
      await api.advance(TAIL_TICKS); // camera only: the loss landing, and the respawn
    },

    async assert(api, check) {
      check.expectEq("riding a floe at the edge", footing, "floe");
      check.expectOk("riding a floe off the side edge is death", r.hit);
      check.expectEq(
        "a life is lost going off the edge",
        r.snap.lives,
        LIVES - 1,
      );
    },
  };
}
