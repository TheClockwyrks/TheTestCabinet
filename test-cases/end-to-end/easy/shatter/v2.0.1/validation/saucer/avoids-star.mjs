// Automated validation for the Saucer item `avoids-star`: the saucer steers clear of the
// star and is never pulled into it. `specs/hazards.md` states both halves in one sentence —
// the saucer "steers to avoid the star's core, never overlapping it" — so this item drives
// both, in two scenarios back to back.
//
//   1. THE STEER. A saucer is posed at rest just off the core, inside the avoid radius. As
//      the real sim runs it must steer away: its distance from the star grows.
//   2. THE GUARANTEE. The saucer is then re-posed 60 px from the star centre — twelve px
//      outside the contact distance of 48 (`CORE_R + SAUCER_R`) — and sent straight at the
//      core at its own cruise speed. It must not sink into the core.
//
// Scenario 2 is not a harder version of scenario 1; it is the other half of the sentence,
// and it exists because scenario 1 alone cannot see the difference between a build that
// treats the core as impassable and one that merely nudges a saucer that is loitering near
// it. A saucer parked at rest is the easy case: any push at all moves it out, and a build
// whose whole avoidance is "add some vertical speed while close" passes it comfortably.
// Send that same saucer through the core at 140 px/s and there is no longer time for a
// nudge to work — the build either holds it out of the core or it does not. One graded run
// crossed the core repeatedly in ordinary play, closing to 23 px of the star's centre — 25
// px INSIDE the surface it may never overlap — and passed this item on scenario 1 alone.
//
// The stand-off is 60 px rather than something roomier because a roomier one measures
// steering rather than the guarantee: from 140 px out every build in hand clears the core,
// including the one that overlaps it in play. The saucer starts outside the core either way,
// so nothing here poses an overlap and then complains about it.
//
// A LIVE saucer is posed rather than one conjured at the sample point: `spawnSaucer` puts a
// real one on the field and `setSaucer` moves it, so the body under test is the build's own,
// running the build's own steering.
//
// Posing is instant (`arrange` for the first scenario, control ops in `act` for the second);
// watching it steer out and then cross is the behavior, so the clip is the escape followed by
// the run at the core.
//
// The sweeps stay LOOPS because each tracks the closest the saucer ever comes to the core,
// which a single long advance would step straight over. Both sample every SINGLE tick, so no
// minimum is missed.
//
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
  SAUCER_CRUISE,
  TICK,
} from "../_helpers.mjs";

// The saucer's centre may come no closer to the star's than this: the core's radius
// plus the saucer's, the contact distance `specs/hazards.md` forbids it to cross.
const CONTACT = CORE_R + SAUCER_R;

// The stand-off the run at the core starts from, and how far past the star it is
// followed. 60 px is outside contact and deep inside any build's avoid radius.
const RUN_START = 60;
const RUN_TICKS = 240; // 2 s at cruise carries it well past the star

export default function item() {
  // Scenario 1: the saucer's distance from the star at the start, its closest
  // approach, and its distance at the end.
  let startD;
  let minD;
  let endD;
  // Scenario 2: the closest the saucer came to the star while crossing the core, and
  // whether it was still on the field to be measured at the end.
  let runMinD;
  let survived;

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

      // Scenario 2: line the same saucer up on the star's row and send it through.
      await api.call("setSaucer", {
        x: 640 - RUN_START,
        y: 360,
        vx: SAUCER_CRUISE,
        vy: 0,
      });
      runMinD = distToStar((await api.snapshot()).saucer);
      for (let i = 0; i < RUN_TICKS; i += 1) {
        await api.advance(TICK);
        const saucer = (await api.snapshot()).saucer;
        if (!saucer) break;
        runMinD = Math.min(runMinD, distToStar(saucer));
      }
      survived = Boolean((await api.snapshot()).saucer);
    },

    async assert(api, check) {
      check.expectGt("the saucer never overlaps the core", minD, CONTACT);
      check.expectGt("the saucer steers away from the star", endD, startD + 20);
      check.expectOk(
        "the saucer is still on the field to have been measured",
        survived,
      );
      // A build that holds the saucer out lands ON the contact distance rather than
      // above it, so allow a pixel for that and for the float arithmetic behind it.
      // What this rejects is sinking INTO the core, not grazing its surface.
      check.expectGt(
        "driven at the core, the saucer does not sink into it",
        runMinD,
        CONTACT - 1,
      );
    },
  };
}
