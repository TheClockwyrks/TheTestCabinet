// check/issue-disconnected-members — a member joined to neither the tower nor
// the arm raises `disconnected-members`.
//
// specs/structure.md § Readiness: "`disconnected-members` — Some member belongs
// to neither the tower nor the arm: it has no member path to an anchor or to a
// flange node." § The slew ring fixes the two halves it names: "Everything
// connected through intact members to the top flange is the arm ...; everything
// connected to the bottom flange or to an anchor is the tower."
//
// So the scenario is a crane that raises nothing else plus one member that has
// neither path. `MINIMAL_CRANE` is the crane that raises nothing else, and the
// stray member is a strut between two lattice nodes high in the far corner of
// site 1's envelope, touching no anchor, no flange node and no member of the
// crane. It is a legal placement — specs/structure.md § The editor's rules
// refuses a member for its envelope, its length, a duplicate, an obstacle, the
// ring rule or the budget, and never for standing alone — which is exactly why
// the rule is a readiness rule rather than an edit rule.
//
// The yard is emptied first so no obstacle can refuse the stray strut, and the
// point is decided in one direction: the issue is raised where a member stands
// alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains } from "../assert";
import {
  clearAll,
  createHarness,
  openSite,
  standMinimalCrane,
  type Harness,
} from "../harness";

/**
 * The stray strut: two lattice nodes at `y = 8` in the far `-x, -z` corner of
 * site 1's envelope (`x` and `z` from `-8`), which no member of the minimal
 * crane reaches and which no anchor stands at.
 */
const STRAY_A = { x: -6, y: 8, z: -6 } as const;
const STRAY_B = { x: -6, y: 8, z: -4 } as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises disconnected-members for a strut with no path to an anchor or a flange", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await h.debug.addMember(
    STRAY_A.x,
    STRAY_A.y,
    STRAY_A.z,
    STRAY_B.x,
    STRAY_B.y,
    STRAY_B.z,
    "strut",
  );

  const { issues } = await h.check();

  await h.advance(1);
  await h.capture("state", "the crane carrying one member joined to nothing");

  assertContains(
    issues,
    "disconnected-members",
    "the issue a member with no member path to an anchor or to a flange node " +
      "raises (specs/structure.md § Readiness)",
  );
});
