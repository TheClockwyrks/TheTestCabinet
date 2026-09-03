// editor/undo-does-not-reach-past-the-site-opening — undo empties the structure
// and then stops.
//
// specs/structure.md: "undo restores the structure to what it was before the most
// recent structure-changing edit, AS FAR BACK AS THE SITE WAS OPENED".
// specs/state.md carries the same from the other side — the history is "the
// structure as it stood before each structure-changing edit" for the open site —
// and specs/instrumentation.md has opening a site empty that history. So undoing
// more times than there are edits walks back to the structure the site opened
// with, and the extra undo has nothing left to pop.
//
// TWO EDITS AND THREE UNDOS is the smallest scenario that shows the floor rather
// than just showing undo working: the third undo is the one with no entry under
// it. What is read afterwards is that the structure is empty and `historyDepth` is
// `0` — the state the second undo reached — so a build whose undo ran off the end
// of its history, threw, or restored something older fails here, and so does a
// build whose undo does nothing at all, since two members would still be standing.
//
// UNDO IS DRIVEN BY ITS KEY because the surface carries no undo operation:
// specs/controls.md binds the `undo` action to `KeyZ` on the build screen, and
// `openSite` leaves the build screen showing, so the key is pressed where the
// action applies and nothing else is touched on the way. A FRAME RUNS BETWEEN THE
// PRESSES so each release is seen on a frame of its own: a build that latches the
// edge as the event arrives and a build that compares held state at the top of
// each frame then agree on three presses, and both are conformant readings of
// specs/controls.md.
//
// THE WORLD IS EMPTIED FIRST, and `clearStructure` on the empty structure a fresh
// site opens with "removes nothing and pushes no history"
// (specs/instrumentation.md), so the history under the two placements is exactly
// the two placements.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

/** The two placements the history is built from. */
const EDITS = [
  [
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 4, z: 0 },
  ],
  [
    { x: 2, y: 0, z: 0 },
    { x: 2, y: 4, z: 0 },
  ],
] as const;

/** One more undo than there are edits. */
const UNDOS = EDITS.length + 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("undoes to the structure the site opened with and then stops", async () => {
  await openSite(h, 0);
  await clearAll(h);

  for (const [a, b] of EDITS) {
    await h.debug.addMember(a.x, a.y, a.z, b.x, b.y, b.z, "strut");
  }

  for (let i = 0; i < UNDOS; i += 1) {
    await h.press("KeyZ");
    await h.advance(1);
  }

  await h.capture(
    "undo-floor",
    "The build screen after one more undo than there were edits",
  );

  const s = await h.snapshot();
  assertLength(
    s.structure.members,
    0,
    `the members standing after ${EDITS.length} placements and ${UNDOS} undos: ` +
      "undo reaches back as far as the site was opened and no further " +
      "(specs/structure.md)",
  );
  assertEqual(
    s.historyDepth,
    0,
    "the edits still to undo once the history is walked out " +
      "(specs/instrumentation.md)",
  );
});
