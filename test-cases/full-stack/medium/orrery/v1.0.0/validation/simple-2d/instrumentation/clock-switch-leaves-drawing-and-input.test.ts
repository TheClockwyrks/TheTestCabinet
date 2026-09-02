// instrumentation/clock-switch-leaves-drawing-and-input — holding the simulation
// off the wall clock stops the simulation and nothing else.
//
// THE RULE. "Drawing and input are unaffected by the switch either way: the loop
// keeps rendering and keeps reading the keys, so a menu still answers a key press
// while the simulation is held" (`specs/instrumentation.md`, The clock). The gate
// it belongs to is stated one line above it: `setAutoStep(false)` "stops the frame
// loop advancing the simulation from the wall clock", and "a gate changes only what
// it names". Under either engine the same hold is the engine's scripted clock, and
// the engine "advances the game frame by frame" while it "drives the actions the
// game registers".
//
// THE KEY IS A REAL KEY. The surface "carries no operation for the registered
// actions", so the press below goes through the runtime's own keyboard, on the
// binding `specs/controls.md` fixes for `down` — which is what "keeps reading the
// keys" is about.
//
// THE SCREEN IS THE TITLE MENU, because that is the example the rule itself gives
// and because it is the one screen whose whole content is the thing the key moves:
// `menuIndex` is what a press must change, and `TITLE_ITEMS` is what it moves
// through. No run is live at all, so nothing the simulation does can be mistaken
// for the menu answering.
//
// THE VERDICT is both halves. The menu answers: two presses of `down` move
// `menuIndex` by one each. And the loop keeps drawing: every frame driven while the
// simulation is held issues drawing operations, and the picture on the canvas
// changes when the highlight moves — a build that had stopped rendering with the
// clock would leave the last frame's picture standing however far the menu moved.

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

it("answers a key and keeps drawing while the simulation is held", async () => {
  await openTitle(h);

  const opened = await h.snapshot();
  assertEqual(opened.screen, "title", "the title menu is showing");
  assertEqual(opened.menuIndex, 0, "with its first item highlighted");
  assertNull(opened.sim, "and no run live, so nothing but the menu can answer");
  assertGreaterThan(
    TITLE_ITEMS.length,
    2,
    "the title menu has room for two presses of down",
  );

  const before = await h.pixelRect(0, 0, STAGE_W, STAGE_H);

  const answered = await captureReplay(h, "answering", async () => {
    // The loop keeps drawing while the simulation is held.
    for (let frame = 0; frame < WATCHED_FRAMES; frame += 1) {
      await h.advance(1);
      assertGreaterThan(
        drawOps(await h.lastCalls()),
        0,
        "every frame advanced with the simulation held still renders",
      );
    }
    const first = await pressAction(h, "down");
    const second = await pressAction(h, "down");
    return { first: first.menuIndex, second: second.menuIndex };
  });

  assertEqual(
    answered.first,
    1,
    "the loop keeps reading the keys, so down moves the highlight by one",
  );
  assertEqual(answered.second, 2, "and the next press moves it again");

  const after = await h.pixelRect(0, 0, STAGE_W, STAGE_H);
  assertGreaterThan(
    differingShare(after, before),
    0,
    "and the picture the loop keeps redrawing is not the one it left before the highlight moved",
  );
});
