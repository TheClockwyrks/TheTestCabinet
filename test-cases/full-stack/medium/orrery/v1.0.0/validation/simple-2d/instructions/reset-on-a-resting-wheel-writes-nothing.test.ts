// instructions/reset-on-a-resting-wheel-writes-nothing — a wheel whose walked
// rotation is its rest rotation receives an empty expansion.
//
// THE RULE. "Invoked on a wheel's tape, `reset` writes step 3 alone, the shorter
// rotation run, and nothing when the wheel is already at its rest rotation"
// (`specs/instructions.md`, `reset`) — this item is that last clause. What an
// empty expansion does to a tape is stated once for both macros: "a macro whose
// expansion is empty leaves the whole tape as it stands" (The two macros).
//
// AT REST MEANS THE WALK'S ROTATION. "For `reset`, the arm's pose at a cell is the
// pose reached by executing cells `0` up to that cell once from the rest pose:
// rotation steps its direction" (The two macros). The prefix here turns the wheel
// one step clockwise and then one step back, so the walk's rotation is the rest
// rotation `0` while the prefix is neither empty nor idle.
//
// THE WHEEL IS OFF ITS REST CELL ON PURPOSE. It is anchored on the first cell of
// an open three-cell track, which mounts it (`specs/parts.md`), and the prefix's
// first cell is `advance`, so the walk stands on cell `1`. A wheel gets step 3
// alone, so a track run of one `recede` — and the `drop` an arm would have led
// with — are exactly what must NOT appear. With the rotation run empty, a wheel's
// whole expansion is empty and the tape is left as it stands.
//
// THE VERDICT. Every column of the tape holds what it held before the key was
// pressed, the columns past its end included.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertNotNull } from "../assert";
import type { InstructionName } from "../constants";
import { at } from "../field";
import { armPart, solution, trackPart } from "../formats";
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
  type OrrerySnapshot,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/**
 * The tape's columns `from` onward, as columns rather than as a trimmed list.
 *
 * "A cell at or past the tape's own length is blank" (`specs/instructions.md`),
 * and `specs/formats.md` trims a tape's trailing blanks away, so a column is read
 * as the cell it holds or as a blank.
 */
function cellsAt(
  snapshot: OrrerySnapshot,
  part: number,
  from: number,
  count: number,
): (InstructionName | null)[] {
  const tape = partById(snapshot, part)?.tape ?? [];
  return Array.from({ length: count }, (_unused, i) => tape[from + i] ?? null);
}

/** The prefix the wheel carries: one cell along its track, and back to rest rotation. */
const TAPE: readonly InstructionName[] = ["advance", "rotate-cw", "rotate-ccw"];

/** The tape as columns, so a blank column reads as a blank rather than as nothing. */
const COLUMNS: (InstructionName | null)[] = [
  ...TAPE,
  null,
  null,
  null,
  null,
  null,
];

it("leaves every cell of a resting wheel's tape as it was", async () => {
  await openChallengeDocument(h, BARE);
  await loadMachine(
    h,
    solution([
      trackPart([at(0, 0), at(1, 0), at(2, 0)], false),
      armPart("wheel", 0, 0, 0, 1, TAPE),
    ]),
  );
  const wheel = (await partIds(h))[1] ?? -1;

  const before = await h.snapshot();
  assertNotNull(
    partById(before, wheel)?.tape,
    "the wheel carries a tape for the macro to leave alone",
  );
  assertDeepEqual(
    cellsAt(before, wheel, 0, COLUMNS.length),
    COLUMNS,
    "the wheel stands with the prefix it was given, and nothing after it",
  );

  await h.debug.setFocus("tape");
  await h.debug.setCursor(wheel, 3);
  await pressAction(h, "ins-reset");
  await captureStill(h, "wheel-nothing");

  const after = await h.snapshot();
  assertNotNull(
    partById(after, wheel)?.tape,
    "the wheel still carries a tape after the macro ran",
  );
  assertDeepEqual(
    cellsAt(after, wheel, 0, COLUMNS.length),
    COLUMNS,
    "the walked rotation is the rest rotation, so a wheel's expansion is empty " +
      "and the tape stands exactly as it was",
  );
});
