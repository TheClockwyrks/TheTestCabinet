// simulation/slack-cable-leaves-the-system — a cable whose force comes back
// negative carries zero, not a compression.
//
// `specs/statics.md` § Slack cables: "Cables carry tension only, so each solve
// iterates to find which are taut. Solve with every candidate cable present;
// every cable whose force comes back negative goes slack, leaves the system
// entirely, and carries zero force."
//
// THE SCENARIO IS AN X-BRACED PANEL, which is where a pair of opposed diagonals
// is decided by one sign. The arm carries a vertical panel between the mast head
// `(0, 8, 0)` and the jib tip `(4, 4, 0)`, its four sides struts and both its
// diagonals cables. The tip is the loaded corner, so the panel is in shear: the
// diagonal from the mast head DOWN to the tip lengthens and must pull, and the
// diagonal from the flange UP to the top corner shortens and could only push.
//
// AND THE SIGN IS READ OFF THE BUILD RATHER THAN ASSERTED FROM THIS FILE. The
// panel is stood up once with both diagonals as STRUTS, which carry compression
// perfectly well, and the two diagonals are then SWAPPED IN PLACE for cables on
// the same two node pairs — a removal, which "is always allowed", and a
// placement each (`specs/structure.md`). The strut reading says which of the two
// the build itself computes a negative force for; the cable reading must then
// report that one as exactly `0` — not the negative figure, and not a small
// residue.
//
// SWAPPED RATHER THAN REBUILT, because the requirement is about the material and
// nothing else: the two readings are taken on one crane whose only difference is
// the two members' material, so nothing else in the panel can have moved between
// them. The swap is the direct route to the second scenario, and re-posing every
// member to reach it would drive twenty-five placements this point does not
// decide. The cables take fresh ids — "the next member id climbs with every
// member placed and falls only when the structure is emptied whole" — so the
// pair is followed by the ids the snapshot hands back rather than by the ids the
// struts carried.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertLessThan,
  assertTrue,
} from "../assert";
import {
  clearAll,
  createHarness,
  openSite,
  poseCrane,
  type CraneDesign,
  type Harness,
  type LatticeNode,
} from "../harness";

/** The panel's two diagonals: ids `21` and `22` in the list below. */
const DOWN_DIAGONAL = 21;
const UP_DIAGONAL = 22;

/** The mast head down to the jib tip: the diagonal the panel's shear pulls. */
const DOWN_NODES: readonly [LatticeNode, LatticeNode] = [
  [0, 8, 0],
  [4, 4, 0],
];

/** The flange up to the top corner: the diagonal the panel's shear pushes. */
const UP_NODES: readonly [LatticeNode, LatticeNode] = [
  [0, 4, 0],
  [4, 8, 0],
];

/** The crane, its two panel diagonals struts. */
const PANEL: CraneDesign = {
  site: 1,
  name: "X-braced panel (strut diagonals)",
  ring: [0, 2, 0],
  counterweights: [],
  members: [
    // 0-13: the tower, anchors to the ring's bottom flange at y = 2.
    [[0, 0, 0], [0, 2, 0], "strut"],
    [[2, 0, 0], [2, 2, 0], "strut"],
    [[0, 0, 2], [0, 2, 2], "strut"],
    [[2, 0, 2], [2, 2, 2], "strut"],
    [[0, 2, 0], [2, 2, 0], "strut"],
    [[0, 2, 2], [2, 2, 2], "strut"],
    [[0, 2, 0], [0, 2, 2], "strut"],
    [[2, 2, 0], [2, 2, 2], "strut"],
    [[0, 2, 0], [2, 2, 2], "strut"],
    [[2, 2, 0], [0, 2, 2], "strut"],
    [[2, 0, 0], [0, 2, 0], "strut"],
    [[0, 0, 2], [0, 2, 0], "strut"],
    [[0, 0, 0], [2, 2, 0], "strut"],
    [[2, 0, 2], [2, 2, 0], "strut"],
    // 14-17: the mast, tied to all four top-flange nodes.
    [[0, 4, 0], [0, 8, 0], "strut"],
    [[2, 4, 0], [0, 8, 0], "strut"],
    [[0, 4, 2], [0, 8, 0], "strut"],
    [[2, 4, 2], [0, 8, 0], "strut"],
    // 18-20: the panel's top chord, its outboard post, and the rail beneath it.
    [[0, 8, 0], [4, 8, 0], "strut"],
    [[4, 8, 0], [4, 4, 0], "strut"],
    [[0, 4, 0], [4, 4, 0], "rail"],
    // 21-22: the two diagonals, the pair this check is about.
    [DOWN_NODES[0], DOWN_NODES[1], "strut"],
    [UP_NODES[0], UP_NODES[1], "strut"],
    // 23-26: the panel's bracing out of its own plane.
    [[0, 4, 2], [4, 4, 0], "strut"],
    [[2, 4, 2], [4, 4, 0], "strut"],
    [[0, 4, 2], [4, 8, 0], "strut"],
    [[2, 4, 2], [4, 8, 0], "strut"],
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

it("reports zero for the diagonal that would have carried compression", async () => {
  await openSite(h, 0);
  await clearAll(h);

  // First, both diagonals as struts: which of the pair does this build compute a
  // negative — a compressive — force for?
  await poseCrane(h, PANEL);
  const asStruts = await h.check();
  assertTrue(asStruts.stable, "the crane stands with strut diagonals");
  const strutDown = asStruts.members.find((one) => one.id === DOWN_DIAGONAL);
  const strutUp = asStruts.members.find((one) => one.id === UP_DIAGONAL);
  assertGreaterThan(
    strutDown?.force ?? 0,
    0,
    `member ${DOWN_DIAGONAL}, the mast-head-to-tip diagonal, is the one the ` +
      "panel's shear pulls",
  );
  assertLessThan(
    strutUp?.force ?? 0,
    0,
    `member ${UP_DIAGONAL}, the flange-to-top-corner diagonal, is the one the ` +
      "panel's shear pushes: as a strut it carries compression",
  );

  // Now the same panel with those two diagonals — and nothing else — made
  // cables. The one the build just computed a negative force for cannot carry
  // it.
  const posed = (await h.snapshot()).structure;
  const cableDownId = posed.nextMemberId;
  const cableUpId = posed.nextMemberId + 1;
  await h.debug.removeMember(DOWN_DIAGONAL);
  await h.debug.removeMember(UP_DIAGONAL);
  for (const [a, b] of [DOWN_NODES, UP_NODES]) {
    await h.debug.addMember(a[0], a[1], a[2], b[0], b[1], b[2], "cable");
  }

  const swapped = (await h.snapshot()).structure;
  assertLength(
    swapped.members,
    posed.members.length,
    "the members standing after the two diagonals were swapped for cables on " +
      "the same node pairs (specs/structure.md)",
  );
  assertEqual(
    swapped.members.filter(
      (one) =>
        (one.id === cableDownId || one.id === cableUpId) &&
        one.material === "cable",
    ).length,
    2,
    "the two cables the swap placed, which is the scenario this point rests " +
      "on (specs/structure.md)",
  );

  const asCables = await h.check();
  await h.capture(
    "slack-cable-leaves-the-system",
    "the X-braced panel, its compression diagonal a slack cable",
  );

  assertTrue(asCables.stable, "the crane stands with cable diagonals");

  const cableDown = asCables.members.find((one) => one.id === cableDownId);
  const cableUp = asCables.members.find((one) => one.id === cableUpId);
  assertGreaterThan(
    cableDown?.force ?? 0,
    0,
    `cable ${cableDownId}, the mast-head-to-tip diagonal, is taut and carries ` +
      "tension (specs/statics.md)",
  );
  assertEqual(
    cableUp?.force,
    0,
    `cable ${cableUpId}, whose force came back negative, goes slack and ` +
      "carries zero force (specs/statics.md)",
  );
  assertEqual(
    cableUp?.utilization,
    0,
    "a slack cable's utilization (specs/statics.md)",
  );
});
