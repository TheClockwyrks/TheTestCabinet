// editor/counterweight-cost — a counterweight adds COUNTERWEIGHT_COST to what the
// crane costs.
//
// `specs/structure.md` § Cost and the budget: "A crane's cost is the sum of its
// parts: each member's length times its material's cost per unit, plus
// `RING_COST` for the ring, plus `COUNTERWEIGHT_COST` per counterweight", and
// § Counterweights gives `COUNTERWEIGHT_COST` as `40`.
//
// THE READING IS THE RISE, not the total. What the cost stands at before the
// counterweight is the member term, which belongs to another point; what this one
// decides is that one counterweight moves the cost by exactly its own figure. So
// the cost is read twice across a single `addCounterweight` and nothing else
// happens in between.
//
// The world is emptied first so the cost has one member's worth in it and nothing
// else — a single four-unit strut, `4 * STRUT_COST_PER_UNIT` — and the
// counterweight goes on that strut's upper end, a node the structure uses. Site
// 0's `3000` budget is far above the `80` this reaches, so no edit here is
// refused for money and the rise is the whole of what the counterweight did.
//
// The tolerance is `1e-6`: the figure is exact arithmetic on integers, and the
// span only forgives a build that accumulates the cost in floating point.

import { afterEach, beforeEach, it } from "vitest";
import { assertClose, assertLength } from "../assert";
import { COUNTERWEIGHT_COST } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  type Harness,
  type Vec3,
} from "../harness";

/** The strut's two ends: a ground anchor of site 0, and the node above it. */
const FOOT: Vec3 = { x: 0, y: 0, z: 0 };
const HEAD: Vec3 = { x: 0, y: 4, z: 0 };

/** Exact arithmetic on integers; this only forgives floating-point drift. */
const COST_TOL = 1e-6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises the crane's cost by COUNTERWEIGHT_COST when one is placed", async () => {
  await openSite(h, 0);
  await clearAll(h);

  await h.debug.addMember(
    FOOT.x,
    FOOT.y,
    FOOT.z,
    HEAD.x,
    HEAD.y,
    HEAD.z,
    "strut",
  );
  const before = await h.snapshot();
  assertLength(
    before.structure.members,
    1,
    "the strut the counterweight hangs on (specs/structure.md)",
  );

  await h.debug.addCounterweight(HEAD.x, HEAD.y, HEAD.z);
  await h.advance(1);

  const after = await h.snapshot();
  assertLength(
    after.structure.counterweights,
    1,
    "the counterweight whose cost is being read",
  );
  assertClose(
    after.structure.cost - before.structure.cost,
    COUNTERWEIGHT_COST,
    COST_TOL,
    "the rise in the crane's cost across one counterweight " +
      "(specs/structure.md § Cost and the budget)",
  );

  await h.capture(
    "counterweight-cost",
    "The crane's cost with one strut and one counterweight",
  );
});
