// harness — the shared drive this directory's validators are written against.
//
// The suites next door are validators: each decides one review point against the
// build. This file decides nothing about the build. It checks the HARNESS — that
// the page it opens really is the game, that a step really is one frame and a
// frame on `playing` really is one tick, that a press really reaches the keyboard
// layer, that an isolated night is left exactly as posed, that a placed entity is
// the one the snapshot reports, that a pixel read really addresses the stage in
// logical units, that a cue is named from the file it played and stamped with
// the frame it played on, and that the evidence a review item declares really
// lands where the runner looks for it. Every one of those is invisible from
// inside a suite and wrong in ways nothing else catches: a replay written in the
// wrong framing reaches the console as something it cannot read, a still written
// under the wrong name is reported to the reviewer as evidence that does not
// exist, and a drive that silently advances nothing turns every point in the
// project into a passing check of nothing at all.
//
// The few assertions below that DO touch the build are the ones that cannot be
// separated from the plumbing they prove — a key press only reaches the game if
// the game reads it, a cue is only named if the game plays one — and they assert
// the plumbing's answer rather than a threshold. Every threshold belongs to a
// suite next door.
//
// No review item names this file, so a run never loads it. It runs with the whole
// project, which is how a case author runs these suites while writing them:
//
//   npx vitest run --config validation/vitest.config.ts

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, beforeEach, it } from "vitest";
import {
  BASE_MAX_HP,
  CUE_NAMES,
  POSITION_TOL,
  REQUIRED_OPS,
  STAGE_CX,
  STAGE_CY,
  STAGE_H,
  STAGE_W,
  SWITCH_NAMES,
  TICK_MS,
  WICK_DEBUG_VERSION,
} from "./constants";
import {
  assertBetween,
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertNear,
  assertTrue,
} from "./assert";
import {
  ISOLATE_LEVEL,
  advanceBy,
  captureReplay,
  captureStill,
  createHarness,
  cuesOnFrame,
  decodedCues,
  directionToward,
  drawOps,
  enemyById,
  fireWeapon,
  gemById,
  holdPassive,
  holdWeapon,
  imageDraws,
  isolate,
  loopingCues,
  namesOnFrame,
  nearestEnemies,
  newEnemies,
  pickupById,
  placeEnemy,
  placeGem,
  placePickup,
  placeProjectile,
  placePuddle,
  poseScreen,
  pressAction,
  projectileById,
  soundCount,
  stagePoint,
  startRun,
  startRunFromTitle,
  stepUntilScreen,
  surfaceVersion,
  watchNamedCues,
  worldIsEmpty,
  worldPoint,
  zoneById,
  type Harness,
  type NamedCue,
  type WickSnapshot,
} from "./harness";

/** The environment variable the runner names the media directory in. */
const MEDIA_DIR_ENV = "TCAB_VALIDATION_MEDIA_DIR";

/**
 * Where this file's own outputs land: the staged project directory, then the
 * suite's path within the project, which for this file is its own name.
 */
const SUITE_DIR = join("validation", "harness.test.ts");

/** A recording, as far as this file reads one. */
interface WrittenRecording {
  format: number;
  width: number;
  height: number;
  background: string | null;
  frames: { count: number; deltaMs: number }[];
}

let h: Harness;
let media: string | null = null;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
  if (media !== null) {
    rmSync(media, { recursive: true, force: true });
    media = null;
  }
  delete process.env[MEDIA_DIR_ENV];
});

/** Collect media into a directory of this test's own, as the runner would. */
function collecting(): string {
  media = mkdtempSync(join(tmpdir(), "wick-harness-"));
  process.env[MEDIA_DIR_ENV] = media;
  return media;
}

/* ---- The page is the game ------------------------------------------------- */

it("opens a page whose surface is the one the specification requires", async () => {
  assertEqual(h.surfaceFault, null, "the build's window.__wick");

  const probed = await h.probe(REQUIRED_OPS);
  for (const op of REQUIRED_OPS) {
    assertEqual(probed.ops[op], "function", `window.__wick.${op}`);
  }
  assertEqual(
    await surfaceVersion(h),
    WICK_DEBUG_VERSION,
    "window.__wick.version",
  );
});

it("opens the game on its title, off the wall clock", async () => {
  // Read BEFORE the opening reset: what the build OPENED on.
  assertEqual(h.openingScreen, "title", "the screen the build opened on");

  const opened = await h.snapshot();
  assertEqual(opened.screen, "title", "the screen a fresh harness stands on");
  assertEqual(
    opened.autoStep,
    false,
    "autoStep once the harness holds the clock",
  );

  // Off the clock: real time passes and nothing the harness counts moves,
  // because nothing stepped it.
  await h.page.waitForTimeout(300);
  assertEqual(h.frame(), 0, "frames driven while nobody drove any");
  const still = await h.snapshot();
  assertEqual(still.screen, "title", "the screen after real time passed");
  assertEqual(still.run.tick, 0, "the run clock after real time passed");
});

it("counts a step as exactly the frames it was asked for", async () => {
  await h.step(7);
  assertEqual(h.frame(), 7, "frames driven");
  await h.step(53);
  assertEqual(h.frame(), 60, "frames driven");
  assertNear(
    h.timeMs(),
    1000,
    1e-6,
    "the simulated time 60 frames cover, in ms",
  );
});

it("runs one tick per frame on playing, and none off it", async () => {
  await startRun(h);
  const played = await h.step(30);
  // How the clock is DIVIDED is `clock/`'s point; that a driven frame reaches
  // the build's own tick at all is this file's, because every suite rests on it.
  assertEqual(played.run.tick, 30, "the run clock after 30 driven frames");

  await poseScreen(h, "paused");
  const held = await h.step(10);
  assertEqual(h.frame(), 40, "frames driven, the paused ones counted too");
  assertEqual(held.run.tick, 30, "the run clock after 10 frames on paused");
});

it("hands the game back to its own clock, and takes it back", async () => {
  await startRun(h);
  await h.runFor(400);
  const during = (await h.snapshot()).run.tick;
  assertGreaterThan(during, 0, "the run clock after real time on its own loop");

  // And back off it: nothing moves again until something steps it.
  await h.page.waitForTimeout(300);
  const after = (await h.snapshot()).run.tick;
  assertEqual(after, during, "the run clock once off the clock again");
});

/* ---- The controls reach the build ----------------------------------------- */

it("delivers a key press the build can read", async () => {
  const started = await h.tap("Enter");
  assertEqual(started.screen, "playing", "the screen after Enter on the title");
});

it("delivers a held key for exactly the frames it holds it", async () => {
  await startRun(h);
  const held = await h.holdFor("ArrowRight", 30);
  assertEqual(h.frame(), 30, "frames driven while the key was held");
  // How FAR it moved is `lamplighter/`'s point; that it moved at all is what
  // says the key reached the keyboard layer the build wrote.
  assertGreaterThan(
    held.run.player.x,
    0,
    "player.x after 30 frames of ArrowRight",
  );
});

/* ---- The posed night ------------------------------------------------------- */

it("poses an isolated night, and leaves it exactly as posed", async () => {
  const posed = await isolate(h);
  assertEqual(
    posed.screen,
    "playing",
    "the screen an isolated night stands on",
  );
  assertEqual(posed.run.tick, 0, "the run clock of an isolated night");
  for (const name of SWITCH_NAMES) {
    assertEqual(posed[name], false, `the ${name} switch after isolate`);
  }
  assertDeepEqual(posed.run.weapons, [], "the weapons held after isolate");
  assertDeepEqual(posed.run.passives, [], "the passives held after isolate");
  assertTrue(
    worldIsEmpty(posed),
    "nothing alive and nothing dropped after isolate",
  );
  assertEqual(
    posed.run.level,
    ISOLATE_LEVEL,
    "the level an isolated night poses",
  );
  assertEqual(posed.run.player.x, 0, "player.x after isolate");
  assertEqual(posed.run.player.y, 0, "player.y after isolate");
  assertEqual(posed.run.player.facing, "right", "facing after isolate");
  assertEqual(posed.run.player.hp, BASE_MAX_HP, "hp after isolate");

  // Sixty frames with every faculty held: the night stays exactly as posed, so
  // a scenario staged over it meets nothing it did not ask for.
  const later = await h.step(60);
  assertEqual(later.run.tick, 60, "the run clock after 60 frames");
  assertTrue(worldIsEmpty(later), "nothing arrived over 60 held frames");
  assertEqual(later.run.player.x, 0, "player.x after 60 held frames");
  assertEqual(later.run.player.y, 0, "player.y after 60 held frames");
  assertEqual(later.run.player.hp, BASE_MAX_HP, "hp after 60 held frames");
  assertEqual(later.run.level, ISOLATE_LEVEL, "the level after 60 held frames");
  assertEqual(later.screen, "playing", "the screen after 60 held frames");
});

it("places each kind of entity where it says, and the held night keeps it there", async () => {
  await isolate(h);
  const moth = await placeEnemy(h, "moth", 200, 0);
  assertEqual(moth.type, "moth", "the placed enemy's type");
  assertNear(moth.x, 200, POSITION_TOL, "the placed enemy's x");
  assertNear(moth.y, 0, POSITION_TOL, "the placed enemy's y");

  const bolt = await placeProjectile(h, "ember", 100, 0, 400, 0, 0);
  assertEqual(bolt.weapon, "ember", "the placed projectile's weapon");
  assertNear(bolt.x, 100, POSITION_TOL, "the placed projectile's x");
  assertNear(bolt.vx, 400, POSITION_TOL, "the placed projectile's vx");

  const puddle = await placePuddle(h, "oil-splash", 50, 50);
  assertEqual(puddle.kind, "puddle", "the placed zone's kind");
  assertNear(puddle.x, 50, POSITION_TOL, "the placed puddle's x");

  const gem = await placeGem(h, "medium", 200, 0);
  assertEqual(gem.tier, "medium", "the placed gem's tier");
  assertEqual(gem.attracted, false, "the placed gem's attraction");

  const bread = await placePickup(h, "bread", 200, 0);
  assertEqual(bread.kind, "bread", "the placed pickup's kind");

  // Every id distinct: one counter shared by every kind.
  const ids = [moth.id, bolt.id, puddle.id, gem.id, bread.id];
  assertEqual(new Set(ids).size, ids.length, "distinct ids across the kinds");

  // Sixty held frames: each is still there, and still where it was put.
  const later = await h.step(60);
  const mothLater = enemyById(later, moth.id);
  assertNear(
    mothLater?.x ?? NaN,
    200,
    POSITION_TOL,
    "the enemy's x after 60 held frames",
  );
  assertNear(
    mothLater?.y ?? NaN,
    0,
    POSITION_TOL,
    "the enemy's y after 60 held frames",
  );
  const boltLater = projectileById(later, bolt.id);
  assertNear(
    boltLater?.x ?? NaN,
    100,
    POSITION_TOL,
    "the projectile's x after 60 held frames",
  );
  const puddleLater = zoneById(later, puddle.id);
  assertNear(
    puddleLater?.x ?? NaN,
    50,
    POSITION_TOL,
    "the puddle's x after 60 held frames",
  );
  const gemLater = gemById(later, gem.id);
  assertNear(
    gemLater?.x ?? NaN,
    200,
    POSITION_TOL,
    "the gem's x after 60 held frames",
  );
  const breadLater = pickupById(later, bread.id);
  assertNear(
    breadLater?.x ?? NaN,
    200,
    POSITION_TOL,
    "the pickup's x after 60 held frames",
  );
});

it("turns on exactly the faculties an isolated night names", async () => {
  const posed = await isolate(h, { on: ["enemyMotion", "weaponFire"] });
  for (const name of SWITCH_NAMES) {
    const wanted = name === "enemyMotion" || name === "weaponFire";
    assertEqual(posed[name], wanted, `the ${name} switch after isolate`);
  }
});

it("reads what a firing tick created, and nothing that was already there", async () => {
  await isolate(h);
  // Something already in the world, so the diff has something to leave out.
  const standing = await placeProjectile(h, "ember", 300, 300, 0, 0, 0);
  const fired = await fireWeapon(h, "pin", 1);
  assertEqual(fired.slot, 0, "the slot Pin fired from");
  assertEqual(
    fired.after.run.tick,
    fired.before.run.tick + 1,
    "one firing tick",
  );
  // HOW MANY darts and WHERE is `pin/`'s point; that the diff holds only what
  // the tick created is this file's.
  assertGreaterThan(
    fired.projectiles.length,
    0,
    "projectiles the firing tick created",
  );
  for (const dart of fired.projectiles) {
    assertEqual(dart.weapon, "pin", "a created projectile's weapon");
    assertGreaterThan(
      dart.id,
      standing.id,
      "a created projectile's id, above the standing one's",
    );
  }
  assertTrue(
    fired.projectiles.every((dart) => dart.id !== standing.id),
    "the standing projectile left out of the diff",
  );
  assertEqual(fired.zones.length, 0, "zones a Pin firing created");
});

it("poses a partial frame through advance, counted by the build and not the harness", async () => {
  await startRun(h);
  const before = h.frame();
  const after = await advanceBy(h, 0.5);
  // HOW the half second divides into ticks is `clock/`'s point; that the pose
  // reached the build's accumulator at all, and moved nothing the harness
  // counts, is this file's.
  assertGreaterThan(
    after.run.tick,
    0,
    "the run clock after a posed half second",
  );
  assertEqual(
    h.frame(),
    before,
    "frames the harness counted for a posed frame",
  );
});

it("sweeps to a screen one frame at a time", async () => {
  await isolate(h);
  await h.debug.setPendingLevelUps(1);
  const swept = await stepUntilScreen(h, "levelup", 5);
  assertTrue(swept.hit, "the levelup screen reached");
  assertEqual(swept.frames, 1, "frames stepped to reach it");
});

it("presses an action through whichever binding is asked for", async () => {
  // The second binding of `confirm` is Space: a press through it starts a run
  // from the title exactly as Enter does. WHETHER a build honours it is
  // `controls/space-confirms`; that the helper reaches for the right key is
  // this file's.
  const started = await pressAction(h, "confirm", 1);
  assertEqual(
    started.screen,
    "playing",
    "the screen after the second confirm binding",
  );
});

it("orders enemies as the targeting rule reads them", async () => {
  // Pure: the ordering over a snapshot posed in memory, distance then id.
  const snapshot = {
    run: {
      player: { x: 0, y: 0, facing: "left", hp: 100 },
      enemies: [
        { id: 7, x: 30, y: 40 },
        { id: 3, x: -50, y: 0 },
        { id: 9, x: 0, y: 10 },
        { id: 2, x: 0, y: -10 },
      ],
    },
  } as unknown as WickSnapshot;
  assertDeepEqual(
    nearestEnemies(snapshot).map((enemy) => enemy.id),
    [2, 9, 3, 7],
    "every enemy, nearest first, ties by lowest id",
  );
  assertDeepEqual(
    nearestEnemies(snapshot, 2).map((enemy) => enemy.id),
    [2, 9],
    "the two nearest",
  );
  assertDeepEqual(
    directionToward(snapshot, { x: 30, y: 40 }),
    { x: 0.6, y: 0.8 },
    "the unit vector toward an enemy",
  );
  assertDeepEqual(
    directionToward(snapshot, { x: 0, y: 0 }),
    { x: -1, y: 0 },
    "the facing direction when the centers coincide",
  );
});

it("tells the enemies a pose spawned from the ones already standing", async () => {
  await isolate(h);
  await placeEnemy(h, "moth", 100, 0);
  const before = await h.snapshot();
  await h.debug.spawnEnemy("bat", 200, 0);
  await h.debug.spawnEnemy("rat", 300, 0);
  const after = await h.snapshot();
  assertDeepEqual(
    newEnemies(before, after).map((enemy) => enemy.type),
    ["bat", "rat"],
    "the enemies spawned since the earlier read, in id order",
  );
});

it("holds a weapon and a passive in the slots it says", async () => {
  await isolate(h);
  assertEqual(await holdWeapon(h, "ember", 3), 0, "the slot Ember went into");
  assertEqual(await holdWeapon(h, "pin", 2), 1, "the slot Pin went into");
  assertEqual(
    await holdPassive(h, "bellows", 2),
    0,
    "the slot Bellows went into",
  );
  const held = await h.snapshot();
  assertDeepEqual(
    held.run.weapons,
    [
      { id: "ember", level: 3, cooldown: 0 },
      { id: "pin", level: 2, cooldown: 0 },
    ],
    "the weapons held",
  );
  assertDeepEqual(
    held.run.passives,
    [{ id: "bellows", level: 2 }],
    "the passives held",
  );
});

/* ---- Reading the picture --------------------------------------------------- */

it("reads the canvas at one device pixel per logical unit", async () => {
  const surface = await h.surface();
  assertEqual(surface.width, STAGE_W, "the canvas's backing-store width");
  assertEqual(surface.height, STAGE_H, "the canvas's backing-store height");

  const rect = await h.pixelRect(100, 100, 12, 9);
  assertEqual(rect.width, 12, "the width of a 12-unit read");
  assertEqual(rect.height, 9, "the height of a 9-unit read");
  assertEqual(rect.data.length, 12 * 9 * 4, "the RGBA bytes of that read");
});

it("hands back the operations one frame's render issued", async () => {
  await startRun(h);
  const calls = await h.frameCalls();
  assertGreaterThan(drawOps(calls), 0, "drawing operations in one frame");
});

it("names the images a frame drew, with their own natural size", async () => {
  await startRun(h);
  const drawn = imageDraws(await h.frameCalls());
  assertGreaterThan(drawn.length, 0, "images drawn in one frame");
  for (const draw of drawn) {
    assertGreaterThan(draw.image.id, 0, "the identity of a drawn image");
    assertGreaterThan(draw.image.width, 0, "a drawn image's natural width");
  }
});

it("walks the camera formula both ways", () => {
  // Pure arithmetic over a snapshot posed in memory: the formula
  // specs/world.md states, not a build's.
  const snapshot = {
    run: { player: { x: 300, y: -120, facing: "right", hp: 100 } },
  } as WickSnapshot;
  const stage = stagePoint(snapshot, 400, -120);
  assertNear(stage.x, STAGE_CX + 100, 1e-9, "the stage x of a point 100 right");
  assertNear(
    stage.y,
    STAGE_CY,
    1e-9,
    "the stage y of a point level with the lamplighter",
  );
  const world = worldPoint(snapshot, STAGE_CX, STAGE_CY);
  assertNear(world.x, 300, 1e-9, "the world x under the stage center");
  assertNear(world.y, -120, 1e-9, "the world y under the stage center");
});

/* ---- The audio probe ------------------------------------------------------- */

it("names the cues the build plays, and stamps them with the frame", async () => {
  // ONE OF THE TWO CHECKS IN THIS FILE THAT READ WHAT THE BUILD SOUNDED, so one
  // of the two that ask for the arming gesture — and asking is a creation, not a
  // call. The gesture is a real browser event the build is entitled to act on,
  // and what makes it safe is that it lands before the harness's opening
  // `reset`; past that there is no restore left to put back what it touched. So
  // the shared harness goes and an armed one takes its place. Every other
  // harness in this file is handed no gesture at all.
  await h.dispose();
  h = await createHarness({ armAudio: true });
  // The probe saw the build's produced files decode, by name: road one works
  // end to end, from the fetch to the buffer.
  const decoded = await decodedCues(h);
  for (const cue of CUE_NAMES) {
    assertTrue(decoded.includes(cue), `the ${cue} file decoded under its name`);
  }

  const cues = await watchNamedCues(h);
  await startRunFromTitle(h);
  await h.step(2);
  // WHICH cue sounds on which frame is `audio/`'s business. What this proves is
  // that the probe hears sounds at all, names each one of the fifteen or
  // nothing, and stamps every one with a frame inside the drive that produced it.
  assertGreaterThan(await soundCount(h), 0, "sounds the probe heard");
  assertGreaterThan(cues.length, 0, "cues the watcher collected");
  for (const cue of cues) {
    assertTrue(
      cue.name === null || (CUE_NAMES as readonly string[]).includes(cue.name),
      `a heard cue's name (${String(cue.name)}) among the fifteen or null`,
    );
    assertBetween(cue.frame, 1, h.frame(), "the frame a cue was stamped with");
    assertBetween(
      cue.first,
      1,
      cue.frame,
      "the first frame of the drive that heard it",
    );
  }
  const looping = await loopingCues(h);
  for (const name of looping) {
    assertTrue(
      (CUE_NAMES as readonly string[]).includes(name),
      `a looping cue's name (${name}) among the fifteen`,
    );
  }
});

it("stamps a single-frame drive with exactly that frame", async () => {
  // The other one, armed the same way and for the same reason as above. The
  // frame counter is untouched by it: the gesture's settling frames run before
  // the opening `reset`, so the tap below is still this harness's frame 1.
  await h.dispose();
  h = await createHarness({ armAudio: true });
  const cues = await watchNamedCues(h);
  // A tap is down, ONE frame, up: whatever it made the build play carries that
  // one frame as both ends of its span.
  await startRunFromTitle(h);
  const tapFrame = h.frame();
  assertEqual(tapFrame, 1, "the frame a tap drives");
  for (const cue of cues) {
    assertEqual(cue.first, cue.frame, "a single-frame drive's span");
    assertEqual(cue.frame, tapFrame, "the frame a tap's cue is stamped with");
  }
});

it("reads a span of cues by frame", () => {
  // Pure: the readers over a log posed in memory.
  const cues: NamedCue[] = [
    { name: "hit", url: null, loop: false, frame: 3, first: 3 },
    { name: "kill", url: null, loop: false, frame: 3, first: 3 },
    { name: "hit", url: null, loop: false, frame: 6, first: 4 },
    { name: null, url: null, loop: false, frame: 6, first: 4 },
    { name: "music", url: null, loop: true, frame: 1, first: 1 },
  ];
  assertDeepEqual(
    namesOnFrame(cues, 3),
    ["hit", "kill"],
    "the names on frame 3",
  );
  assertDeepEqual(
    namesOnFrame(cues, 5),
    ["hit"],
    "the names on a frame inside a span",
  );
  assertEqual(cuesOnFrame(cues, 2).length, 0, "the cues on a silent frame");
  assertEqual(
    cuesOnFrame(cues, 6).length,
    2,
    "the cues on the span's last frame",
  );
});

/* ---- Evidence -------------------------------------------------------------- */

it("writes a still where the runner looks for it", async () => {
  const dir = collecting();
  await startRun(h);
  await h.step(1);
  await captureStill(h, "still");
  assertTrue(
    existsSync(join(dir, SUITE_DIR, "still.png")),
    "a still written under the suite's own staged path",
  );
});

it("writes a replay of exactly the section the check drove", async () => {
  const dir = collecting();
  await startRun(h);
  // The setup above is OUTSIDE the capture, so what lands is the drive alone.
  const after = await captureReplay(h, "clip", () => h.step(10));
  assertEqual(after.run.tick, 10, "the run clock the capture left");

  const path = join(dir, SUITE_DIR, "clip.json.gz");
  assertTrue(
    existsSync(path),
    "a replay written under the suite's staged path",
  );
  const recording = JSON.parse(
    gunzipSync(readFileSync(path)).toString("utf8"),
  ) as WrittenRecording;
  assertEqual(recording.frames.length, 10, "the frames the capture kept");
  assertEqual(recording.width, STAGE_W, "the replay's logical width");
  assertEqual(recording.height, STAGE_H, "the replay's logical height");
  for (const frame of recording.frames) {
    assertNear(frame.deltaMs, TICK_MS, 1e-6, "one frame's simulated delta");
  }
});

it("writes nothing for a capture that drove no frame", async () => {
  const dir = collecting();
  await captureReplay(h, "empty", async () => undefined);
  assertTrue(
    !existsSync(join(dir, SUITE_DIR, "empty.json.gz")),
    "no replay for a capture that closed no frame",
  );
});

it("costs nothing when nobody is collecting", async () => {
  // No media directory: the scenario still runs, and its value still comes back.
  await startRun(h);
  const after = await captureReplay(h, "clip", () => h.step(3));
  assertEqual(after.run.tick, 3, "the run clock the scenario left");
  await captureStill(h, "still");
  assertEqual(h.frame(), 3, "the frames the scenario drove");
});
