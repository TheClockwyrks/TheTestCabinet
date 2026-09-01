// presentation/lamplighter-faces-left — with `facing` `"left"` the lamplighter's
// sprite is drawn reflected.
//
// THE REQUIREMENT. `specs/world.md` — "Facing": "`facing` is `"left"` or
// `"right"` and starts as `"right"` ... and the lamplighter's sprite is drawn
// facing the same way." `specs/assets.md` says how a build may do it: "The sprite
// faces the way `facing` says: produce one facing and mirror it in code, or
// produce both."
//
// WHAT IS READ, AND WHY BOTH ROUTES ARE ACCEPTED. Which way round the produced
// sprite reached the canvas, relative to the file as it was produced. A build
// that reflects through the transform reports a negative destination width; a
// build that pre-renders a reflected copy draws a source whose pixels are the
// produced file reflected. Both are conformant, so the reading combines them:
// the sprite is "mirrored" when exactly one of those two holds, and "upright"
// when neither or both do.
//
// THE SCENARIO. The frame drawn with `facing` `"right"`, which is what a fresh
// run starts on, and then the frame drawn with `facing` `"left"`, posed through
// the one operation `specs/instrumentation.md` gives for it — `setFacing`, which
// "Sets `facing` to `facing`" and touches nothing else. Nothing but the facing
// differs between the two frames: the world is emptied, every faculty is held,
// no key is down, and the lamplighter has not moved, so both frames draw the idle
// sprite at the stage centre.
//
// A SPRITE THAT IS ITS OWN REFLECTION passes. A build free to choose its own art
// may draw a lamplighter symmetric about its vertical axis, and reflecting such a
// sprite draws exactly the picture the requirement asks for. The reading reports
// that case as its own answer and the point accepts it, because there is nothing
// there to fail.
//
// There is no tolerance: which way round a sprite was drawn is a yes or a no.

import { afterEach, beforeEach, it } from "vitest";
import { LAMPLIGHTER_IDLE } from "../constants";
import { assertNotEqual, assertTrue } from "../assert";
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
  const facingRight = await orientationOf(
    h,
    await oneSpriteDraw(
      h,
      await h.lastCalls(),
      FILES,
      "the produced lamplighter sprite",
    ),
    FILES,
  );

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
  if (facingRight === "either") {
    assertTrue(
      facingLeft === "either",
      "a sprite that is its own reflection to read the same way round " +
        "whichever way the lamplighter faces (specs/assets.md)",
    );
    return;
  }
  assertNotEqual(
    facingLeft,
    facingRight,
    "the produced lamplighter sprite drawn reflected across its vertical " +
      "axis while facing left, against the way the same sprite was drawn " +
      "while facing right (specs/world.md)",
  );
});
