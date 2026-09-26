// instrumentation/pointer-builds-a-machine-without-a-frame — a whole machine,
// placed from code, between two frames.
//
// THE RULE. "**Each of the three pointer operations takes effect immediately, when
// it is called, rather than being sampled once per frame.**... No frame need pass
// between them, so a whole machine can be placed from code without advancing the
// game at all" (`specs/instrumentation.md`, The editor's hands). The three "feed
// the same input path the player's pointer feeds: targeting, selection, drags,
// lays, and the focus rule all run as `specs/editor.md` and `specs/controls.md`
// state."
//
// THE PREVIOUS THREE POINTS TAKE THE THREE OPERATIONS ONE AT A TIME; THIS ONE
// TAKES THEM AS A SEQUENCE, because that is what the sentence is about. Sixteen
// pointer operations run back to back with no frame advanced between any two of
// them — three drags out of the tray, one drag of a placed part across the field,
// and a lay that walks a track two cells further — and the machine the snapshot
// reports afterwards is read with no frame advanced at all.
//
// WHAT EACH GESTURE IS REQUIRED TO HAVE DONE comes from `specs/editor.md`. "From
// the tray: the ghost is a new part at the targeted hex, at rotation `0` and
// length `1`. Releasing on a legal hex places it and selects it. A `track` entry
// places a single open cell." "From the field: a press on a part selects it at
// once and begins a move. The drag's offset is the targeted hex minus the pressed
// hex, and the whole part translates by it". "While laying, moving the pointer
// onto a hex adjacent to the live end appends it to the path when the placement
// rules allow", and "The release ends the lay, leaving the path as laid." The
// parts are reported "in placement order", which is the order the three tray drags
// ran in.
//
// THE WORLD IS POSED, NOT SEARCHED. A posed challenge whose permitted kinds hold
// the three the check drags, an empty machine, and a layout whose every placement
// is legal under `specs/parts.md`: no two arms share an anchor, no footprint is
// shared, and the track's cells are distinct and consecutively adjacent. The tray
// slots are derived from the challenge the way `specs/editor.md` derives them
// rather than counted by hand.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertLength,
  assertNotNull,
} from "../assert";
import { ARM_MIN_LEN, type PartName } from "../constants";
import { at, hexCenter } from "../field";
import { derivedTray, type Challenge } from "../formats";
import {
  captureStill,
  createHarness,
  dragFromTray,
  dragHex,
  openChallengeDocument,
  pressAt,
  moveTo,
  releasePointer,
  type Harness,
} from "../harness";
import { REPEATING } from "../fixtures";

/** Where each tray drag drops its part, and where the moved one ends up. */
const ARM_AT = at(0, 0);
const PISTON_DROPPED = at(2, 0);
const PISTON_MOVED = at(2, -2);
const TRACK_START = at(-2, 2);
const TRACK_MIDDLE = at(-1, 2);
const TRACK_END = at(0, 2);
const TRACK_CELLS = [TRACK_START, TRACK_MIDDLE, TRACK_END];

/** The tray slot a challenge offers `kind` at (`specs/editor.md`, The tray). */
function slotOf(challenge: Challenge, kind: PartName): number {
  return derivedTray(challenge).findIndex((entry) => entry.kind === kind);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the finished machine in the snapshot with no frame passing between the calls", async () => {
  await openChallengeDocument(h, REPEATING);
  await h.debug.clearMachine();

  await dragFromTray(h, slotOf(REPEATING, "arm"), ARM_AT);
  await dragFromTray(h, slotOf(REPEATING, "piston"), PISTON_DROPPED);
  await dragFromTray(h, slotOf(REPEATING, "track"), TRACK_START);
  await dragHex(h, PISTON_DROPPED, PISTON_MOVED);
  await pressAt(h, hexCenter(TRACK_START));
  await moveTo(h, hexCenter(TRACK_MIDDLE));
  await moveTo(h, hexCenter(TRACK_END));
  await releasePointer(h);

  const built = await h.snapshot();

  await h.advance(1);
  await captureStill(h, "built");

  assertLength(
    built.editor.parts,
    3,
    "the three tray drags placed three parts, with no frame advanced between the calls",
  );
  const [arm, piston, track] = built.editor.parts;

  assertEqual(arm?.kind, "arm", "the first tray drag placed the arm");
  assertEqual(arm?.q, ARM_AT.q, "the arm is where its drag released");
  assertEqual(arm?.r, ARM_AT.r, "the arm is where its drag released");
  assertEqual(arm?.rotation, 0, "a tray ghost opens at rotation 0");
  assertEqual(arm?.length, ARM_MIN_LEN, "a tray ghost opens at length 1");

  assertEqual(piston?.kind, "piston", "the second tray drag placed the piston");
  assertEqual(
    piston?.q,
    PISTON_MOVED.q,
    "the field drag translated the piston by the offset it was dragged",
  );
  assertEqual(
    piston?.r,
    PISTON_MOVED.r,
    "the field drag translated the piston by the offset it was dragged",
  );

  assertEqual(track?.kind, "track", "the third tray drag placed the track");
  assertNotNull(track?.cells, "a track carries its path");
  assertDeepEqual(
    track?.cells,
    TRACK_CELLS,
    "the lay appended each hex the pointer was moved onto, in order",
  );
  assertEqual(
    track?.closed,
    false,
    "a track entry places a single open cell, and the lay left it open",
  );
});
