// editor/counterweight-outlives-the-member-that-held-it — removing the last
// member at a node leaves the counterweight standing there.
//
// `specs/structure.md` § The editor's rules: "Removing a member, the ring, or a
// counterweight is always allowed", and a removal is stated as removing that one
// thing — nothing in the editor's rules takes anything else with it. § Counter-
// weights states what becomes of a counterweight the structure has let go of, and
// it is not removal: "What holds it is the structure at that node, so a
// counterweight left with nothing at its node falls, as `specs/statics.md`
// states." A counterweight that fell during a run is one the editor still carries,
// and § Cost and the budget keeps charging for it: the cost is the sum of the
// parts, "plus `COUNTERWEIGHT_COST` per counterweight".
//
// SO THE SCENARIO IS THE SMALLEST ONE THAT CAN SHOW IT: one strut, one
// counterweight on its upper end, and then that strut removed. After the removal
// the node is bare, and what the structure reports is whether the counterweight
// went with the member. The world is emptied first, so no other member reaches
// the node and no other counterweight is in the cost.
//
// The member takes id `0` — `clearStructure` "returns `nextMemberId` to `0`" and
// "`addMember` gives the member the structure's `nextMemberId`" — so `removeMember(0)`
// names the strut that was just placed.

import { afterEach, beforeEach, it } from "vitest";
import { assertClose, assertContains, assertLength } from "../assert";
import { COUNTERWEIGHT_COST } from "../constants";
import {
  createHarness,
  emptyYard,
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

it("leaves the counterweight standing when the member under it is removed", async () => {
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
  await h.debug.addCounterweight(HEAD.x, HEAD.y, HEAD.z);
  const posed = await h.snapshot();
  assertLength(posed.structure.members, 1, "the strut about to be removed");
  assertLength(
    posed.structure.counterweights,
    1,
    "the counterweight on its head",
  );

  await h.debug.removeMember(0);
  await h.advance(1);

  const { structure } = await h.snapshot();
  assertLength(structure.members, 0, "the members left after the removal");
  assertContains(
    structure.counterweights,
    HEAD,
    `the counterweight still on (${HEAD.x}, ${HEAD.y}, ${HEAD.z}) once the ` +
      "member that ended there is gone (specs/structure.md)",
  );
  assertClose(
    structure.cost,
    COUNTERWEIGHT_COST,
    COST_TOL,
    "the crane's cost with nothing but that counterweight left, which is " +
      "still charged for (specs/structure.md § Cost and the budget)",
  );

  await h.capture(
    "counterweight-outlives-the-member-that-held-it",
    "The counterweight left at a bare node",
  );
});
