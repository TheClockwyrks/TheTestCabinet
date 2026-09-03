// editor/history-depth-counts-landed-edits — every landed edit raises
// historyDepth by one.
//
// `specs/state.md` § The editor: "The undo history for the open site: the
// structure as it stood before each structure-changing edit since the site was
// opened, oldest first. The snapshot reports its depth as `historyDepth`."
// `specs/instrumentation.md` § The structure says the poses feed the same stack a
// player's clicks do: "Each edit that lands pushes the undo history exactly as a
// click would."
//
// SO THE READING IS THE RISE PER EDIT, not the total. What the depth stands at
// before the four members belongs to whatever arranged the world, and a build that
// pushed one entry for emptying the structure is not what this point is about; so
// the depth is read once as a baseline and then after each of four placements, and
// what is asserted is one more each time.
//
// FOUR MEMBERS RATHER THAN ONE, because the requirement is that the stack COUNTS
// rather than that it flips: a build that latched the depth at `1` on the first
// edit passes a single-edit check and fails this one.
//
// Each of the four is a two-unit strut standing on one of site 0's ground anchors
// — inside `STRUT_MAX_LEN` (`6`), inside the envelope, `80` against a `3000`
// budget, no rail and no ring, so nothing in `specs/structure.md`'s refusal list
// touches them and all four land. That they landed is read back before the depth
// is: an edit that was refused pushes nothing, and the check should say so as a
// refusal rather than as a miscount.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  createHarness,
  emptyYard,
  openSite,
  type Harness,
  type Vec3,
} from "../harness";

/** Four struts, each standing on one of site 0's ground anchors. */
const STRUTS: readonly (readonly [Vec3, Vec3])[] = [
  [
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 2, z: 0 },
  ],
  [
    { x: 2, y: 0, z: 0 },
    { x: 2, y: 2, z: 0 },
  ],
  [
    { x: 0, y: 0, z: 2 },
    { x: 0, y: 2, z: 2 },
  ],
  [
    { x: 2, y: 0, z: 2 },
    { x: 2, y: 2, z: 2 },
  ],
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises historyDepth by one for each edit that lands", async () => {
  await openSite(h, 0);
  await emptyYard(h);

  const baseline = (await h.snapshot()).historyDepth;

  for (const [index, [a, b]] of STRUTS.entries()) {
    await h.debug.addMember(a.x, a.y, a.z, b.x, b.y, b.z, "strut");
    // Read straight after the call, with no frame in between: a pose "sets one
    // thing and leaves the rest of the game as it stands"
    // (`specs/instrumentation.md`), so the edit has landed by the time it
    // returns and a frame run here would only be a frame this point is not
    // about.
    const s = await h.snapshot();
    assertLength(
      s.structure.members,
      index + 1,
      `the members standing after strut ${index}, from (${a.x}, ${a.y}, ` +
        `${a.z}) to (${b.x}, ${b.y}, ${b.z}): the edit has to land before it ` +
        "can be undone (specs/structure.md)",
    );
    assertEqual(
      s.historyDepth,
      baseline + index + 1,
      `historyDepth after ${index + 1} landed edits (specs/state.md)`,
    );
  }

  // One frame, so the still below is the build screen carrying the four struts
  // rather than the frame that stood before the first of them was placed.
  await h.advance(1);
  await h.capture(
    "history-depth-counts-landed-edits",
    "The four struts the undo history counts",
  );
});
