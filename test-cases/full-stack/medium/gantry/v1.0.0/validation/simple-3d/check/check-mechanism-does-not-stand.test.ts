// check/check-mechanism-does-not-stand — a crane that breaks no readiness rule
// but is a mechanism is reported as not standing.
//
// specs/structure.md § Readiness: "Whether it stands is the solve's verdict, not
// the editor's: a ready structure may still be a mechanism or collapse under its
// first load". § The static check: the two solves "run at the run-start posture
// ... and the structure stands when both solves are regular". specs/statics.md
// § Singularity names the ordinary way to get there: "An under-braced 3D truss
// with nothing resisting out-of-plane motion is a mechanism even though every
// member is sound."
//
// The scenario is the minimal crane with the four diagonals that brace the
// tower's sides taken away, and nothing else changed. What is left below the ring
// is four vertical legs, the bottom flange square and one diagonal across it:
// nine members holding four free nodes, which is twelve displacement unknowns
// against nine member stiffnesses, so the supported tower system cannot be
// regular however it is assembled — each of the tower's four vertical faces is a
// free parallelogram. The arm above the ring is the minimal crane's, unchanged,
// so the structure is a mechanism in one solve and not in the other.
//
// Readiness is read first as the scenario's precondition, because "a READY
// structure may still be a mechanism" is the sentence under test: a crane that
// raised an issue would not be solved at all (§ The static check: "With any
// readiness issue the structure is not solved"), and `stable` reading false
// would then say nothing about mechanisms. The crane keeps its ring, its sound
// single-rail track and a member path to an anchor or a flange node from every
// member, so it raises none.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertTrue } from "../assert";
import {
  MINIMAL_CRANE,
  clearAll,
  createHarness,
  openSite,
  poseCrane,
  type CraneDesign,
  type DesignMember,
  type Harness,
} from "../harness";

/**
 * The minimal crane's tower with no out-of-plane bracing: the four legs, the
 * bottom flange square and the one diagonal across it, and none of the four
 * diagonals that brace the tower's sides.
 */
const FLAT_TOWER: readonly DesignMember[] = [
  [[0, 0, 0], [0, 2, 0], "strut"],
  [[2, 0, 0], [2, 2, 0], "strut"],
  [[0, 0, 2], [0, 2, 2], "strut"],
  [[2, 0, 2], [2, 2, 2], "strut"],
  [[0, 2, 0], [2, 2, 0], "strut"],
  [[0, 2, 2], [2, 2, 2], "strut"],
  [[0, 2, 0], [0, 2, 2], "strut"],
  [[2, 2, 0], [2, 2, 2], "strut"],
  [[0, 2, 0], [2, 2, 2], "strut"],
];

/** The minimal crane's arm: every member of it stands at or above `y = 4`. */
const ARM: readonly DesignMember[] = MINIMAL_CRANE.members.filter(
  ([a, b]) => a[1] >= 4 && b[1] >= 4,
);

/** Ready, sound member by member, and a mechanism below the ring. */
const UNBRACED: CraneDesign = {
  site: 0,
  name: "Unbraced tower",
  ring: [0, 2, 0],
  counterweights: [],
  members: [...FLAT_TOWER, ...ARM],
  tape: [],
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports that a ready crane with an unbraced tower does not stand", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await poseCrane(h, UNBRACED);

  const result = await h.check();

  await h.advance(1);
  await h.capture(
    "state",
    "a ready crane whose tower has no out-of-plane bracing",
  );

  assertLength(
    result.issues.filter((one) => one !== "empty-program"),
    0,
    "the readiness issues of the unbraced crane, so what the verdict reports " +
      "is the solve's and not the editor's (specs/structure.md § Readiness)",
  );
  assertTrue(
    result.stable === false,
    "stable false: a ready structure with nothing resisting out-of-plane " +
      "motion is a mechanism and does not stand (specs/structure.md " +
      "§ The static check)",
  );
});
