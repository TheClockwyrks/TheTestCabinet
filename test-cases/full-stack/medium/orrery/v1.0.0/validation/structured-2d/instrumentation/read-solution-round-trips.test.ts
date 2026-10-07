// instrumentation/read-solution-round-trips — what `readSolution` hands back
// rebuilds the machine it was read from.
//
// THE RULE. "`readSolution()` | A pure read: the current machine as a solution
// document, exactly what `loadSolution` would accept to rebuild it"
// (`specs/instrumentation.md`, The machine), against "`loadSolution(solution)` |
// Replaces the open challenge's machine with `solution`... which is exactly the
// placements above applied in the order `parts` lists them". What a document has
// to carry for that to hold is `specs/formats.md`'s: "The order of `parts` is the
// machine's placement order", and per class "`q`, `r`, `rotation`... `length`...
// `tape`", "`cells`, the path in order, and `closed`", and "`index`: which reagent
// or product".
//
// THE CONFIGURATION. A machine built one placement at a time through the machine
// group, so the document under test is read off a machine this check never handed
// the build as a document: the rise for reagent `0`, the set for product `0`, a
// `biarm` turned to rotation `3`, grown to length `2` and given a four-cell tape,
// a three-cell open track laid cell by cell, and a `bind` at rotation `4`. It is
// then read, the editor is CLEARED — "`clearMachine()` | Removes every placed
// part" — and the document read back is loaded into the empty editor.
//
// THE VERDICT. The machine after the reload is the machine before it, part for
// part: the same kinds in the same order, at the same anchors and rotations, with
// the same lengths, the same paths, the same loop flags, the same reagent and
// product indices, and the same tapes. Ids are the one thing not compared, because
// no sentence of `specs/` fixes what a rebuilt part's id is.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { at } from "../field";
import { BARE } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadMachine,
  openChallengeDocument,
  placePart,
  placeRise,
  placeSet,
  placeTrack,
  readMachine,
  writeTape,
  type Harness,
  type OrrerySnapshot,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Everything `specs/formats.md` makes a solution document carry about one part. */
function shapeOf(snapshot: OrrerySnapshot): unknown[] {
  return snapshot.editor.parts.map((part) => ({
    kind: part.kind,
    q: part.q,
    r: part.r,
    rotation: part.rotation,
    length: part.length,
    cells: (part.cells ?? []).map((cell) => `${cell.q},${cell.r}`),
    closed: part.closed,
    index: part.index,
    tape: part.tape,
  }));
}

it("hands back a document that rebuilds the same machine, part for part", async () => {
  await h.debug.reset();
  await openChallengeDocument(h, BARE);

  await placeRise(h, 0, at(-4, 0), 0);
  await placeSet(h, 0, at(4, 0), 0);
  const biarm = await placePart(h, "biarm", at(0, 0), 3);
  await h.debug.setPartLength(biarm, 2);
  await writeTape(h, biarm, ["grab", "rotate-cw", "drop", "rotate-ccw"]);
  await placeTrack(h, [at(0, 3), at(1, 3), at(2, 3)]);
  await placePart(h, "bind", at(-2, -2), 4);
  const before = await h.snapshot();

  const document = await readMachine(h);
  await h.debug.clearMachine();
  const cleared = await h.snapshot();

  await loadMachine(h, document);
  await h.advance(1);
  await captureStill(h, "rebuilt");
  const after = await h.snapshot();

  assertEqual(
    before.editor.parts.length,
    5,
    "the machine the document was read from holds all five parts",
  );
  assertEqual(
    cleared.editor.parts.length,
    0,
    "the editor is empty before the document is loaded back into it",
  );
  assertEqual(
    after.editor.parts.length,
    5,
    "the document rebuilds every part it was read from",
  );
  assertDeepEqual(
    shapeOf(after),
    shapeOf(before),
    "the rebuilt machine is the same parts in the same order, at the same poses, with the same paths and tapes",
  );
});
