// extras/references-legal — every Extra's reference solution is a legal machine
// for its own challenge.
//
// THE RULE. "Every Extras challenge ships a reference solution under the
// requirement `specs/modes/campaign.md` states for a course challenge"
// (`specs/modes/extras.md`, The shelf), and that requirement asks for one "that
// is legal" (`specs/modes/campaign.md`, The course). What legal means is
// `specs/formats.md`, Solutions: "A solution is legal for a challenge when every
// part is a permitted kind or a rise or set the challenge derives, every
// placement rule of `specs/parts.md` holds across the whole list, and every rise
// and set index exists."
//
// THE THREE CLAUSES, each read off the DOCUMENT against the challenge the editor
// reports for that row:
//
//   - THE KINDS. Every part is one of the challenge's own `permitted` kinds, or a
//     `rise` or a `set` — "the tray derives one `rise` per reagent and one `set`
//     per product" (`specs/formats.md`, Challenges), so those two are available
//     without being permitted and nothing else is.
//   - THE INDICES. Every rise's and every set's `index`, "which reagent or
//     product, from `0`", names a reagent or product the challenge actually
//     holds.
//   - THE PLACEMENT RULES of `specs/parts.md`, all of them, "across the whole
//     list" — so a machine legal part by part and overlapping as a whole is
//     caught rather than waved through.
//
// WHY THE DOCUMENT AND NOT THE LOAD. That `loadSolution` accepts the document is
// `references-present-for-all-ten`'s reading, and it is the build judging its own
// machine. This one judges it against the specification's rules, computed here,
// so a build whose placement rules are too permissive is caught by the same
// reading that catches a reference that breaks them.
//
// THE PICTURE is a reference machine standing on the field, loaded before any
// assertion runs and only where the document is one the rules admit — whether
// they admit it is precisely this item's verdict, so the load is evidence and
// never the check.
//
// THE VERDICT, for each of the ten Extras: its reference solution is legal for
// its own challenge under all three clauses.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertNotNull,
  assertTrue,
} from "../assert";
import { EXTRA_COUNT } from "../constants";
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

it("ships a legal machine for every one of the ten Extras", async () => {
  assertEqual(
    (await h.snapshot()).extras.count,
    EXTRA_COUNT,
    "the Extras shelf holds the ten challenges a reference is required for",
  );

  for (let index = 0; index < EXTRA_COUNT; index += 1) {
    const at = `Extras ${index + 1}'s reference solution`;
    const document = await referenceSolution(h, "extras", index);
    await openChallenge(h, "extras", index);
    const view = (await h.snapshot()).challenge;

    assertNotNull(view, `Extras ${index + 1} opens in the editor`);
    assertNotNull(document ?? null, `${at} is a document`);
    if (view === null || document === null || document === undefined) return;
    assertTrue(Array.isArray(document.parts), `${at} carries a parts list`);

    // The picture alone: a document the rules refuse is not loaded, because
    // whether they refuse it is the verdict below.
    const placeable =
      solutionFault(document) === null &&
      solutionLegalFor(document, view) &&
      placementFault(document.parts, view) === null;
    if (placeable) await loadMachine(h, document);
    await h.advance(1);
    await captureStill(h, "loaded");

    assertTrue(
      solutionLegalFor(document, view),
      `every part of ${at} is a kind the challenge permits, or a rise or set whose index the challenge holds`,
    );
    assertEqual(
      placementFault(document.parts, view),
      null,
      `every placement rule of specs/parts.md holds across the whole of ${at}`,
    );
  }
});
