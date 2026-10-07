// presentation/lamplighter-faces-right — with facing right, the lamplighter
// drawn on the stage is the produced idle sprite as it was authored.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Facing"): "facing is 'left'
// or 'right' and starts as 'right' ... the lamplighter's sprite is drawn facing
// the same way." specs/ui.md ("playing") repeats it of the picture: the
// lamplighter is drawn at the stage center "facing the way facing says".
// specs/assets.md ("Animation") fixes which picture that is: "The produced idle
// sprite faces right, and the lamplighter drawn facing left is that sprite
// reflected across its vertical axis." The right-facing picture is therefore the
// produced file itself, and this point holds the frame to it.
//
// THE WORLD. An isolated playing run (`isolate`): nothing on the field, no
// weapon held, every driver switch off, and no key touched, so the lamplighter
// stands still and draws the idle sprite (specs/assets.md: the walk sheet is
// drawn "on a tick with a non-zero movement direction and the idle sprite on
// every other tick"). `setFacing` poses the one facing this point is about, and
// the frame drawn facing left belongs to the point about that facing.
//
// WHAT IS READ. The picture the frame put on the stage: the pixels of the
// produced file the lamplighter blit painted, reflected where the transform in
// force reflected them, so a build that mirrors in code and a build that shipped
// two files read the same way. That picture is the produced idle sprite as it
// was authored.
//
// WHY THE OTHER FACING IS NOT READ. The frames' relation to each other is one
// symmetric fact counted twice: a build that draws its sprite reflected on both
// facings, and a build that swaps the two, both satisfy "the two differ by a
// reflection" or fail it together, so neither point can fail alone. Each point
// reads its own facing against the produced file instead, which the
// specification now fixes, and a build that reflects the wrong one of the two
// fails that one alone.
//
// TOLERANCE. None. Both readings are decodings of the same produced file, so a
// build that draws it as it was authored matches byte for byte.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, isolate, type Harness } from "../harness";
import { LAMPLIGHTER_DIR, drawnUnder } from "./drawn";
import { assertSamePicture, drawnPicture, producedIdle } from "./facing";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the lamplighter as the produced sprite while facing right", async () => {
  const posed = isolate(h);
  assertEqual(posed.screen, "playing", "the screen the frame is drawn on");

  h.debug.setFacing("right");
  assertEqual(h.snapshot().run.player.facing, "right", "facing as posed");
  const right = await h.frameBlits();
  captureStill(h, "right");
  const facingRight = await drawnPicture(
    drawnUnder(right, LAMPLIGHTER_DIR, "lamplighter facing right"),
    "lamplighter facing right",
  );

  assertSamePicture(
    facingRight,
    await producedIdle(),
    "the lamplighter drawn facing right, against the produced idle sprite",
  );
});
