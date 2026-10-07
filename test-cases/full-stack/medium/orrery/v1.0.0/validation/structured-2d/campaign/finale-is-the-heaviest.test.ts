// campaign/finale-is-the-heaviest — the last challenge asks for more parts than
// any before it.
//
// THE RULE. "The last challenge of the course asks for more parts and a longer
// tape than any before it" (`specs/modes/campaign.md`, Course design). The parts
// half is this point's; the tape half is `finale-carries-the-longest-tape`'s.
//
// MORE THAN ANY, WHICH IS STRICTLY MORE. "More parts ... than any before it"
// makes the finale the single heaviest machine of the course, so a finale tying
// with an earlier challenge has not asked for more than it. That is a stronger
// statement than the rising ladder of `part-count-never-drops-across-two`, which
// compares each challenge with the one two places back and permits ties
// throughout; this one is about the last challenge being the summit.
//
// WHAT COUNTS AS A PART. The entries of the solution document's `parts` list,
// rises and sets included, since both are kinds of `PARTS` and both are placed
// like anything else (`specs/formats.md`, Solutions). The reference solution is
// what says what a challenge asks for: it is the answer the build itself puts
// forward.
//
// THE POSE. Every reference solution of the course read off the surface, then the
// FINALE's machine put into the editor for the picture — the machine the
// comparison is about — when the placement rules of `specs/parts.md` admit it,
// which is `reference-solution-is-legal`'s point rather than this one's.
//
// THE VERDICT. The last challenge's reference solution places strictly more parts
// than every earlier challenge's.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertNotNull, assertTrue } from "../assert";
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

it("makes the finale's machine the heaviest of the course", async () => {
  const count = (await h.snapshot()).campaign.count;
  assertGreaterThan(count, 0, "the campaign ships a course to read");
  const last = count - 1;

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

  const finale = documents[last] as Solution;
  await openChallenge(h, "campaign", last);
  const view = (await h.snapshot()).challenge;
  // The picture alone: whether the document is placeable is another point's.
  const placeable =
    view !== null &&
    solutionFault(finale) === null &&
    solutionLegalFor(finale, view) &&
    placementFault(finale.parts, view) === null;
  if (placeable) await loadMachine(h, finale);
  await h.advance(1);
  await captureStill(h, "finale");

  for (let index = 0; index < last; index += 1) {
    assertGreaterThan(
      finale.parts.length,
      (documents[index] as Solution).parts.length,
      `the last challenge of the course, challenge ${count}, asks for more parts than challenge ${index + 1}`,
    );
  }
});
