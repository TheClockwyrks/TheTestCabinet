// campaign/reference-solution-places-every-set — every reference solution puts a
// set on every one of its challenge's products.
//
// THE RULE. Every challenge of the course "is solvable: the build ships a
// reference solution for it, in the solution format, that is legal, places every
// rise and set, and whose run completes without faulting"
// (`specs/modes/campaign.md`, The course). "The tray derives one `rise` per
// reagent and one `set` per product" (`specs/formats.md`, Challenges), so the
// sets a challenge HAS are one per product, indexed from `0`, and placing every
// set is placing all of them.
//
// WHY IT MATTERS. Completion is read off the sets: "After the rises, if every
// set's tally has reached the challenge's `target`, the run completes ... A run
// whose machine holds no set never completes" (`specs/simulation.md`, Completion
// and metrics). A reference missing a product's set is a reference that delivers
// one of the challenge's two demanded products and never has to deliver the
// other.
//
// WHAT IS COUNTED. The sets of the DOCUMENT, by their `index` key, against the
// challenge's own product count as the editor reports it. "Each `set` is placed
// at most once" is placement rule 5 of `specs/parts.md` and is
// `reference-solution-is-legal`'s to decide, so what this reads is coverage: one
// set per product, and every product index among them.
//
// THE VERDICT, for every challenge of the course: the reference solution's sets
// number exactly as many as the challenge's products, and their indices are
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

it("places one set per product, covering every product, in every challenge", async () => {
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
    await captureStill(h, "sets");

    const sets = (document.parts ?? [])
      .filter((part) => part.kind === "set")
      .map((part) => part.index)
      .sort((a, b) => (a ?? -1) - (b ?? -1));
    assertDeepEqual(
      sets,
      view.products.map((_unused, n) => n),
      `campaign challenge ${index + 1}'s reference solution places one set per product, covering every one of its ${view.products.length} product indices`,
    );
    assertTrue(
      view.products.length > 0,
      `campaign challenge ${index + 1} carries a product for its reference to place a set on`,
    );
  }
});
