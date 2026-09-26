// presentation/chest-draws-world-beneath — the chest overlay is drawn over the
// world, which stays where the tick that opened it left it.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("chest"): "An overlay over the
// held world, opened as specs/progression.md states." The same file's table of
// what advances fixes that the world beneath cannot move while the overlay is
// up: on "levelup, chest, paused" advancing is "Nothing. The world beneath
// holds exactly the tick it was at." specs/world.md ("The camera and the view")
// fixes where a world position is drawn: "A world point (wx, wy) is drawn at
// the stage position (wx - player.x + STAGE_CX, wy - player.y + STAGE_CY)", and
// specs/assets.md ("The sprites") that each produced sprite "is drawn centered
// on the thing it depicts".
//
// THE WORLD. The isolated night `beneath.ts` poses: the lamplighter off the
// world origin, three enemies of three types standing around it inside the
// view, and every driver switch off, so nothing on the field moves, spawns,
// fires, or is hit either side of the transition. A chest is placed on the
// lamplighter's center and the tick that collects it is run, which is the
// overlay's own route rather than a posed screen; with no weapon and no passive
// held the chest's result is its heal, which changes nothing that is drawn on
// the field.
//
// WHAT IS READ. The blits of OVERLAY_FRAMES frames drawn on `chest` after the
// tick that opened it, each against the state that tick ended at: the
// lamplighter's produced sprite and each enemy's own sheet, each centered on
// the stage point the camera formula gives its position. A build that stops
// drawing the world under the overlay fails on the missing blit, and one that
// keeps drawing it somewhere else fails on the center.
//
// TOLERANCE. DRAWN_POINT_TOLERANCE (1 unit) on each drawn center, the case's
// tolerance for a sprite a build may snap to whole device pixels. The enemies
// stand hundreds of units apart, so a world drawn at the wrong offset misses by
// far more.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  blitsOf,
  captureStill,
  createHarness,
  isolate,
  openChest,
  type Blit,
  type Harness,
} from "../harness";
import { assertWorldDrawn, poseWorld } from "./beneath";

/** Frames drawn on the overlay and read: the opening tick's and two after. */
const OVERLAY_FRAMES = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("keeps drawing the world where the opening tick left it, under the chest overlay", async () => {
  const posed = isolate(h);
  assertEqual(posed.screen, "playing", "the screen the overlay is opened from");
  const stood = poseWorld(h);

  const opened = await openChest(h);
  assertEqual(opened.screen, "chest", "the screen the opening tick left");
  captureStill(h, "beneath");

  const frames: Blit[][] = [blitsOf(h.lastCalls())];
  while (frames.length < OVERLAY_FRAMES) frames.push(await h.frameBlits());
  assertEqual(
    h.snapshot().screen,
    "chest",
    "the screen the overlay frames were drawn on",
  );

  for (const [index, blits] of frames.entries()) {
    assertWorldDrawn(h, blits, opened, stood, `overlay frame ${index + 1}`);
  }
});
