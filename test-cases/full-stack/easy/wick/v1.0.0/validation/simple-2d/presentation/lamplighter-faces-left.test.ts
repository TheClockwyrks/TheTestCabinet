// presentation/lamplighter-faces-left — with facing left, the lamplighter drawn
// on the stage is the produced idle sprite reflected across its vertical axis.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Facing"): "facing is 'left'
// or 'right' ... and the lamplighter's sprite is drawn facing the same way."
// specs/ui.md ("playing") repeats it of the picture: the lamplighter is drawn
// at the stage center "facing the way facing says". specs/assets.md
// ("Animation") fixes which picture that is: "The produced idle sprite faces
// right, and the lamplighter drawn facing left is that sprite reflected across
// its vertical axis." The left-facing picture is therefore the produced file
// reflected, and this point holds the frame to it.
//
// THE WORLD. An isolated playing run (`isolate`): nothing on the field, no
// weapon held, every driver switch off, and no key touched, so the lamplighter
// stands still and draws the idle sprite (specs/assets.md: the walk sheet is
// drawn "on a tick with a non-zero movement direction and the idle sprite on
// every other tick"). `setFacing` poses the one facing this point is about, and
// the frame drawn facing right belongs to the point about that facing.
//
// WHAT IS READ. The picture the frame put on the stage: the pixels of the
// produced file the lamplighter blit painted, reflected where the transform in
// force reflected them, so a build that mirrors in code and a build that shipped
// two files read the same way. That picture is the produced idle sprite
// reflected across its vertical axis.
//
// WHY THE OTHER FACING IS NOT READ. The frames' relation to each other is one
// symmetric fact counted twice: a build that draws its sprite reflected on both
// facings, and a build that swaps the two, both satisfy "the two differ by a
// reflection" or fail it together, so neither point can fail alone. Each point
// reads its own facing against the produced file instead, which the
// specification now fixes, and a build that leaves this facing unreflected fails
// this point alone.
//
// TOLERANCE. None. A reflection of a decoded bitmap is a reordering of its own
// bytes, so a conformant build matches pixel for pixel.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, isolate, type Harness } from "../harness";
import { LAMPLIGHTER_DIR, drawnUnder } from "./drawn";
import { assertMirrored, drawnPicture, producedIdle } from "./facing";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the lamplighter as the produced sprite reflected while facing left", async () => {
  const posed = isolate(h);
  assertEqual(posed.screen, "playing", "the screen the frame is drawn on");

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
    await producedIdle(),
    "the lamplighter drawn facing left, against the produced idle sprite",
  );
});
