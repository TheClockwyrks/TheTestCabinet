// Automated validation for the Star-core item `rock-recycled`: a rock pulled into the
// star is destroyed and immediately replaced by a same-size rock entering from the edge,
// so the number of rocks is conserved and no points are scored. A single rock is aimed
// into the core; the real sim runs until the star recycles it, and the field is read.
//
// `specs/hazards.md` is specific about where the replacement comes from — "the replacement
// enters from off-screen: pick a random point just outside one of the four edges" — and that
// is the half worth being careful about, because it is what makes the star churn the board
// rather than teleport rocks around it. Distance from the STAR does not test it: everywhere
// except the middle of the field is far from the star, so a build that pops the replacement
// into open space, hundreds of px from any edge, satisfies a from-the-star test completely.
// One graded run did exactly that, materialising the replacement mid-field, and passed. The
// assertion is therefore against the nearest EDGE (`distToEdge`), which is the thing the
// spec names.
//
// The allowance is the rock's own radius plus a little: a rock "just outside" an edge sits
// at a negative edge distance, and a build that wraps its coordinates reports the same point
// as `radius`-ish INSIDE the far edge instead. Both are the perimeter. What no reading of
// "just outside one of the four edges" reaches is the middle of the field.
//
// Posing the rock on its way into the core is instant (`arrange`); the fall and the recycle out
// to an edge are the behavior (`act`), so the clip is the whole exchange. `actUntilRecycled`
// ticks one at a time because the recycle is detected by COMPARING consecutive samples — a
// coarse poll would step over the jump.
//
// The 2 s the old drive allowed is 2 x 120 = 240 ticks.

import {
  newGame,
  actUntilRecycled,
  distToStar,
  distToEdge,
  ROCK_RADIUS,
} from "../_helpers.mjs";

// The size the rock is posed at, and so the size the replacement must come back as.
const SIZE = "small";

// How far inside the field the replacement may be and still count as having entered
// from an edge: its own radius (a rock placed just off-screen and wrapped) plus a
// margin for a build that seats it on the edge rather than beyond it.
const EDGE_ALLOWANCE = ROCK_RADIUS[SIZE] + 24;

export default function item() {
  // Whether the rock was recycled, and the field it left behind.
  let outcome;

  return {
    id: "star-core.rock-recycled",

    async arrange(api) {
      await newGame(api);
      await api.call("setScore", 0);
      await api.call("addRock", SIZE, { x: 640, y: 200, vx: 0, vy: 240 });
    },

    async act(api) {
      outcome = await actUntilRecycled(api, { maxTicks: 240 });
    },

    async assert(api, check) {
      const snap = outcome.snap;
      const replacement = snap.rocks[0];

      check.expectOk(
        "the rock is recycled by the star (relocated to an edge)",
        outcome.recycled,
      );
      check.expectEq(
        "the rock count is conserved — one out, one in",
        snap.rocks.length,
        1,
      );
      check.expectGt(
        "the replacement enters from far off, not through the center",
        distToStar(replacement),
        150,
      );
      check.expectLt(
        "the replacement enters from an edge of the field, not out of open space",
        distToEdge(replacement),
        EDGE_ALLOWANCE,
      );
      check.expectEq(
        "the replacement comes back at the same size",
        replacement.size,
        SIZE,
      );
      check.expectEq("recycling a rock scores nothing", snap.score, 0);
    },
  };
}
