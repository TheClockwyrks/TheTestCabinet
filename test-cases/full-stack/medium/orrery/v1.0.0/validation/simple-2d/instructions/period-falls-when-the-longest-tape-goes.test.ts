// instructions/period-falls-when-the-longest-tape-goes — deleting the part that
// carried the longest tape leaves the period at the largest length that remains.
//
// THE RULE, IN TWO SENTENCES THAT MEET. "Deleting a track deletes its whole path;
// deleting an arm or wheel discards its tape and its row" (`specs/editor.md`,
// Dragging), and the debug removal is the same edit — "Removes one placed part,
// discarding its tape and its tape-panel row exactly as `part-delete` does"
// (`specs/instrumentation.md`). "The machine's period `P` is the largest tape
// length across its arms and wheels" (`specs/instructions.md`), and
// `editor.period` is derived from "the tapes, as `specs/instructions.md` computes
// it" (`specs/instrumentation.md`) — so the maximum is re-taken over what stands,
// and a tape that has been discarded is no longer in it.
//
// THE CONFIGURATION. One challenge open, an empty machine, and four parts whose
// tapes are of length `2`, `5`, `4` and `3`. The `4` is a WHEEL's, because the
// rule the item states is about "the arm or wheel whose tape is the longest" and
// both classes carry tapes; the other three are arms. Four distinct anchors on
// the field, nothing else placed, and no run, because the period is the editor's
// figure over the machine as it stands.
//
// THE PARTS COME OFF LONGEST FIRST, so the period is watched falling from one
// standing maximum to the next: `5` with everything placed, `4` once the
// five-cell arm is gone, `3` once the wheel is gone, and `2` once the three-cell
// arm is gone. A build that cached the period rather than deriving it, or that
// discarded the row but kept the tape in the maximum, holds at `5`; a build that
// took the maximum over the arms alone would already report `4` at the first
// reading rather than at the second.
//
// THE VERDICT. The four steps report `5`, `4`, `3` and `2`, and each of the three
// removals is a part fewer on the machine.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { armPart, solution } from "../formats";
import { BARE } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadMachine,
  openChallengeDocument,
  partIds,
  type Harness,
} from "../harness";

/** Tapes of length 2, 5, 4 and 3, the 4 on a wheel. */
const MACHINE = solution([
  armPart("arm", 0, 0, 0, 1, ["grab", "drop"]),
  armPart("arm", 3, 0, 0, 1, ["rotate-cw", null, null, null, "rotate-ccw"]),
  armPart("wheel", -3, 0, 0, 1, ["rotate-cw", null, null, "rotate-ccw"]),
  armPart("arm", 0, 3, 0, 1, ["grab", null, "drop"]),
]);

/** The period with everything placed. */
const START = 5;

/**
 * The removals, longest tape first: which part goes, and the largest length
 * among the tapes that remain once it has.
 */
const STEPS: readonly { index: number; label: string; period: number }[] = [
  { index: 1, label: "the arm whose tape is 5 long", period: 4 },
  { index: 2, label: "the wheel whose tape is 4 long", period: 3 },
  { index: 3, label: "the arm whose tape is 3 long", period: 2 },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("re-takes the period over the tapes that remain as parts are deleted", async () => {
  await openChallengeDocument(h, BARE);
  await h.debug.clearMachine();
  await loadMachine(h, MACHINE);
  const ids = await partIds(h);
  await h.advance(1);

  const posed = await h.snapshot();
  assertEqual(
    posed.editor.parts.length,
    MACHINE.parts.length,
    "all four parts are on the machine",
  );
  assertEqual(
    posed.editor.period,
    START,
    "with everything placed the period is the longest tape's 5",
  );

  let standing = MACHINE.parts.length;
  for (const [order, step] of STEPS.entries()) {
    await h.debug.removePart(ids[step.index] ?? -1);
    standing -= 1;
    await h.advance(1);
    // The moment the item names: the longest-taped part gone and the figure
    // already re-taken over what is left.
    if (order === 0) await captureStill(h, "lowered");
    const after = await h.snapshot();
    assertEqual(
      after.editor.parts.length,
      standing,
      `deleting ${step.label} leaves one part fewer on the machine`,
    );
    assertEqual(
      after.editor.period,
      step.period,
      `with ${step.label} deleted the period is the largest length among the tapes that remain`,
    );
  }
});
