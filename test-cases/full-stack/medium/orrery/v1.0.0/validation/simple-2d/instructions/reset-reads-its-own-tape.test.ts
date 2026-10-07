// instructions/reset-reads-its-own-tape — `reset` is computed from the cursor's
// own arm, and nothing else on the machine reaches it.
//
// THE RULE. "`reset` and `repeat` are editor macros rather than instructions:
// invoking one writes plain instructions into the tape at the cursor ... Both are
// computed from the arm's own tape alone" (`specs/instructions.md`, The two
// macros). The expansion's two ingredients are named in the same file: "the arm's
// pose at a cell is the pose reached by executing cells `0` up to that cell once
// from the rest pose", and `reset` "writes, from that cell onward, the sequence
// that returns the arm from its pose at that cell to its rest pose". Both are the
// cursor's arm's — its rest pose and its cells — so a second arm's rest pose and
// a second arm's tape are not inputs.
//
// THE CONFIGURATION. One challenge open in the editor, an empty machine, and two
// arms with nothing in common. The CURSOR'S arm sits at `(0, 0)` at rest rotation
// `0` and length `1` with a one-cell tape, `rotate-cw`. The other arm sits at
// `(3, 0)` at rest rotation `2` and length `3`, with a five-cell tape of
// rotations, an `extend` and an `advance` — every kind of cell the walk reads,
// pointing the other way, from a different rest pose. A build that walked the
// machine rather than the row, or took its rest pose from the wrong row, cannot
// land on the same answer from those two.
//
// AND THEN THE SECOND ARM IS TAKEN AWAY ENTIRELY. The same challenge, the same
// one-cell tape, the same cursor, on a machine holding the cursor's arm ALONE —
// and the tape the macro leaves is compared with the tape it left beside the
// other arm. That comparison is the point being decided: not that some particular
// expansion was written, but that the two are the same text, "unchanged by what
// any other arm or wheel in the machine carries on its tape".
//
// NO RUN IS STARTED. A macro is an editing verb — "While a run is active, in any
// status ... the editor reads the run controls above and `mute` and nothing else"
// (`specs/editor.md`) — so the world here is the editor, the focus is posed to
// `tape`, and the cursor is posed at the column the macro is invoked at.
//
// THE VERDICT. Beside the busy second arm, `reset` at column `1` writes `drop`
// then the one `rotate-ccw` that returns the walk's rotation `1` to the rest
// rotation `0`; the second arm's tape is exactly the tape it was placed with; and
// alone, the same invocation writes the same cells.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertNotNull } from "../assert";
import { type InstructionName } from "../constants";
import { armPart, solution, type Solution } from "../formats";
import { BARE } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadMachine,
  openChallengeDocument,
  partById,
  partIds,
  pressAction,
  type Harness,
} from "../harness";

/** The cursor's arm: rest rotation 0, rest length 1, one cell of tape. */
const OWN_TAPE = ["rotate-cw"] as const;

/** The column the macro is invoked at: one past the arm's own single cell. */
const COLUMN = OWN_TAPE.length;

/** The other arm's tape, which the macro must not read. */
const OTHER_TAPE = [
  "rotate-ccw",
  "rotate-ccw",
  "extend",
  "advance",
  "grab",
] as const;

/** The cursor's arm alone. */
const ALONE: Solution = solution([armPart("arm", 0, 0, 0, 1, [...OWN_TAPE])]);

/** The same arm, beside one whose rest pose and tape agree with it nowhere. */
const BESIDE: Solution = solution([
  armPart("arm", 0, 0, 0, 1, [...OWN_TAPE]),
  armPart("arm", 3, 0, 2, 3, [...OTHER_TAPE]),
]);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Load a machine, invoke `reset` at the column on its FIRST arm, answer the tape. */
async function resetFirstRow(
  machine: Solution,
): Promise<(InstructionName | null)[] | null | undefined> {
  await h.debug.clearMachine();
  await loadMachine(h, machine);
  const arm = (await partIds(h))[0] ?? -1;
  await h.debug.setFocus("tape");
  await h.debug.setCursor(arm, COLUMN);
  await pressAction(h, "ins-reset");
  return partById(await h.snapshot(), arm)?.tape;
}

it("writes the same expansion whatever else the machine's tapes carry", async () => {
  await openChallengeDocument(h, BARE);

  const beside = await resetFirstRow(BESIDE);
  await captureStill(h, "own-tape");
  assertNotNull(beside, "the cursor's arm is on the machine after the macro");
  assertDeepEqual(
    beside,
    ["rotate-cw", "drop", "rotate-ccw"],
    "reset writes the run that returns THIS arm from its own walked pose to its own rest pose",
  );

  const others = await partIds(h);
  assertDeepEqual(
    partById(await h.snapshot(), others[1] ?? -1)?.tape,
    [...OTHER_TAPE],
    "the arm the cursor does not name is left exactly as it was",
  );

  const alone = await resetFirstRow(ALONE);
  assertNotNull(alone, "the cursor's arm is on the machine after the macro");
  assertDeepEqual(
    alone,
    beside,
    "the expansion is computed from the arm's own tape alone: taking the other arm off changes nothing",
  );
});
