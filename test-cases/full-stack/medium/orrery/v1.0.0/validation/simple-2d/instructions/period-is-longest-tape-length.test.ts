// instructions/period-is-longest-tape-length — the machine's period is the
// LARGEST tape length across its arms and wheels.
//
// THE RULE. "The machine's period `P` is the largest tape length across its arms
// and wheels" (`specs/instructions.md`, Tapes and the period). A tape's length is
// fixed by the sentence before it: "A tape's length is the index of its last
// non-blank cell plus one, and `0` when it is entirely blank." The figure is
// reported: `editor.period` is derived from "the tapes, as `specs/instructions.md`
// computes it" (`specs/instrumentation.md`), and the readout carries it too —
// "During a run the readout shows at least the status, the cycle count, the
// period" (`specs/editor.md`).
//
// THE CONFIGURATION. One challenge open, an empty machine, and three arms whose
// tapes are of length `2`, `5` and `3` — the very machine the review item names.
// The five-cell tape is written with INTERIOR BLANKS, `rotate-cw` at cell `0` and
// `rotate-ccw` at cell `4`, so its length is the index of its last non-blank cell
// plus one rather than a count of the instructions on it: a build that summed the
// non-blank cells would read that tape as `2`. The three anchors are distinct hexes
// of the field and nothing else is placed, so the period is a figure over exactly
// these three tapes. No run is started: the period is the editor's figure, derived
// from the machine as it stands.
//
// WHAT IS COMPARED. The three tapes are read back off the snapshot first, each
// against the length this check wrote, so the machine really is the `2`, `5`, `3`
// machine the rule is quoted for; then `editor.period` is read against `5`. The
// largest is neither the first tape's length, nor the last's, nor the sum, nor the
// count of parts, so the one reading separates the rule from every arithmetic
// near it.
//
// THE VERDICT. The three tapes report lengths `2`, `5` and `3`, and the machine
// reports a period of `5`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { armPart, solution } from "../formats";
import { BARE } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadMachine,
  openChallengeDocument,
  partById,
  partIds,
  type Harness,
} from "../harness";

/** The three tapes, in placement order: lengths 2, 5 and 3. */
const MACHINE = solution([
  armPart("arm", 0, 0, 0, 1, ["grab", "drop"]),
  armPart("arm", 2, 0, 0, 1, ["rotate-cw", null, null, null, "rotate-ccw"]),
  armPart("arm", -2, 0, 0, 1, ["grab", null, "drop"]),
]);

/** The length each of the three tapes carries, in placement order. */
const LENGTHS = [2, 5, 3];

/** The largest of them, which is the period. */
const PERIOD = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports the largest of its tape lengths as the period", async () => {
  await openChallengeDocument(h, BARE);
  await h.debug.clearMachine();
  await loadMachine(h, MACHINE);
  const ids = await partIds(h);
  await h.advance(1);
  await captureStill(h, "period");

  const snapshot = await h.snapshot();
  for (const [index, expected] of LENGTHS.entries()) {
    const id = ids[index] ?? -1;
    const part = partById(snapshot, id);
    assertNotNull(part, `the arm placed ${index + 1}st is on the machine`);
    assertEqual(
      part?.tape?.length,
      expected,
      `the arm placed ${index + 1}st carries a tape of length ${expected}: ` +
        "the index of its last non-blank cell plus one",
    );
  }
  assertEqual(
    snapshot.editor.period,
    PERIOD,
    "the period is the largest tape length across the machine's arms and wheels",
  );
});
