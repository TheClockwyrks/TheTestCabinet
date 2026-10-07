// instructions/reset-walks-from-the-rest-pose — the walk that decides a `reset`
// starts at the arm's PLACED pose, not at rotation `0` and length `1`.
//
// THE RULE. "For `reset`, the arm's pose at a cell is the pose reached by
// executing cells `0` up to that cell once from the rest pose, ignoring faults
// and other parts" (`specs/instructions.md`, The two macros), and the expansion
// is "the sequence that returns the arm from its pose at that cell to its rest
// pose". What the rest pose IS belongs to `specs/parts.md`: "An arm's placed
// rotation and length are its rest pose", chosen in the editor, with length "a
// whole number from `ARM_MIN_LEN` (`1`) to `ARM_MAX_LEN` (`3`)". So the walk
// begins at the placed pose and ends at the placed pose, and an arm placed away
// from `(0, 1)` is the case that says so.
//
// THE CONFIGURATION. One challenge open in the editor, an empty machine, and ONE
// arm at `(0, 0)`, placed at rotation `3` and length `2` — neither of the two
// figures a build could substitute — carrying a one-cell tape of `rotate-cw`.
// The cursor is posed at column `1`, so the walk reads exactly that one cell. No
// run is started: a macro is an editing verb, and the focus is posed to `tape`,
// which is the focus `specs/editor.md` reads the tape verbs under.
//
// WHAT THE TWO WALKS DISAGREE ON. From the rest pose the walk stands at rotation
// `4`, length `2`, and returning it takes one step counterclockwise — "whichever
// direction reaches the rest rotation in fewer steps", and `4` is one step
// counterclockwise of `3` where clockwise would be five — and no length
// instruction at all, because the walk never touched the length. From rotation
// `0` and length `ARM_MIN_LEN` the walk would stand at rotation `1`, length `1`,
// and returning it to `(3, 2)` takes an `extend` and two `rotate-cw`. The two
// expansions share only their first cell.
//
// THE VERDICT. `reset` at column `1` leaves the tape `rotate-cw`, `drop`,
// `rotate-ccw`: the arm is returned to rotation `3` and length `2`, and the cell
// before the cursor is untouched.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull } from "../assert";
import { armPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
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

/** The placed pose: neither rotation 0 nor length ARM_MIN_LEN. */
const REST_ROTATION = 3;
const REST_LENGTH = 2;

/** The one cell the walk reads, and the column the macro is invoked at. */
const PREFIX = ["rotate-cw"] as const;
const COLUMN = PREFIX.length;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns the arm to its placed rotation and length, not to 0 and 1", async () => {
  await openChallengeDocument(h, BARE);
  await h.debug.clearMachine();
  await loadMachine(
    h,
    solution([
      armPart("arm", ORIGIN.q, ORIGIN.r, REST_ROTATION, REST_LENGTH, [
        ...PREFIX,
      ]),
    ]),
  );
  const arm = (await partIds(h))[0] ?? -1;

  const placed = partById(await h.snapshot(), arm);
  assertNotNull(placed, "the arm is on the machine");
  assertEqual(
    placed?.rotation,
    REST_ROTATION,
    "the arm's rest rotation is the rotation it was placed at",
  );
  assertEqual(
    placed?.length,
    REST_LENGTH,
    "the arm's rest length is the length it was placed at",
  );

  await h.debug.setFocus("tape");
  await h.debug.setCursor(arm, COLUMN);
  await pressAction(h, "ins-reset");
  await captureStill(h, "from-rest");

  assertDeepEqual(
    partById(await h.snapshot(), arm)?.tape,
    ["rotate-cw", "drop", "rotate-ccw"],
    "the walk began at rotation 3 and length 2, so reset writes drop and the one rotate-ccw that returns rotation 4 to 3 — where a walk from rotation 0 and length 1 would have written an extend and two rotate-cw",
  );
});
