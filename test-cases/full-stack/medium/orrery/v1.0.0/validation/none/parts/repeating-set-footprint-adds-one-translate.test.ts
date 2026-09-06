// parts/repeating-set-footprint-adds-one-translate — a set for a REPEATING
// product claims its pattern's hexes and the pattern translated once by the
// repeat vector.
//
// THE RULE. "A rise or set is placed at an anchor and rotation like any sigil,
// and its footprint is its pattern's hexes placed at that pose: the molecule
// pattern for a rise, and for a set the pattern plus, when the product repeats,
// the pattern translated once by the repeat vector" (`specs/parts.md`, Rises and
// sets). `specs/formats.md` fixes what a repeat is: "`repeat` appears on
// repeating products alone ... Its `vector` is a non-zero hex offset ... and the
// pattern and the pattern translated once by `vector` share no hex."
//
// HOW A FOOTPRINT IS OBSERVED. The snapshot reports a set's anchor and rotation,
// never the hexes it covers, so the footprint is read through the rule that
// depends on it. Placement rule 2: "Sigil footprints, rise and set footprints
// included, are pairwise disjoint, and no track cell lies on any of them"
// (`specs/parts.md`) — so a one-cell track offered on a hex the footprint claims
// is refused, and one offered on a hex it does not claim is placed. That is a
// yes-or-no reading of one hex at a time, and this check reads six of them.
//
// THE CONFIGURATION. A challenge whose one product is TWO `luna` on `(0, 0)` and
// `(1, 0)`, joined, repeating by the vector `(2, 0)` with a link from `(1, 0)` to
// `(2, 0)`. Its set is placed at `(-2, 0)` at rotation `0`, so the pattern lands
// on `(-2, 0)` and `(-1, 0)` and the one translate on `(0, 0)` and `(1, 0)`:
// FOUR hexes for a two-mote product, which is the figure the rule fixes. The two
// hexes flanking them, `(-3, 0)` and `(2, 0)`, are the control: a footprint of
// the pattern alone would claim two, and a footprint that kept translating would
// claim more.
//
// THE VERDICT. Each of the four hexes refuses a track cell, and each of the two
// flanking hexes takes one.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { at, place, type Hex } from "../field";
import { challenge, link, molecule, mote } from "../formats";
import {
  captureStill,
  createHarness,
  openChallengeDocument,
  partIds,
  placeSet,
  type Harness,
} from "../harness";
import { setFootprint } from "../parts";

/**
 * Whether the surface REFUSED a placement: "Each placement is checked against
 * the placement rules of `specs/parts.md` alone, and throws an `Error` naming
 * the first rule it breaks" (`specs/instrumentation.md`, The machine).
 */
async function refusesPlacement(
  place_: () => Promise<unknown>,
): Promise<boolean> {
  try {
    await place_();
    return false;
  } catch {
    return true;
  }
}

/** The pattern the product repeats: two `luna` joined east. */
const PATTERN_HEXES: readonly Hex[] = [at(0, 0), at(1, 0)];

/** The repeat vector, which is what the one translate shifts the pattern by. */
const REPEAT_VECTOR: Hex = at(2, 0);

/** The repeating product: the two-mote pattern chained east by the vector. */
const PRODUCT = molecule(
  [mote(0, 0, "luna"), mote(1, 0, "luna")],
  [link(at(0, 0), at(1, 0), 1)],
  { vector: REPEAT_VECTOR, link: link(at(1, 0), at(2, 0), 1) },
);

/** A challenge whose one product is that two-mote pattern, repeating east. */
const TWIN_CHAIN = challenge({
  name: "Twin Chain",
  reagents: [molecule([mote(0, 0, "luna")])],
  products: [PRODUCT],
  permitted: ["arm", "track"],
});

/** Where the set stands. */
const ANCHOR: Hex = at(-2, 0);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("claims the placed pattern and one translate of it, four hexes for a two-mote product", async () => {
  await openChallengeDocument(h, TWIN_CHAIN);
  const set = await placeSet(h, 0, ANCHOR, 0);

  await h.advance(1);
  await captureStill(h, "repeating");

  // What the rule says the footprint is, computed from the pattern and the
  // vector rather than read off the build.
  const claimed = setFootprint(PRODUCT, ANCHOR, 0);
  assertEqual(
    claimed.map((hex) => `${hex.q},${hex.r}`).join(" "),
    "-2,0 -1,0 0,0 1,0",
    "the pattern at (-2, 0) plus the pattern translated once by (2, 0)",
  );
  assertEqual(
    claimed.length,
    2 * PATTERN_HEXES.length,
    "a two-mote repeating product claims four hexes rather than two",
  );

  for (const hex of claimed) {
    const refused = await refusesPlacement(() =>
      h.debug.placeTrack(hex.q, hex.r),
    );
    assertEqual(
      refused,
      true,
      `a track cell on (${hex.q}, ${hex.r}) is refused: the set's footprint covers it`,
    );
    assertEqual(
      (await partIds(h)).length,
      1,
      `the refused track on (${hex.q}, ${hex.r}) added no part`,
    );
  }

  // The hexes either side of the footprint, which a set whose footprint were the
  // pattern alone, or one that kept translating, would place differently.
  const flanking: readonly Hex[] = [
    place(at(-1, 0), ANCHOR, 0),
    place(at(REPEAT_VECTOR.q * 2, REPEAT_VECTOR.r * 2), ANCHOR, 0),
  ];
  let placed = 1;
  for (const hex of flanking) {
    const refused = await refusesPlacement(() =>
      h.debug.placeTrack(hex.q, hex.r),
    );
    assertEqual(
      refused,
      false,
      `a track cell on (${hex.q}, ${hex.r}) is placed: the set's footprint does not reach it`,
    );
    placed += 1;
    assertEqual(
      (await partIds(h)).length,
      placed,
      `the track on (${hex.q}, ${hex.r}) stands on the machine`,
    );
  }

  assertEqual(
    (await partIds(h))[0],
    set,
    "the set is still the machine's first part, refusals and all",
  );
});
