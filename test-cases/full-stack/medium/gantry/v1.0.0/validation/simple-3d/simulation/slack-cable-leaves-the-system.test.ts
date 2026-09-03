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
// same crane is posed twice: once with both diagonals as STRUTS, which carry
// compression perfectly well, and once with both as CABLES. The strut pose says
// which of the two the build itself computes a negative force for; the cable pose
// must then report that one as exactly `0` — not the negative figure, and not a
// small residue.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
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
  type MaterialName,
} from "../harness";

/** The panel's two diagonals: ids `21` and `22` in the list below. */
const DOWN_DIAGONAL = 21;
const UP_DIAGONAL = 22;

/** The crane, with the two panel diagonals made of `material`. */
function craneWith(material: MaterialName): CraneDesign {
  const members: CraneDesign["members"] = [
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
    [[0, 8, 0], [4, 4, 0], material],
    [[0, 4, 0], [4, 8, 0], material],
    // 23-26: the panel's bracing out of its own plane.
    [[0, 4, 2], [4, 4, 0], "strut"],
    [[2, 4, 2], [4, 4, 0], "strut"],
    [[0, 4, 2], [4, 8, 0], "strut"],
    [[2, 4, 2], [4, 8, 0], "strut"],
  ];
  return {
    site: 1,
    name: `X-braced panel (${material} diagonals)`,
    ring: [0, 2, 0],
    counterweights: [],
    members,
    tape: [],
  };
}

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
  await poseCrane(h, craneWith("strut"));
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

  // Now the same panel with both diagonals as cables. The one the build just
  // computed a negative force for cannot carry it.
  await poseCrane(h, craneWith("cable"));
  const asCables = await h.check();
  assertTrue(asCables.stable, "the crane stands with cable diagonals");
  await h.capture(
    "slack-cable-leaves-the-system",
    "the X-braced panel, its compression diagonal a slack cable",
  );

  const cableDown = asCables.members.find((one) => one.id === DOWN_DIAGONAL);
  const cableUp = asCables.members.find((one) => one.id === UP_DIAGONAL);
  assertGreaterThan(
    cableDown?.force ?? 0,
    0,
    `cable ${DOWN_DIAGONAL} is taut and carries tension (specs/statics.md)`,
  );
  assertEqual(
    cableUp?.force,
    0,
    `cable ${UP_DIAGONAL}, whose force came back negative, goes slack and ` +
      "carries zero force (specs/statics.md)",
  );
  assertEqual(
    cableUp?.utilization,
    0,
    "a slack cable's utilization (specs/statics.md)",
  );
});
