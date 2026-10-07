// instrumentation/place-rise — `placeRise` places the rise for one reagent, at the
// pose it was given, with the footprint that reagent's pattern gives it.
//
// THE RULE. "`placeRise(index, q, r, rotation)` | Places the rise for the open
// challenge's reagent `index`, anchored and rotated the same way"
// (`specs/instrumentation.md`, The machine) — the same way as `placePart`,
// "anchored on `(q, r)` at `rotation` `0` to `5`". Its shape on the field is
// `specs/parts.md`'s: "A rise or set is placed at an anchor and rotation like any
// sigil, and its footprint is its pattern's hexes placed at that pose: the
// molecule pattern for a rise". `specs/field.md`'s placement of a pattern hex is
// what "at that pose" means, and the snapshot reports which reagent it is:
// "`index: <number | null>`" (Snapshot shape).
//
// WHERE THE FOOTPRINT IS READ. The snapshot reports the rise's pose rather than
// its hexes, and placement rule 2 is what makes those hexes observable through
// this same group of operations: "Sigil footprints, rise and set footprints
// included, are pairwise disjoint" (`specs/parts.md`), and every machine operation
// "is checked against the placement rules of `specs/parts.md` alone"
// (`specs/instrumentation.md`). So a one-hex sigil laid on a footprint hex is
// refused and one laid off it is placed, and the pair says exactly which hexes the
// rise took.
//
// THE CONFIGURATION. A challenge with TWO reagents — a lone `dust` and a
// three-mote line — so the index names which one, and the rise for reagent `1`
// placed on `(0, 0)` at rotation `1`. That pattern's hexes are `(0, 0)`, `(1, 0)`,
// `(2, 0)`, so at rotation `1` its footprint is `(0, 0)`, `(0, 1)`, `(0, 2)` and
// at rotation `0` it would have been `(0, 0)`, `(1, 0)`, `(2, 0)`: the two probes
// below are the hexes the two poses disagree about. Nothing else is placed.
//
// THE VERDICT. The machine holds one part; it is a `rise` for reagent `1`,
// anchored on `(0, 0)` at rotation `1`. A `wane`, whose footprint is its anchor
// hex alone, is refused on `(0, 2)` — a footprint hex at the placed rotation — and
// placed on `(2, 0)`, which would be a footprint hex only at rotation `0`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertTrue } from "../assert";
import { at } from "../field";
import { challenge } from "../formats";
import { ONE_DUST, THREE_DUST_LINE } from "../fixtures";
import {
  captureStill,
  createHarness,
  openChallengeDocument,
  partById,
  placeRise,
  type Harness,
} from "../harness";

/** Two reagents, so the rise's `index` names one of them rather than the only one. */
const TWO_REAGENTS = challenge({
  name: "Two Reagents",
  reagents: [ONE_DUST, THREE_DUST_LINE],
  products: [ONE_DUST],
  permitted: ["arm"],
});

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Whether a surface call refused: it threw rather than returning. */
async function refused(call: () => Promise<unknown>): Promise<boolean> {
  try {
    await call();
    return false;
  } catch {
    return true;
  }
}

it("places the rise for a reagent at its pose, with that reagent's footprint", async () => {
  await h.debug.reset();
  await openChallengeDocument(h, TWO_REAGENTS);

  const rise = await placeRise(h, 1, at(0, 0), 1);
  await h.advance(1);
  await captureStill(h, "rise");
  const placed = await h.snapshot();

  assertEqual(
    placed.editor.parts.length,
    1,
    "placeRise places one part and nothing else",
  );
  assertNotNull(
    partById(placed, rise),
    "the machine reports the rise it placed",
  );
  assertEqual(
    partById(placed, rise)?.kind,
    "rise",
    "the part placed is a rise",
  );
  assertEqual(
    partById(placed, rise)?.index,
    1,
    "the snapshot reports which reagent the rise delivers",
  );
  assertEqual(partById(placed, rise)?.q, 0, "the rise is anchored on q = 0");
  assertEqual(partById(placed, rise)?.r, 0, "the rise is anchored on r = 0");
  assertEqual(
    partById(placed, rise)?.rotation,
    1,
    "the rise carries the rotation it was placed at",
  );

  assertTrue(
    await refused(() => h.debug.placePart("wane", 0, 2, 0)),
    "(0, 2) is a footprint hex of the reagent's line at rotation 1, so a sigil there breaks rule 2",
  );
  assertEqual(
    (await h.snapshot()).editor.parts.length,
    1,
    "the refused placement placed nothing",
  );

  await h.debug.placePart("wane", 2, 0, 0);
  assertEqual(
    (await h.snapshot()).editor.parts.length,
    2,
    "(2, 0) lies off the footprint at rotation 1, so a sigil there is placed",
  );
});
