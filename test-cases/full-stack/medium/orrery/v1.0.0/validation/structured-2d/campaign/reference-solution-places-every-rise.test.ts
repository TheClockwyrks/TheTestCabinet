// campaign/reference-solution-places-every-rise — every reference solution puts a
// rise on every one of its challenge's reagents.
//
// THE RULE. Every challenge of the course "is solvable: the build ships a
// reference solution for it, in the solution format, that is legal, places every
// rise and set, and whose run completes without faulting"
// (`specs/modes/campaign.md`, The course). "The tray derives one `rise` per
// reagent and one `set` per product" (`specs/formats.md`, Challenges), so the
// rises a challenge HAS are one per reagent, indexed from `0`, and placing every
// rise is placing all of them.
//
// WHY IT MATTERS. A rise is what puts a reagent on the field at all
// (`specs/parts.md`), so a machine missing one reagent's rise is a machine one of
// the challenge's inputs never reaches — and a run that could only complete if
// that input were never needed. This is the half of solvability that says the
// reference actually uses the puzzle it was written for.
//
// WHAT IS COUNTED. The rises of the DOCUMENT, by their `index` key, against the
// challenge's own reagent count as the editor reports it. "Each `rise` is placed
// at most once" is placement rule 5 of `specs/parts.md` and is
// `reference-solution-is-legal`'s to decide, so what this reads is coverage: one
// rise per reagent, and every reagent index among them.
//
// THE VERDICT, for every challenge of the course: the reference solution's rises
// number exactly as many as the challenge's reagents, and their indices are
// exactly `0` to one less than that.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
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

it("places one rise per reagent, covering every reagent, in every challenge", async () => {
  const count = (await h.snapshot()).campaign.count;
  assertGreaterThan(count, 0, "the campaign ships a course to read");

  for (let index = 0; index < count; index += 1) {
    const document = await referenceSolution(h, "campaign", index);
    await openChallenge(h, "campaign", index);
    const view = (await h.snapshot()).challenge;
    assertNotNull(view, `campaign challenge ${index + 1} opens in the editor`);
    assertNotNull(
      document ?? null,
      `campaign challenge ${index + 1} ships a reference solution`,
    );
    if (view === null || document === null) return;

    // The picture alone: whether the document is placeable is another point's.
    const placeable =
      Array.isArray(document.parts) &&
      solutionFault(document) === null &&
      solutionLegalFor(document, view) &&
      placementFault(document.parts, view) === null;
    if (placeable) await loadMachine(h, document);
    await h.advance(1);
    await captureStill(h, "rises");

    const rises = (document.parts ?? [])
      .filter((part) => part.kind === "rise")
      .map((part) => part.index)
      .sort((a, b) => (a ?? -1) - (b ?? -1));
    assertDeepEqual(
      rises,
      view.reagents.map((_unused, n) => n),
      `campaign challenge ${index + 1}'s reference solution places one rise per reagent, covering every one of its ${view.reagents.length} reagent indices`,
    );
    assertTrue(
      view.reagents.length > 0,
      `campaign challenge ${index + 1} carries a reagent for its reference to place a rise on`,
    );
  }
});
