// Automated validation for the Rocks item `fragment-fan`. `specs/simulation.md` says what a
// split does to the two pieces: each "takes the parent's velocity plus a split kick of about
// 90 px/s directed perpendicular to the bullet's travel, the two fragments kicked to opposite
// sides". A Large is destroyed with a horizontal shot and the pair is read for both halves.
//
// The two halves are read off the pair rather than off each fragment. The AVERAGE of the two
// velocities is the parent's velocity, whatever the kick did, so it carries the inheritance;
// the DIFFERENCE between them is twice the kick, with the parent's motion cancelled out, so
// it carries the fan. Each is then checked for what the sentence asks: the average still
// drifting the way the parent was posed, the difference about 2 x 90 px/s and lying across
// the shot.
//
// WHERE THE PARENT IS POSED. Out towards the bottom-left of the field, 412 px from the star,
// where the pull is about 26 px/s² against the 556 of the core. Gravity is inverse-square
// with no cutoff (`specs/simulation.md`), so it is never quite absent, but over the half
// second the three shots take it moves the parent by some 13 px/s — small against the drift
// being read and the kick being measured.
//
// HOW IT DRIFTS. Up and to the left, at 85 px/s: a legal Large drift speed
// (`specs/hazards.md` gives 60 to 110) on a diagonal, while the shot is horizontal. The
// diagonal is what separates "perpendicular to the bullet's travel" from "perpendicular to
// the rock's own course", which a parent drifting along the shot's line would leave pointing
// the same way. Against this pose the two differ by 60 degrees.
//
// Posing the parent is instant (`arrange`); the shot and the fan it produces are the behavior
// (`act`), so the clip shows the fragments spring apart.

import {
  arrangePosedRock,
  actFireUntilGone,
  hyp,
  SPLIT_KICK,
} from "../_helpers.mjs";

// Where the parent is put and how it drifts — see the header.
const POSE = { x: 320, y: 620, vx: -60, vy: -60 };

// The kick the pair should be separated by, and how far off it may land. `specs/simulation.md`
// says "about 90 px/s" each way, so the pair separates by twice that.
const FAN = 2 * SPLIT_KICK;
const FAN_TOLERANCE = 60;

// How much of the fan may lie ALONG the shot rather than across it. A kick perpendicular to a
// horizontal shot has no horizontal component at all; this is the room left for a build that
// computes the perpendicular from a bullet whose own course has been bent a little.
const ALONG_SHOT = 30;

// How much of the posed drift must survive into the fragments. The parent is posed at 60 px/s
// on each axis and gravity trims about 13 px/s from that over the shots.
const DRIFT = -20;

export default function item() {
  // The field just after the Large died, read by `assert`.
  let outcome;

  return {
    id: "rocks.fragment-fan",

    // Parent drifts up and left; the shot is horizontal, so the split kick is vertical.
    async arrange(api) {
      await arrangePosedRock(api, "large", POSE);
    },

    async act(api) {
      outcome = await actFireUntilGone(api, "large");
    },

    async assert(api, check) {
      const frags = outcome.snap.rocks.filter((r) => r.size === "medium");

      check.expectEq("the Large split into two fragments", frags.length, 2);
      if (frags.length !== 2) return;

      // Twice the kick, with the parent's motion cancelled out.
      const fan = {
        vx: frags[0].vx - frags[1].vx,
        vy: frags[0].vy - frags[1].vy,
      };
      // The parent's velocity when it died, with the kick cancelled out.
      const carried = {
        vx: (frags[0].vx + frags[1].vx) / 2,
        vy: (frags[0].vy + frags[1].vy) / 2,
      };

      check.expectClose(
        "the fragments are kicked about 2 x 90 px/s apart",
        hyp(fan.vx, fan.vy),
        FAN,
        FAN_TOLERANCE,
      );
      check.expectLt(
        "the kick is across the shot, which was horizontal",
        Math.abs(fan.vx),
        ALONG_SHOT,
      );
      check.expectLt(
        "the fragments are kicked to opposite sides of the parent's course",
        (frags[0].vy - POSE.vy) * (frags[1].vy - POSE.vy),
        0,
      );

      check.expectLt(
        "one fragment carries the parent's leftward drift",
        frags[0].vx,
        DRIFT,
      );
      check.expectLt("the other fragment carries it too", frags[1].vx, DRIFT);
      check.expectLt(
        "the pair carries the parent's upward drift",
        carried.vy,
        DRIFT,
      );
    },
  };
}
