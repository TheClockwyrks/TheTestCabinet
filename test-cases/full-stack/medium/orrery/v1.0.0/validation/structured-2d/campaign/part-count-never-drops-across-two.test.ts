// campaign/part-count-never-drops-across-two — the ladder never steps back down.
//
// THE RULE. "Difficulty rises across the course ... no challenge's reference
// solution places fewer parts than the reference solution two challenges before
// it" (`specs/modes/campaign.md`, The course).
//
// WHY TWO AND NOT ONE. The rule deliberately allows a dip between neighbours: a
// course is free to follow a big machine with a smaller one that teaches
// something new, so long as the TREND holds. Comparing each challenge with the
// one two places back is what makes that a rising course rather than a sawtooth
// — every other rung of the ladder is at least as high as the one below it, on
// both of the two interleaved ladders.
//
// WHAT COUNTS AS A PART. The entries of the solution document's `parts` list,
// rises and sets included, since both are kinds of `PARTS` and both are placed
// like anything else (`specs/formats.md`, Solutions).
//
// THE POSE. Every reference solution of the course read off the surface, then
// each comparison made in course order with the LATER of its two machines
// standing in the editor, so the picture a failure leaves behind is the machine
// that came up short. It is loaded only when the placement rules of
// `specs/parts.md` admit it — whether they do is `reference-solution-is-legal`'s
// point and is not decided here.
//
// A COURSE OF FEWER THAN THREE CHALLENGES constrains nothing here, and how long
// the course must be is `course-within-bounds`'s point rather than this one's.
//
// THE VERDICT. For every challenge from the third on, its reference solution
// places at least as many parts as the reference solution two challenges before
// it.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertNotNull,
  assertTrue,
} from "../assert";
import { solutionFault, solutionLegalFor, type Solution } from "../formats";
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

it("never places fewer parts than the challenge two places before", async () => {
  const count = (await h.snapshot()).campaign.count;
  assertGreaterThan(count, 0, "the campaign ships a course to read");

  const documents: Solution[] = [];
  for (let index = 0; index < count; index += 1) {
    const document = await referenceSolution(h, "campaign", index);
    assertNotNull(
      document ?? null,
      `campaign challenge ${index + 1} ships a reference solution`,
    );
    assertTrue(
      document !== null && Array.isArray(document.parts),
      `campaign challenge ${index + 1}'s reference solution carries a parts list`,
    );
    if (document === null || !Array.isArray(document.parts)) return;
    documents.push(document);
  }

  for (let index = 2; index < count; index += 1) {
    const later = documents[index] as Solution;
    const earlier = documents[index - 2] as Solution;

    await openChallenge(h, "campaign", index);
    const view = (await h.snapshot()).challenge;
    // The picture alone: whether the document is placeable is another point's.
    const placeable =
      view !== null &&
      solutionFault(later) === null &&
      solutionLegalFor(later, view) &&
      placementFault(later.parts, view) === null;
    if (placeable) await loadMachine(h, later);
    await h.advance(1);
    await captureStill(h, "ladder");

    assertGreaterThanOrEqual(
      later.parts.length,
      earlier.parts.length,
      `campaign challenge ${index + 1}'s reference solution places at least as many parts as challenge ${index - 1}'s, two challenges before it`,
    );
  }
});
