// editor/rotation-does-nothing-on-a-track — `part-cw` with a track selected leaves
// the track's path exactly as it is.
//
// THE RULE. "`part-cw` and `part-ccw` turn AN ARM, A WHEEL, OR A SIGIL one rotation
// step" (`specs/editor.md`, Selection on the field) — three kinds, and a track is
// none of them. `specs/parts.md` says why: "Every placed arm, wheel, and sigil
// carries an anchor hex and a rotation `0` to `5`, and A TRACK CARRIES ITS PATH",
// which is "an ordered path of distinct hexes, `cells`, laid one hex at a time in
// the editor". A track's shape is its path and its `closed` flag, and no rotation
// formula reaches either. `specs/instrumentation.md` reports both on the part:
// `cells: [{ q, r }] | null, closed: <boolean | null>`.
//
// THE CONFIGURATION. `BARE` opened in the editor, its machine cleared, and two
// parts: a CLOSED track through `(0, 0)`, `(1, 0)`, `(0, 1)` — each cell adjacent
// to the next by `DIRS` and the last adjacent to the first, three cells, which is
// what `specs/parts.md`'s rule 6 asks of a loop — and one ARM anchored on
// `(-3, 0)`, three hexes clear of every cell, sharing no anchor and lying on no
// footprint.
//
// WHY THE ARM IS THERE. The verdict is that something did NOT change, which a
// build that never reads `KeyE` would satisfy for the wrong reason. So the arm is
// selected FIRST and pressed, and its rotation must rise — that reading is what
// says `part-cw` is live in this posed world. The track is then selected and
// pressed, and that press is the item's own verdict.
//
// THE VERDICT. After the press with the track selected its `cells` are the same
// hexes in the same order, and it is still `closed`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull } from "../assert";
import { at, type Hex } from "../field";
import { BARE, WEST } from "../fixtures";
import {
  captureStill,
  createHarness,
  openChallengeDocument,
  partById,
  placePart,
  placeTrack,
  pressAction,
  type Harness,
} from "../harness";

/** A closed track: three cells, each adjacent to the next and the last to the first. */
const CELLS: readonly Hex[] = [at(0, 0), at(1, 0), at(0, 1)];

/** The path as the check compares it: one string per cell, in path order. */
const PATH = CELLS.map((cell) => `${cell.q},${cell.r}`);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves a selected track's cells and closed flag untouched by part-cw", async () => {
  await openChallengeDocument(h, BARE);
  const track = await placeTrack(h, CELLS, true);
  const arm = await placePart(h, "arm", WEST);

  await h.debug.setSelected(arm);
  await h.debug.setFocus("field");
  await pressAction(h, "part-cw");
  const armTurned = partById(await h.snapshot(), arm)?.rotation;
  const before = partById(await h.snapshot(), track);

  await h.debug.setSelected(track);
  await pressAction(h, "part-cw");
  await captureStill(h, "held");

  assertEqual(
    armTurned,
    1,
    "with the arm selected the press turns it, so part-cw is live in this world",
  );
  assertNotNull(before, "the track is on the field before the press");
  assertDeepEqual(
    (before?.cells ?? []).map((cell) => `${cell.q},${cell.r}`),
    PATH,
    "and it holds the path it was laid on",
  );
  assertEqual(before?.closed, true, "closed into a loop");

  const after = partById(await h.snapshot(), track);
  assertNotNull(after, "the track is still on the field after the press");
  assertDeepEqual(
    (after?.cells ?? []).map((cell) => `${cell.q},${cell.r}`),
    PATH,
    "a part-cw press with a track selected leaves its cells exactly as they stand: the rotation verbs act on an arm, a wheel, or a sigil",
  );
  assertEqual(
    after?.closed,
    true,
    "and leaves its closed flag exactly as it stands",
  );
});
