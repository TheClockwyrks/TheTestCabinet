// instrumentation/place-set — `placeSet` places the set for one product, at the
// pose it was given, with the repeat translation inside its footprint.
//
// THE RULE. "`placeSet(index, q, r, rotation)` | Places the set for the open
// challenge's product `index`, anchored and rotated the same way"
// (`specs/instrumentation.md`, The machine). Its shape on the field is
// `specs/parts.md`'s, and a set's is larger than a rise's when the product
// repeats: "its footprint is its pattern's hexes placed at that pose: the molecule
// pattern for a rise, and for a set the pattern plus, when the product repeats,
// the pattern translated once by the repeat vector". The snapshot reports which
// product it receives: "`index: <number | null>`" (Snapshot shape).
//
// WHERE THE FOOTPRINT IS READ. The snapshot reports the set's pose rather than its
// hexes, and placement rule 2 is what makes those hexes observable through this
// same group of operations: "Sigil footprints, rise and set footprints included,
// are pairwise disjoint" (`specs/parts.md`), and every machine operation "is
// checked against the placement rules of `specs/parts.md` alone"
// (`specs/instrumentation.md`). So a one-hex sigil laid on a footprint hex is
// refused and one laid off it is placed.
//
// THE CONFIGURATION. A challenge with TWO products — a lone `dust` and a repeating
// `luna` whose repeat vector is `(1, 0)` — so the index names which one, and the
// set for product `1` placed on `(0, 0)` at rotation `1`. That product's pattern
// is the single hex `(0, 0)`, so its footprint is that hex PLUS the pattern
// translated by the repeat vector; the translation is a pattern offset and turns
// with the pose, so at rotation `1` the footprint is `(0, 0)` and `(0, 1)`, and at
// rotation `0` it would have been `(0, 0)` and `(1, 0)`. The two probes below are
// those two disagreeing hexes, and both of them exist only because the product
// repeats. Nothing else is placed.
//
// THE VERDICT. The machine holds one part; it is a `set` for product `1`, anchored
// on `(0, 0)` at rotation `1`. A `wane`, whose footprint is its anchor hex alone,
// is refused on `(0, 1)` — the repeat translate at the placed rotation — and
// placed on `(1, 0)`, which would be the repeat translate only at rotation `0`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertTrue } from "../assert";
import { at } from "../field";
import { challenge } from "../formats";
import { ONE_DUST, REPEATING_LUNA } from "../fixtures";
import {
  captureStill,
  createHarness,
  openChallengeDocument,
  partById,
  placeSet,
  type Harness,
} from "../harness";

/** Two products, the second repeating, so a set's footprint carries the translate. */
const TWO_PRODUCTS = challenge({
  name: "Two Products",
  reagents: [ONE_DUST],
  products: [ONE_DUST, REPEATING_LUNA],
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

it("places the set for a product at its pose, repeat translation included", async () => {
  await h.debug.reset();
  await openChallengeDocument(h, TWO_PRODUCTS);

  const set = await placeSet(h, 1, at(0, 0), 1);
  await h.advance(1);
  await captureStill(h, "set");
  const placed = await h.snapshot();

  assertEqual(
    placed.editor.parts.length,
    1,
    "placeSet places one part and nothing else",
  );
  assertNotNull(partById(placed, set), "the machine reports the set it placed");
  assertEqual(partById(placed, set)?.kind, "set", "the part placed is a set");
  assertEqual(
    partById(placed, set)?.index,
    1,
    "the snapshot reports which product the set receives",
  );
  assertEqual(partById(placed, set)?.q, 0, "the set is anchored on q = 0");
  assertEqual(partById(placed, set)?.r, 0, "the set is anchored on r = 0");
  assertEqual(
    partById(placed, set)?.rotation,
    1,
    "the set carries the rotation it was placed at",
  );

  assertTrue(
    await refused(() => h.debug.placePart("wane", 0, 1, 0)),
    "(0, 1) is the repeat translate at rotation 1, part of the footprint, so a sigil there breaks rule 2",
  );
  assertEqual(
    (await h.snapshot()).editor.parts.length,
    1,
    "the refused placement placed nothing",
  );

  await h.debug.placePart("wane", 1, 0, 0);
  assertEqual(
    (await h.snapshot()).editor.parts.length,
    2,
    "(1, 0) is the repeat translate at rotation 0 alone, so a sigil there is placed",
  );
});
