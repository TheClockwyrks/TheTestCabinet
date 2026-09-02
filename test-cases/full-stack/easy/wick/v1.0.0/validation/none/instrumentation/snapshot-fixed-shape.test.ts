// Wick — instrumentation/snapshot-fixed-shape: the snapshot carries every
// documented field on each of the eight screens, `run` reports the idle run on
// `title` and `howto` and the run that just ended on `fallen` and `dawn`, `pool`
// is empty on every screen but `levelup`, and `menuIndex` rests at `0` on a
// screen with no menu.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — "Snapshot shape"):
// "The shape is fixed, and every field is present whatever the screen. `run`
// reports the idle run of `specs/state.md` on `title` and `howto`, and the run
// that just ended on `fallen` and `dawn`"; `pool`: "on `levelup`, the candidate
// pool ...; on every other screen an empty list". specs/controls.md: "`menuIndex`
// is `0` on entering every screen, and on a screen with no highlight it stays
// `0`". The idle run is specs/state.md's list, restated by `idleRun()`.
//
// WHY THE WORLD IS POSED AS IT IS. Each screen is entered by the `setScreen` row
// the specification gives it, except `chest`, which "is reached through
// `spawnPickup("chest", x, y)` at the lamplighter's center and one tick, which
// is the real collection path". The run is given a clock before it ends, so
// "the run that just ended" is told from the idle one by its tick.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertHasProperty,
  assertLength,
  assertNotNull,
} from "../assert";
import { RUN_FIELDS, SNAPSHOT_FIELDS, type ScreenName } from "../constants";
import {
  captureStill,
  createHarness,
  documentedRun,
  idleRun,
  isolate,
  openChest,
  openLevelUp,
  poseScreen,
  type Harness,
  type WickSnapshot,
} from "../harness";

/** A clock the ended run keeps, so it is told from the idle run. */
const ENDED_TICK = 500;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Every documented field, top level and run, is present on `s`. */
function requireShape(s: WickSnapshot, screen: ScreenName): void {
  for (const field of SNAPSHOT_FIELDS) {
    assertHasProperty(s, field, `snapshot() on ${screen}`);
  }
  for (const field of RUN_FIELDS) {
    assertHasProperty(s.run, field, `snapshot().run on ${screen}`);
  }
  assertEqual(s.screen, screen, "the screen the snapshot reports");
}

it("carries every field on all eight screens, with the run each reports", async () => {
  // title: the harness's opening reset leaves the game here.
  await h.debug.reset();
  const title = await h.snapshot();
  requireShape(title, "title");
  assertDeepEqual(documentedRun(title.run), idleRun(), "the run on title");
  assertLength(title.run.pool, 0, "the pool on title");

  // howto.
  const howto = await poseScreen(h, "howto");
  requireShape(howto, "howto");
  assertDeepEqual(documentedRun(howto.run), idleRun(), "the run on howto");
  assertLength(howto.run.pool, 0, "the pool on howto");
  assertEqual(howto.menuIndex, 0, "menuIndex on howto, a screen with no menu");

  // playing, on an isolated night.
  const playing = await isolate(h);
  requireShape(playing, "playing");
  assertLength(playing.run.pool, 0, "the pool on playing");
  assertEqual(
    playing.menuIndex,
    0,
    "menuIndex on playing, a screen with no menu",
  );

  // levelup: the real path, a queued level-up and the tick that opens it.
  const levelup = await openLevelUp(h);
  requireShape(levelup, "levelup");
  assertEqual(
    levelup.run.pool.length > 0,
    true,
    "the pool on levelup, computed from the slots",
  );

  // chest: the real collection path.
  await isolate(h);
  const chest = await openChest(h);
  requireShape(chest, "chest");
  assertNotNull(chest.run.chestResult, "chestResult on chest");
  assertLength(chest.run.pool, 0, "the pool on chest");
  assertEqual(chest.menuIndex, 0, "menuIndex on chest, a screen with no menu");

  // paused.
  await isolate(h);
  const paused = await poseScreen(h, "paused");
  requireShape(paused, "paused");
  assertLength(paused.run.pool, 0, "the pool on paused");
  assertEqual(
    paused.menuIndex,
    0,
    "menuIndex on paused, a screen with no menu",
  );

  // fallen, keeping the run that just ended.
  await isolate(h);
  await h.debug.setTick(ENDED_TICK);
  const fallen = await poseScreen(h, "fallen");
  requireShape(fallen, "fallen");
  assertEqual(fallen.run.tick, ENDED_TICK, "the ended run's tick on fallen");
  assertLength(fallen.run.pool, 0, "the pool on fallen");

  // dawn, the same.
  await isolate(h);
  await h.debug.setTick(ENDED_TICK);
  const dawn = await poseScreen(h, "dawn");
  requireShape(dawn, "dawn");
  assertEqual(dawn.run.tick, ENDED_TICK, "the ended run's tick on dawn");
  assertLength(dawn.run.pool, 0, "the pool on dawn");
  await h.step(1);
  await captureStill(h, "screens");
});
