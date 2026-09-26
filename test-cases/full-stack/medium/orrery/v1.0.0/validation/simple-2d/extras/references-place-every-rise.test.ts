// extras/references-place-every-rise — every Extra's reference solution puts a
// rise on every one of that challenge's reagents.
//
// THE RULE. "Every Extras challenge ships a reference solution under the
// requirement `specs/modes/campaign.md` states for a course challenge"
// (`specs/modes/extras.md`, The shelf), and that requirement asks for one that
// "places every rise and set" (`specs/modes/campaign.md`, The course). Which
// rises a challenge HAS is fixed by `specs/formats.md`, Challenges: "The tray
// derives one `rise` per reagent and one `set` per product" — so they are one per
// reagent, named by `index`, "which reagent or product, from `0`", and placing
// every rise is placing all of them.
//
// WHY IT MATTERS. A rise is what puts a reagent on the field at all, so a machine
// missing one reagent's rise is a machine one of the challenge's inputs never
// reaches. Two of the ten Extras carry more than one reagent — Ascendant's
// `mercury` and `saturn`, and Aetherfall's four — and they are exactly the rows
// where a reference could complete while quietly ignoring an input the challenge
// asked for.
//
// WHAT IS COUNTED. The rises of the DOCUMENT, by their `index` key, against the
// reagent count the editor reports for that challenge. That each rise is placed
// at most once is a placement rule of `specs/parts.md` and belongs to
// `references-legal`; what this reads is COVERAGE — as many rises as reagents,
// and every reagent index among them.
//
// THE VERDICT, for each of the ten Extras: its reference solution's rise indices
// are exactly `0` to one less than its reagent count.

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

it("places one rise per reagent, covering every reagent, on all ten Extras", async () => {
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
    await captureStill(h, "complete-machine");

    assertGreaterThan(
      view.reagents.length,
      0,
      `${at} carries a reagent for its reference to place a rise on`,
    );
    const rises = (document.parts ?? [])
      .filter((part) => part.kind === "rise")
      .map((part) => part.index)
      .sort((a, b) => (a ?? -1) - (b ?? -1));
    assertDeepEqual(
      rises,
      view.reagents.map((_unused, n) => n),
      `${at}'s reference solution places one rise per reagent, covering every one of its ${view.reagents.length} reagent indices`,
    );
  }
});
