// presentation/lamplighter-faces-right — with `facing` `"right"` the lamplighter
// is drawn as the produced idle sprite itself.
//
// THE REQUIREMENT. `specs/assets.md` — "Animation", the lamplighter's bullet:
// "The produced idle sprite faces right, and the lamplighter drawn facing left is
// that sprite reflected across its vertical axis." `specs/world.md` — "Facing" —
// says when that picture is drawn: "the lamplighter's sprite is drawn facing the
// same way" as `facing`. This point decides the `"right"` half: the picture the
// stage carries while `facing` is `"right"` is the produced file as it was
// authored, so a build that draws one picture whatever `facing` says fails it,
// and so does one that leaves the sprite reflected after the lamplighter has
// turned back.
//
// WHAT IS READ. The PICTURE the frame laid on the stage, against the produced
// file as it was authored: "upright" when what reached the canvas is that file,
// "mirrored" when it is the file reflected across its vertical axis. Which way a
// build got there is not read and is not fixed — a build that reflects as it
// blits reports a negative destination width, and a build that draws a reflected
// copy it produced itself draws a source whose pixels are the produced file
// reflected — so the reading combines the two and answers about the picture
// alone.
//
// WHY THE OTHER FRAME IS NOT THE STANDARD. Two frames that differ by a
// reflection differ by a reflection whichever of them carries the mirror, so a
// build that mirrors the right-facing frame and leaves the left-facing one
// upright satisfies a comparison between them. The produced file is the standard
// the specification names, so this point reads the right-facing frame against it
// and `presentation/lamplighter-faces-left` reads the left-facing frame against
// it, and each fails on its own.
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
// `presentation/lamplighter-faces-left` gives: the file and its reflection are
// one picture, and there is nothing there to fail.
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

it("draws the produced idle sprite as it was authored while facing right", async () => {
  await isolate(h);
  await primeSources(h, FILES);

  await h.debug.setFacing("left");
  await h.step(1);

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
  if (facingRight !== "either") {
    assertEqual(
      facingRight,
      "upright",
      "the lamplighter drawn facing right to be the produced idle sprite as " +
        "it was authored (specs/assets.md)",
    );
  }
});
