// instructions/reset-on-a-wheel-writes-rotation-alone — a wheel's expansion is the
// rotation run and nothing else.
//
// THE RULE. "Invoked on a wheel's tape, `reset` writes step 3 alone, the shorter
// rotation run, and nothing when the wheel is already at its rest rotation"
// (`specs/instructions.md`, `reset`). Step 3 is "`rotate-cw` or `rotate-ccw`,
// repeated, whichever direction reaches the rest rotation in fewer steps". So the
// three groups a wheel does not get are step 1's `drop`, step 2's length run, and
// step 4's track run.
//
// THE CONFIGURATION IS BUILT SO EACH OMITTED GROUP WOULD SHOW. The wheel is
// anchored on the first cell of an open three-cell track, which mounts it — "An
// arm or wheel whose anchor hex is a cell of a track is mounted on that track"
// (`specs/parts.md`) — and its tape's prefix is `advance`, `rotate-cw`,
// `rotate-cw`. The walk therefore stands one cell along the track and two rotation
// steps clockwise of rest, so a build that ran the arm's four groups here would
// write `drop`, then nothing for the length (a wheel's "`length` is always `1`",
// `specs/parts.md`), then the rotation run, then a `recede`. Only the two rotation
// cells belong to a wheel.
//
// WHICH DIRECTION IS NOT WHAT THIS ITEM DECIDES, but the run has to be written as
// something: from rotation `2`, counterclockwise reaches rotation `0` in two steps
// against clockwise's four, so the shorter run is two `rotate-ccw`.
//
// THE VERDICT. The cursor's own cell holds the first `rotate-ccw` rather than
// `drop`, the cell after it holds the second, and the two columns after that are
// blank: no `drop` before the run and no track run after it.

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

it("writes the rotation run alone on a wheel's row, with no drop and no track run", async () => {
  await openChallengeDocument(h, BARE);
  await loadMachine(
    h,
    solution([
      trackPart([at(0, 0), at(1, 0), at(2, 0)], false),
      armPart("wheel", 0, 0, 0, 1, ["advance", "rotate-cw", "rotate-cw"]),
    ]),
  );
  const wheel = (await partIds(h))[1] ?? -1;

  await h.debug.setFocus("tape");
  await h.debug.setCursor(wheel, 3);
  await pressAction(h, "ins-reset");
  await captureStill(h, "wheel-reset");

  const written = await h.snapshot();
  assertNotNull(
    partById(written, wheel)?.tape,
    "the wheel still carries a tape to have been written to",
  );
  assertDeepEqual(
    cellsAt(written, wheel, 3, 2),
    ["rotate-ccw", "rotate-ccw"],
    "a wheel's expansion begins at the rotation run: the cursor's own cell " +
      "holds a rotation step rather than drop",
  );
  assertDeepEqual(
    cellsAt(written, wheel, 5, 2),
    [null, null],
    "and it ends there: no track run follows, though the walk stands one cell " +
      "along the track the wheel is mounted on",
  );
});
