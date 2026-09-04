// instrumentation/surface-drives-the-running-game — a pose reaches the game that
// is being DRAWN, and the next snapshot reads the same change back.
//
// THE RULE. "Every scenario driven from code reaches the game through it", and "a
// pose sets one thing, and the game's own editor rules, simulation, sigils, and
// completion test run from there exactly as they do in play, so a scenario driven
// from code behaves exactly like one played by hand" (`specs/instrumentation.md`).
// The reading side is fixed under Snapshot shape: "Every field is read straight off
// the game's state, so what the snapshot reports is what the game holds." And what
// a pose does to a LIVE run is fixed under The machine: "While a run is live, a
// part one of them adds enters the run at its rest pose holding nothing."
//
// WHY THE CANVAS IS READ AND NOT ONLY THE SNAPSHOT. A surface that posed a copy of
// the game — a state built beside the one the loop is drawing, or a snapshot
// synthesized from the arguments it was handed — would answer every reading
// perfectly and change nothing a player could see. So the verdict is the two
// together: the picture on the canvas over the arm's anchor hex and over the mote's
// hex both change, and the snapshot reports the part and the mote that changed
// them.
//
// THE POSE is `openBareRun`'s empty world on `BARE` — no part, no mote, no fixture
// — so the two hexes read below hold nothing at all before the two poses and
// exactly one thing each after them. `EAST` is three hexes from `ORIGIN`, well
// clear of the arm's own footprint, so neither reading can be moved by the other's
// subject.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertNotNull,
} from "../assert";
import { HEX_PITCH } from "../constants";
import { hexCenter } from "../field";
import { BARE, EAST, ORIGIN } from "../fixtures";
import {
  captureStill,
  createHarness,
  differingShare,
  moteAt,
  openBareRun,
  partById,
  placePart,
  poseOf,
  spawnMote,
  type Harness,
} from "../harness";

/** A square over one hex, in logical units, addressed at its top-left corner. */
function overHex(hex: { q: number; r: number }): {
  x: number;
  y: number;
  size: number;
} {
  const centre = hexCenter(hex);
  return {
    x: centre.x - HEX_PITCH / 2,
    y: centre.y - HEX_PITCH / 2,
    size: HEX_PITCH,
  };
}

const ARM_SQUARE = overHex(ORIGIN);
const MOTE_SQUARE = overHex(EAST);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("poses the game that is being drawn, and reads the same change back", async () => {
  await openBareRun(h, { challenge: BARE });
  await h.advance(1);
  const emptyArmHex = await h.pixelRect(
    ARM_SQUARE.x,
    ARM_SQUARE.y,
    ARM_SQUARE.size,
    ARM_SQUARE.size,
  );
  const emptyMoteHex = await h.pixelRect(
    MOTE_SQUARE.x,
    MOTE_SQUARE.y,
    MOTE_SQUARE.size,
    MOTE_SQUARE.size,
  );

  const arm = await placePart(h, "arm", ORIGIN, 0);
  const mote = await spawnMote(h, EAST, "sol");
  await h.advance(1);
  await captureStill(h, "driven");

  const snapshot = await h.snapshot();
  assertLength(
    snapshot.editor.parts,
    1,
    "placePart added one part to the machine the run is running",
  );
  assertEqual(
    partById(snapshot, arm)?.kind,
    "arm",
    "and the next snapshot reports it, by the id the call answered",
  );
  assertNotNull(
    poseOf(snapshot, arm),
    "a part added while a run is live enters the run at its rest pose",
  );
  assertLength(
    snapshot.sim?.motes ?? [],
    1,
    "spawnMote added one mote to the field the run is running",
  );
  assertEqual(
    moteAt(snapshot, EAST)?.id,
    mote,
    "and the next snapshot reports it resting on the hex it was given",
  );

  const drawnArmHex = await h.pixelRect(
    ARM_SQUARE.x,
    ARM_SQUARE.y,
    ARM_SQUARE.size,
    ARM_SQUARE.size,
  );
  const drawnMoteHex = await h.pixelRect(
    MOTE_SQUARE.x,
    MOTE_SQUARE.y,
    MOTE_SQUARE.size,
    MOTE_SQUARE.size,
  );
  assertGreaterThan(
    differingShare(drawnArmHex, emptyArmHex),
    0,
    "the posed part appears on the field the game is drawing, not only in a reading",
  );
  assertGreaterThan(
    differingShare(drawnMoteHex, emptyMoteHex),
    0,
    "and so does the posed mote",
  );
});
