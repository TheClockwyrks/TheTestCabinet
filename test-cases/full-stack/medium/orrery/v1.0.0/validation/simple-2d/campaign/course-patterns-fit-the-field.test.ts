// campaign/course-patterns-fit-the-field — every reagent and every product of the
// course can be put on the field.
//
// THE RULE. "A challenge is well formed when all of the above hold and every
// pattern fits the field. Some placement of each reagent lies entirely on the
// field, and some placement of each product's footprint lies entirely on the
// field. A set's footprint is defined in `specs/parts.md`"
// (`specs/formats.md`, Challenges). Every challenge of the campaign "is well
// formed under `specs/formats.md`" (`specs/modes/campaign.md`, The course).
//
// WHAT A PLACEMENT IS. `specs/field.md` places a pattern at an anchor and a
// rotation, and `specs/parts.md` fixes the two footprints: a rise's is "the
// molecule pattern for a rise", and a set's is "the pattern plus, when the
// product repeats, the pattern translated once by the repeat vector". SOME
// placement is enough, so every anchor of the field and every one of the six
// rotations is a candidate, and the requirement is that at least one of them puts
// every hex of the footprint inside `max(|q|, |r|, |q + r|) <= FIELD_R`.
//
// WHY IT MATTERS. Placement rule 1 of `specs/parts.md` refuses a part any of
// whose hexes is off the field, so a pattern that fits nowhere is a rise or a set
// the player can never place — and a challenge that can never be solved.
//
// THE POSE. Every challenge of the course read out of the editor, then challenge
// `1`'s first reagent and first product placed as a rise and a set for the
// picture, at placements this check found and at hexes that do not overlap, so
// what the picture shows is the two apertures standing on the field.
//
// THE VERDICT. For every challenge, every reagent has a placement entirely on the
// field, and every product's footprint has one too.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertNotNull, assertTrue } from "../assert";
import { fieldHexes, onField, sameHex, type Hex } from "../field";
import type { Molecule } from "../formats";
import { riseFootprint, setFootprint } from "../parts";
import {
  captureStill,
  createHarness,
  openChallenge,
  placeRise,
  placeSet,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** One placement of a pattern: where it is anchored and how far it is turned. */
interface Placement {
  anchor: Hex;
  rotation: number;
}

/**
 * The first placement whose whole footprint lies on the field and avoids
 * `taken`, or `null` when the pattern fits nowhere that does.
 */
function fits(
  footprint: (anchor: Hex, rotation: number) => Hex[],
  taken: readonly Hex[] = [],
): Placement | null {
  for (const anchor of fieldHexes()) {
    for (let rotation = 0; rotation < 6; rotation += 1) {
      const hexes = footprint(anchor, rotation);
      const clear =
        hexes.every((hex) => onField(hex)) &&
        !hexes.some((hex) => taken.some((other) => sameHex(hex, other)));
      if (clear) return { anchor, rotation };
    }
  }
  return null;
}

const rise =
  (molecule: Molecule) =>
  (anchor: Hex, rotation: number): Hex[] =>
    riseFootprint(molecule, anchor, rotation);

const set =
  (molecule: Molecule) =>
  (anchor: Hex, rotation: number): Hex[] =>
    setFootprint(molecule, anchor, rotation);

it("fits every reagent and every product footprint somewhere on the field", async () => {
  const count = (await h.snapshot()).campaign.count;
  assertGreaterThan(count, 0, "the campaign ships a course to read");

  const measured: [string, Placement | null][] = [];
  for (let index = 0; index < count; index += 1) {
    await openChallenge(h, "campaign", index);
    const view = (await h.snapshot()).challenge;
    assertNotNull(view, `campaign challenge ${index + 1} opens in the editor`);
    if (view === null) return;
    const at = `campaign challenge ${index + 1}`;
    for (const [n, molecule] of view.reagents.entries()) {
      measured.push([`${at}'s reagent ${n}`, fits(rise(molecule))]);
    }
    for (const [n, molecule] of view.products.entries()) {
      measured.push([`${at}'s product ${n}`, fits(set(molecule))]);
    }
  }

  await openChallenge(h, "campaign", 0);
  const opener = (await h.snapshot()).challenge;
  const reagent = opener?.reagents[0];
  const product = opener?.products[0];
  const risePlacement = reagent === undefined ? null : fits(rise(reagent));
  if (reagent !== undefined && risePlacement !== null) {
    await placeRise(h, 0, risePlacement.anchor, risePlacement.rotation);
  }
  const taken =
    reagent === undefined || risePlacement === null
      ? []
      : riseFootprint(reagent, risePlacement.anchor, risePlacement.rotation);
  const setPlacement = product === undefined ? null : fits(set(product), taken);
  if (setPlacement !== null) {
    await placeSet(h, 0, setPlacement.anchor, setPlacement.rotation);
  }
  await h.advance(1);
  await captureStill(h, "placed");

  for (const [where, placement] of measured) {
    assertTrue(
      placement !== null,
      `${where} has some placement — some anchor and rotation of the field — whose whole footprint lies on the field`,
    );
  }
});
