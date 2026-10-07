// editor/rail-refused-not-horizontal — a rail member whose ends do not share a `y`
// is refused.
//
// `specs/structure.md` § The trolley and the rail states the rule: "Every rail
// member is horizontal: its two ends share a `y`", and says where it is decided:
// "The first rule is enforced the moment a rail member is placed; the rest are
// checked whenever the structure is readied." § The editor's rules lists it among
// the placement refusals: "it is a rail member and is not horizontal". A refused
// edit changes nothing.
//
// The ends are two units apart on `x` and two on `y`, so the member is sloped
// rather than merely a little off level, and the reading is unambiguous. They are
// on the lattice inside site 1's envelope, the segment is `2.83` units against the
// rail's maximum of six, the yard is empty of obstacles, no member joins them
// already, and the crane carries no ring — so of every rule in the list, the one
// about a rail's `y` is the only one this placement can break.

import { afterEach, beforeEach, it } from "vitest";
import { assertClose, assertLength } from "../assert";
import { createHarness, emptyYard, openSite, type Harness } from "../harness";

/** The two ends: a rail's, two units apart on `x` and two on `y`. */
const A = { x: 0, y: 4, z: 0 };
const B = { x: 2, y: 6, z: 0 };

/** Costs are sums of exact figures, so this is float slop and nothing more. */
const COST_TOL = 1e-6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("places no rail member whose two ends stand at different heights", async () => {
  await openSite(h, 0);
  await emptyYard(h);

  await h.debug.addMember(A.x, A.y, A.z, B.x, B.y, B.z, "rail");

  const s = await h.snapshot();
  await h.advance(1);
  await h.capture("refused", "The bare lattice the sloped rail left");

  assertLength(
    s.structure.members,
    0,
    "the rail members whose ends do not share a y (specs/structure.md)",
  );
  assertClose(
    s.structure.cost,
    0,
    COST_TOL,
    "the cost a refused edit spends: none (specs/structure.md)",
  );
});
