// harness — the machinery the suites in this directory are built on.
//
// The suites next door are validators: each decides one review point against
// the build. This file decides nothing about the build. It checks the HARNESS,
// whose faults are invisible from inside a suite and wrong in ways nothing
// else catches: a clock that resolves the wrong number of ticks moves every
// duration this case states, an isolation helper that leaves a switch on
// feeds phantom spawns into every scenario, an observer that read the build's
// own copy of a press would silently break the game it was watching, a served
// asset that never reached the loader would fail every presentation point
// against a build that draws exactly what it was asked to, a cue whose file
// was never attributed would fail every binding point, and a replay written
// in the wrong framing reaches the console as something it cannot read.
//
// The few assertions below that DO touch the build are the ones that cannot
// be separated from the plumbing they prove — a key press only reaches the
// game if the game reads it — and they assert figures `specs/` states rather
// than anything the reference decided. Every threshold belongs to a suite
// next door.
//
// No review item names this file, so a run never loads it. It runs with the
// whole project, which is how a case author runs these suites while writing
// them:
//
//   npx vitest run --config validation/vitest.config.ts

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { Recording } from "@test-cabinet/structured-2d";
import {
  BASE_MAX_HP,
  CUES,
  CUE_PATHS,
  DEFAULT_SEED,
  ENEMIES,
  GEM_SPRITE_SIZES,
  GEM_PATHS,
  GEM_VALUES,
  LAMPLIGHTER_IDLE_PATH,
  LAMPLIGHTER_SPRITE_HEIGHT,
  LAMPLIGHTER_SPRITE_WIDTH,
  MOVE_SPEED,
  MOTION_EPS,
  PIN_LEVELS,
  STAGE_CX,
  STAGE_CY,
  STAGE_H,
  STAGE_W,
  TICK_DT,
  TICK_MS,
  TITLE_ITEMS,
  TITLE_TEXT,
  WICK_DEBUG_VERSION,
  assetFile,
  xpToNext,
} from "./constants";
import {
  addObserver,
  advanceTicks,
  angleOf,
  angularOffset,
  armWeapon,
  blitsFrom,
  blitsNear,
  captureReplay,
  captureStill,
  centerOf,
  clickAt,
  createHarness,
  cuesNamed,
  disable,
  distance,
  drawnText,
  drewText,
  enable,
  enemyById,
  endDawn,
  endFallen,
  freshRun,
  gemById,
  hasToken,
  hold,
  holdPassive,
  holdTogether,
  holdWeapon,
  hoverAt,
  isolate,
  menuRects,
  mirroredRect,
  onCue,
  openChest,
  openLevelUp,
  pixelsDiffering,
  placeEnemy,
  placeEnemyNear,
  placeGem,
  placePickup,
  placeProjectile,
  placePuddle,
  pointAt,
  poseScreen,
  projectilesOf,
  readPng,
  readWav,
  repeatKey,
  spriteNear,
  startPlay,
  switchesOf,
  tap,
  toggleOverlay,
  unit,
  wavPeak,
  wavSeam,
  wheelBy,
  type Harness,
} from "./harness";
import { REQUIRED_OPS, SCREENS, SWITCH_NAMES } from "./surface";

/** The environment variable the runner names the media directory in. */
const MEDIA_DIR_ENV = "TCAB_VALIDATION_MEDIA_DIR";

/**
 * Where this file's own outputs land: the staged project directory, then the
 * suite's path within the project, which for this file is its own name.
 */
const SUITE_DIR = join("validation", "harness.test.ts");

let mediaDir: string;
let collecting: string | undefined;
let h: Harness;

beforeEach(async () => {
  collecting = process.env[MEDIA_DIR_ENV];
  mediaDir = mkdtempSync(join(tmpdir(), "wick-replay-"));
  process.env[MEDIA_DIR_ENV] = mediaDir;
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
  if (collecting === undefined) delete process.env[MEDIA_DIR_ENV];
  else process.env[MEDIA_DIR_ENV] = collecting;
  rmSync(mediaDir, { recursive: true, force: true });
});

/* -------------------------------------------------------------------------- */
/* The engine, the surface, and the boot state                                */
/* -------------------------------------------------------------------------- */

it("stands the build up on a real engine and reaches its surface", () => {
  // Every check in this project reads the surface off `engine.debug` and never
  // builds one, so the harness having got that far is the precondition of the
  // whole suite. What is read back is the boot state `specs/state.md` gives:
  // the title with the idle run and every switch on.
  expect(h.surfaceFault).toBeNull();
  for (const op of REQUIRED_OPS) {
    expect(typeof h.debug[op]).toBe("function");
  }
  expect(h.debug.version).toBe(WICK_DEBUG_VERSION);

  const opening = h.snapshot();
  expect(opening.screen).toBe("title");
  expect(opening.menuIndex).toBe(0);
  expect(opening.run.tick).toBe(0);
  expect(opening.run.level).toBe(1);
  expect(opening.run.xp).toBe(0);
  expect(opening.run.kills).toBe(0);
  expect(opening.run.player).toEqual({
    x: 0,
    y: 0,
    facing: "right",
    hp: BASE_MAX_HP,
  });
  expect(opening.run.weapons).toEqual([]);
  expect(opening.run.passives).toEqual([]);
  expect(opening.run.enemies).toEqual([]);
  expect(opening.run.nextId).toBe(0);
  for (const name of SWITCH_NAMES) expect(opening[name]).toBe(true);
  expect(opening.accumulator).toBe(0);
  expect(opening.simTime).toBe(0);
});

it("serves the produced tree: every sprite and every cue loads", async () => {
  // The loader fetches each produced file under `assets/` through the
  // harness's `fetch`, decodes images through this canvas library, and decodes
  // sounds through the headless audio context — so a build that loads exactly
  // the files `specs/assets.md` names sees every one arrive.
  await advanceTicks(h, 2);
  expect(h.assetFailures).toEqual([]);
  expect(h.assetLoads).toContain(LAMPLIGHTER_IDLE_PATH);
  expect(h.assetLoads).toContain(CUE_PATHS.hit);
  expect(h.assetLoads).toContain(CUE_PATHS.music);
});

it("resets to the boot state from a fully posed world, taking a seed", async () => {
  isolate(h, { seed: 3 });
  h.debug.setPlayerPosition(300, -120);
  h.debug.setHp(12);
  h.debug.setKills(40);
  h.debug.setWeapon(0, "ember", 4);
  h.debug.setPassive(0, "brass", 2);
  placeEnemy(h, "moth", 200, 0);
  placeGem(h, "large", 100, 100);
  placePickup(h, "bread", -100, 0);
  placeProjectile(h, "pin", 0, 0, 600, 0, 1);
  placePuddle(h, "oil-splash", 50, 50);
  await advanceTicks(h, 3);

  h.reset(7);
  const after = h.snapshot();

  expect(after.screen).toBe("title");
  expect(after.menuIndex).toBe(0);
  expect(after.run.tick).toBe(0);
  expect(after.run.level).toBe(1);
  expect(after.run.kills).toBe(0);
  expect(after.run.player).toEqual({
    x: 0,
    y: 0,
    facing: "right",
    hp: BASE_MAX_HP,
  });
  expect(after.run.weapons).toEqual([]);
  expect(after.run.passives).toEqual([]);
  expect(after.run.enemies).toEqual([]);
  expect(after.run.projectiles).toEqual([]);
  expect(after.run.zones).toEqual([]);
  expect(after.run.gems).toEqual([]);
  expect(after.run.pickups).toEqual([]);
  expect(after.run.nextId).toBe(0);
  for (const name of SWITCH_NAMES) expect(after[name]).toBe(true);
  expect(after.accumulator).toBe(0);
  expect(after.simTime).toBe(0);

  // The seed is what `reset` lays the generator with: two resets from the
  // same seed read the same state (specs/instrumentation.md).
  const seeded = after.rngState;
  h.reset(7);
  expect(h.snapshot().rngState).toBe(seeded);
  h.reset();
  const bySeed = h.snapshot().rngState;
  h.reset(DEFAULT_SEED);
  expect(h.snapshot().rngState).toBe(bySeed);
});

/* -------------------------------------------------------------------------- */
/* The clock                                                                  */
/* -------------------------------------------------------------------------- */

it("resolves exactly one tick per frame on playing, and none off it", async () => {
  // The pairing `specs/instrumentation.md` names: a frame of 1000/60 ms on
  // `playing` consumes exactly one tick. On `title` a frame ticks nothing
  // and `simTime` still rises by its delta (specs/ui.md).
  const opening = h.snapshot();
  await h.advance(7);
  const idle = h.snapshot();
  expect(idle.run.tick).toBe(0);
  expect(idle.simTime).toBeCloseTo(opening.simTime + 7 * TICK_DT, 9);

  isolate(h);
  const before = h.snapshot();
  expect((await advanceTicks(h, 7)).run.tick).toBe(before.run.tick + 7);
  expect((await advanceTicks(h, 100)).run.tick).toBe(before.run.tick + 107);
  expect(h.frame()).toBeGreaterThanOrEqual(114);
  expect(h.timeMs()).toBeCloseTo(114 * TICK_MS, 6);
});

it("poses a partial frame of any delta through the scripted clock", async () => {
  // `frameOf(ms)` hands the next frame exactly `ms`, and the clock returns to
  // its one-tick step after. Read off the engine's own accounting, so the
  // proof is about the clock and not the build: the engine's simulated time
  // rises by exactly what the clock supplied.
  isolate(h);
  const start = h.timeMs();
  await h.frameOf(500);
  expect(h.timeMs()).toBeCloseTo(start + 500, 9);
  await h.advance(1);
  expect(h.timeMs()).toBeCloseTo(start + 500 + TICK_MS, 9);
  await h.frameOf(40);
  await h.frameOf(10);
  expect(h.timeMs()).toBeCloseTo(start + 500 + TICK_MS + 50, 9);
});

it("refuses a partial frame under a foreign clock", async () => {
  const own = await createHarness({
    clock: { delta: () => TICK_MS },
  });
  try {
    await expect(own.frameOf(40)).rejects.toThrow(/scripted clock/);
    await own.advance(2);
    expect(own.frame()).toBeGreaterThanOrEqual(2);
  } finally {
    own.dispose();
  }
});

it("drives the pointer in stage coordinates: hover, click, and the wheel", async () => {
  // The three pointer rules are applied per frame (specs/controls.md), and
  // every rectangle is reported "in stage coordinates, 0 to STAGE_W across and
  // 0 to STAGE_H down" (specs/instrumentation.md) — so the helpers aim at a
  // rectangle the surface reported and let one frame read the gesture. The
  // title menu answers the pointer, so its second item's rectangle is where a
  // hover lands the highlight.
  h.reset();
  const rects = menuRects(h);
  expect(rects).toHaveLength(TITLE_ITEMS.length);
  const second = centerOf(rects[1]);
  expect((await hoverAt(h, second.x, second.y)).menuIndex).toBe(1);

  // LIGHT THE LAMP is entry 0 (specs/ui.md), and a click takes the item under
  // it exactly as `confirm` does — proving the press edge reaches the frame.
  h.reset();
  const first = centerOf(menuRects(h)[0]);
  expect((await clickAt(h, first.x, first.y)).screen).toBe("playing");

  // The wheel: WHEEL_ROW units of downward travel move the almanac's list one
  // row, and the tools tab holds more entries than ALMANAC_ROWS, so the row is
  // there to reach (specs/controls.md, specs/ui.md).
  h.reset();
  poseScreen(h, "almanac");
  expect((await wheelBy(h, 1)).almanacScroll).toBe(1);
});

it("maps a stage point through a surface that is not one to one", async () => {
  // The mapping is the harness's own, and a fault in it would aim every
  // pointer check at the wrong place under any surface but the default. A
  // canvas laid out at half the stage's CSS size on a 2x display draws the
  // same device pixels, so the SAME stage point must still land on the same
  // menu item.
  const own = await createHarness({
    cssWidth: STAGE_W / 2,
    cssHeight: STAGE_H / 2,
    dpr: 2,
  });
  try {
    own.reset();
    const second = centerOf(menuRects(own)[1]);
    expect((await hoverAt(own, second.x, second.y)).menuIndex).toBe(1);
  } finally {
    own.dispose();
  }
});

/* -------------------------------------------------------------------------- */
/* Isolation and the posed screens                                            */
/* -------------------------------------------------------------------------- */

it("isolates: the playing screen over an idle run, every switch off", () => {
  const posed = isolate(h, { seed: 3 });

  expect(posed.screen).toBe("playing");
  expect(posed.run.tick).toBe(0);
  expect(posed.run.level).toBe(1);
  expect(posed.run.xpToNext).toBe(xpToNext(1));
  expect(posed.run.xp).toBe(0);
  expect(posed.run.kills).toBe(0);
  expect(posed.run.player).toEqual({
    x: 0,
    y: 0,
    facing: "right",
    hp: BASE_MAX_HP,
  });
  expect(posed.run.weapons).toEqual([]);
  expect(posed.run.passives).toEqual([]);
  expect(posed.run.enemies).toEqual([]);
  expect(posed.run.projectiles).toEqual([]);
  expect(posed.run.zones).toEqual([]);
  expect(posed.run.gems).toEqual([]);
  expect(posed.run.pickups).toEqual([]);
  expect(posed.run.pendingLevelUps).toBe(0);
  expect(posed.run.offers).toEqual([]);
  for (const name of SWITCH_NAMES) expect(posed[name]).toBe(false);
});

it("leaves an isolated world exactly as posed across a drive", async () => {
  // With every switch off nothing autonomous runs: the director spawns
  // nothing, nothing fires, nothing moves, nothing hits. What a check placed
  // is what it finds, tick after tick — an enemy at rest where it was put,
  // the lamplighter untouched, and nothing else on the field.
  isolate(h);
  const moth = placeEnemy(h, "moth", 200, 0);
  const gem = placeGem(h, "small", 300, 0);
  const after = await advanceTicks(h, 60);

  expect(after.screen).toBe("playing");
  expect(after.run.tick).toBe(60);
  expect(after.run.enemies.map((enemy) => enemy.id)).toEqual([moth]);
  const found = enemyById(after, moth);
  expect(found?.x).toBe(200);
  expect(found?.y).toBe(0);
  expect(found?.hp).toBe(ENEMIES.moth.hp);
  expect(after.run.player).toEqual({
    x: 0,
    y: 0,
    facing: "right",
    hp: BASE_MAX_HP,
  });
  expect(after.run.gems.map((one) => one.id)).toEqual([gem]);
  expect(gemById(after, gem)?.attracted).toBe(false);
  expect(after.run.projectiles).toEqual([]);
  expect(after.run.zones).toEqual([]);
  expect(after.run.pickups).toEqual([]);
  expect(after.run.kills).toBe(0);
  expect(after.run.level).toBe(1);
});

it("holds a kill's drop and a gain's level while the two switches are off", async () => {
  // The faculties `drops` and `progression` name, gated rather than outrun: a
  // kill leaves nothing on the field, and a gem collected raises `xp` past
  // `xpToNext(1)` (`5`) without a level or a queued level-up following it.
  isolate(h);
  enable(h, "weaponFire");
  const slot = holdWeapon(h, "taper", 1);
  h.debug.setWeaponCooldown(slot, 0);
  placeEnemyNear(h, "moth", 20, 0);
  const killed = await advanceTicks(h, 2);
  expect(killed.run.kills).toBe(1);
  expect(killed.run.gems).toEqual([]);
  expect(killed.run.pickups).toEqual([]);

  isolate(h);
  placeGem(h, "large", 0, 0);
  const collected = await advanceTicks(h, 2);
  expect(collected.run.gems).toEqual([]);
  expect(collected.run.xp).toBe(GEM_VALUES.large);
  expect(collected.run.level).toBe(1);
  expect(collected.run.pendingLevelUps).toBe(0);
  expect(collected.screen).toBe("playing");
});

it("holds Taper out of an isolated world unless it is asked for", () => {
  expect(isolate(h).run.weapons).toEqual([]);
  expect(isolate(h, { taper: true }).run.weapons).toEqual([
    { id: "taper", level: 1, cooldown: 0 },
  ]);
  expect(isolate(h, { level: 7 }).run.level).toBe(7);
});

it("turns the driver switches on and off one at a time", () => {
  isolate(h);
  enable(h, "enemyMotion", "weaponFire");
  expect(switchesOf(h.snapshot())).toEqual({
    spawning: false,
    events: false,
    despawning: false,
    enemyMotion: true,
    enemyContact: false,
    weaponFire: true,
    effectMotion: false,
    drops: false,
    progression: false,
  });
  disable(h, "weaponFire");
  expect(h.snapshot().weaponFire).toBe(false);
  expect(h.snapshot().enemyMotion).toBe(true);
});

it("holds a weapon and a passive in the first free slot, and arms the weapon", async () => {
  isolate(h);
  expect(holdWeapon(h, "ember", 4)).toBe(0);
  expect(holdWeapon(h, "pin")).toBe(1);
  expect(holdPassive(h, "brass", 2)).toBe(0);
  const held = h.snapshot().run;
  expect(held.weapons).toEqual([
    { id: "ember", level: 4, cooldown: 0 },
    { id: "pin", level: 1, cooldown: 0 },
  ]);
  expect(held.passives).toEqual([{ id: "brass", level: 2 }]);

  // Armed, Pin fires on the next tick whether or not an enemy exists
  // (specs/weapons.md), one dart at level 1.
  armWeapon(h, 1);
  expect(h.snapshot().weaponFire).toBe(true);
  const fired = await advanceTicks(h, 1);
  expect(projectilesOf(fired, "pin")).toHaveLength(PIN_LEVELS[0].amount);
});

it("composes a fresh run out of atomic poses, with the switches left on", () => {
  const run = freshRun(h, 5);
  expect(run.screen).toBe("playing");
  expect(run.run.tick).toBe(0);
  expect(run.run.weapons).toEqual([{ id: "taper", level: 1, cooldown: 0 }]);
  expect(run.run.level).toBe(1);
  for (const name of SWITCH_NAMES) expect(run[name]).toBe(true);
});

it("poses each screen through the surface, leaving the run's figures standing", async () => {
  // The end screens report the run that just ended (specs/state.md), so
  // poseScreen must not reset first.
  isolate(h);
  h.debug.setKills(143);
  h.debug.setTick(7260);

  expect(poseScreen(h, "paused").screen).toBe("paused");
  expect(poseScreen(h, "fallen").screen).toBe("fallen");
  expect(h.snapshot().run.kills).toBe(143);
  expect(h.snapshot().run.tick).toBe(7260);
  expect(h.snapshot().menuIndex).toBe(0);

  expect(poseScreen(h, "title").screen).toBe("title");
  expect(poseScreen(h, "howto").screen).toBe("howto");
  expect(poseScreen(h, "playing").screen).toBe("playing");
  expect(poseScreen(h, "dawn").screen).toBe("dawn");
  for (const screen of SCREENS) {
    expect(typeof screen).toBe("string");
  }
});

it("opens the overlays and the endings through the real ticks", async () => {
  isolate(h);
  const levelup = await openLevelUp(h, 2);
  expect(levelup.screen).toBe("levelup");
  expect(levelup.run.pendingLevelUps).toBe(2);
  expect(levelup.run.offers.length).toBeGreaterThan(0);

  isolate(h);
  const chest = await openChest(h);
  expect(chest.screen).toBe("chest");
  expect(chest.run.chestResult).not.toBeNull();
  expect(chest.run.pickups).toEqual([]);

  isolate(h);
  expect((await endFallen(h)).screen).toBe("fallen");

  isolate(h);
  const dawn = await endDawn(h);
  expect(dawn.screen).toBe("dawn");
  expect(dawn.run.tick).toBe(36000);
});

/* -------------------------------------------------------------------------- */
/* Real input: tap, hold, startPlay, and the observer                         */
/* -------------------------------------------------------------------------- */

it("taps with real key events: one tap, one menu step, one cue", async () => {
  // The title menu wraps (specs/ui.md), so `TITLE_ITEMS.length` taps of `down`
  // walk the highlight all the way round and back to 0, each playing
  // menu-move — which also proves the cue collector hears the frames and not
  // the poses.
  h.reset();
  const played = onCue(h);
  for (let step = 1; step <= TITLE_ITEMS.length; step += 1) {
    expect((await tap(h, "ArrowDown")).menuIndex).toBe(
      step % TITLE_ITEMS.length,
    );
  }
  expect(cuesNamed(played, CUES.menuMove)).toHaveLength(TITLE_ITEMS.length);
});

it("holds a key for a counted number of ticks", async () => {
  // 180 units per second while `right` is held (specs/world.md): 20 ticks is
  // a third of a second, 60 units.
  isolate(h);
  const after = await hold(h, "ArrowRight", 20);
  expect(after.run.player.x).toBeCloseTo((MOVE_SPEED * 20) / 60, 6);
  expect(after.run.player.y).toBe(0);

  // Released: another 20 ticks move it nowhere.
  const later = await advanceTicks(h, 20);
  expect(later.run.player.x).toBeCloseTo(after.run.player.x, 9);

  // The other binding of the opposite action turns it back (specs/controls.md).
  const back = await hold(h, "KeyA", 20);
  expect(back.run.player.x).toBeCloseTo(0, 6);

  // Two keys held together: the diagonal is normalized (specs/world.md).
  const diagonal = await holdTogether(h, ["ArrowRight", "ArrowDown"], 10);
  const step = (MOVE_SPEED * 10) / 60;
  expect(diagonal.run.player.x).toBeCloseTo(step * Math.SQRT1_2, 6);
  expect(diagonal.run.player.y).toBeCloseTo(step * Math.SQRT1_2, 6);
});

it("dispatches a repeat keydown that arms no second edge", async () => {
  h.reset();
  h.holdKey("ArrowDown");
  await h.advance(1);
  expect(h.snapshot().menuIndex).toBe(1);
  expect((await repeatKey(h, "ArrowDown")).menuIndex).toBe(1);
  h.releaseKey("ArrowDown");
});

it("startPlay reaches playing through the real title menu", async () => {
  const playing = await startPlay(h);
  expect(playing.screen).toBe("playing");
  expect(playing.run.weapons[0]?.id).toBe("taper");
  // The frame whose press lights the lamp runs that frame's tick
  // (specs/controls.md).
  expect(playing.run.tick).toBe(1);
});

it("observes an action without eating the build's copy of the edge", async () => {
  // The observer reads its own copy between the press and the frame that
  // delivers it; the build still sees the press, so the game pauses.
  isolate(h);
  const observer = addObserver(h);

  h.holdKey("KeyP");
  expect(observer.input.pressed("pause")).toBe(true);
  await h.advance(1);
  h.releaseKey("KeyP");

  expect(h.snapshot().screen).toBe("paused");
});

/* -------------------------------------------------------------------------- */
/* Placing entities                                                           */
/* -------------------------------------------------------------------------- */

it("places each kind of entity under the id it answers", () => {
  isolate(h);
  const moth = placeEnemy(h, "moth", 200, 0);
  const gem = placeGem(h, "medium", 100, 100);
  const bread = placePickup(h, "bread", -100, 0);
  const bolt = placeProjectile(h, "ember", 0, 0, 400, 0, 0);
  const puddle = placePuddle(h, "oil-splash", 50, 50);
  const s = h.snapshot();

  expect([moth, gem, bread, bolt, puddle]).toEqual([0, 1, 2, 3, 4]);
  expect(s.run.enemies.map((e) => e.id)).toEqual([moth]);
  expect(s.run.gems.map((g) => g.id)).toEqual([gem]);
  expect(s.run.pickups.map((p) => p.id)).toEqual([bread]);
  expect(s.run.projectiles.map((p) => p.id)).toEqual([bolt]);
  expect(s.run.zones.map((z) => z.id)).toEqual([puddle]);
  expect(s.run.nextId).toBe(5);
});

it("places an enemy relative to the lamplighter", () => {
  isolate(h);
  h.debug.setPlayerPosition(300, -120);
  const moth = placeEnemyNear(h, "moth", 50, -20);
  const found = enemyById(h.snapshot(), moth);
  expect(found?.x).toBe(350);
  expect(found?.y).toBe(-140);
});

it("sweeps a tick at a time until a predicate holds", async () => {
  // Not a verdict on the gem's flight — the validators own that — but proof
  // the placement, the switch, the tick drive, and the sweep compose: an
  // attracted gem flies to the lamplighter and is collected.
  isolate(h);
  const gem = placeGem(h, "small", 100, 0);
  h.debug.setGemAttracted(gem, true);
  const swept = await h.until((s) => gemById(s, gem) === undefined, {
    maxTicks: 30,
  });
  expect(swept.hit).toBe(true);
  expect(swept.ticks).toBeGreaterThan(0);
});

it("maps geometry the way the specification does", () => {
  // specs/weapons.md: 0 along +x, positive angles toward +y.
  const right = pointAt({ x: 0, y: 0 }, 0, 100);
  expect(right.x).toBeCloseTo(100, 9);
  expect(right.y).toBeCloseTo(0, 9);
  const down = pointAt({ x: 0, y: 0 }, 90, 100);
  expect(down.x).toBeCloseTo(0, 9);
  expect(down.y).toBeCloseTo(100, 9);
  expect(angleOf(0, 100)).toBeCloseTo(90, 9);
  expect(angleOf(-100, 0)).toBeCloseTo(180, 9);
  expect(angularOffset(350, 10)).toBeCloseTo(20, 9);
  expect(unit(3, 4)).toEqual({ x: 0.6, y: 0.8 });
  expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
});

/* -------------------------------------------------------------------------- */
/* Audio: the cues, their files, and the loops                                */
/* -------------------------------------------------------------------------- */

it("attributes each cue to the produced file it sounded from", async () => {
  // The headless audio graph remembers which produced file each decoded
  // buffer came from and which buffer each sound started, so a cue's `file`
  // is the path the loader fetched for it. menu-move on the title is the
  // simplest cue to raise; music is the loop a fresh run starts.
  h.reset();
  const played = onCue(h);
  await tap(h, "ArrowDown");
  const move = cuesNamed(played, CUES.menuMove);
  expect(move).toHaveLength(1);
  expect(move[0].file).toBe(assetFile(CUE_PATHS[CUES.menuMove]));

  await startPlay(h);
  const music = cuesNamed(played, CUES.music);
  expect(music.length).toBeGreaterThanOrEqual(1);
  expect(music[0].loop).toBe(true);
  expect(music[0].file).toBe(assetFile(CUE_PATHS[CUES.music]));
});

it("reports the loops running, off the bus and off the graph", async () => {
  await startPlay(h);
  await h.advance(1);
  expect(h.looping(CUES.music)).toBe(true);
  const live = h.liveLoops();
  expect(live.filter((loop) => loop.cue === CUES.music)).toHaveLength(1);
  expect(live[0].file).toBe(assetFile(CUE_PATHS[CUES.music]));

  h.reset();
  await h.advance(1);
  expect(h.looping(CUES.music)).toBe(false);
  expect(h.liveLoops()).toEqual([]);
});

/* -------------------------------------------------------------------------- */
/* The render readings                                                        */
/* -------------------------------------------------------------------------- */

it("attributes a blit to the produced file it was served from", async () => {
  // The lamplighter is drawn at the stage center from its produced idle
  // sprite (specs/ui.md, specs/assets.md), so the frame's blits must hold one
  // whose bytes came from that file, centered there — which is the whole
  // asset pipeline of this host proven end to end: fetch, decode, identity,
  // and the transform mapping of the blit box.
  isolate(h);
  const { blits } = await h.frameDraw();
  const idle = blitsFrom(blits, LAMPLIGHTER_IDLE_PATH);
  expect(idle.length).toBeGreaterThanOrEqual(1);
  const onPlayer = blitsNear(h, blits, 0, 0, 2);
  expect(onPlayer.map((b) => b.id)).toContain(assetFile(LAMPLIGHTER_IDLE_PATH));
  expect(idle[0].w).toBeCloseTo(LAMPLIGHTER_SPRITE_WIDTH, 6);
  expect(idle[0].h).toBeCloseTo(LAMPLIGHTER_SPRITE_HEIGHT, 6);
  expect(idle[0].smoothing).toBe(false);
});

it("maps world points through the camera and stage points past the fit", async () => {
  // The camera is centered on the lamplighter (specs/world.md), so the
  // lamplighter's world point maps to the stage center whatever its position,
  // and a world point 100 to its right lands 100 device pixels to the right
  // at the default one-to-one surface.
  isolate(h);
  h.debug.setPlayerPosition(300, -120);
  await h.frameDraw();
  expect(h.device(300, -120)).toEqual({ x: STAGE_CX, y: STAGE_CY });
  expect(h.device(400, -120)).toEqual({ x: STAGE_CX + 100, y: STAGE_CY });
  expect(h.stageDevice(STAGE_CX, STAGE_CY)).toEqual({
    x: STAGE_CX,
    y: STAGE_CY,
  });
  expect(h.pixel(300, -120)).toHaveLength(4);
  expect(h.stagePixel(10, 10)).toHaveLength(4);
});

it("reads the text a frame drew", async () => {
  h.reset();
  const calls = await h.frameCalls();
  expect(drewText(calls, TITLE_TEXT)).toBe(true);
  expect(drewText(calls, TITLE_ITEMS[0])).toBe(true);
  expect(drewText(calls, TITLE_ITEMS[1])).toBe(true);
  expect(hasToken(drawnText(calls), TITLE_TEXT)).toBe(true);
  expect(hasToken(["LEVEL 4", "48 / 100"], "4")).toBe(true);
  expect(hasToken(["LEVEL 4", "348"], "48")).toBe(false);
  expect(hasToken(["48 / 100"], "48")).toBe(true);
});

it("names the produced file painted at a world point", async () => {
  isolate(h);
  const { blits } = await h.frameDraw();
  expect(spriteNear(h, blits, 0, 0, 2)).toBe(assetFile(LAMPLIGHTER_IDLE_PATH));
  expect(spriteNear(h, blits, 5000, 5000, 2)).toBeNull();
});

it("keeps only the last frame's calls, and reads a rectangle of pixels back", async () => {
  isolate(h);
  await h.advance(5);
  const last = h.lastCalls();
  expect(last.length).toBeGreaterThan(0);
  expect(last).toEqual(h.lastCalls());

  const rect = h.pixelRect(STAGE_CX - 12, STAGE_CY - 16, 24, 32);
  expect(rect.width).toBe(24);
  expect(rect.height).toBe(32);
  expect(pixelsDiffering(rect, rect)).toBe(0);
  const flipped = mirroredRect(rect);
  expect(flipped.width).toBe(24);
  expect(pixelsDiffering(mirroredRect(flipped), rect)).toBe(0);
});

it("toggles the engine's overlay and reads the diagnostic sources", async () => {
  isolate(h);
  const readings = h.diagnostics();
  expect(readings.length).toBeGreaterThan(0);
  const before = h.snapshot();
  await toggleOverlay(h);
  await toggleOverlay(h);
  // Showing and hiding the overlay is the engine's; the game's state is
  // untouched by it beyond the two frames the taps ran.
  expect(h.snapshot().run.tick).toBe(before.run.tick + 2);
});

/* -------------------------------------------------------------------------- */
/* The produced files                                                         */
/* -------------------------------------------------------------------------- */

it("decodes a produced sprite and a produced cue off disk", async () => {
  const idle = await readPng(assetFile(LAMPLIGHTER_IDLE_PATH));
  expect(idle.reason).toBeNull();
  expect(idle.image?.width).toBe(LAMPLIGHTER_SPRITE_WIDTH);
  expect(idle.image?.height).toBe(LAMPLIGHTER_SPRITE_HEIGHT);
  const large = await readPng(assetFile(GEM_PATHS.large));
  expect(large.image?.width).toBe(GEM_SPRITE_SIZES.large);

  const hit = readWav(assetFile(CUE_PATHS.hit));
  expect(hit.reason).toBeNull();
  expect(hit.wav?.sampleRate).toBeGreaterThan(0);
  expect(hit.wav?.frames).toBeGreaterThan(0);
  expect(hit.wav?.channels.length).toBeGreaterThan(0);
  expect(wavPeak(hit.wav!)).toBeGreaterThan(0);
  expect(wavSeam(hit.wav!)).toBeGreaterThanOrEqual(0);

  const missing = readWav("assets/audio/nothing-here.wav");
  expect(missing.wav).toBeNull();
  expect(missing.reason).toMatch(/no file/);
  const missingPng = await readPng("assets/sprites/nothing-here.png");
  expect(missingPng.image).toBeNull();
});

/* -------------------------------------------------------------------------- */
/* Evidence capture                                                           */
/* -------------------------------------------------------------------------- */

it("captures a replay of exactly the wrapped section, under the staged address", async () => {
  isolate(h);
  const value = await captureReplay(h, "clip", async () => {
    await advanceTicks(h, 5);
    return "through";
  });
  expect(value).toBe("through");

  const written = join(mediaDir, SUITE_DIR, "clip.json.gz");
  expect(existsSync(written)).toBe(true);
  const recording = JSON.parse(
    gunzipSync(readFileSync(written)).toString("utf8"),
  ) as Recording;
  expect(recording.frames).toHaveLength(5);
  expect(Array.isArray(recording.ops)).toBe(true);
  expect(Array.isArray(recording.states)).toBe(true);
  // The produced sprites reach the recording as captured images, which is
  // what the `ImageBitmap` global stands up for the recorder.
  expect(recording.images.length).toBeGreaterThan(0);
});

it("still writes the replay when the scenario throws", async () => {
  isolate(h);
  await expect(
    captureReplay(h, "broken", async () => {
      await advanceTicks(h, 3);
      throw new Error("the check's own failure");
    }),
  ).rejects.toThrow("the check's own failure");

  expect(existsSync(join(mediaDir, SUITE_DIR, "broken.json.gz"))).toBe(true);
});

it("thins an over-long capture instead of cutting it short", async () => {
  isolate(h);
  await captureReplay(h, "long", () => advanceTicks(h, 400));

  const written = join(mediaDir, SUITE_DIR, "long.json.gz");
  const recording = JSON.parse(
    gunzipSync(readFileSync(written)).toString("utf8"),
  ) as Recording;

  expect(recording.frames.length).toBeLessThanOrEqual(300);
  // The whole section survives: the deltas still sum to the elapsed time.
  const total = recording.frames.reduce((sum, f) => sum + f.deltaMs, 0);
  expect(total).toBeCloseTo(400 * TICK_MS, 3);
  // The last frame kept is the section's last.
  const last = recording.frames[recording.frames.length - 1];
  expect(last.count).toBeGreaterThanOrEqual(400);
});

it("writes no file for a capture that closed no frames", async () => {
  isolate(h);
  await captureReplay(h, "empty", () => undefined);
  expect(existsSync(join(mediaDir, SUITE_DIR, "empty.json.gz"))).toBe(false);
});

it("keeps the frame on the canvas as a still", async () => {
  isolate(h);
  await h.frameDraw();
  captureStill(h, "scene");

  const written = join(mediaDir, SUITE_DIR, "scene.png");
  expect(existsSync(written)).toBe(true);
  const bytes = readFileSync(written);
  // The PNG signature, so what landed is a picture and not a stack trace.
  expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
});

it("is a no-op with nothing collecting media", async () => {
  delete process.env[MEDIA_DIR_ENV];
  isolate(h);
  const value = await captureReplay(h, "quiet", () => advanceTicks(h, 2));
  expect(value.run.tick).toBeGreaterThan(0);
  captureStill(h, "quiet");
  expect(existsSync(join(mediaDir, SUITE_DIR))).toBe(false);
});

it("states its motion tolerance far above a whole night's rounding", () => {
  // Thirty-six thousand steps of 3 units each, summed in floating point,
  // land within the stated bound of the exact figure.
  let x = 0;
  for (let i = 0; i < 36000; i += 1) x += MOVE_SPEED * TICK_DT;
  expect(Math.abs(x - MOVE_SPEED * 600)).toBeLessThan(MOTION_EPS);
});
