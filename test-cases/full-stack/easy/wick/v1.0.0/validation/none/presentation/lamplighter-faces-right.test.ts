// presentation/lamplighter-faces-right — with `facing` `"right"` the lamplighter's
// sprite is drawn the other way round from the frame drawn facing left.
//
// THE REQUIREMENT. `specs/world.md` — "Facing": "`facing` is `"left"` or
// `"right"` ... and the lamplighter's sprite is drawn facing the same way." This
// point decides the `"right"` half: a build that draws one picture whatever
// `facing` says fails it, and so does one that leaves the sprite reflected after
// the lamplighter has turned back.
//
// WHAT IS READ, AND WHY BOTH ROUTES ARE ACCEPTED. Which way round the produced
// sprite reached the canvas, relative to the file as it was produced. A build
// that reflects through the transform reports a negative destination width; a
// build that pre-renders a reflected copy draws a source whose pixels are the
// produced file reflected. `specs/assets.md` allows either — "produce one facing
// and mirror it in code, or produce both" — so the reading combines them.
//
// THE SCENARIO, AND WHY IT RUNS THIS WAY ROUND. The frame drawn with `facing`
// `"left"` first and the frame drawn with `facing` `"right"` after it, which is
// the turn this point is about: the sprite the right-facing frame draws is the
// left-facing one reflected back. Both facings are posed through `setFacing`,
// which `specs/instrumentation.md` says "Sets `facing` to `facing`" and nothing
// else. Nothing but the facing differs between the two frames: the world is
// emptied, every faculty is held, no key is down, and the lamplighter has not
// moved, so both frames draw the idle sprite at the stage centre.
//
// A SPRITE THAT IS ITS OWN REFLECTION passes, for the reason
// `presentation/lamplighter-faces-left` gives: reflecting such a sprite draws
// exactly the picture the requirement asks for, and there is nothing there to
// fail.
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

it("draws the lamplighter the other way round while facing right", async () => {
  await isolate(h);
  await primeSources(h, FILES);

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
  await captureStill(h, "right");

  assertNotEqual(
    facingRight,
    "unknown",
    "the lamplighter drawn from its produced idle sprite while facing right, " +
      "one way round or the other (specs/assets.md)",
  );
  if (facingLeft === "either") {
    assertTrue(
      facingRight === "either",
      "a sprite that is its own reflection to read the same way round " +
        "whichever way the lamplighter faces (specs/assets.md)",
    );
    return;
  }
  assertNotEqual(
    facingRight,
    facingLeft,
    "the produced lamplighter sprite drawn the other way round while facing " +
      "right, against the way the same sprite was drawn while facing left " +
      "(specs/world.md)",
  );
});
