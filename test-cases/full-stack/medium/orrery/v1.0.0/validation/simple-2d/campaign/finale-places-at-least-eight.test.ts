// campaign/finale-places-at-least-eight — the course ends with a large machine.
//
// THE RULE. "Difficulty rises across the course ... the reference solution for
// the last challenge places at least `CAMPAIGN_FINALE_PARTS` (`8`) parts"
// (`specs/modes/campaign.md`, The course). It is the far end of the same ladder
// the opener's bound starts: a course whose last challenge is answered by four
// parts has not risen anywhere, whatever its middle looks like.
//
// WHICH CHALLENGE IS THE LAST. The one at index `campaign.count - 1`, since
// `campaign.count` is "how many challenges the shipped course holds"
// (`specs/instrumentation.md`) and the course is "in a fixed order, numbered
// from `1`" (`specs/modes/campaign.md`). Nothing here assumes how long the course
// is: that is `course-within-bounds`'s point.
//
// WHAT COUNTS AS A PART. The entries of the solution document's `parts` list,
// rises and sets included, since both are kinds of `PARTS` and both are placed
// like anything else (`specs/formats.md`, Solutions).
//
// THE POSE. The finale's own reference solution read off the surface, and put
// into the editor for the picture when the placement rules of `specs/parts.md`
// admit it — whether they do is `reference-solution-is-legal`'s point and is not
// decided here.
//
// THE VERDICT. The reference solution for the last challenge of the course places
// at least `CAMPAIGN_FINALE_PARTS` parts.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertNotNull,
  assertTrue,
} from "../assert";
import { CAMPAIGN_FINALE_PARTS } from "../constants";
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

it("answers the last challenge with at least CAMPAIGN_FINALE_PARTS parts", async () => {
  const count = (await h.snapshot()).campaign.count;
  assertGreaterThan(count, 0, "the campaign ships a course to read");
  const last = count - 1;

  const document = await referenceSolution(h, "campaign", last);
  await openChallenge(h, "campaign", last);
  const view = (await h.snapshot()).challenge;
  assertNotNull(
    document ?? null,
    `campaign challenge ${count} ships a reference solution`,
  );
  assertTrue(
    document !== null && Array.isArray(document.parts),
    `campaign challenge ${count}'s reference solution carries a parts list`,
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
  await captureStill(h, "finale");

  assertGreaterThanOrEqual(
    document.parts.length,
    CAMPAIGN_FINALE_PARTS,
    `the reference solution for the last challenge of the course, challenge ${count}, places at least CAMPAIGN_FINALE_PARTS parts`,
  );
});
