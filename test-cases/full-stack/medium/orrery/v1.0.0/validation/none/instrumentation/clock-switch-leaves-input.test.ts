// instrumentation/clock-switch-leaves-input — holding the simulation off the wall
// clock stops the simulation and not the keys.
//
// THE RULE. "Drawing and input are unaffected by the switch either way: the loop
// keeps rendering and keeps reading the keys, so a menu still answers a key press
// while the simulation is held" (`specs/instrumentation.md`, The clock). The gate
// it belongs to is stated one line above it: `setAutoStep(false)` "stops the frame
// loop advancing the simulation from the wall clock", and "a gate changes only what
// it names". Under either engine the same hold is the engine's scripted clock, and
// the engine "drives the actions the game registers" while it "advances the game
// frame by frame". This point reads the INPUT half of that sentence; the drawing
// half is `clock-switch-leaves-drawing`.
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
// THE VERDICT. With the simulation held, two presses of `down` move `menuIndex` by
// one each. A build that stopped reading the keys with the clock leaves the
// highlight where it stood.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertNull } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureReplay,
  createHarness,
  openTitle,
  pressAction,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("answers a key press while the simulation is held", async () => {
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

  const answered = await captureReplay(h, "answering", async () => {
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
});
