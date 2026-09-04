// instrumentation/snapshot-parts-in-placement-order — `editor.parts` is the
// machine in the order it was built, and a removal does not disturb it.
//
// THE RULE. `specs/instrumentation.md`, Snapshot shape, names the order in the
// literal itself: "`parts`: [ // placement order; the tape panel's row order".
// `specs/state.md` says it again of the state behind it — "`parts` holds the
// machine in placement order, which is the order the tape panel lists its rows
// in" — and `specs/editor.md` reads it off the panel: "The panel shows one row
// per arm and wheel, in placement order."
//
// THE CONFIGURATION. Four arms placed one at a time on four hexes, each given a
// tape cell of its own so no two rows are alike, then the SECOND one removed, then
// a fifth arm placed. Every placement is one `placePart` call, so the order the
// check placed them in is a fact the check holds rather than one it read back.
//
// WHY AN INTERIOR PART. Removing the last entry leaves any order looking right,
// and so does removing the first if the rest are merely re-listed. Taking out the
// second is what tells placement order apart from every other order a build might
// have kept the parts in: what remains must read first, third, fourth, and then
// the new one at the end.
//
// THE VERDICT. Each of the three readings — after the four placements, after the
// removal, and after the fifth placement — lists exactly the parts still on the
// machine, in the order they were placed, by their anchors and their tapes.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import { at, type Hex } from "../field";
import { BARE } from "../fixtures";
import {
  captureStill,
  createHarness,
  openChallengeDocument,
  placePart,
  type Harness,
  type OrrerySnapshot,
} from "../harness";

/** Four hexes far enough apart to place five separate arms on. */
const HEXES: readonly Hex[] = [
  at(-2, 0),
  at(0, -2),
  at(2, 0),
  at(0, 2),
  at(2, -2),
];

/** Each placed part read as the pair the check posed: its anchor and its tape. */
function placements(snapshot: OrrerySnapshot): string[] {
  return snapshot.editor.parts.map(
    (part) => `${part.q},${part.r}:${(part.tape ?? []).join("/")}`,
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("lists the machine in placement order, across a removal", async () => {
  await openChallengeDocument(h, BARE);
  await h.debug.clearMachine();

  const ids: number[] = [];
  for (const [k, hex] of HEXES.slice(0, 4).entries()) {
    const id = await placePart(h, "arm", hex, 0);
    await h.debug.setTapeCell(id, k, "rotate-cw");
    ids.push(id);
  }

  const built = await h.snapshot();
  await h.advance(1);
  await captureStill(h, "order");
  assertLength(built.editor.parts, 4, "all four arms are on the machine");
  assertDeepEqual(
    placements(built),
    [
      "-2,0:rotate-cw",
      "0,-2:/rotate-cw",
      "2,0://rotate-cw",
      "0,2:///rotate-cw",
    ],
    "editor.parts lists the four arms in the order they were placed",
  );
  assertDeepEqual(
    built.editor.parts.map((part) => part.id),
    ids,
    "the ids are listed in the order the placements answered them",
  );

  await h.debug.removePart(ids[1] ?? -1);
  const shortened = await h.snapshot();
  assertLength(shortened.editor.parts, 3, "the removed arm is off the machine");
  assertDeepEqual(
    placements(shortened),
    ["-2,0:rotate-cw", "2,0://rotate-cw", "0,2:///rotate-cw"],
    "removing an interior part leaves the parts that remain in placement order",
  );

  const added = await placePart(h, "arm", HEXES[4] ?? at(0, 0), 0);
  await h.debug.setTapeCell(added, 4, "rotate-ccw");

  const rebuilt = await h.snapshot();
  assertLength(rebuilt.editor.parts, 4, "the fifth arm joined the machine");
  assertDeepEqual(
    placements(rebuilt),
    [
      "-2,0:rotate-cw",
      "2,0://rotate-cw",
      "0,2:///rotate-cw",
      "2,-2:////rotate-ccw",
    ],
    "a part placed after a removal is listed last, behind the survivors",
  );
  assertEqual(
    rebuilt.editor.parts[3]?.id,
    added,
    "the part placed last is the last entry",
  );
});
