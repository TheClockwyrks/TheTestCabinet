// Wick — instrumentation/overlay-read-only: showing the overlay, letting it
// report over 120 ticks of a posed run, and hiding it leaves the game exactly
// as an identical run without it: the two runs' snapshots are identical.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — "Diagnostics"):
// "keep every source a pure read, so watching the overlay leaves the game as
// it is"; "it reads the game without changing it". With "A deterministic
// core": "Given the same seed, the same sequence of operations, and the same
// number of ticks, the game reaches the same `run` and `rngState` every
// time", so a run watched and a run unwatched must agree on both, exactly.
//
// WHY THE WORLD IS POSED AS IT IS. Two fresh runs from one seed with every
// faculty on, so the director spawns, the enemies chase, and Taper fires; the
// second is watched, the toggle pressed on its first frame and again on its
// last, so the overlay reports over the whole stretch, and both runs cover
// exactly 120 frames.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import {
  captureReplay,
  createHarness,
  documentedRun,
  pressOverlayToggle,
  startRun,
  type Harness,
  type WickSnapshot,
} from "../harness";

const SEED = 9137;
const RUN_TICKS = 120;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads the game without changing it", async () => {
  await startRun(h, SEED);
  const unwatched = await h.step(RUN_TICKS);
  assertGreaterThan(unwatched.run.enemies.length, 0, "enemies the unwatched run spawned");

  await startRun(h, SEED);
  const watched = await captureReplay(h, "watched", async (): Promise<WickSnapshot> => {
    await pressOverlayToggle(h);
    await h.step(RUN_TICKS - 2);
    return pressOverlayToggle(h);
  });

  assertEqual(watched.run.tick, unwatched.run.tick, "the ticks the two runs covered");
  assertEqual(watched.rngState, unwatched.rngState, "rngState after the watched run");
  assertDeepEqual(
    documentedRun(watched.run),
    documentedRun(unwatched.run),
    "the run after the watched stretch, against the unwatched one",
  );
});
