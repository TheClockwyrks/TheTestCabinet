// instrumentation/reset-empties-the-history — a reset leaves an empty undo
// history, so nothing can be undone after it.
//
// `specs/instrumentation.md` § The run and the screens lists the undo history
// among the fields a reset restores to their title-screen value: "the strut tool,
// no pending node, an empty history, the camera at its start pose". The snapshot
// reports its depth as `historyDepth` (`specs/state.md`), so the reading is that
// number.
//
// THE HISTORY HAS TO BE NON-EMPTY FIRST, and the only thing that fills it is an
// edit that lands: "Each edit that lands pushes the undo history exactly as a
// click would." So four members are placed — four legal strut legs on site 1's
// four anchors, each two units long, well inside the envelope and far inside the
// budget — and the depth is read before the reset to confirm the check is
// deciding something. How MUCH each edit pushes is another item's requirement;
// this one only needs the history to be carrying something.
//
// The yard is emptied first: nothing about the undo history concerns the loads
// standing in it, and an obstacle left in the yard could refuse a member.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { createHarness, emptyYard, openSite, type Harness } from "../harness";

/** Four legal struts: one two-unit leg standing on each of site 1's anchors. */
const LEGS: readonly (readonly [number, number])[] = [
  [0, 0],
  [2, 0],
  [0, 2],
  [2, 2],
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("empties the undo history", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  for (const [x, z] of LEGS) {
    await h.debug.addMember(x, 0, z, x, 2, z, "strut");
  }

  assertGreaterThan(
    (await h.snapshot()).historyDepth,
    0,
    "the history the four placed members pushed, before the reset",
  );

  await h.debug.reset();
  const depth = (await h.snapshot()).historyDepth;
  await h.advance(1);
  await h.capture("history", "The undo history a reset leaves");

  assertEqual(
    depth,
    0,
    "historyDepth after a reset (specs/instrumentation.md)",
  );
});
