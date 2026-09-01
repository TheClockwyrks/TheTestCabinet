// Wick — instrumentation/seeded-replay-deterministic: two runs given
// `reset({ seed })` with the same seed, the same sequence of operations, and
// the same number of ticks report identical `run` and `rngState`, the spawns and
// the offers included.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — "A deterministic
// core"): "Given the same seed, the same sequence of operations, and the same
// number of ticks, the game reaches the same `run` and `rngState` every time."
// The comparison is exact equality of the documented `run`, because the
// sentence promises the same state and not a nearby one.
//
// WHY THE WORLD IS POSED AS IT IS. Each run is played with every faculty on, so
// the director spawns and the enemies chase; a level-up is queued and its
// overlay drawn, so the offer draw is in the sequence; the first offer is
// accepted and the run played on, so the acceptance and what follows are in it
// too. Both runs are the SAME sequence, so anything that differs is the
// generator or the state failing to replay.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import {
  captureReplay,
  createHarness,
  documentedRun,
  startRun,
  type Harness,
  type WickSnapshot,
} from "../harness";

/** A seed of this check's own. */
const SEED = 7311;

/** Ticks played before the level-up is queued, and after it is resolved. */
const BEFORE_TICKS = 90;
const AFTER_TICKS = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** One seeded run: play, level up, accept the first offer, play on. */
async function playSeeded(): Promise<{ overlay: WickSnapshot; end: WickSnapshot }> {
  await startRun(h, SEED);
  await h.step(BEFORE_TICKS);
  await h.debug.setPendingLevelUps(1);
  const overlay = await h.step(1);
  await h.debug.choose(0);
  const end = await h.step(AFTER_TICKS);
  return { overlay, end };
}

it("replays a seeded run to identical snapshots", async () => {
  const first = await playSeeded();
  const second = await captureReplay(h, "seeded", () => playSeeded());

  assertEqual(first.overlay.screen, "levelup", "the overlay the first run opened");
  assertGreaterThan(first.end.run.enemies.length, 0, "enemies the first run spawned");
  assertDeepEqual(
    second.overlay.run.offers,
    first.overlay.run.offers,
    "the offers drawn, in order",
  );
  assertEqual(second.end.rngState, first.end.rngState, "rngState at the end");
  assertDeepEqual(
    documentedRun(second.end.run),
    documentedRun(first.end.run),
    "the run at the end of the two seeded plays",
  );
});
