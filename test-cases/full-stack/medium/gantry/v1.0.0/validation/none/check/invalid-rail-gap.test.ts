// check/invalid-rail-gap — collinear rails with a gap between them raise
// `invalid-rail`.
//
// specs/structure.md § The trolley and the rail, the second track rule: the
// rails "cover one unbroken stretch of it exactly once: no two rails overlap and
// no gap is left between them. They therefore meet end to end, each sharing an
// end node with the next". § Readiness: "`invalid-rail` — The crane has a ring
// and rail members, and they break one of the track rules above."
//
// The scenario leaves exactly one lattice node of clear line between two rails
// and breaks nothing else. Both rails lie on the line `y = 4, z = 0`, so they
// are horizontal and collinear; the near one runs `(0, 4, 0)` to `(2, 4, 0)`
// between two top-flange nodes and the far one runs `(4, 4, 0)` to `(6, 4, 0)`,
// with the stretch from `x = 2` to `x = 4` covered by neither. The far rail is
// tied into the arm through a strut from the mast at `(0, 8, 0)` down to
// `(4, 4, 0)`, so both rails are in the arm and no member is disconnected — the
// gap is the only rule broken. The extreme nodes `x = 0` and `x = 6` stand at
// `sqrt(2)` and `sqrt(26)` from the slew axis through `(1, ·, 1)`, so the
// distinct-radius rule holds too.
//
// The tower under the ring is the minimal crane's, which reaches only the bottom
// flange, so no member joins the arm to the tower outside the ring.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains } from "../assert";
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

/** The minimal crane's braced tower: every member of it ends at or below `y = 2`. */
const TOWER: readonly DesignMember[] = MINIMAL_CRANE.members.filter(
  ([a, b]) => a[1] <= 2 && b[1] <= 2,
);

/** The mast, tied to all four top-flange nodes, so the arm has something to hang from. */
const MAST: readonly DesignMember[] = [
  [[0, 4, 0], [0, 8, 0], "strut"],
  [[2, 4, 0], [0, 8, 0], "strut"],
  [[0, 4, 2], [0, 8, 0], "strut"],
  [[2, 4, 2], [0, 8, 0], "strut"],
];

/** Two collinear rails with the stretch from `x = 2` to `x = 4` left uncovered. */
const GAPPED_TRACK: CraneDesign = {
  site: 0,
  name: "Gapped track",
  ring: [0, 2, 0],
  counterweights: [],
  members: [
    ...TOWER,
    ...MAST,
    [[0, 8, 0], [4, 4, 0], "strut"],
    [[0, 4, 0], [2, 4, 0], "rail"],
    [[4, 4, 0], [6, 4, 0], "rail"],
  ],
  tape: [],
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises invalid-rail for two collinear rails that do not meet end to end", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await poseCrane(h, GAPPED_TRACK);

  const { issues } = await h.check();

  await h.advance(1);
  await h.capture("state", "two collinear rails with a gap between them");

  assertContains(
    issues,
    "invalid-rail",
    "the issue rails that leave a gap between them raise " +
      "(specs/structure.md § The trolley and the rail)",
  );
});
