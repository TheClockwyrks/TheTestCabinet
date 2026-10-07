// campaign/course-repeat-only-on-products — a repeat appears on a product and
// nowhere else.
//
// THE RULE. "`repeat` appears on repeating products alone, and is absent
// otherwise" (`specs/formats.md`, Molecules). A repeat is what makes a set accept
// a chain of copies rather than one pattern; a reagent is a thing a RISE spawns,
// one whole molecule at a time, and there is no reading under which a spawned
// reagent repeats. Every challenge of the campaign "is well formed under
// `specs/formats.md`" (`specs/modes/campaign.md`, The course), so the course's
// own reagents answer to it.
//
// ABSENT AND `null` ARE THE SAME THING. "A reader treats an absent `repeat` and a
// `repeat` of `null` alike" (`specs/formats.md`), so a reagent reported with
// `repeat: null` carries none, and only an actual repeat object breaks the rule.
//
// THE POSE. The whole course read out of the editor, then the first challenge
// that DOES carry a repeating product opened again for the picture — the evidence
// this point wants is a challenge where a repeat is legitimately present, beside
// reagents that carry none. A course with no repeating product anywhere is
// pictured at its first challenge instead.
//
// THE VERDICT. No reagent of any challenge of the course carries a repeat.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertNotNull, assertTrue } from "../assert";
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

/** Whether a molecule carries a repeat, absent and `null` reading alike. */
function repeats(molecule: Molecule): boolean {
  return (molecule.repeat ?? null) !== null;
}

it("carries no repeat on any reagent of the course", async () => {
  const count = (await h.snapshot()).campaign.count;
  assertGreaterThan(count, 0, "the campaign ships a course to read");

  const reagents: [string, Molecule][] = [];
  let pictured = 0;
  let found = false;
  for (let index = 0; index < count; index += 1) {
    await openChallenge(h, "campaign", index);
    const view = (await h.snapshot()).challenge;
    assertNotNull(view, `campaign challenge ${index + 1} opens in the editor`);
    if (view === null) return;
    for (const [n, molecule] of view.reagents.entries()) {
      reagents.push([
        `campaign challenge ${index + 1}'s reagent ${n}`,
        molecule,
      ]);
    }
    if (!found && view.products.some(repeats)) {
      pictured = index;
      found = true;
    }
  }

  await openChallenge(h, "campaign", pictured);
  await captureStill(h, "challenge");

  for (const [where, molecule] of reagents) {
    assertTrue(
      !repeats(molecule),
      `${where} carries no repeat: a repeat appears on repeating products alone`,
    );
  }
});
