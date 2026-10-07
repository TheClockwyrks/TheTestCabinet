// campaign/course-molecules-well-formed — every reagent and every product of the
// course is a well-formed molecule.
//
// THE RULE, from `specs/formats.md`. Of a challenge: "`reagents` and `products`
// are non-empty lists of molecules." Of a molecule: "`motes` is non-empty. Each
// entry places one mote type at `(q, r)`, and no two entries share a hex. `type`
// is any member of `MOTES` in `specs/field.md`." Every challenge of the campaign
// "is well formed under `specs/formats.md`" (`specs/modes/campaign.md`, The
// course), so the course's own documents answer to those sentences.
//
// WHAT THIS DECIDES, AND WHAT IT LEAVES ALONE. The three things a molecule's
// MOTES list must be: there, on distinct hexes, and of known types — plus the two
// lists being there at all. A pattern's filaments and its connectedness are the
// next requirement's, and a repeat is the two after that.
//
// THE POSE. Each challenge of the course opened in the editor in turn. The
// editor's `challenge` reports `reagents` and `products` "exactly [in] the
// formats of `specs/formats.md`" (`specs/instrumentation.md`, Snapshot shape),
// so what is read is the shipped document itself.
//
// THE VERDICT. Both lists are non-empty in every challenge, and every molecule in
// them carries at least one mote, no two motes on one hex, and no type outside
// `MOTES`.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertContains,
  assertGreaterThan,
  assertNotNull,
  assertTrue,
} from "../assert";
import { MOTES } from "../constants";
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

/** Whether two mote entries of one pattern stand on one hex. */
function sharesAHex(molecule: Molecule): boolean {
  const seen = new Set<string>();
  for (const entry of molecule.motes) {
    const key = `${entry.q},${entry.r}`;
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}

it("carries a well-formed molecule for every reagent and every product", async () => {
  const count = (await h.snapshot()).campaign.count;
  assertGreaterThan(count, 0, "the campaign ships a course to read");

  for (let index = 0; index < count; index += 1) {
    await openChallenge(h, "campaign", index);
    await captureStill(h, "challenge");

    const view = (await h.snapshot()).challenge;
    assertNotNull(view, `campaign challenge ${index + 1} opens in the editor`);
    if (view === null) return;

    const at = `campaign challenge ${index + 1}`;
    assertGreaterThan(
      view.reagents.length,
      0,
      `${at} carries a non-empty reagents list`,
    );
    assertGreaterThan(
      view.products.length,
      0,
      `${at} carries a non-empty products list`,
    );

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
      assertGreaterThan(
        molecule.motes.length,
        0,
        `${where} carries a non-empty motes list`,
      );
      assertTrue(
        !sharesAHex(molecule),
        `no two of ${where}'s mote entries share a hex`,
      );
      for (const entry of molecule.motes) {
        assertContains(
          MOTES as readonly string[],
          entry.type,
          `${where}'s mote on (${entry.q}, ${entry.r}) carries a type of MOTES`,
        );
      }
    }
  }
});
