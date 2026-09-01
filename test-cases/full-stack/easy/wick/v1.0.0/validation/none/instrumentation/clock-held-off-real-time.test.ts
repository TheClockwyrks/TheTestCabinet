// Wick — instrumentation/clock-held-off-real-time: with the wall clock held off
// the simulation, `run.tick` advances only when the scenario advances it, while
// the build keeps running frames and a menu still answers a key press; giving
// the clock back lets `run.tick` advance on its own again.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — `setAutoStep`):
// "`setAutoStep(false)` stops the frame loop feeding the wall clock's delta
// time into the tick accumulator, so no tick runs until `step` or `advance`
// runs one. `setAutoStep(true)` returns the game to advancing itself"; "Drawing
// and input are unaffected either way: the build's own loop keeps running
// frames in real time, each reading the keys ... so a menu still answers a key
// press while the simulation is held." specs/controls.md: on `title`, "`up`,
// `down` move the highlight".
//
// WHY THE WORLD IS POSED AS IT IS. The harness has already taken the clock. A
// fresh run is left alone for half a second of real time: a build still feeding
// the accumulator accumulates ticks, a conformant one none. The menu half is
// read on the title with a key held through the build's OWN loop — no harness
// frame is stepped — so what answers the press is the loop the sentence says
// keeps running. Then the clock is handed back through `runFor`, which is
// `setAutoStep(true)` and real time, and the tick must have moved.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";

/** Real time with the clock held: tens of ticks' worth on any refresh rate. */
const FROZEN_MS = 500;

/** Real time a held key is left down for the build's own loop to read it. */
const PRESS_MS = 250;

/** Real time the game is handed back its own clock for. */
const RUNNING_MS = 400;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds the run's clock off real time, keeps the menu live, and gives the clock back", async () => {
  // Held: real time passes, nothing steps, the clock does not move.
  await startRun(h);
  await h.page.waitForTimeout(FROZEN_MS);
  const held = await h.snapshot();
  assertEqual(held.autoStep, false, "autoStep while held");
  assertEqual(held.run.tick, 0, "the run clock after real time with nothing stepped");

  // And the build's own loop still runs frames that read the keys: a menu
  // answers a press with no harness frame driven at all.
  await h.debug.reset();
  await h.page.keyboard.down("ArrowDown");
  await h.page.waitForTimeout(PRESS_MS);
  await h.page.keyboard.up("ArrowDown");
  const menu = await h.snapshot();
  await captureStill(h, "held");
  assertEqual(menu.screen, "title", "the screen the menu press was read on");
  assertEqual(menu.menuIndex, 1, "menuIndex after a press read by the build's own loop");
  assertEqual(menu.run.tick, 0, "the run clock, still held, after the press");

  // Given back: the run advances on its own.
  await startRun(h);
  await h.runFor(RUNNING_MS);
  const running = await h.snapshot();
  assertGreaterThan(
    running.run.tick,
    0,
    "the run clock after the game was handed back its own clock",
  );
});
