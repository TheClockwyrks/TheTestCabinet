// instrumentation/load-solution — `loadSolution` stands the machine a document
// describes up, in the document's own order.
//
// THE RULE. "`loadSolution(solution)` | Replaces the open challenge's machine with
// `solution`, a solution document in the format of `specs/formats.md`, which is
// exactly the placements above applied in the order `parts` lists them"
// (`specs/instrumentation.md`, The machine). What each entry carries is
// `specs/formats.md`'s: "Arms and wheels | `q`, `r`, `rotation` (`0` to `5`),
// `length` (`1` to `3`; wheels always `1`), `tape`", "`track` | `cells`, the path
// in order, and `closed`", "Sigils | `q`, `r`, `rotation`", "`rise`, `set` |
// `q`, `r`, `rotation`, and `index`". And the order is load-bearing: "The order of
// `parts` is the machine's placement order, which fixes the tape panel's row order
// and the part indices the debug surface reports" — which the snapshot reports as
// "`parts`: placement order; the tape panel's row order".
//
// THE CONFIGURATION. A machine already standing — one arm placed on `(0, 0)` — so
// what the load does is a REPLACEMENT rather than a first placement. The document
// then names one part of every class the format distinguishes, in an order that is
// not the order of `PARTS`: the rise for reagent `0`, the set for product `0`, a
// `biarm` at rotation `3`, length `2`, carrying a four-cell tape, a three-cell
// open track, and a `bind` at rotation `4`. Every placement rule of
// `specs/parts.md` holds across the list, so the document is legal for the open
// challenge.
//
// THE VERDICT. The machine holds those five parts and no other — the arm that was
// standing is gone — reported in the document's order, each carrying the kind,
// anchor, rotation, length, path and tape the document gave it.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNull } from "../assert";
import { at } from "../field";
import {
  armPart,
  risePart,
  setPart,
  sigilPart,
  solution,
  trackPart,
} from "../formats";
import { BARE } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadMachine,
  openChallengeDocument,
  partById,
  placePart,
  type Harness,
} from "../harness";

/** One part of every class `specs/formats.md` distinguishes, in a deliberate order. */
const DOCUMENT = solution([
  risePart(0, -4, 0, 0),
  setPart(0, 4, 0, 0),
  armPart("biarm", 0, 0, 3, 2, ["grab", "rotate-cw", "drop", "rotate-ccw"]),
  trackPart([at(0, 3), at(1, 3), at(2, 3)]),
  sigilPart("bind", -2, -2, 4),
]);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("replaces the machine with the document's parts, in the document's order", async () => {
  await h.debug.reset();
  await openChallengeDocument(h, BARE);
  const standing = await placePart(h, "arm", at(2, -4), 0);

  await loadMachine(h, DOCUMENT);
  await h.advance(1);
  await captureStill(h, "machine");
  const loaded = await h.snapshot();
  const parts = loaded.editor.parts;

  assertNull(
    partById(loaded, standing),
    "the machine that was standing is replaced rather than added to",
  );
  assertDeepEqual(
    parts.map((part) => part.kind),
    ["rise", "set", "biarm", "track", "bind"],
    "the parts are reported in the order the document lists them",
  );

  assertEqual(parts[0]?.index, 0, "the rise delivers reagent 0");
  assertEqual(
    parts[0]?.q,
    -4,
    "the rise is anchored where the document put it",
  );
  assertEqual(parts[0]?.r, 0, "the rise is anchored where the document put it");
  assertEqual(
    parts[0]?.rotation,
    0,
    "the rise carries the document's rotation",
  );

  assertEqual(parts[1]?.index, 0, "the set receives product 0");
  assertEqual(parts[1]?.q, 4, "the set is anchored where the document put it");
  assertEqual(parts[1]?.r, 0, "the set is anchored where the document put it");
  assertEqual(parts[1]?.rotation, 0, "the set carries the document's rotation");

  assertEqual(
    parts[2]?.q,
    0,
    "the biarm is anchored where the document put it",
  );
  assertEqual(
    parts[2]?.r,
    0,
    "the biarm is anchored where the document put it",
  );
  assertEqual(
    parts[2]?.rotation,
    3,
    "the biarm carries the document's rotation",
  );
  assertEqual(parts[2]?.length, 2, "the biarm carries the document's length");
  assertDeepEqual(
    parts[2]?.tape,
    ["grab", "rotate-cw", "drop", "rotate-ccw"],
    "the biarm carries the document's tape",
  );

  assertDeepEqual(
    (parts[3]?.cells ?? []).map((cell) => `${cell.q},${cell.r}`),
    ["0,3", "1,3", "2,3"],
    "the track carries the document's path, in order",
  );
  assertEqual(
    parts[3]?.closed,
    false,
    "the track is open, as the document says",
  );

  assertEqual(
    parts[4]?.q,
    -2,
    "the sigil is anchored where the document put it",
  );
  assertEqual(
    parts[4]?.r,
    -2,
    "the sigil is anchored where the document put it",
  );
  assertEqual(
    parts[4]?.rotation,
    4,
    "the sigil carries the document's rotation",
  );
});
