// campaign/reference-solution-is-legal — every reference solution of the course is
// a legal machine for its own challenge.
//
// THE RULE. Every challenge of the course "is solvable: the build ships a
// reference solution for it, in the solution format, that is legal"
// (`specs/modes/campaign.md`, The course), and what legal means is
// `specs/formats.md`, Solutions: "A solution is legal for a challenge when every
// part is a permitted kind or a rise or set the challenge derives, every
// placement rule of `specs/parts.md` holds across the whole list, and every rise
// and set index exists."
//
// THE THREE READINGS, and each is one clause of that sentence.
//
//   - THE DOCUMENT'S SHAPE, from the table under Solutions: which keys each class
//     carries, a `rotation` of `0` to `5`, a track's `cells` and no anchor, an
//     `index` on a rise and a set, and a tape whose entries are `INSTRUCTIONS`
//     names or blanks and whose last entry is an instruction.
//   - THE KINDS AND THE INDICES: every part is a kind the challenge permits, or a
//     rise or set whose index the challenge's own reagents and products carry.
//   - THE PLACEMENT RULES of `specs/parts.md`, all six, "across the whole list" —
//     so a machine legal part by part and overlapping as a whole is caught.
//
// THEN THE MACHINE IS LOADED, because the requirement is about a document a
// player's editor could hold: `loadSolution` "replaces the open challenge's
// machine with `solution` ... which is exactly the placements above applied in
// the order `parts` lists them", and each placement "throws an `Error` naming the
// first rule it breaks" (`specs/instrumentation.md`). So a legal document leaves
// every one of its parts standing, in the order it listed them —
// `editor.parts` is reported in "placement order" — and that is read back.
//
// THE VERDICT, for every challenge of the course: the three readings hold, and
// loading the document leaves exactly its parts, kind for kind, in its own order.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertNotNull,
  assertTrue,
} from "../assert";
import { solutionFault, solutionLegalFor } from "../formats";
import { placementFault } from "../parts";
import {
  captureStill,
  createHarness,
  loadMachine,
  openChallenge,
  referenceSolution,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("loads every reference solution of the course as the machine it states", async () => {
  const count = (await h.snapshot()).campaign.count;
  assertGreaterThan(count, 0, "the campaign ships a course to read");

  for (let index = 0; index < count; index += 1) {
    const document = await referenceSolution(h, "campaign", index);
    await openChallenge(h, "campaign", index);
    const view = (await h.snapshot()).challenge;
    assertNotNull(view, `campaign challenge ${index + 1} opens in the editor`);
    if (view === null) return;

    const at = `campaign challenge ${index + 1}'s reference solution`;
    assertNotNull(document ?? null, `${at} is a document`);
    assertTrue(
      document !== null && Array.isArray(document.parts),
      `${at} carries a parts list`,
    );
    if (document === null || !Array.isArray(document.parts)) return;

    assertEqual(
      solutionFault(document),
      null,
      `${at} is a well-formed solution document`,
    );
    assertTrue(
      solutionLegalFor(document, view),
      `every part of ${at} is a kind the challenge permits, or a rise or set whose index the challenge carries`,
    );
    assertEqual(
      placementFault(document.parts, view),
      null,
      `every placement rule of specs/parts.md holds across the whole of ${at}`,
    );

    await loadMachine(h, document);
    await h.advance(1);
    await captureStill(h, "machine");

    const placed = (await h.snapshot()).editor.parts;
    assertDeepEqual(
      placed.map((part) => part.kind),
      document.parts.map((part) => part.kind),
      `loading ${at} leaves every one of its parts placed, in the order the document lists them`,
    );
  }
});
