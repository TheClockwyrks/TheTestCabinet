// presentation/lamplighter-faces-left — with `facing` `"left"` the lamplighter is
// drawn as the produced idle sprite reflected.
//
// THE REQUIREMENT. `specs/assets.md` — "Animation", the lamplighter's bullet:
// "The produced idle sprite faces right, and the lamplighter drawn facing left is
// that sprite reflected across its vertical axis." `specs/world.md` — "Facing" —
// says when that picture is drawn: "`facing` is `"left"` or `"right"` and starts
// as `"right"` ... and the lamplighter's sprite is drawn facing the same way."
//
// WHAT IS READ. The PICTURE the frame laid on the stage, against the produced
// file as it was authored: the sprite is "mirrored" when what reached the canvas
// is that file reflected across its vertical axis, and "upright" when it is the
// file itself. Which way a build got there is not read and is not fixed — a build
// that reflects as it blits reports a negative destination width, and a build
// that draws a reflected copy it produced itself draws a source whose pixels are
// the produced file reflected — so the reading combines the two and answers about
// the picture alone.
//
// WHY THE OTHER FRAME IS NOT THE STANDARD. The frame drawn facing right decides
// nothing here: two frames that differ by a reflection are two frames that differ
// by a reflection whichever of them carries the mirror, so a build that draws the
// mirror on the wrong facing satisfies that comparison in both directions. The
// produced file is the standard the specification names, so this point reads the
// left-facing frame against it and `presentation/lamplighter-faces-right` reads
// the right-facing frame against it, and each fails on its own.
//
// THE SCENARIO. The frame drawn with `facing` `"right"`, which is what a fresh
// run starts on, and then the frame drawn with `facing` `"left"`, posed through
// the one operation `specs/instrumentation.md` gives for it — `setFacing`, which
// "Sets `facing` to `facing`" and touches nothing else. The turn is made rather
// than posed from a fresh run so that a build which latches its mirror is read
// after the turn. Nothing but the facing differs between the two frames: the
// world is emptied, every faculty is held, no key is down, and the lamplighter
// has not moved, so both frames draw the idle sprite at the stage centre.
//
// A SPRITE THAT IS ITS OWN REFLECTION passes. A build free to choose its own art
// may draw a lamplighter symmetric about its vertical axis, and reflecting such a
// sprite draws exactly the picture the requirement asks for, so the file and its
// reflection are one picture and there is nothing there to fail. The reading
// reports that case as its own answer and the point accepts it.
//
// There is no tolerance: which way round a sprite was drawn is a yes or a no.

import { afterEach, beforeEach, it } from "vitest";
import { LAMPLIGHTER_IDLE } from "../constants";
import { assertEqual, assertNotEqual } from "../assert";
import { captureStill, createHarness, isolate, type Harness } from "../harness";
import { oneSpriteDraw, orientationOf } from "./readouts";
import { primeSources } from "./sources";

/** The one produced file a still lamplighter is drawn from. */
const FILES = [LAMPLIGHTER_IDLE];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the lamplighter reflected while facing left", async () => {
  await isolate(h);
  await primeSources(h, FILES);

  await h.debug.setFacing("right");
  await h.step(1);

  await h.debug.setFacing("left");
  await h.step(1);
  const facingLeft = await orientationOf(
    h,
    await oneSpriteDraw(
      h,
      await h.lastCalls(),
      FILES,
      "the produced lamplighter sprite",
    ),
    FILES,
  );
  await captureStill(h, "left");

  assertNotEqual(
    facingLeft,
    "unknown",
    "the lamplighter drawn from its produced idle sprite while facing left, " +
      "one way round or the other (specs/assets.md)",
  );
  if (facingLeft !== "either") {
    assertEqual(
      facingLeft,
      "mirrored",
      "the lamplighter drawn facing left to be the produced idle sprite " +
        "reflected across its vertical axis (specs/assets.md)",
    );
  }
});
