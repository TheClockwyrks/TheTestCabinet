// editor/a-drag-ends-at-its-release — every drag shape ends at its release, and a
// move made afterwards retargets nothing.
//
// THE RULE. "A drag ends at its release" (`specs/editor.md`, Dragging), of the one
// drag shape "Placing and moving run through one drag shape: a press begins it,
// each pointer move retargets it, and the release commits or cancels it" — and of
// the lay too, whose own sentence says the same: "The release ends the lay"
// (Laying track). `specs/instrumentation.md` reports the live drag as
// `editor.drag`, "`null`" when there is none, in "one of its three shapes":
// `place`, `move`, and `lay`. So the rule is read as `editor.drag` being `null`
// after `pointerUp`, for all three; and because "each pointer move retargets IT",
// a move with no drag live retargets nothing at all.
//
// THE CONFIGURATION. `BARE` opened in the editor, whose tray's first entry is its
// one permitted kind, `arm`. Each shape is posed in turn, on a field holding only
// what that shape needs, and after each release the pointer is moved onto a hex
// the drag would plainly have retargeted onto had it still been live:
//
// - `place`: the tray's `arm` entry is pressed, moved onto `(0, 0)` and released,
//   which places the arm. The pointer is then moved onto `(3, 0)`, a bare hex — a
//   live place drag would have retargeted its ghost there.
// - `move`: the placed arm is pressed and released on its own hex, which "commits
//   no move". The pointer is then moved onto `(3, 0)` — a live move drag would
//   have retargeted onto it, and the release that follows would have moved the arm.
// - `lay`: the machine is cleared, a one-cell track is posed on `(0, 0)`, pressed
//   and released. The pointer is then moved onto `(1, 0)`, adjacent to the live
//   end — a live lay would have appended it.
//
// THE VERDICT. After each release `editor.drag` is `null`; after each following
// move it is still `null`, and the machine is untouched by that move — no second
// arm placed, the arm still anchored on `(0, 0)`, the track still one cell long.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertLength,
  assertNull,
} from "../assert";
import { at, hexCenter, type Hex } from "../field";
import { BARE, EAST, ORIGIN } from "../fixtures";
import {
  captureStill,
  clearWorld,
  createHarness,
  dragFromTray,
  moveTo,
  openChallengeDocument,
  partById,
  placeTrack,
  pressAt,
  releasePointer,
  type Harness,
} from "../harness";

/** Adjacent to `(0, 0)` by `DIRS[0]`: what a live lay from the last end would append. */
const NEXT_CELL: Hex = at(1, 0);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves no drag live after the release, for a place, a move and a lay", async () => {
  await openChallengeDocument(h, BARE);

  // The place drag.
  await dragFromTray(h, 0, ORIGIN);
  await h.advance(1);
  await captureStill(h, "ended");
  assertNull(
    (await h.snapshot()).editor.drag,
    "the place drag ends at its release",
  );
  const placed = (await h.snapshot()).editor.parts;
  assertLength(placed, 1, "the place drag placed the arm it was released on");

  await moveTo(h, hexCenter(EAST));
  const afterPlace = await h.snapshot();
  assertNull(
    afterPlace.editor.drag,
    "the move after the release opens no drag: a place drag ended at its release",
  );
  assertDeepEqual(
    afterPlace.editor.parts.map((part) => `${part.kind}:${part.q},${part.r}`),
    placed.map((part) => `${part.kind}:${part.q},${part.r}`),
    "the move after the release retargets nothing, so no second arm follows the pointer",
  );

  // The move drag, on the arm the place drag left.
  await pressAt(h, hexCenter(ORIGIN));
  assertEqual(
    (await h.snapshot()).editor.drag?.kind,
    "move",
    "the press on the arm opens a move drag",
  );
  await releasePointer(h);
  assertNull(
    (await h.snapshot()).editor.drag,
    "the move drag ends at its release",
  );

  await moveTo(h, hexCenter(EAST));
  await releasePointer(h);
  const afterMove = await h.snapshot();
  assertNull(
    afterMove.editor.drag,
    "the move after the release opens no drag: a move drag ended at its release",
  );
  const arm = afterMove.editor.parts[0];
  assertEqual(
    `${arm?.q},${arm?.r}`,
    `${ORIGIN.q},${ORIGIN.r}`,
    "the arm did not follow the pointer: the move after the release retargeted nothing",
  );

  // The lay.
  await clearWorld(h);
  const track = await placeTrack(h, [ORIGIN]);
  await pressAt(h, hexCenter(ORIGIN));
  assertEqual(
    (await h.snapshot()).editor.drag?.kind,
    "lay",
    "the press on the one-cell track opens a lay",
  );
  await releasePointer(h);
  assertNull((await h.snapshot()).editor.drag, "the lay ends at its release");

  await moveTo(h, hexCenter(NEXT_CELL));
  const afterLay = await h.snapshot();
  assertNull(
    afterLay.editor.drag,
    "the move after the release opens no drag: a lay ended at its release",
  );
  assertLength(
    partById(afterLay, track)?.cells ?? [],
    1,
    "the move onto the adjacent hex appended nothing, because the lay ended at its release",
  );
});
