// editor/member-refused-inside-obstacle — a member whose segment reaches inside an
// obstacle is refused.
//
// `specs/structure.md` § The editor's rules: "A member placement is refused when:
// ... its segment reaches inside an obstacle (`specs/world.md`)". `specs/world.md`
// § Obstacles fixes what reaching inside means: "a body meets an obstacle when
// some point of the body lies inside the box, strictly between the box's minimum
// and its maximum on all three axes", and "A member's body is its segment."
//
// The yard is emptied and one obstacle is put back, so the box under test is the
// only box there is. The member runs straight through the middle of it: its
// segment holds points strictly inside on all three axes at once, well clear of
// every face, so the refusal rests on the rule rather than on where the rule's
// boundary is drawn — a member grazing a face is a different edge case and
// belongs to a validator of its own. Both ends are on the lattice inside site 1's
// envelope and outside the box, the strut is four units long against a maximum of
// six, and the crane carries no ring, so nothing else can refuse it.

import { afterEach, beforeEach, it } from "vitest";
import { assertClose, assertLength } from "../assert";
import {
  addOneObstacle,
  createHarness,
  emptyYard,
  openSite,
  type Harness,
} from "../harness";

/** The box: x from `1` to `3`, y from `0` to `6`, z from `-1` to `1`. */
const MIN = { x: 1, y: 0, z: -1 };
const SIZE = { x: 2, y: 6, z: 2 };

/** The member: straight through the box at y `2`, z `0`, from x `0` to x `4`. */
const A = { x: 0, y: 2, z: 0 };
const B = { x: 4, y: 2, z: 0 };

/** Costs are sums of exact figures, so this is float slop and nothing more. */
const COST_TOL = 1e-6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("places no member whose segment passes through an obstacle", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  await addOneObstacle(h, MIN, SIZE);

  const posed = await h.snapshot();
  assertLength(
    posed.site.obstacles,
    1,
    "the obstacles the yard holds: exactly the one under test",
  );

  await h.debug.addMember(A.x, A.y, A.z, B.x, B.y, B.z, "strut");

  const s = await h.snapshot();
  await h.advance(1);
  await h.capture("refused", "The obstacle the member was refused through");

  assertLength(
    s.structure.members,
    0,
    "the members whose segment reaches inside an obstacle " +
      "(specs/structure.md, specs/world.md)",
  );
  assertClose(
    s.structure.cost,
    0,
    COST_TOL,
    "the cost a refused edit spends: none (specs/structure.md)",
  );
});
