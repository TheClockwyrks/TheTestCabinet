// campaign/reference-solution-per-challenge — every challenge of the course ships
// a reference solution.
//
// THE RULE. Every challenge of the course "is solvable: the build ships a
// reference solution for it, in the solution format, that is legal, places every
// rise and set, and whose run completes without faulting within
// `CAMPAIGN_REFERENCE_CYCLES` (`600`) cycles of the run's start. The reference
// solutions are part of the build and are reachable only through the surface
// `specs/instrumentation.md` defines" (`specs/modes/campaign.md`, The course).
//
// WHERE ONE IS REACHED. "`referenceSolution(mode, index)` | A pure read: the
// build's own reference solution for that challenge, as a solution document,
// whatever is unlocked or solved. `specs/modes/campaign.md` and
// `specs/modes/extras.md` require one per challenge; this is where they are
// reachable" (`specs/instrumentation.md`).
//
// WHAT THIS DECIDES, AND WHAT IT LEAVES ALONE. That there IS one for every index
// of the course, and that it is a solution document — an object carrying a
// `parts` list (`specs/formats.md`, Solutions). Whether it is legal, whether it
// places the rises and the sets, and whether its run completes are the four
// requirements after this one; this is the one that says a build cannot ship a
// course with a hole in it.
//
// A READ IS A PURE READ, so nothing is posed for it beyond a fresh session: the
// document comes back "whatever is unlocked or solved". The picture is the
// opener's reference machine standing in the editor, loaded only when its
// document is one the placement rules of `specs/parts.md` admit — whether they do
// is `reference-solution-is-legal`'s point and must not be decided here.
//
// THE VERDICT. `referenceSolution("campaign", index)` answers, for every index of
// the course, a document that is neither `null` nor `undefined` and whose `parts`
// is a list. A call that threw instead has failed the point where it stands.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertNotNull, assertTrue } from "../assert";
import { type Solution, solutionFault, solutionLegalFor } from "../formats";
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

it("answers a solution document for every index of the course", async () => {
  const count = (await h.snapshot()).campaign.count;
  assertGreaterThan(count, 0, "the campaign ships a course to read");

  const answered: (Solution | null | undefined)[] = [];
  for (let index = 0; index < count; index += 1) {
    answered.push(await referenceSolution(h, "campaign", index));
  }

  const opener = answered[0] ?? null;
  await openChallenge(h, "campaign", 0);
  if (opener !== null) {
    const view = (await h.snapshot()).challenge;
    const placeable =
      view !== null &&
      Array.isArray(opener.parts) &&
      solutionFault(opener) === null &&
      solutionLegalFor(opener, view) &&
      placementFault(opener.parts, view) === null;
    if (placeable) await loadMachine(h, opener);
  }
  await h.advance(1);
  await captureStill(h, "solution");

  for (const [index, document] of answered.entries()) {
    const at = `campaign challenge ${index + 1}`;
    assertNotNull(
      document ?? null,
      `${at} ships a reference solution, so referenceSolution answers a document rather than nothing`,
    );
    assertTrue(
      document !== null &&
        document !== undefined &&
        Array.isArray(document.parts),
      `${at}'s reference solution is a solution document, which carries a parts list`,
    );
  }
});
