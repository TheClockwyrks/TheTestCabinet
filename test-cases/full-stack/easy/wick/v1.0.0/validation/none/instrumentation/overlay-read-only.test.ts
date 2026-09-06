// Wick — instrumentation/overlay-read-only: showing the overlay, letting it
// report over 120 frames of a posed run, and hiding it leaves the game exactly
// as it was.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — "Diagnostics"):
// "keep every source a pure read, so watching the overlay leaves the game as
// it is"; "it reads the game without changing it". specs/instrumentation.md
// (`step`): "On every other screen the update ticks nothing: the menu edges
// are read, the loops are reconciled, `muted` is mirrored, and `run.tick` is
// untouched", so on `paused` the frames the overlay reports over change
// nothing of the run, and the run read after them is the run read before.
//
// WHY THE WORLD IS POSED AS IT IS. A run posed with one entity of every kind,
// a clock, a spawn timer, and a weapon with a timer counting, then paused, so
// every source the overlay reads has something to read and a source that
// wrote back would be caught on that field. The toggle is pressed on the
// first frame and again on the last, so the overlay reports over the whole
// stretch, and the documented run is compared exactly across it.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import {
  captureReplay,
  createHarness,
  documentedRun,
  poseScreen,
  pressOverlayToggle,
  type Harness,
  type WickSnapshot,
} from "../harness";
import { poseLiveNight } from "../clock/stage";

const RUN_FRAMES = 120;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads the game without changing it", async () => {
  await poseLiveNight(h);
  await h.debug.setTick(600);
  await h.debug.setSpawnTimer(0.4);
  const paused = await poseScreen(h, "paused");
  assertEqual(paused.screen, "paused", "the screen the overlay reports over");
  assertGreaterThan(
    paused.run.enemies.length,
    0,
    "enemies the posed run holds for the overlay to report",
  );

  const watched = await captureReplay(
    h,
    "watched",
    async (): Promise<WickSnapshot> => {
      await pressOverlayToggle(h);
      await h.step(RUN_FRAMES - 2);
      return pressOverlayToggle(h);
    },
  );

  assertEqual(watched.screen, "paused", "the screen after the watched stretch");
  assertDeepEqual(
    documentedRun(watched.run),
    documentedRun(paused.run),
    "the run after the watched stretch, against the run before it",
  );
});
