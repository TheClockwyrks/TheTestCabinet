// instructions/reset-walk-stops-at-an-open-track-end — the walk's track cell
// stops at an open track's ends rather than wrapping or faulting.
//
// THE RULE. "`advance` and `recede` step its track cell, wrapping only on a
// closed track and stopping at the end of an open one"
// (`specs/instructions.md`, The two macros). "Stopping" is the walk's own
// behaviour and it is deliberately unlike the run's, which "ignoring faults" in
// the same sentence covers: a run there raises `track-end`, "`advance` at the
// last cell, or `recede` at the first cell, of an open track"
// (`specs/simulation.md`, Faults). A track "is `closed` when its last cell is
// adjacent to its first and the editor has joined them into a loop ... otherwise
// it is open" (`specs/parts.md`), and an arm anchored on one of its cells is
// mounted on it.
//
// THE CONFIGURATION. One challenge open in the editor, an empty machine, and one
// OPEN three-cell track `(-1, 0)`, `(0, 0)`, `(1, 0)` with two arms anchored on
// it: one on the FIRST cell carrying three `advance`, and one on the LAST cell
// carrying three `recede`. Three steps along a three-cell path is one step more
// than the path holds, so each walk reaches the far end on its second step and
// then takes the step the rule is about. Nothing else is placed, no run is
// started, and the focus is posed to `tape` with the cursor at column `3` on each
// row in turn, so each walk reads exactly its own three cells.
//
// WHAT THE THREE READINGS DISAGREE ON. Stopping, the first arm's walk stands on
// the last cell, two cells from its rest cell, and the return run is two
// `recede`; the second arm's walk stands on the first cell and the return run is
// two `advance`. A build that WRAPPED would have carried each walk right back
// onto its own rest cell and would write `drop` alone. A build that FAULTED, or
// refused the macro, writes nothing at all and leaves each tape three cells long.
//
// THE VERDICT. The arm on the first cell is answered `drop`, `recede`, `recede`;
// the arm on the last cell is answered `drop`, `advance`, `advance`; and each
// keeps the three cells before its cursor.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull } from "../assert";
import { at, type Hex } from "../field";
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
} from "../harness";

/** An open three-cell path: consecutive cells adjacent, ends never joined. */
const LINE: readonly Hex[] = [at(-1, 0), at(0, 0), at(1, 0)];

/** The two anchors: the path's first cell and its last. */
const FIRST = LINE[0] ?? at(0, 0);
const LAST = LINE[LINE.length - 1] ?? at(0, 0);

/** One step more than the path holds, so the last step is taken at the end. */
const FORWARD = ["advance", "advance", "advance"] as const;
const BACKWARD = ["recede", "recede", "recede"] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds the walk at an open track's end rather than wrapping or faulting", async () => {
  await openChallengeDocument(h, BARE);
  await h.debug.clearMachine();
  await loadMachine(
    h,
    solution([
      trackPart(LINE, false),
      armPart("arm", FIRST.q, FIRST.r, 0, 1, [...FORWARD]),
      armPart("arm", LAST.q, LAST.r, 0, 1, [...BACKWARD]),
    ]),
  );
  const [track = -1, onFirst = -1, onLast = -1] = await partIds(h);

  const placed = partById(await h.snapshot(), track);
  assertNotNull(placed, "the track is on the machine");
  assertEqual(placed?.closed, false, "the three-cell track is open");

  await h.debug.setFocus("tape");
  await h.debug.setCursor(onFirst, FORWARD.length);
  await pressAction(h, "ins-reset");
  await h.debug.setCursor(onLast, BACKWARD.length);
  await pressAction(h, "ins-reset");
  await captureStill(h, "open-stop");

  const written = await h.snapshot();
  assertDeepEqual(
    partById(written, onFirst)?.tape,
    [...FORWARD, "drop", "recede", "recede"],
    "the third advance left the walk on the path's last cell rather than wrapping to the first, so reset runs two cells back to the rest cell",
  );
  assertDeepEqual(
    partById(written, onLast)?.tape,
    [...BACKWARD, "drop", "advance", "advance"],
    "the third recede left the walk on the path's first cell rather than wrapping to the last, so reset runs two cells forward to the rest cell",
  );
});
