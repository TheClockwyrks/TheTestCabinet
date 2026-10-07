// check/issue-disconnected-members — a member joined to neither the tower nor
// the arm raises `disconnected-members`.
//
// specs/structure.md § Readiness: "`disconnected-members` — Some member belongs
// to neither the tower nor the arm: it has no member path to an anchor or to a
// flange node." § The slew ring fixes the two halves it names: "Everything
// connected through intact members to the top flange is the arm ...; everything
// connected to the bottom flange or to an anchor is the tower."
//
// So the scenario is a structure carrying a member that HAS one of those paths
// and a member that has neither, which is the whole of what the rule reads. The
// anchored strut is one leg standing on site 1's anchor at `(0, 0, 0)`, so the
// structure holds a member the rule must leave alone; the stray member is a
// strut between two lattice nodes high in the far corner of site 1's envelope,
// touching no anchor, no flange node and no other member. It is a legal
// placement — specs/structure.md § The editor's rules refuses a member for its
// envelope, its length, a duplicate, an obstacle, the ring rule or the budget,
// and never for standing alone — which is exactly why the rule is a readiness
// rule rather than an edit rule.
//
// NO RING, NO RAIL AND NO TOWER ARE BUILT. A whole crane would also raise
// `no-ring` and `no-rail`, and this check reads neither: what is asserted is
// that `disconnected-members` is among the issues, so the rows a fuller crane
// would silence are rows nothing here looks at. Standing one anyway would put
// the slew ring, the track rules and the site budget on the route to this
// scenario, and a build that misplaces any of them would fail THIS point for a
// defect that belongs to the point that decides it (§ Validators reach their
// target directly, guides/authoring/writing-debug-apis-and-validators).
//
// The yard is emptied first so no obstacle can refuse either strut, and the
// point is decided in one direction: the issue is raised where a member stands
// alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains } from "../assert";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

/**
 * The anchored strut: a two-unit leg standing on site 1's anchor at `(0, 0, 0)`
 * (specs/sites.md § Site 1). It is the member the rule must NOT name, so a build
 * that raises the issue for every member it holds fails here.
 */
const LEG_A = { x: 0, y: 0, z: 0 } as const;
const LEG_B = { x: 0, y: 2, z: 0 } as const;

/**
 * The stray strut: two lattice nodes at `y = 8` in the far `-x, -z` corner of
 * site 1's envelope (`x` and `z` from `-8`), which the anchored leg does not
 * reach and which no anchor stands at.
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
  await h.debug.addMember(
    LEG_A.x,
    LEG_A.y,
    LEG_A.z,
    LEG_B.x,
    LEG_B.y,
    LEG_B.z,
    "strut",
  );
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
  await h.capture(
    "state",
    "the anchored leg beside the member joined to nothing",
  );

  assertContains(
    issues,
    "disconnected-members",
    "the issue a member with no member path to an anchor or to a flange node " +
      "raises (specs/structure.md § Readiness)",
  );
});
