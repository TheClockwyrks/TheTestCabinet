// parts/plain-set-footprint-is-its-product-pattern — a set for a product without a
// repeat occupies exactly that product's pattern, and nothing more.
//
// THE RULE. "A rise or set is placed at an anchor and rotation like any sigil, and
// its footprint is its pattern's hexes placed at that pose: the molecule pattern
// for a rise, and for a set the pattern plus, WHEN THE PRODUCT REPEATS, the
// pattern translated once by the repeat vector" (`specs/parts.md`, Rises and
// sets). The extra translate is conditional on the repeat, so a product with no
// `repeat` — and "`repeat` appears on repeating products alone, and is absent
// otherwise" (`specs/formats.md`) — gives the pattern's hexes alone. What "placed
// at that pose" means is `specs/field.md`, Molecule patterns.
//
// HOW A FOOTPRINT IS OBSERVED. Placement rule 2: "Sigil footprints, rise and set
// footprints included, are pairwise disjoint" (`specs/parts.md`). So a hex of the
// footprint refuses a second sigil and a hex outside it accepts one, and the
// refusal is stated: "Each placement is checked against the placement rules of
// `specs/parts.md` alone, and throws an `Error` naming the first rule it breaks"
// (`specs/instrumentation.md`). The probe is a `wane`, whose footprint is the
// single hex "`(0, 0)` — seat" (`specs/sigils.md`), so a refusal can only be about
// the one hex it was offered on.
//
// THE CONFIGURATION. A posed challenge whose one product is three `dust` in a
// line, `(0, 0)`, `(1, 0)`, `(2, 0)`, joined west to east, and carrying no
// `repeat`. Its set is placed at anchor `(-1, -1)` at rotation `0`, so its
// footprint is those three hexes translated by the anchor: `(-1, -1)`, `(0, -1)`,
// `(1, -1)`. A `wane` is then offered on each of the three, and on every hex
// ADJACENT to the footprint and off it — which includes `(2, -1)`, exactly where
// a translate the product never asked for would land.
//
// THE VERDICT. All three footprint hexes refuse the second sigil and add nothing
// to the machine; every hex around the footprint accepts one, which is removed
// again before the next probe. No additional hex is claimed.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertTrue,
  assertUndefined,
} from "../assert";
import { at, neighbors, onField, sameHex, type Hex } from "../field";
import { challenge, type Challenge } from "../formats";
import { ONE_DUST, THREE_DUST_LINE } from "../fixtures";
import { setFootprint } from "../parts";
import {
  captureStill,
  createHarness,
  openChallengeDocument,
  partIds,
  placeSet,
  type Harness,
} from "../harness";

/**
 * Whether the surface REFUSED a placement: "Each placement is checked against
 * the placement rules of `specs/parts.md` alone, and throws an `Error` naming
 * the first rule it breaks" (`specs/instrumentation.md`, The machine).
 */
async function refusesPlacement(
  place: () => Promise<unknown>,
): Promise<boolean> {
  try {
    await place();
    return false;
  } catch {
    return true;
  }
}

/** A challenge whose one product is a plain three-mote line: no `repeat` on it. */
const LINE_PRODUCT: Challenge = challenge({
  name: "Line Product",
  reagents: [ONE_DUST],
  products: [THREE_DUST_LINE],
  permitted: ["arm"],
});

/** Where the set stands. Rotation `0`, so the pose is the anchor's translation. */
const ANCHOR = at(-1, -1);
const ROTATION = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("claims its product's three hexes and no hex around them", async () => {
  assertUndefined(
    THREE_DUST_LINE.repeat,
    "the posed product carries no repeat, so its footprint gains no translate",
  );
  const footprint = setFootprint(THREE_DUST_LINE, ANCHOR, ROTATION);
  assertLength(
    footprint,
    THREE_DUST_LINE.motes.length,
    "a plain product's footprint is its pattern's hexes: one hex per pattern mote",
  );

  await openChallengeDocument(h, LINE_PRODUCT);
  const set = await placeSet(h, 0, ANCHOR, ROTATION);

  await h.advance(1);
  await captureStill(h, "set");

  assertEqual(
    (await partIds(h)).length,
    1,
    "the set is on the machine, and it is the only part on it",
  );

  for (const hex of footprint) {
    const refused = await refusesPlacement(() =>
      h.debug.placePart("wane", hex.q, hex.r, 0),
    );
    assertTrue(
      refused,
      `(${hex.q}, ${hex.r}) is a footprint hex of the set, so rule 2 refuses a sigil on it`,
    );
    assertEqual(
      (await partIds(h)).length,
      1,
      `the refused sigil on (${hex.q}, ${hex.r}) added no part`,
    );
  }

  // Every hex touching the footprint and off it takes a sigil, so no additional
  // hex is claimed — the hex a repeat's translate would have taken included.
  const around: Hex[] = [];
  for (const hex of footprint) {
    for (const near of neighbors(hex)) {
      const claimed = footprint.some((own) => sameHex(own, near));
      const already = around.some((seen) => sameHex(seen, near));
      if (!claimed && !already && onField(near)) around.push(near);
    }
  }
  assertTrue(
    around.length > 0,
    "the footprint has hexes around it on the field to probe",
  );
  for (const hex of around) {
    const refused = await refusesPlacement(() =>
      h.debug.placePart("wane", hex.q, hex.r, 0),
    );
    assertEqual(
      refused,
      false,
      `(${hex.q}, ${hex.r}) is not one of the product pattern's hexes, so the set does not claim it`,
    );
    const ids = await partIds(h);
    assertEqual(ids.length, 2, `the sigil on (${hex.q}, ${hex.r}) was placed`);
    await h.debug.removePart(ids[1] ?? -1);
  }

  assertEqual(
    (await partIds(h)).length,
    1,
    "the machine is back to the set alone, so every probe was cleaned up after",
  );
  assertEqual(set, (await partIds(h))[0], "the set is the part that remains");
});
