// Wick — instrumentation/overlay-read-only: showing the overlay, letting it
// report over 120 frames of a posed run, and hiding it leaves the game exactly
// as it was, on a paused run and on a playing one.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — "Diagnostics"):
// "keep every source a pure read, so watching the overlay leaves the game as
// it is"; "it reads the game without changing it". specs/instrumentation.md
// (`step`): "On every other screen the update ticks nothing: the menu edges
// are read, the loops are reconciled, `muted` is mirrored, and `run.tick` is
// untouched", so on `paused` the frames the overlay reports over change
// nothing of the run, and the run read after them is the run read before.
// specs/world.md ("One tick"): "`tick` rises by one" on every tick, "The run
// clock `time` is `tick / TICK_HZ` seconds", recovery holds `hp` at `maxHp`,
// and every other phase moves an entity the world holds or runs under a
// driver switch; so on `playing` with every switch off and the lamplighter
// alone, the frames the overlay reports over raise `tick` and `time` and
// change nothing else.
//
// WHY THE WORLD IS POSED AS IT IS. Two stretches, each watched from the
// toggle pressed on its first frame to the toggle pressed on its last, so the
// overlay reports over the whole of each. The paused stretch holds a run
// posed with one entity of every kind, a clock, a spawn timer, and a weapon
// with a timer counting, so every source the overlay reads has something to
// read and a source that wrote back would be caught on that field; the
// documented run is compared exactly across it. The playing stretch holds an
// isolated run, so the frames tick for real and a source that writes back
// only while the game ticks is caught too; the run after it is the run before
// with the clock advanced by the frames driven.
//
// TOLERANCE. None on the paused stretch and on `tick`; `TIME_TOL` on `time`,
// a figure a build may reach by dividing or by summing `TICK_DT`.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertNear,
} from "../assert";
import { TICK_HZ } from "../constants";
import {
  captureReplay,
  createHarness,
  documentedRun,
  isolate,
  poseScreen,
  pressOverlayToggle,
  type Harness,
  type WickSnapshot,
} from "../harness";
import { poseLiveNight } from "../clock/stage";

const RUN_FRAMES = 120;

/** How far `time` may sit from `tick / TICK_HZ` after the playing stretch. */
const TIME_TOL = 1e-6;

/** Show the overlay, let it report over `RUN_FRAMES` frames, and hide it. */
async function watch(h: Harness): Promise<WickSnapshot> {
  await pressOverlayToggle(h);
  await h.step(RUN_FRAMES - 2);
  return pressOverlayToggle(h);
}

/** The documented run less the clock, which a playing stretch advances. */
function runLessClock(run: WickSnapshot["run"]): Record<string, unknown> {
  const { tick: _tick, time: _time, ...rest } = documentedRun(run);
  return rest;
}

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

  const watched = await captureReplay(h, "watched", () => watch(h));

  assertEqual(watched.screen, "paused", "the screen after the watched stretch");
  assertDeepEqual(
    documentedRun(watched.run),
    documentedRun(paused.run),
    "the run after the watched stretch, against the run before it",
  );

  const playing = await isolate(h);
  assertEqual(playing.screen, "playing", "the screen the overlay reports over");
  const played = await watch(h);

  assertEqual(played.screen, "playing", "the screen after the playing stretch");
  const tick = playing.run.tick + RUN_FRAMES;
  assertEqual(played.run.tick, tick, "run.tick after the playing stretch");
  assertNear(
    played.run.time,
    tick / TICK_HZ,
    TIME_TOL,
    "run.time after the playing stretch, tick / TICK_HZ",
  );
  assertDeepEqual(
    runLessClock(played.run),
    runLessClock(playing.run),
    "the run after the playing stretch, less its clock, against the run before it",
  );
});
