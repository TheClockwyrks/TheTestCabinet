// campaign/opener-places-at-most-three — the course opens with a small machine.
//
// THE RULE. "Difficulty rises across the course. The reference solution for
// challenge `1` places at most `CAMPAIGN_OPENER_PARTS` (`3`) parts"
// (`specs/modes/campaign.md`, The course). Challenge `1` is the one challenge
// "unlocked from the start" (Progression), so it is the first machine anyone
// building this game ever builds, and the bound is what keeps it a first machine:
// three parts is a rise, a set, and one thing between them.
//
// WHAT COUNTS AS A PART. The entries of the solution document's `parts` list,
// which is where "the placed parts with their poses and tapes" live
// (`specs/formats.md`, Solutions) — rises and sets included, since both are kinds
// of `PARTS` and both are placed like anything else.
//
// THE POSE. The opener's own reference solution read off the surface, and put
// into the editor for the picture when the placement rules of `specs/parts.md`
// admit it — whether they do is `reference-solution-is-legal`'s point and is not
// decided here.
//
// THE VERDICT. The reference solution for campaign challenge `1` places at most
// `CAMPAIGN_OPENER_PARTS` parts.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertGreaterThan,
  assertLessThanOrEqual,
  assertNotNull,
  assertTrue,
} from "../assert";
import { CAMPAIGN_OPENER_PARTS } from "../constants";
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

it("answers challenge 1 with at most CAMPAIGN_OPENER_PARTS parts", async () => {
  const count = (await h.snapshot()).campaign.count;
  assertGreaterThan(count, 0, "the campaign ships a course to read");

  const document = await referenceSolution(h, "campaign", 0);
  await openChallenge(h, "campaign", 0);
  const view = (await h.snapshot()).challenge;
  assertNotNull(
    document ?? null,
    "campaign challenge 1 ships a reference solution",
  );
  assertTrue(
    document !== null && Array.isArray(document.parts),
    "campaign challenge 1's reference solution carries a parts list",
  );
  if (document === null || !Array.isArray(document.parts)) return;

  // The picture alone: whether the document is placeable is another point's.
  const placeable =
    view !== null &&
    solutionFault(document) === null &&
    solutionLegalFor(document, view) &&
    placementFault(document.parts, view) === null;
  if (placeable) await loadMachine(h, document);
  await h.advance(1);
  await captureStill(h, "opener");

  assertLessThanOrEqual(
    document.parts.length,
    CAMPAIGN_OPENER_PARTS,
    "the reference solution for campaign challenge 1 places at most CAMPAIGN_OPENER_PARTS parts",
  );
});
