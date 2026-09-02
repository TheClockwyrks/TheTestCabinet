// instrumentation/close-track — `closeTrack` joins a path into a loop.
//
// THE RULE. "`closeTrack(part)` | Joins that track's last cell to its first,
// exactly as closing a path in `specs/editor.md` does"
// (`specs/instrumentation.md`, The machine). What that means for the track:
// "A track is `closed` when its last cell is adjacent to its first and the editor
// has joined them into a loop" (`specs/parts.md`, Track), and a closed track is
// what makes a mounted part's motion wrap: "The `advance` instruction carries a
// mounted arm's base to the next cell of the path and `recede` to the previous
// one; on a closed track both wrap between the ends, and on an open track moving
// past either end faults" (`specs/parts.md`, Track). Placement rule 6 fixes what
// a closed path must be: "a closed track's last cell is adjacent to its first and
// its path holds at least three cells".
//
// THE CONFIGURATION. The shortest closed path there is: `(0, 0)`, `(1, 0)`,
// `(0, 1)`, laid open and then closed, with one arm anchored on `(0, 1)` — the
// path's LAST cell, so the arm is mounted there ("An arm or wheel whose anchor hex
// is a cell of a track is mounted on that track") — carrying `advance` in tape
// cell `0`. Nothing else is placed and the field is emptied, so the only motion in
// the cycle is the one the wrap decides.
//
// THE VERDICT. `closed` reports `false` while the path is open and `true` after
// the call, with the path itself unchanged; and the cycle that fetches `advance`
// at the last cell carries the arm's base to the FIRST cell rather than faulting
// as `track-end`, so the two ends wrap.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull } from "../assert";
import { at } from "../field";
import { BARE } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  openChallengeDocument,
  partById,
  placePart,
  placeTrack,
  poseOf,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("closes a three-cell path into a loop that advance wraps around", async () => {
  await h.debug.reset();
  await openChallengeDocument(h, BARE);

  const track = await placeTrack(h, [at(0, 0), at(1, 0), at(0, 1)]);
  const open = await h.snapshot();

  await h.debug.closeTrack(track);
  const closed = await h.snapshot();

  const arm = await placePart(h, "arm", at(0, 1), 0);
  await h.debug.setTapeCell(arm, 0, "advance");
  await h.debug.setCompletion(false);
  await h.debug.startRun();
  await h.debug.clearMotes();

  await advanceCycles(h, 1);
  await h.advance(1);
  await captureStill(h, "loop");
  const ran = await h.snapshot();

  assertNotNull(partById(open, track), "the machine reports the track it laid");
  assertEqual(
    partById(open, track)?.closed,
    false,
    "the path is open until closeTrack joins it",
  );
  assertEqual(
    partById(closed, track)?.closed,
    true,
    "closeTrack reports the track closed",
  );
  assertDeepEqual(
    (partById(closed, track)?.cells ?? []).map((cell) => `${cell.q},${cell.r}`),
    ["0,0", "1,0", "0,1"],
    "closing joins the two ends and leaves the path as it was laid",
  );
  assertEqual(
    ran.sim?.status,
    "running",
    "advance at the last cell of a CLOSED track does not fault as track-end",
  );
  assertEqual(
    `${poseOf(ran, arm)?.cell.q},${poseOf(ran, arm)?.cell.r}`,
    "0,0",
    "advance at the last cell wraps to the first: the ends are joined",
  );
});
