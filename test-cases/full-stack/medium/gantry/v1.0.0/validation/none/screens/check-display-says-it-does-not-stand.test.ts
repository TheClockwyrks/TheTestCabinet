// screens/check-display-says-it-does-not-stand — with a ready crane that is a
// mechanism the check display says the structure does not stand.
//
// specs/ui.md § Build, the check's table: with "No readiness issue, and the
// structure does not stand" the screen shows "The issues by name, `empty-program`
// among them when the tape is empty, and that the structure does not stand".
// specs/structure.md § Readiness: "Whether it stands is the solve's verdict, not
// the editor's: a ready structure may still be a mechanism"; specs/statics.md
// § Singularity: "An under-braced 3D truss with nothing resisting out-of-plane
// motion is a mechanism even though every member is sound."
//
// The crane is the minimal one with the four diagonals bracing the tower's sides
// taken away and nothing else changed: it keeps its ring, its sound single-rail
// track and a member path to an anchor or a flange node from every member, so it
// raises no readiness issue, while each of the tower's four vertical faces is
// left a free parallelogram, so the tower solve cannot be regular. That is the
// row of the table this point is about — ready, and not standing — and the
// readiness is read first, because a crane that raised an issue would be the row
// above it instead.
//
// THE COPY IS NOT FIXED BY THE SPECIFICATION, so the screen is read for the
// verdict rather than for a sentence: a run that says the structure does not
// stand, however the build words the negative — "does not stand", "cannot
// stand", "unstable". Case, spacing and punctuation are ignored.

import { afterEach, beforeEach, it } from "vitest";
import { drawnText, toDrawCall, type RecordedOp } from "../case-harness/index";
import { assertLength, assertTrue, fail } from "../assert";
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

/** The page global the shared harness installs its draw recorder on. */
const RECORDER = "__tcabRec";

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

/** Every run of text the last closed frame drew, in draw order. */
async function frameText(harness: Harness): Promise<string[]> {
  const ops = (await harness.page.evaluate(
    (global) =>
      (window as unknown as Record<string, { last(): unknown[] }>)[
        global
      ]!.last(),
    RECORDER,
  )) as RecordedOp[];
  return drawnText(ops.map(toDrawCall));
}

/** The run's words, lowercased, everything but letters turned to spaces. */
function words(text: string): string {
  return ` ${text
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .trim()} `;
}

/** Whether a run says the structure does not stand. */
function saysItDoesNot(text: string): boolean {
  const said = words(text);
  return (
    /\bunstable\b/.test(said) ||
    /\b(not|never|cannot|cant|wont|no|fails|fail|falls|collapse|collapses)\b[a-z ]*\b(stand|stands|standing|stable)\b/.test(
      said,
    )
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("says the structure does not stand when the check finds a mechanism", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await poseCrane(h, UNBRACED);

  const found = await h.check();
  await h.press("KeyC");
  await h.advance(1);

  const runs = await frameText(h);
  await h.capture("check-unstable", "The does-not-stand verdict");

  assertLength(
    found.issues.filter((issue) => issue !== "empty-program"),
    0,
    "the readiness issues of the unbraced crane, so the screen owes the " +
      "verdict of a READY structure (specs/ui.md § Build)",
  );
  assertTrue(
    found.stable === false,
    "the unbraced crane not to stand, so the verdict the screen owes below " +
      "is the negative one (specs/structure.md § The static check)",
  );
  if (!runs.some(saysItDoesNot)) {
    fail(
      "the check display to say that the structure does not stand " +
        "(specs/ui.md § Build)",
      `the build screen drew ${JSON.stringify(runs)}`,
    );
  }
});
