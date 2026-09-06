// parts/rise-and-set-join-the-disjointness — a rise's and a set's footprints are
// counted among the footprints rule 2 keeps apart.
//
// THE RULE. Placement rule 2: "Sigil footprints, rise and set footprints
// included, are pairwise disjoint, and no track cell lies on any of them"
// (`specs/parts.md`, Placement rules). A rise's and a set's footprint is its
// pattern placed at its pose (`specs/parts.md`, Rises and sets), and the surface
// "throws an `Error` naming the first rule it breaks"
// (`specs/instrumentation.md`).
//
// THE CONFIGURATION. A challenge with two one-mote reagents and one one-mote
// product, so every rise and set below covers exactly the hex it is anchored on
// and the pairings are unambiguous. On an empty machine with no run live:
//
//   - a `bind` stands at `(0, 0)`, covering `(0, 0)` and `(1, 0)`;
//   - a SET is offered on the bind's second hex `(1, 0)`, and a RISE on its
//     anchor `(0, 0)` — a footprint against a transforming sigil's, both ways;
//   - rise `0` is placed clear at `(3, 0)`, and rise `1` is offered on top of it
//     — a footprint against another RISE's;
//   - set `0` is placed clear at `(-3, 0)`, and rise `1` is offered on top of it
//     — a footprint against a SET's;
//   - rise `1` is finally offered at `(0, 3)`, which no footprint reaches.
//
// Every hex named is on the field, so rule 1 refuses none of it, and no two of
// the three refusals lean on the same pairing.
//
// THE VERDICT. The four overlapping offers are refused and add no part; the three
// clear ones are placed.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { at, onField, type Hex } from "../field";
import { challenge, molecule, mote } from "../formats";
import {
  captureStill,
  createHarness,
  openChallengeDocument,
  partById,
  partIds,
  placePart,
  placeRise,
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

/** Two one-mote reagents and one one-mote product: every footprint is one hex. */
const TWO_REAGENTS = challenge({
  name: "Two Reagents",
  reagents: [molecule([mote(0, 0, "dust")]), molecule([mote(0, 0, "nova")])],
  products: [molecule([mote(0, 0, "dust")])],
  permitted: ["arm", "bind"],
});

const SIGIL: Hex = at(0, 0);
const SIGIL_SECOND: Hex = at(1, 0);
const FIRST_RISE: Hex = at(3, 0);
const THE_SET: Hex = at(-3, 0);
const CLEAR: Hex = at(0, 3);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("refuses a rise or set covering a sigil's, another rise's, or a set's footprint", async () => {
  await openChallengeDocument(h, TWO_REAGENTS);

  for (const hex of [SIGIL, SIGIL_SECOND, FIRST_RISE, THE_SET, CLEAR]) {
    assertEqual(
      onField(hex),
      true,
      `the hex (${hex.q}, ${hex.r}) this check places on is on the field`,
    );
  }

  const bind = await placePart(h, "bind", SIGIL, 0);

  const setOverSigil = await refusesPlacement(() =>
    h.debug.placeSet(0, SIGIL_SECOND.q, SIGIL_SECOND.r, 0),
  );
  const afterSetOverSigil = (await partIds(h)).length;
  const riseOverSigil = await refusesPlacement(() =>
    h.debug.placeRise(0, SIGIL.q, SIGIL.r, 0),
  );
  const afterRiseOverSigil = (await partIds(h)).length;

  let rise = -1;
  const riseClear = await refusesPlacement(async () => {
    rise = await placeRise(h, 0, FIRST_RISE, 0);
  });
  const riseOverRise = await refusesPlacement(() =>
    h.debug.placeRise(1, FIRST_RISE.q, FIRST_RISE.r, 0),
  );
  const afterRiseOverRise = (await partIds(h)).length;

  let product = -1;
  const setClear = await refusesPlacement(async () => {
    product = await placeSet(h, 0, THE_SET, 0);
  });
  const riseOverSet = await refusesPlacement(() =>
    h.debug.placeRise(1, THE_SET.q, THE_SET.r, 0),
  );
  const afterRiseOverSet = (await partIds(h)).length;

  let second = -1;
  const secondClear = await refusesPlacement(async () => {
    second = await placeRise(h, 1, CLEAR, 0);
  });

  await h.advance(1);
  await captureStill(h, "overlap");

  assertEqual(
    setOverSigil,
    true,
    "a set whose footprint covers a transforming sigil's hex is refused",
  );
  assertEqual(afterSetOverSigil, 1, "that refusal added no part");
  assertEqual(
    riseOverSigil,
    true,
    "a rise whose footprint covers a transforming sigil's anchor is refused",
  );
  assertEqual(afterRiseOverSigil, 1, "that refusal added no part either");

  assertEqual(riseClear, false, "a rise clear of every footprint is placed");
  assertEqual(
    riseOverRise,
    true,
    "a rise whose footprint covers another rise's hex is refused",
  );
  assertEqual(afterRiseOverRise, 2, "that refusal added no part");

  assertEqual(setClear, false, "a set clear of every footprint is placed");
  assertEqual(
    riseOverSet,
    true,
    "a rise whose footprint covers a set's hex is refused",
  );
  assertEqual(afterRiseOverSet, 3, "that refusal added no part");

  assertEqual(
    secondClear,
    false,
    "the second rise is placed where no footprint reaches",
  );

  const snapshot = await h.snapshot();
  assertEqual(partById(snapshot, bind)?.kind, "bind", "the sigil still stands");
  assertEqual(
    partById(snapshot, rise)?.kind,
    "rise",
    "the first rise still stands",
  );
  assertEqual(partById(snapshot, product)?.kind, "set", "the set still stands");
  assertEqual(
    partById(snapshot, second)?.kind,
    "rise",
    "the second rise stands clear",
  );
  assertEqual(
    (await partIds(h)).length,
    4,
    "the machine holds the four accepted parts and none of the refused ones",
  );
});
