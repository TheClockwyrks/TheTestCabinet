// Automated validation for the Saucer item `avoids-star`: the saucer steers clear of the
// star and is never pulled into it. A saucer is posed just off the core; as the real sim
// runs it must steer away — its distance from the star grows and it never overlaps the
// core.
//
// Posing the saucer inside the avoid radius is instant (`arrange`); watching it steer out is
// the behavior (`act`), so the clip is the escape itself.
//
// The sweep stays a LOOP because it tracks the closest the saucer ever comes to the core, which
// a single long advance would step straight over. The old drive ran 40 x 0.02 s = 0.8 s; 0.02 s
// is 2.4 ticks, which is not a whole tick count, so this samples every SINGLE tick instead and
// runs 96 of them — the same 0.8 s budget at strictly finer resolution, so no minimum is missed.

// A bystander rock is parked because `newGame` leaves the field empty and this item drives
// nothing onto it: an empty field is a cleared wave, so the first step raises a WAVE banner,
// and a build is entitled to treat that beat as a lull with nothing to move. The saucer then
// sits still for the whole sweep and the item reports a steering failure that never happened.
// The rock keeps the field occupied so the sim the saucer is measured in is ordinary play.

import {
  newGame,
  arrangeBystanderRock,
  distToStar,
  CORE_R,
  SAUCER_R,
  TICK,
} from "../_helpers.mjs";

export default function item() {
  // The saucer's distance from the star at the start, its closest approach, and its
  // distance at the end.
  let startD;
  let minD;
  let endD;

  return {
    id: "saucer.avoids-star",

    async arrange(api) {
      await newGame(api);
      await arrangeBystanderRock(api); // keeps the field occupied — see the header
      await api.call("spawnSaucer");
      await api.call("setSaucer", { x: 640, y: 430, vx: 0, vy: 0 }); // just below the core, inside the avoid radius
      startD = distToStar((await api.snapshot()).saucer);
    },

    async act(api) {
      minD = startD;
      for (let i = 0; i < 96; i += 1) {
        await api.advance(TICK);
        minD = Math.min(minD, distToStar((await api.snapshot()).saucer));
      }
      endD = distToStar((await api.snapshot()).saucer);
    },

    async assert(api, check) {
      check.expectGt(
        "the saucer never overlaps the core",
        minD,
        CORE_R + SAUCER_R,
      );
      check.expectGt("the saucer steers away from the star", endD, startD + 20);
    },
  };
}
