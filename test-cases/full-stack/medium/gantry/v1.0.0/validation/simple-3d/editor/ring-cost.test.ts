// editor/ring-cost — the ring adds RING_COST to the crane's cost.
//
// specs/structure.md fixes the sum: "A crane's cost is the sum of its parts: each
// member's length times its material's cost per unit, plus `RING_COST` for the
// ring, plus `COUNTERWEIGHT_COST` per counterweight", and the slew ring's own
// section gives the figure — "The ring weighs `RING_MASS` (`20`), costs
// `RING_COST` (`300`)".
//
// THE STRUCTURE IS EMPTIED FIRST so the reading is the ring's alone: cost is a
// sum, and a cost read over a crane that carries members measures the sum rather
// than the term. The ring is placed by its base corner at `(0, 2, 0)`, whose `y`
// is not `0` — "the ring sits on a tower, not on the ground" — and whose eight
// flange nodes span `x 0..2`, `y 2..4`, `z 0..2`, every one of them inside
// site 1's envelope. With nothing built there is no path of members to join the
// arm to the tower, and `300` is well inside the site's budget of `3000`, so the
// only thing that can change the cost here is the ring itself.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { RING_COST } from "../constants";
import { createHarness, openSite, type Harness } from "../harness";

/** The base corner the ring is placed by. */
const CORNER = { x: 0, y: 2, z: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("adds RING_COST to the cost when the ring is placed", async () => {
  await openSite(h, 0);
  // The precondition is an empty structure and nothing else. A site opened
  // after a reset already carries one (specs/state.md), and `clearStructure`
  // states it rather than leaving it implied; emptying the yard and the tape
  // too would drive surface this requirement does not concern.
  await h.debug.clearStructure();

  const before = (await h.snapshot()).structure.cost;

  await h.debug.setRing(CORNER.x, CORNER.y, CORNER.z);

  await h.advance(1);
  await h.capture("cost", "The lone slew ring and the cost it carries");

  const after = (await h.snapshot()).structure;
  assertNotNull(after.ring, "the ring the placement seated");
  assertEqual(
    after.cost - before,
    RING_COST,
    "what the ring adds to the crane's cost (specs/structure.md)",
  );
});
