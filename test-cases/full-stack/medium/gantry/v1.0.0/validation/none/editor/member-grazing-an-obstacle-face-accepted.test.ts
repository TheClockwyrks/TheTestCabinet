// editor/member-grazing-an-obstacle-face-accepted — a member that only touches an
// obstacle's face is clear of it, and stands.
//
// specs/world.md states the one obstacle rule the whole game uses: "a body meets
// an obstacle when some point of the body lies inside the box, STRICTLY between
// the box's minimum and its maximum on all three axes. Contact is not collision,
// so a segment GRAZING A FACE, a segment lying flush along one, and a box resting
// flush against one are all clear of it." specs/structure.md refuses a member only
// when "its segment reaches inside an obstacle", so a segment that stops on a face
// is accepted. This is the touching edge of that rule; a segment lying flush ALONG
// a face is a different edge and its own point.
//
// THE MEMBER RUNS UP TO THE FACE AND NO FURTHER, which is what makes it that edge
// case. The obstacle is the box with minimum `(2, 0, -2)` and size `(2, 6, 4)`, so
// it spans `x 2..4`, `y 0..6`, `z -2..2`; the strut runs from `(0, 2, 0)` to
// `(2, 2, 0)`, so its far end sits exactly on the box's `x = 2` face while every
// other point of it stands at `x < 2`. Its `y` and `z` are inside the box's ranges
// the whole way, so the single point that touches the box is the one that decides
// it — and it touches rather than enters.
//
// THE YARD HOLDS THAT OBSTACLE AND NOTHING ELSE, and the structure is empty, so
// the obstacle rule is the only one that could refuse: both ends are lattice nodes
// inside site 1's envelope (`x -8..12`, `y 0..16`, `z -8..12`), they are distinct,
// the strut is `2` long against `STRUT_MAX_LEN` (`6`), no ring stands so the
// arm-to-tower rule has no flange to trip on, and `20` is well inside the budget
// of `3000`.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength } from "../assert";
import {
  addOneObstacle,
  clearAll,
  createHarness,
  openSite,
  type Harness,
} from "../harness";

/** The box x 2..4, y 0..6, z -2..2. */
const OBSTACLE_MIN = { x: 2, y: 0, z: -2 };
const OBSTACLE_SIZE = { x: 2, y: 6, z: 4 };

/** A strut whose far end sits exactly on the box's x = 2 face. */
const A = { x: 0, y: 2, z: 0 };
const B = { x: 2, y: 2, z: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("accepts a member whose end only touches an obstacle's face", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await addOneObstacle(h, OBSTACLE_MIN, OBSTACLE_SIZE);

  await h.debug.addMember(A.x, A.y, A.z, B.x, B.y, B.z, "strut");

  await h.advance(1);
  await h.capture("grazing", "The member stopped on the obstacle's face");

  assertLength(
    (await h.snapshot()).structure.members,
    1,
    "the members standing after a strut whose far end sits exactly on the " +
      "x = 2 face of the box x 2..4, y 0..6, z -2..2, reaching no point " +
      "strictly inside it (specs/world.md, specs/structure.md)",
  );
});
