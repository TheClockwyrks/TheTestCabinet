// campaign/course-molecules-connected — every molecule pattern of the course is
// one connected constellation.
//
// THE RULE, from `specs/formats.md`, Molecules: "`filaments` lists the links.
// Each joins two distinct mote hexes of this molecule that are adjacent,
// `weight` is `1` or `3`, and no pair appears twice. The list may be empty. Every
// molecule pattern is connected: its motes and filaments form one constellation,
// so a one-mote pattern carries no filament and every larger pattern carries
// enough to join every mote." Every challenge of the campaign "is well formed
// under `specs/formats.md`" (`specs/modes/campaign.md`, The course).
//
// WHY CONNECTEDNESS MATTERS TO PLAY. A set "accepts" a constellation, and a
// constellation is one connected body of motes (`specs/field.md`), so a product
// pattern in two pieces is a product no machine can ever deliver. The rule is
// what keeps the course solvable at all.
//
// THE POSE. Each challenge of the course opened in the editor in turn, and every
// molecule of both lists read out of the reported document.
//
// THE VERDICT, over every reagent and every product of every challenge. Each
// filament joins two distinct, adjacent hexes that are both mote hexes of that
// same pattern; its weight is `1` or `3`; no pair of hexes carries two filaments;
// and walking the filaments from any one mote reaches every mote of the pattern.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertNotNull,
  assertTrue,
} from "../assert";
import { FILAMENT_WEIGHTS } from "../constants";
import { adjacent, sameHex, type Hex } from "../field";
import type { Molecule } from "../formats";
import {
  captureStill,
  createHarness,
  openChallenge,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** How many of a pattern's motes the filaments reach from its first one. */
function reachedFromTheFirst(molecule: Molecule): number {
  const key = (hex: Hex): string => `${hex.q},${hex.r}`;
  const first = molecule.motes[0];
  if (first === undefined) return 0;
  const seen = new Set<string>([key(first)]);
  const queue: string[] = [key(first)];
  while (queue.length > 0) {
    const here = queue.shift() as string;
    for (const filament of molecule.filaments) {
      const a = key(filament.a);
      const b = key(filament.b);
      const other = a === here ? b : b === here ? a : null;
      if (other !== null && !seen.has(other)) {
        seen.add(other);
        queue.push(other);
      }
    }
  }
  return seen.size;
}

it("joins every molecule of the course into one constellation", async () => {
  const count = (await h.snapshot()).campaign.count;
  assertGreaterThan(count, 0, "the campaign ships a course to read");

  for (let index = 0; index < count; index += 1) {
    await openChallenge(h, "campaign", index);
    await captureStill(h, "challenge");

    const view = (await h.snapshot()).challenge;
    assertNotNull(view, `campaign challenge ${index + 1} opens in the editor`);
    if (view === null) return;

    const at = `campaign challenge ${index + 1}`;
    const molecules: [string, Molecule][] = [
      ...view.reagents.map((molecule, n): [string, Molecule] => [
        `${at}'s reagent ${n}`,
        molecule,
      ]),
      ...view.products.map((molecule, n): [string, Molecule] => [
        `${at}'s product ${n}`,
        molecule,
      ]),
    ];

    for (const [where, molecule] of molecules) {
      const holds = (hex: Hex): boolean =>
        molecule.motes.some((entry) => entry.q === hex.q && entry.r === hex.r);

      for (const filament of molecule.filaments) {
        const pair = `(${filament.a.q}, ${filament.a.r})-(${filament.b.q}, ${filament.b.r})`;
        assertTrue(
          holds(filament.a) && holds(filament.b),
          `${where}'s filament ${pair} joins two mote hexes of that same molecule`,
        );
        assertTrue(
          !sameHex(filament.a, filament.b),
          `${where}'s filament ${pair} joins two DISTINCT hexes`,
        );
        assertTrue(
          adjacent(filament.a, filament.b),
          `${where}'s filament ${pair} joins two ADJACENT hexes`,
        );
        assertTrue(
          (FILAMENT_WEIGHTS as readonly number[]).includes(filament.weight),
          `${where}'s filament ${pair} carries weight 1 or 3, not ${filament.weight}`,
        );
      }

      const pairs = molecule.filaments.map((filament) => {
        const ends = [
          `${filament.a.q},${filament.a.r}`,
          `${filament.b.q},${filament.b.r}`,
        ].sort();
        return ends.join("|");
      });
      assertEqual(
        new Set(pairs).size,
        pairs.length,
        `no pair of ${where}'s motes appears twice in its filaments`,
      );

      assertEqual(
        reachedFromTheFirst(molecule),
        molecule.motes.length,
        `${where}'s motes and filaments form ONE constellation, so its filaments reach every one of its ${molecule.motes.length} motes`,
      );
    }
  }
});
