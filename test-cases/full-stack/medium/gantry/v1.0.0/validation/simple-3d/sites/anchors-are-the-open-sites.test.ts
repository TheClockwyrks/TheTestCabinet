// sites/anchors-are-the-open-sites — the nodes the solve holds immovable are the
// open site's anchors, not one anchor set for the whole game.
//
// specs/world.md § Anchors: "Each site fixes its anchor nodes: lattice nodes on
// the ground where the structure is fixed to the earth. An anchor is the one
// kind of support the structure has... in the solve an anchor node is held
// immovable". specs/sites.md gives Site 6 — Heavy Haul the three-by-three block
// `(0,0,0) … (4,0,4)` and Site 1 — First Lift only the four nodes of the square
// `(0,0,0), (2,0,0), (0,0,2), (2,0,2)`.
//
// THIS IS THE POINT A SINGLE HARD-CODED ANCHOR SET FAILS, and no reading of
// `site.anchors` catches: a build that drew nine anchors on Heavy Haul's floor
// and still supported its solve on the four of the sites before it reports the
// right list and stands the wrong cranes. So the requirement is decided from the
// solve's side — the SAME crane, posed on two sites, and `check()` read back on
// each.
//
// THE CRANE IS THE MINIMAL ONE, MOVED TWO UNITS ALONG x AND z, so its four feet
// stand at `(2,0,2)`, `(4,0,2)`, `(2,0,4)` and `(4,0,4)`. All four are anchors
// on Heavy Haul; on First Lift only `(2,0,2)` is, and a structure pinned at one
// node alone is free to turn about it — a mechanism, which specs/statics.md's
// singularity test is exactly what finds. The crane is otherwise untouched, so
// the two sites are handed identical geometry, identical mass and identical
// members, and the only thing that differs between the two readings is which of
// its feet the site holds.
//
// EVERYTHING ELSE IS HELD EQUAL AND CHECKED. Every node lies inside both
// envelopes (First Lift `x -8..12, y 0..16, z -8..12`, Heavy Haul
// `x -10..18, y 0..20, z -8..8`) and the crane costs well inside both budgets,
// so `poseCrane` — which fails the check if any edit was refused — stands the
// same twenty-one members on both. Readiness is asserted clear on BOTH sites, so
// the verdict that differs is the solve's and not a missing ring or a broken
// track: specs/structure.md has a structure with any readiness issue go unsolved,
// and this scenario must never reach its assertion that way. `empty-program` is
// filtered out of both, being the tape's issue rather than the structure's —
// "a ready structure is solved whether or not it has a tape".
//
// THE YARD IS EMPTIED FIRST. Loads and obstacles reach neither solve — the check
// runs at the run-start posture "with the bare hook hanging at rest" — but the
// scenario holds only what it is about.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertTrue } from "../assert";
import {
  MINIMAL_CRANE,
  createHarness,
  emptyYard,
  openSite,
  poseCrane,
  type CraneDesign,
  type DesignMember,
  type Harness,
  type LatticeNode,
} from "../harness";

/** Heavy Haul, whose anchors are the three-by-three block out to (4, 0, 4). */
const ANCHORED_SITE = 5;

/** First Lift, whose anchors are the square (0,0,0) … (2,0,2) alone. */
const UNANCHORED_SITE = 0;

/** Two units along x and z: off First Lift's anchor square, onto Heavy Haul's. */
const SHIFT: LatticeNode = [2, 0, 2];

function moved(node: LatticeNode): LatticeNode {
  return [node[0] + SHIFT[0], node[1] + SHIFT[1], node[2] + SHIFT[2]];
}

/**
 * The minimal crane, standing on the feet Heavy Haul anchors and First Lift does
 * not: `(2,0,2)`, `(4,0,2)`, `(2,0,4)`, `(4,0,4)`.
 */
const SHIFTED_CRANE: CraneDesign = {
  ...MINIMAL_CRANE,
  name: "Minimal, two units along x and z",
  ring: MINIMAL_CRANE.ring === null ? null : moved(MINIMAL_CRANE.ring),
  counterweights: MINIMAL_CRANE.counterweights.map(moved),
  members: MINIMAL_CRANE.members.map(
    ([a, b, material]): DesignMember => [moved(a), moved(b), material],
  ),
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("stands the same crane on the site that anchors its feet and leaves it unsupported on the site that does not", async () => {
  await openSite(h, ANCHORED_SITE);
  await emptyYard(h);
  await poseCrane(h, SHIFTED_CRANE);
  const anchored = await h.check();

  await openSite(h, UNANCHORED_SITE);
  await emptyYard(h);
  await poseCrane(h, SHIFTED_CRANE);
  const unanchored = await h.check();

  // The still is First Lift, with the crane's feet standing clear of the four
  // anchors the site draws on its floor.
  await h.advance(1);
  await h.capture(
    "footing",
    "The same crane standing on one site and unsupported on the other",
  );

  assertLength(
    anchored.issues.filter((one) => one !== "empty-program"),
    0,
    "the readiness issues of the crane on Site 6 (specs/structure.md)",
  );
  assertLength(
    unanchored.issues.filter((one) => one !== "empty-program"),
    0,
    "the readiness issues of the identical crane on Site 1, so what the two " +
      "solves differ on is the support (specs/structure.md)",
  );

  assertTrue(
    anchored.stable,
    "the crane stands on Site 6, whose anchors hold all four of its feet " +
      "(specs/sites.md § Site 6 — Heavy Haul, specs/world.md § Anchors)",
  );
  assertTrue(
    !unanchored.stable,
    "the identical crane does not stand on Site 1, whose anchors hold one of " +
      "its four feet (specs/sites.md § Site 1 — First Lift, specs/world.md " +
      "§ Anchors)",
  );
});
