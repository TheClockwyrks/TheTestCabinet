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
// WHY THE FRAME'S OWN OPERATIONS ARE READ AND NOT ONLY THE SNAPSHOT. A surface that
// posed a copy of the game — a state built beside the one the loop is drawing, or a
// snapshot synthesized from the arguments it was handed — would answer every
// reading perfectly and hand the loop nothing to draw. So the verdict is the two
// together: the frame after the two poses issues a hub draw on the arm's anchor hex
// and a mote draw on the mote's hex, neither of which the frame before them issued,
// and the snapshot reports the part and the mote that put them there.
//
// THE POSE is `openBareRun`'s empty world on `BARE` — no part, no mote, no fixture
// — so the two hexes read below are drawn on by nothing at all before the two poses
// and by exactly one sprite each after them. `EAST` is three hexes from `ORIGIN`,
// well clear of the arm's own footprint, so neither reading can be moved by the
// other's subject.
//
// EACH READING IS FENCED BY THE SPRITE'S OWN CANVAS — `HUB_SPRITE_SIZE` (`40`) and
// `MOTE_SPRITE_SIZE` (`44`), which `specs/assets.md` authors each sprite at and
// draws "at that size in logical units, centered on the thing it depicts, so
// nothing is scaled at draw time". The gripper the arm also puts on the field is on
// a canvas of its own, so it is never mistaken for the hub.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNotNull } from "../assert";
import { HUB_SPRITE_SIZE, MOTE_SPRITE_SIZE } from "../constants";
import { hexCenter, type Hex } from "../field";
import { BARE, EAST, ORIGIN } from "../fixtures";
import {
  captureStill,
  createHarness,
  imagesNear,
  moteAt,
  openBareRun,
  partById,
  placePart,
  poseOf,
  spawnMote,
  type DrawCall,
  type Harness,
  type ImageDraw,
} from "../harness";

/** How near a sprite's centre must land to count as drawn on a hex. */
const ON_POINT = 6;

/** The sprites a frame drew on a hex, at the canvas the sprite is authored on. */
function spritesOn(
  calls: readonly DrawCall[],
  hex: Hex,
  size: number,
): ImageDraw[] {
  return imagesNear(calls, hexCenter(hex), ON_POINT).filter(
    (draw) => draw.image.width === size && draw.image.height === size,
  );
}

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
  const empty = await h.lastCalls();
  assertLength(
    spritesOn(empty, ORIGIN, HUB_SPRITE_SIZE),
    0,
    "the empty world draws no hub on the hex the arm is about to stand on",
  );
  assertLength(
    spritesOn(empty, EAST, MOTE_SPRITE_SIZE),
    0,
    "and no mote on the hex the mote is about to rest on",
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

  const drawn = await h.lastCalls();
  assertLength(
    spritesOn(drawn, ORIGIN, HUB_SPRITE_SIZE),
    1,
    "the posed part appears on the field the game is drawing, not only in a reading",
  );
  assertLength(
    spritesOn(drawn, EAST, MOTE_SPRITE_SIZE),
    1,
    "and so does the posed mote",
  );
});
