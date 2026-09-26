// presentation/lamplighter-faces-right — with `facing` `"right"`, the picture
// the lamplighter is laid on the stage as is the produced sprite as authored.
//
// WHERE THE REQUIREMENT COMES FROM. `specs/assets.md`, Animation: "The produced
// idle sprite faces right, and the lamplighter drawn facing left is that sprite
// reflected across its vertical axis." `specs/world.md`, Facing: `facing`
// "starts as `"right"`" and "the lamplighter's sprite is drawn facing the same
// way". So the lamplighter a frame draws while `facing` is `"right"` is the
// produced file's own picture, the way it was authored.
//
// WHAT IS READ. The PICTURE on the canvas, not the transform that put it there.
// `presentation/sprites.ts` samples the canvas over the box the blit landed in
// and compares what it holds against the produced file's own pixels and against
// those pixels reflected, answering which of the two the frame laid down. A
// build is free to reach the reflected picture however it likes, so a reading of
// the transform's sign would decide the build's design rather than the picture a
// player sees, and would fail a build whose left-facing lamplighter is a
// reflected copy it prepared for itself.
//
// WHICH FILE IT IS READ AGAINST. The one the blit drew from, which the harness
// attributes to the produced tree. A still lamplighter draws the idle sprite the
// Animation bullet pins, and a build that draws something else there is failed
// by `presentation/lamplighter-idle-when-still`, which is that requirement's own
// point.
//
// THE BOUND. None on the picture: which of the two it fits. The two readings are
// taken as equal within `FACING_MARGIN`, so a sprite drawn symmetric about its
// vertical axis is read as `"either"` and passes, since nothing on the canvas
// can tell which way round such a picture was laid.
//
// THE WORLD, AND WHY. An isolated world holding nothing, with `facing` posed
// through `setFacing`, which `specs/instrumentation.md` makes a pose of that
// field alone, so no movement, no key, and no other actor is involved. No key
// is held, so the idle sprite is what the frame draws.

import { afterEach, beforeEach, it } from "vitest";
import { assertNotEqual, assertNotNull } from "../assert";
import { STAGE_CX, STAGE_CY } from "../constants";
import {
  blitsNearStage,
  captureStill,
  createHarness,
  isolate,
  type Blit,
  type Harness,
} from "../harness";
import { LAMPLIGHTER_FILES, SPRITE_TOL, drawnFacing } from "./sprites";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("lays the lamplighter down as its sprite is authored while facing right", async () => {
  isolate(h);
  h.debug.setFacing("right");

  const blits = await h.frameBlits();
  captureStill(h, "right");
  const drawn = blitsNearStage(h, blits, STAGE_CX, STAGE_CY, SPRITE_TOL).filter(
    (blit) => LAMPLIGHTER_FILES.includes(blit.id),
  );
  const sprite = drawn.length === 0 ? null : drawn[drawn.length - 1];
  assertNotNull(sprite, "a produced lamplighter sprite while facing right");

  const facing = await drawnFacing(h, sprite as Blit);
  assertNotNull(
    facing,
    "the way round the picture the frame laid on the stage reads",
  );
  assertNotEqual(
    facing,
    "left",
    "the picture the lamplighter was laid down as while facing right, which " +
      "is the produced sprite as authored (or a sprite symmetric about its " +
      "vertical axis, which reads as either)",
  );
});
