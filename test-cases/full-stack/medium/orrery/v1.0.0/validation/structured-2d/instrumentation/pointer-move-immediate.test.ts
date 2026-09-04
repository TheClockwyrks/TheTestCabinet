// instrumentation/pointer-move-immediate — a posed move is resolved before the
// call returns.
//
// THE RULE, set in bold by `specs/instrumentation.md` (The editor's hands): "**Each
// of the three pointer operations takes effect immediately, when it is called,
// rather than being sampled once per frame.** The press, the move, or the release
// is resolved before the call returns rather than deferred to the next frame."
// And `specs/controls.md`: "Each pointer position is resolved on its own, in the
// order the positions arrive, so a drag's ghost and a track being laid follow the
// pointer hex by hex."
//
// SO EVERY READING BELOW IS TAKEN WITH NO FRAME ADVANCED between the call and the
// snapshot, and the two moves of the first drag are read separately, because a
// build that resolved only the LAST position of a sequence would still answer the
// second reading.
//
// WHAT A MOVE IS REQUIRED TO HAVE DONE comes from `specs/editor.md`. Under a live
// drag, "each pointer move retargets it" and the snapshot's drag carries "`at`:
// the targeted hex, `null` off every hex", so the ghost's `at` is the hex the
// pointer was last moved onto. Under a live LAY, "moving the pointer onto a hex
// adjacent to the live end appends it to the path when the placement rules allow",
// so the track's `cells` — which the snapshot carries as "a track's path, in
// order" — has grown by that hex.
//
// THE WORLD IS POSED, NOT SEARCHED. A posed challenge and an empty machine for the
// place drag; then the machine is emptied again and a one-cell track is placed
// through the surface, which is the whole of the field for the lay. "A press on a
// one-cell track begins laying from its `last` end" (`specs/editor.md`), so the
// press that opens the lay needs nothing arranged but the track. The tray slot is
// derived from the challenge the way `specs/editor.md` derives it.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull } from "../assert";
import { at, hexCenter, traySlot } from "../field";
import { derivedTray } from "../formats";
import {
  captureStill,
  centerOf,
  createHarness,
  moveTo,
  openChallengeDocument,
  partById,
  placeTrack,
  pressAt,
  releasePointer,
  type Harness,
} from "../harness";
import { BARE } from "../fixtures";

/** The two hexes the ghost is dragged across, in order. */
const FIRST = at(-2, -1);
const SECOND = at(2, -1);

/** The one-cell track, and the hex the lay appends to it. */
const TRACK = at(0, 2);
const APPENDED = at(1, 2);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("retargets the ghost and appends the laid cell before the call returns", async () => {
  await openChallengeDocument(h, BARE);
  await h.debug.clearMachine();
  const armSlot = derivedTray(BARE).findIndex((entry) => entry.kind === "arm");

  await pressAt(h, centerOf(traySlot(armSlot)));
  await moveTo(h, hexCenter(FIRST));
  const onFirst = await h.snapshot();
  await moveTo(h, hexCenter(SECOND));
  const onSecond = await h.snapshot();
  await releasePointer(h);

  await h.debug.clearMachine();
  const track = await placeTrack(h, [TRACK]);
  await pressAt(h, hexCenter(TRACK));
  await moveTo(h, hexCenter(APPENDED));
  const laid = await h.snapshot();

  await h.advance(1);
  await captureStill(h, "moved");
  await releasePointer(h);

  const first = onFirst.editor.drag;
  assertNotNull(
    first,
    "the place drag is live after the first move, with no frame advanced",
  );
  assertEqual(first?.kind, "place", "a drag out of the tray is a place drag");
  assertDeepEqual(
    first?.kind === "place" ? first.at : null,
    FIRST,
    "the move reports the newly targeted hex in the snapshot taken with no frame advanced",
  );

  const second = onSecond.editor.drag;
  assertNotNull(second, "the place drag is still live after the second move");
  assertDeepEqual(
    second?.kind === "place" ? second.at : null,
    SECOND,
    "each move is resolved on its own, so the second reports the hex it targeted",
  );

  const laying = laid.editor.drag;
  assertNotNull(
    laying,
    "the lay is live after the move, with no frame advanced",
  );
  assertEqual(
    laying?.kind,
    "lay",
    "a press on an end cell of an open track begins laying rather than moving",
  );
  const path = partById(laid, track);
  assertNotNull(path, "the track being laid is still on the machine");
  assertDeepEqual(
    path?.cells,
    [TRACK, APPENDED],
    "moving onto a hex adjacent to the live end has appended it to the path, in order, with no frame advanced",
  );
});
