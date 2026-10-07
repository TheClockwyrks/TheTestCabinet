// instrumentation/clock-switch-leaves-drawing — holding the simulation off the
// wall clock stops the simulation and not the rendering.
//
// THE RULE. "Drawing and input are unaffected by the switch either way: the loop
// keeps rendering and keeps reading the keys, so a menu still answers a key press
// while the simulation is held" (`specs/instrumentation.md`, The clock), under the
// gate stated one line above it: `setAutoStep(false)` "stops the frame loop
// advancing the simulation from the wall clock", and "a gate changes only what it
// names". Under either engine the same hold is the engine's scripted clock, and
// the engine "advances the game frame by frame". This point reads the DRAWING half
// of that sentence; the input half is `clock-switch-leaves-input`.
//
// WHAT THIS READS THAT `advance-runs-real-frames` DOES NOT. That point asks
// whether ONE advanced frame is a real frame — an update followed by a render, with
// the canvas reflecting the state the frame produced. This one asks what the SWITCH
// leaves alone: that EVERY frame the held clock is advanced by issues its drawing
// operations, over a stretch of them rather than one, and that across that stretch
// the picture on the canvas follows the state rather than standing at whatever the
// loop last left. A build that rendered its first held frame and then went quiet
// passes there and fails here.
//
// THE SCREEN IS THE TITLE MENU, for the reason `clock-switch-leaves-input` gives:
// no run is live, so nothing the simulation does can be mistaken for the loop
// drawing. Moving the highlight is this check's posing step — the point that
// decides that a held loop still answers a key is `clock-switch-leaves-input` — and
// what the canvas does about it is the verdict.
//
// THE VERDICT. Each of `WATCHED_FRAMES` frames advanced with the simulation held
// issues drawing operations, and the picture the loop keeps redrawing after the
// highlight has moved is not the one it left before.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertNull } from "../assert";
import { STAGE_H, STAGE_W, TITLE_ITEMS } from "../constants";
import {
  captureReplay,
  createHarness,
  differingShare,
  drawOps,
  openTitle,
  pressAction,
  type Harness,
} from "../harness";

/** How many frames of held game time the canvas is watched over. */
const WATCHED_FRAMES = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps drawing every frame while the simulation is held", async () => {
  await openTitle(h);

  const opened = await h.snapshot();
  assertEqual(opened.screen, "title", "the title menu is showing");
  assertNull(opened.sim, "and no run live, so nothing but the loop is drawing");
  assertGreaterThan(
    TITLE_ITEMS.length,
    1,
    "the title menu has room for the press that moves the highlight",
  );

  const before = await h.pixelRect(0, 0, STAGE_W, STAGE_H);

  const moved = await captureReplay(h, "drawing", async () => {
    for (let frame = 0; frame < WATCHED_FRAMES; frame += 1) {
      await h.advance(1);
      assertGreaterThan(
        drawOps(await h.lastCalls()),
        0,
        "every frame advanced with the simulation held still renders",
      );
    }
    return (await pressAction(h, "down")).menuIndex;
  });

  assertEqual(
    moved,
    1,
    "the highlight moved, which is the state this point watches the picture follow",
  );

  const after = await h.pixelRect(0, 0, STAGE_W, STAGE_H);
  assertGreaterThan(
    differingShare(after, before),
    0,
    "and the picture the loop keeps redrawing is not the one it left before the highlight moved",
  );
});
