// extras/references-place-every-set — every Extra's reference solution puts a set
// on every one of that challenge's products.
//
// THE RULE. "Every Extras challenge ships a reference solution under the
// requirement `specs/modes/campaign.md` states for a course challenge"
// (`specs/modes/extras.md`, The shelf), and that requirement asks for one that
// "places every rise and set" (`specs/modes/campaign.md`, The course). Which sets
// a challenge HAS is fixed by `specs/formats.md`, Challenges: "The tray derives
// one `rise` per reagent and one `set` per product" — so they are one per
// product, named by `index`, "which reagent or product, from `0`", and placing
// every set is placing all of them.
//
// WHY IT MATTERS. Completion is read off the sets: "After the rises, if every
// set's tally has reached the challenge's `target`, the run completes ... A run
// whose machine holds no set never completes" (`specs/simulation.md`, Completion
// and metrics). A reference missing a product's set is a reference that never has
// to deliver that product at all, so the row it belongs to would be shipped
// unsolved by its own answer.
//
// WHAT IS COUNTED. The sets of the DOCUMENT, by their `index` key, against the
// product count the editor reports for that challenge. That each set is placed at
// most once is a placement rule of `specs/parts.md` and belongs to
// `references-legal`; what this reads is COVERAGE — as many sets as products, and
// every product index among them.
//
// THE VERDICT, for each of the ten Extras: its reference solution's set indices
// are exactly `0` to one less than its product count.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertNotNull,
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

it("places one set per product, covering every product, on all ten Extras", async () => {
  assertEqual(
    (await h.snapshot()).extras.count,
    EXTRA_COUNT,
    "the Extras shelf holds the ten challenges a reference is required for",
  );

  for (let index = 0; index < EXTRA_COUNT; index += 1) {
    const at = `Extras ${index + 1}`;
    const document = await referenceSolution(h, "extras", index);
    await openChallenge(h, "extras", index);
    const view = (await h.snapshot()).challenge;

    assertNotNull(view, `${at} opens in the editor`);
    assertNotNull(document ?? null, `${at} ships a reference solution`);
    if (view === null || document === null || document === undefined) return;

    // The picture alone: whether the document is placeable is another point's.
    const placeable =
      Array.isArray(document.parts) &&
      solutionFault(document) === null &&
      solutionLegalFor(document, view) &&
      placementFault(document.parts, view) === null;
    if (placeable) await loadMachine(h, document);
    await h.advance(1);
    await captureStill(h, "every-set");

    assertGreaterThan(
      view.products.length,
      0,
      `${at} carries a product for its reference to place a set on`,
    );
    const sets = (document.parts ?? [])
      .filter((part) => part.kind === "set")
      .map((part) => part.index)
      .sort((a, b) => (a ?? -1) - (b ?? -1));
    assertDeepEqual(
      sets,
      view.products.map((_unused, n) => n),
      `${at}'s reference solution places one set per product, covering every one of its ${view.products.length} product indices`,
    );
  }
});
