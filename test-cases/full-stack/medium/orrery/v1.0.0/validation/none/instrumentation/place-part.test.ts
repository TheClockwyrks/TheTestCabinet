// instrumentation/place-part — `placePart` places one arm, wheel or sigil.
//
// THE RULE. "`placePart(kind, q, r, rotation)` — Places one part of `kind`, an
// arm, wheel, or sigil kind of `PARTS` in `specs/parts.md`, anchored on `(q, r)`
// at `rotation` `0` to `5`, at length `ARM_MIN_LEN` (`1`) with an empty tape"
// (`specs/instrumentation.md`, The machine). Two of the group's five standing
// rules are read with it: "A new part's `id` is the `id` of the last entry of
// `editor.parts` in the next snapshot", and "None pushes an undo entry".
//
// WHAT THE SNAPSHOT REPORTS OF A PLACED PART is fixed by the snapshot shape:
// `{ id, kind, q, r, rotation, length, cells, closed, index, tape }`, where
// `tape` is "the tape, for arms and wheels" and `null` for everything else — so
// an empty tape reads as the empty list on an arm and on a wheel, and a sigil,
// which has no tape at all, reports `null`.
//
// THE CONFIGURATION. `BARE`, opened as a document so the world is this project's
// own, and three placements covering the three classes the row names: an ARM
// kind, a WHEEL, and a SIGIL kind. Each is placed at a rotation other than `0`,
// and at three different rotations, so a build that ignored the argument and
// rested everything at `0` is caught. The three anchors are far enough apart that
// every placement rule of `specs/parts.md` holds across the whole machine, so
// nothing is refused for a reason this item is not about.
//
// THE VERDICT. Each placement adds exactly one part, reported as the last entry
// of `editor.parts`, carrying the kind, the anchor and the rotation it was given,
// at `ARM_MIN_LEN`, with an empty tape where the class has one and `null` where
// it has none — and the undo history is still empty afterwards.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertLength,
  assertNotNull,
  assertNull,
} from "../assert";
import { ARM_MIN_LEN } from "../constants";
import { at, type Hex } from "../field";
import { BARE } from "../fixtures";
import {
  captureStill,
  createHarness,
  openTitle,
  partById,
  placePart,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** The three classes `placePart` accepts, each at its own anchor and rotation. */
const PLACEMENTS = [
  { kind: "arm", hex: at(0, -3), rotation: 2, tape: [] as string[] },
  { kind: "wheel", hex: at(0, 3), rotation: 4, tape: [] as string[] },
  { kind: "bind", hex: at(2, -2), rotation: 1, tape: null },
] as const;

it("places one part of the kind, anchor and rotation it was given", async () => {
  await openTitle(h);
  await h.debug.loadChallenge(BARE);
  await h.debug.setScreen("editor");

  const placed: number[] = [];
  for (const [index, entry] of PLACEMENTS.entries()) {
    const hex: Hex = entry.hex;
    const id = await placePart(h, entry.kind, hex, entry.rotation);
    placed.push(id);

    const snapshot = await h.snapshot();
    assertLength(
      snapshot.editor.parts,
      index + 1,
      `placePart(${entry.kind}) placed exactly one part`,
    );
    assertEqual(
      snapshot.editor.parts[snapshot.editor.parts.length - 1]?.id,
      id,
      `the new ${entry.kind}'s id is the id of the last entry of editor.parts`,
    );

    const part = partById(snapshot, id);
    assertNotNull(part, `the ${entry.kind} is on the field`);
    assertEqual(part?.kind, entry.kind, "under the kind it was given");
    assertEqual(part?.q, hex.q, "anchored on the q it was given");
    assertEqual(part?.r, hex.r, "and on the r it was given");
    assertEqual(
      part?.rotation,
      entry.rotation,
      "at the rotation it was given, rather than resting at 0",
    );
    assertEqual(
      part?.length,
      ARM_MIN_LEN,
      "at ARM_MIN_LEN, which placePart fixes for every kind it places",
    );
    if (entry.tape === null) {
      assertNull(
        part?.tape ?? null,
        "a sigil carries no tape, so the snapshot reports null for it",
      );
    } else {
      assertDeepEqual(
        part?.tape,
        [],
        "an arm or a wheel is placed with an empty tape",
      );
    }
  }

  await h.advance(1);
  await captureStill(h, "placed");

  const built = await h.snapshot();
  assertDeepEqual(
    built.editor.parts.map((part) => part.id),
    placed,
    "the three placements stand together, in the order they were placed",
  );
  assertEqual(
    built.editor.undoDepth,
    0,
    "none of the machine operations pushes an undo entry",
  );
});
