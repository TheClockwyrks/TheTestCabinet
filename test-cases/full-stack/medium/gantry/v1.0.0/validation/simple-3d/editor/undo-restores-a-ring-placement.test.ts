// editor/undo-restores-a-ring-placement — the undo after a ring placement takes
// the ring back off.
//
// `specs/structure.md` § The editor's rules: "undo restores the structure to what
// it was before the most recent structure-changing edit, as far back as the site
// was opened." A ring placement is one of those edits — the ring "costs
// `RING_COST` (`300`)" — so the undo after one restores the ringless structure
// that stood before it, cost included.
//
// The world is one strut and the ring, and nothing else. The strut is what makes
// "the structure it was before" a structure rather than nothing: an undo that
// emptied the crane whole and an undo that reversed the ring alone read the same
// on a bare lattice, and here they do not.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertClose,
  assertLength,
  assertNotNull,
  assertNull,
} from "../assert";
import { BINDINGS, RING_COST, STRUT_COST_PER_UNIT } from "../constants";
import { createHarness, emptyYard, openSite, type Harness } from "../harness";

/** A leg from a ground anchor to the node the ring's base corner sits at. */
const FOOT = { x: 0, y: 0, z: 0 };
const HEAD = { x: 0, y: 4, z: 0 };

/** Its cost: `STRUT_COST_PER_UNIT` a unit over its four units of length. */
const STRUT_COST = STRUT_COST_PER_UNIT * 4;

/** Costs are sums of exact figures, so this is float slop and nothing more. */
const COST_TOL = 1e-6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("takes a placed ring back off and leaves the structure that stood", async () => {
  await openSite(h, 0);
  await emptyYard(h);

  await h.debug.addMember(
    FOOT.x,
    FOOT.y,
    FOOT.z,
    HEAD.x,
    HEAD.y,
    HEAD.z,
    "strut",
  );
  await h.debug.setRing(HEAD.x, HEAD.y, HEAD.z);

  const ringed = await h.snapshot();
  assertNotNull(
    ringed.structure.ring,
    "the ring the tower's head accepts (specs/structure.md)",
  );
  assertClose(
    ringed.structure.cost,
    STRUT_COST + RING_COST,
    COST_TOL,
    "the cost the ring added (specs/structure.md)",
  );

  await h.press(BINDINGS.undo[0]!);

  const s = await h.snapshot();
  await h.advance(1);
  await h.capture("undone", "The structure the undo restored, with no ring");

  assertNull(
    s.structure.ring,
    "the ring the undo took back off (specs/structure.md)",
  );
  assertLength(
    s.structure.members,
    1,
    "the strut the undo left standing: it reverses one edit, the ring's",
  );
  assertClose(
    s.structure.cost,
    STRUT_COST,
    COST_TOL,
    "the cost the undo returned RING_COST from (specs/structure.md)",
  );
});
