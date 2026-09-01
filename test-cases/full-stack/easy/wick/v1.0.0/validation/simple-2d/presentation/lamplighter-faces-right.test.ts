// presentation/lamplighter-faces-right — with facing right, the lamplighter's
// sprite is drawn the other way round from the frame drawn facing left.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Facing"): "facing is 'left'
// or 'right' and starts as 'right' ... the lamplighter's sprite is drawn facing
// the same way." specs/ui.md ("playing") repeats it of the picture: the
// lamplighter is drawn at the stage center "facing the way facing says".
// specs/assets.md ("Animation") leaves the build the choice of how: "produce one
// facing and mirror it in code, or produce both", so which of the two frames
// carries the reflection is the build's and that the two differ by one is not.
//
// THE WORLD. An isolated playing run (`isolate`): nothing on the field, no
// weapon held, every driver switch off, and no key touched, so the lamplighter
// stands still and draws the same idle sprite on both frames. `setFacing` poses
// each side in turn, left first so the facing-right frame is the one reached
// last and read as the subject.
//
// WHAT IS READ. The picture each frame put on the stage: the pixels of the
// produced file the lamplighter blit painted, reflected where the transform in
// force reflected them. The facing-right picture is the facing-left picture
// reflected across its vertical axis, so a build that draws one sprite both
// ways round fails here as it fails the facing-left point.
//
// TOLERANCE. None. A reflection of a decoded bitmap is a reordering of its own
// bytes, so a conformant build matches pixel for pixel.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, isolate, type Harness } from "../harness";
import { LAMPLIGHTER_DIR, drawnUnder } from "./drawn";
import { assertMirrored, drawnPicture } from "./facing";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the lamplighter the other way round while facing right", async () => {
  const posed = isolate(h);
  assertEqual(posed.screen, "playing", "the screen the frames are drawn on");

  h.debug.setFacing("left");
  assertEqual(h.snapshot().run.player.facing, "left", "facing as posed");
  const left = await h.frameBlits();
  const facingLeft = await drawnPicture(
    drawnUnder(left, LAMPLIGHTER_DIR, "lamplighter facing left"),
    "lamplighter facing left",
  );

  h.debug.setFacing("right");
  assertEqual(h.snapshot().run.player.facing, "right", "facing as posed");
  const right = await h.frameBlits();
  captureStill(h, "right");
  const facingRight = await drawnPicture(
    drawnUnder(right, LAMPLIGHTER_DIR, "lamplighter facing right"),
    "lamplighter facing right",
  );

  assertMirrored(
    facingRight,
    facingLeft,
    "the lamplighter drawn facing right, against the frame drawn facing left",
  );
});
