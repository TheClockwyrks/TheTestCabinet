// campaign/course-repeat-well-formed — every repeating product of the course
// carries a well-formed repeat.
//
// THE RULE, from `specs/formats.md`, Molecules: a repeat's "`vector` is a
// non-zero hex offset, and `link` names the filament joining each copy to the
// next: `a` is a mote hex of the pattern, `b` minus `vector` is a mote hex of the
// pattern, and `a` and `b` are adjacent. `link`'s `weight` is `1` or `3` like any
// filament, and the pattern and the pattern translated once by `vector` share no
// hex." Every challenge of the campaign "is well formed under
// `specs/formats.md`" (`specs/modes/campaign.md`, The course).
//
// WHAT EACH CLAUSE BUYS. A zero vector would stack every copy on the last; a link
// whose ends are not a pattern hex and the matching hex of the next copy joins
// nothing; a non-adjacent pair is not a filament at all (`specs/field.md` joins
// adjacent motes); and patterns that overlapped their own translate could never
// be laid end to end on the field.
//
// THE POSE. The whole course read out of the editor, then the first repeating
// product's SET placed on the field for the picture, at an anchor whose whole
// footprint — "the pattern plus, when the product repeats, the pattern translated
// once by the repeat vector" (`specs/parts.md`, Rises and sets) — lies on the
// field, which is placement rule 1 and the only rule a lone set can break. A
// course with no repeating product anywhere satisfies this requirement vacuously
// and is pictured at its first challenge.
//
// THE VERDICT, over every repeat any product of the course carries: the six
// clauses above, read off the shipped document.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertNotNull, assertTrue } from "../assert";
import { FILAMENT_WEIGHTS } from "../constants";
import { adjacent, at, fieldHexes, onField, type Hex } from "../field";
import type { Molecule } from "../formats";
import { setFootprint } from "../parts";
import {
  captureStill,
  createHarness,
  openChallenge,
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

/** Whether a molecule carries a repeat, absent and `null` reading alike. */
function repeats(molecule: Molecule): boolean {
  return (molecule.repeat ?? null) !== null;
}

/** The first anchor at rotation `0` putting a set's whole footprint on the field. */
function anchorOnField(product: Molecule): Hex | null {
  for (const anchor of fieldHexes()) {
    if (setFootprint(product, anchor, 0).every((hex) => onField(hex))) {
      return anchor;
    }
  }
  return null;
}

it("carries a well-formed repeat on every repeating product of the course", async () => {
  const count = (await h.snapshot()).campaign.count;
  assertGreaterThan(count, 0, "the campaign ships a course to read");

  const repeating: [string, Molecule][] = [];
  let pictured: { challenge: number; product: number } | null = null;
  for (let index = 0; index < count; index += 1) {
    await openChallenge(h, "campaign", index);
    const view = (await h.snapshot()).challenge;
    assertNotNull(view, `campaign challenge ${index + 1} opens in the editor`);
    if (view === null) return;
    for (const [n, molecule] of view.products.entries()) {
      if (!repeats(molecule)) continue;
      repeating.push([
        `campaign challenge ${index + 1}'s product ${n}`,
        molecule,
      ]);
      if (pictured === null) pictured = { challenge: index, product: n };
    }
  }

  await openChallenge(h, "campaign", pictured?.challenge ?? 0);
  if (pictured !== null) {
    const view = (await h.snapshot()).challenge;
    const product = view?.products[pictured.product];
    const anchor = product === undefined ? null : anchorOnField(product);
    if (anchor !== null) {
      await placeSet(h, pictured.product, anchor);
      await h.advance(1);
    }
  }
  await captureStill(h, "repeat");

  for (const [where, molecule] of repeating) {
    const repeat = molecule.repeat;
    if (repeat === undefined || repeat === null) continue;
    const holds = (hex: Hex): boolean =>
      molecule.motes.some((entry) => entry.q === hex.q && entry.r === hex.r);

    assertTrue(
      !(repeat.vector.q === 0 && repeat.vector.r === 0),
      `${where}'s repeat vector is a NON-ZERO hex offset`,
    );
    assertTrue(
      holds(repeat.link.a),
      `${where}'s repeat link a (${repeat.link.a.q}, ${repeat.link.a.r}) is a mote hex of the pattern`,
    );
    assertTrue(
      holds(
        at(
          repeat.link.b.q - repeat.vector.q,
          repeat.link.b.r - repeat.vector.r,
        ),
      ),
      `${where}'s repeat link b minus the vector is a mote hex of the pattern`,
    );
    assertTrue(
      adjacent(repeat.link.a, repeat.link.b),
      `${where}'s repeat link joins two ADJACENT hexes`,
    );
    assertTrue(
      (FILAMENT_WEIGHTS as readonly number[]).includes(repeat.link.weight),
      `${where}'s repeat link carries weight 1 or 3, not ${repeat.link.weight}`,
    );
    const shifted = molecule.motes.map((entry) =>
      at(entry.q + repeat.vector.q, entry.r + repeat.vector.r),
    );
    assertTrue(
      !shifted.some((hex) => holds(hex)),
      `${where}'s pattern and its translate by the repeat vector share no hex`,
    );
  }
});
