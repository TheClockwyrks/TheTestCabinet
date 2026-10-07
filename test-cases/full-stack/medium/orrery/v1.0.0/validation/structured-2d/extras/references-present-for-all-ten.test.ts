// extras/references-present-for-all-ten — every Extra ships a reference solution,
// and every one of them is a document the editor will take.
//
// THE RULE. "Every Extras challenge ships a reference solution under the
// requirement `specs/modes/campaign.md` states for a course challenge, reachable
// through the surface `specs/instrumentation.md` defines"
// (`specs/modes/extras.md`, The shelf). That requirement: a challenge "is
// solvable: the build ships a reference solution for it, in the solution format,
// that is legal, places every rise and set, and whose run completes without
// faulting" (`specs/modes/campaign.md`, The course).
//
// WHERE ONE IS REACHED. "`referenceSolution(mode, index)` | A pure read: the
// build's own reference solution for that challenge, as a solution document,
// whatever is unlocked or solved. `specs/modes/campaign.md` and
// `specs/modes/extras.md` require one per challenge; this is where they are
// reachable" (`specs/instrumentation.md`, The challenge).
//
// WHAT THIS DECIDES. Two halves of "in the solution format", for all ten:
//
//   - THERE IS ONE, and it is a solution document — "a machine for a given
//     challenge: the placed parts with their poses and tapes", so an object
//     carrying `parts` — well formed under the table of `specs/formats.md`:
//     which keys each class carries, a `rotation` of `0` to `5`, a track's
//     `cells` and no anchor, an `index` on a rise and a set, and a tape whose
//     entries are `INSTRUCTIONS` names or blanks and whose last entry is an
//     instruction.
//   - `loadSolution` TAKES IT. "`loadSolution(solution)` | Replaces the open
//     challenge's machine with `solution`, a solution document in the format of
//     `specs/formats.md`, which is exactly the placements above applied in the
//     order `parts` lists them" (`specs/instrumentation.md`) — so the document
//     read back off the build is one the build's own editor accepts, and it
//     leaves exactly the parts it listed, in the order it listed them, because
//     `editor.parts` is reported in "placement order".
//
// WHAT IT LEAVES ALONE. Whether the document is LEGAL for its challenge is
// `references-legal`'s, whether it covers every rise and set is
// `references-place-every-rise` and `references-place-every-set`, and whether its
// run completes is the ten `reference-solves-…` items. This is the one that says
// a build cannot ship the shelf with a hole in it.
//
// THE VERDICT, for each of the ten Extras: `referenceSolution("extras", index)`
// answers a well-formed solution document, and loading it leaves the machine it
// states standing in the editor.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertNotNull,
  assertNull,
  assertTrue,
} from "../assert";
import { EXTRA_COUNT } from "../constants";
import { solutionFault } from "../formats";
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

it("answers a loadable solution document for every one of the ten Extras", async () => {
  assertEqual(
    (await h.snapshot()).extras.count,
    EXTRA_COUNT,
    "the Extras shelf holds the ten challenges a reference is required for",
  );

  for (let index = 0; index < EXTRA_COUNT; index += 1) {
    const at = `Extras ${index + 1}`;
    const document = await referenceSolution(h, "extras", index);

    await openChallenge(h, "extras", index);
    // A refusal is caught rather than thrown, so the reading below names the
    // challenge whose document the editor would not take.
    let refused: unknown = null;
    try {
      await loadMachine(h, document);
    } catch (error) {
      refused = error;
    }
    await h.advance(1);
    await captureStill(h, "reference");

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
    assertEqual(
      solutionFault(document),
      null,
      `${at}'s reference solution is well formed in the solution format of specs/formats.md`,
    );
    assertNull(
      refused,
      `loadSolution takes ${at}'s reference solution rather than refusing it`,
    );

    const placed = (await h.snapshot()).editor.parts;
    assertDeepEqual(
      placed.map((part) => part.kind),
      document.parts.map((part) => part.kind),
      `loading ${at}'s reference solution leaves every one of its parts standing, in the order the document lists them`,
    );
  }
});
