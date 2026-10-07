// editor/clear-ring-removes-it — removing the ring takes it off, and its cost
// with it.
//
// `specs/structure.md` § The editor's rules: "Removing a member, the ring, or a
// counterweight is always allowed; removal is how a structure that the ring rule
// would otherwise trap is reshaped." And § Cost and the budget: "A crane's cost
// is the sum of its parts: ... plus `RING_COST` for the ring", so the crane the
// removal leaves costs `RING_COST` less than the one that carried it.
//
// The world is the ring alone. A ring on a bare lattice is accepted — its eight
// flange nodes lie inside site 1's envelope, its base corner's `y` is not `0`,
// and with no members there is no path for the ring rule to trap — so nothing but
// the ring is posed, and nothing but the ring can account for what the reading
// shows.

import { afterEach, beforeEach, it } from "vitest";
import { assertClose, assertNotNull, assertNull } from "../assert";
import { RING_COST } from "../constants";
import { createHarness, emptyYard, openSite, type Harness } from "../harness";

/** The ring's base corner: a lattice node off the ground, as the ring needs. */
const CORNER = { x: 0, y: 4, z: 0 };

/** Costs are sums of exact figures, so this is float slop and nothing more. */
const COST_TOL = 1e-6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("takes the ring off and returns RING_COST", async () => {
  await openSite(h, 0);
  await emptyYard(h);

  await h.debug.setRing(CORNER.x, CORNER.y, CORNER.z);
  const ringed = await h.snapshot();
  assertNotNull(
    ringed.structure.ring,
    "the ring the placement landed (specs/structure.md)",
  );
  assertClose(
    ringed.structure.cost,
    RING_COST,
    COST_TOL,
    "the crane's cost with the ring on it (specs/structure.md)",
  );

  await h.debug.clearRing();

  const s = await h.snapshot();
  await h.advance(1);
  await h.capture("cleared", "The lattice with the ring removed");

  assertNull(
    s.structure.ring,
    "the ring the removal took off: removal is always allowed " +
      "(specs/structure.md)",
  );
  assertClose(
    s.structure.cost,
    ringed.structure.cost - RING_COST,
    COST_TOL,
    "the cost the removal returned RING_COST from (specs/structure.md)",
  );
});
