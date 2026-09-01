// presentation/lamplighter-faces-left — with facing left, the lamplighter's
// sprite is drawn mirrored against the frame drawn facing right.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Facing"): "facing is 'left'
// or 'right' ... and the lamplighter's sprite is drawn facing the same way."
// specs/ui.md ("playing") repeats it of the picture: the lamplighter is drawn
// at the stage center "facing the way facing says". specs/assets.md
// ("Animation") fixes what "facing the other way" means for a sprite and leaves
// the build the choice of how: "The sprite faces the way facing says: produce
// one facing and mirror it in code, or produce both."
//
// THE WORLD. An isolated playing run (`isolate`): nothing on the field, no
// weapon held, every driver switch off, and no key touched, so the lamplighter
// stands still and draws the same idle sprite on both frames. `setFacing` poses
// each side in turn, which is the one thing that differs between them.
//
// WHAT IS READ. The picture each frame put on the stage: the pixels of the
// produced file the lamplighter blit painted, reflected where the transform in
// force reflected them, so a build that mirrors in code and a build that
// shipped two files read the same way. The facing-left picture is the
// facing-right picture reflected across its vertical axis.
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

it("draws the lamplighter mirrored while facing left", async () => {
  const posed = isolate(h);
  assertEqual(posed.screen, "playing", "the screen the frames are drawn on");

  h.debug.setFacing("right");
  assertEqual(h.snapshot().run.player.facing, "right", "facing as posed");
  const right = await h.frameBlits();
  const facingRight = await drawnPicture(
    drawnUnder(right, LAMPLIGHTER_DIR, "lamplighter facing right"),
    "lamplighter facing right",
  );

  h.debug.setFacing("left");
  assertEqual(h.snapshot().run.player.facing, "left", "facing as posed");
  const left = await h.frameBlits();
  captureStill(h, "left");
  const facingLeft = await drawnPicture(
    drawnUnder(left, LAMPLIGHTER_DIR, "lamplighter facing left"),
    "lamplighter facing left",
  );

  assertMirrored(
    facingLeft,
    facingRight,
    "the lamplighter drawn facing left, against the frame drawn facing right",
  );
});
