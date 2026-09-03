// harness — the machinery the suites in this directory are built on.
//
// The suites next door are validators: each decides one review point against
// the build. This file decides nothing about the build. It checks the HARNESS,
// whose faults are invisible from inside a suite and wrong in ways nothing else
// catches: an isolation that leaves a bystander on the field would have a
// contact point fail on a moth the check never posed, a step schedule that
// resolves the wrong number of ticks moves every duration this case states, a
// replay written in the wrong framing reaches the console as something it
// cannot read, and a host that cannot serve the produced sprites or decode the
// produced cues would have every presentation point failing a build that did
// exactly what it was asked.
//
// No review item names this file, so a run never loads it. It runs with the
// whole project, which is how a case author runs these suites while writing
// them:
//
//   npx vitest run --config validation/vitest.config.ts

import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { Recording } from "@test-cabinet/simple-2d";
import {
  BASE_MAX_HP,
  CUE_PATHS,
  DEFAULT_SEED,
  ENEMIES,
  ISOLATE_LEVEL,
  enemyFramePath,
  enemySpriteSize,
  LAMPLIGHTER_IDLE_PATH,
  LAMPLIGHTER_SPRITE_HEIGHT,
  LAMPLIGHTER_SPRITE_WIDTH,
  MOVE_SPEED,
  STAGE_CX,
  STAGE_CY,
  TICK_DT,
  TICK_HZ,
  TICK_MS,
  WICK_DEBUG_VERSION,
  xpToNext,
} from "./constants";
import {
  assetPath,
  blitsNear,
  blitsOfFile,
  captureReplay,
  captureStill,
  createHarness,
  cuesNamed,
  enable,
  enemyById,
  hold,
  imagePixels,
  isolate,
  mirrorRect,
  onCue,
  openChest,
  openLevelUp,
  paintedPixels,
  poseScene,
  pressToggle,
  producedFile,
  rectsEqual,
  retable,
  soundsOf,
  spawnEnemyAt,
  startPlay,
  switchesOf,
  tap,
  drawnText,
  minusLines,
  type Harness,
} from "./harness";
import { REQUIRED_OPS, SWITCH_NAMES } from "./surface";

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
/* The engine, the surface, and the step schedule                             */
/* -------------------------------------------------------------------------- */

it("stands the build up on a real engine and reaches its surface", () => {
  // Every check in this project reads the surface off `engine.debug` and never
  // builds one, so the harness having got that far is the precondition of the
  // whole suite. The boot state is read before anything touched it
  // (specs/ui.md: the game opens on the title).
  expect(h.surfaceFault).toBeNull();
  expect(h.boot).not.toBeNull();
  expect(h.boot?.screen).toBe("title");
  expect(h.debug.version).toBe(WICK_DEBUG_VERSION);
  for (const op of REQUIRED_OPS) {
    expect(
      typeof (h.engine.debug as unknown as Record<string, unknown>)[op],
      op,
    ).toBe("function");
  }

  const opening = h.snapshot();
  expect(opening.screen).toBe("title");
  expect(opening.menuIndex).toBe(0);
  expect(opening.run.tick).toBe(0);
  expect(opening.run.level).toBe(1);
  expect(opening.run.weapons).toEqual([]);
  expect(opening.run.enemies).toEqual([]);
  for (const name of SWITCH_NAMES) expect(opening[name], name).toBe(true);
});

it("runs a pose through apply and a reading against the current state", () => {
  // The engine holds the state by value, so a pose is a transition rather
  // than a mutation: what `h.debug.setHp(40)` has to leave behind is a state
  // the ENGINE is holding, which the next frame's `update` then receives. A
  // driver that called the pose and dropped what it returned would leave
  // every scenario in this directory posing nothing at all, silently.
  h.reset();
  h.debug.setScreen("playing");
  h.debug.setHp(40);

  expect(h.snapshot().run.player.hp).toBe(40);
  expect(h.state.run.player.hp).toBe(40);
});

it("lets a refused pose throw out of the driver and leave the state as it was", () => {
  // specs/instrumentation.md: an argument outside its domain "throws rather
  // than guessing". The throw has to reach the check that made the call, and
  // `engine.apply` has to leave the state untouched behind it.
  h.reset();
  h.debug.setScreen("playing");
  const before = h.snapshot();

  expect(() => h.debug.setHp(BASE_MAX_HP + 1)).toThrow();

  expect(h.snapshot()).toEqual(before);
});

it("resolves exactly one tick per frame on playing", async () => {
  // The pairing the spec itself prescribes: a ConstantClock of 1000 / 60
  // milliseconds with engine.advance, one frame per tick on `playing`.
  expect(TICK_MS * TICK_HZ).toBeCloseTo(1000, 9);
  isolate(h);
  const opening = h.snapshot();

  const after = await h.tick(7);

  expect(after.run.tick - opening.run.tick).toBe(7);
  expect(h.frame()).toBe(7);
  expect(after.simTime - opening.simTime).toBeCloseTo(7 * TICK_DT, 9);
});

it("runs one frame of any length through frameOf and puts the clock back", async () => {
  // A check about the division of ticks into frames poses a frame of its own
  // length; every frame after it is one tick again.
  isolate(h);
  const opening = h.snapshot();

  const partial = await h.frameOf(0.04);
  expect(partial.run.tick - opening.run.tick).toBe(2);
  expect(partial.accumulator).toBeCloseTo(0.04 - 2 * TICK_DT, 9);

  const next = await h.tick(1);
  expect(next.run.tick - partial.run.tick).toBe(1);
  expect(h.timeMs()).toBeCloseTo(40 + TICK_MS, 6);
});

/* -------------------------------------------------------------------------- */
/* Posing an isolated night                                                   */
/* -------------------------------------------------------------------------- */

it("isolates an empty playing run with every switch off and no weapon", () => {
  const posed = isolate(h);

  expect(posed.screen).toBe("playing");
  expect(posed.run.enemies).toEqual([]);
  expect(posed.run.projectiles).toEqual([]);
  expect(posed.run.zones).toEqual([]);
  expect(posed.run.gems).toEqual([]);
  expect(posed.run.pickups).toEqual([]);
  expect(posed.run.weapons).toEqual([]);
  expect(posed.run.passives).toEqual([]);
  expect(posed.run.level).toBe(ISOLATE_LEVEL);
  expect(posed.run.xpToNext).toBe(xpToNext(ISOLATE_LEVEL));
  for (const name of SWITCH_NAMES) expect(posed[name], name).toBe(false);
  expect(posed.rngState).toBe(h.snapshot().rngState);
});

it("leaves the isolated state exactly as posed across ticks", async () => {
  // Nothing spawns, nothing moves, nothing fires: sixty ticks of an isolated
  // night change the clock and nothing else the scenario posed.
  const posed = isolate(h);
  const id = spawnEnemyAt(h, "moth", 200, 0);
  const placed = h.snapshot();

  const after = await h.tick(60);

  expect(after.run.tick).toBe(posed.run.tick + 60);
  expect(after.run.enemies).toHaveLength(1);
  const moth = enemyById(after, id);
  expect(moth?.x).toBe(200);
  expect(moth?.y).toBe(0);
  expect(moth?.heading).toEqual(enemyById(placed, id)?.heading);
  expect(after.run.player).toEqual(placed.run.player);
  expect(after.run.projectiles).toEqual([]);
  expect(after.run.zones).toEqual([]);
  expect(after.run.pendingLevelUps).toBe(0);
  expect(after.screen).toBe("playing");
  expect(after.rngState).toBe(placed.rngState);
  expect(switchesOf(after)).toEqual(switchesOf(posed));
});

it("keeps Taper on request and turns exactly the named switches on", async () => {
  const posed = isolate(h, { keepTaper: true, level: 3 });
  expect(posed.run.weapons.map((held) => held.id)).toEqual(["taper"]);
  expect(posed.run.level).toBe(3);

  enable(h, "weaponFire", "enemyMotion");
  const after = h.snapshot();
  expect(after.weaponFire).toBe(true);
  expect(after.enemyMotion).toBe(true);
  expect(after.spawning).toBe(false);
  expect(after.enemyContact).toBe(false);

  // With weaponFire on, the held Taper fires on the next tick: the timer is 0
  // on acquisition (specs/weapons.md).
  const fired = await h.tick(1);
  expect(fired.run.zones.some((zone) => zone.kind === "slash")).toBe(true);
});

it("reseeds through reset so the draw stream is the caller's", async () => {
  // `reset(seed)` is the one lever over the generator; two resets with the
  // same seed leave indistinguishable states (specs/instrumentation.md).
  h.reset(42);
  const first = h.snapshot();
  h.debug.setScreen("playing");
  await h.tick(3);
  h.reset(42);

  expect(h.snapshot()).toEqual(first);
  expect(first.screen).toBe("title");
  expect(first.run.tick).toBe(0);
  h.reset();
  expect(h.snapshot().rngState).toBe(h.snapshot().rngState);
  h.reset(DEFAULT_SEED);
  const seeded = h.snapshot().rngState;
  h.reset();
  expect(h.snapshot().rngState).toBe(seeded);
});

it("reaches every posable screen through poseScene", () => {
  for (const screen of [
    "playing",
    "paused",
    "fallen",
    "dawn",
    "howto",
    "title",
  ] as const) {
    expect(poseScene(h, screen).screen, screen).toBe(screen);
  }
});

it("opens the two overlays through the ticks that open them", async () => {
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
});

it("starts a run the way a player does", async () => {
  // The real path: reset to the title, `confirm` on LIGHT THE LAMP. The
  // confirming frame runs the run's first tick (specs/controls.md).
  const opening = await startPlay(h);

  expect(opening.screen).toBe("playing");
  expect(opening.run.tick).toBe(1);
  expect(opening.run.weapons.map((held) => held.id)).toEqual(["taper"]);
  expect(opening.run.player.facing).toBe("right");
});

/* -------------------------------------------------------------------------- */
/* Input, as a player's keys deliver it                                       */
/* -------------------------------------------------------------------------- */

it("delivers exactly one action edge per tap", async () => {
  h.reset();
  expect(h.snapshot().menuIndex).toBe(0);

  const after = await tap(h, "ArrowDown");

  expect(after.menuIndex).toBe(1);
});

it("holds a movement key for a counted number of ticks", async () => {
  // 180 units per second held for 30 ticks (half a second) carries the
  // lamplighter 90 units to the right (specs/world.md).
  isolate(h);

  const after = await hold(h, "ArrowRight", 30);

  expect(after.run.player.x).toBeCloseTo((MOVE_SPEED * 30) / TICK_HZ, 6);
  expect(after.run.player.y).toBe(0);
});

it("marks a repeat event as the engine reads it", async () => {
  // An OS auto-repeat is not a new press: with the key already held, a repeat
  // keydown moves the highlight no further.
  h.reset();
  h.holdKey("ArrowDown");
  await h.tick(1);
  h.holdKey("ArrowDown", { repeat: true });
  await h.tick(1);
  h.releaseKey("ArrowDown");

  expect(h.snapshot().menuIndex).toBe(1);
});

/* -------------------------------------------------------------------------- */
/* The ticks run the real systems                                             */
/* -------------------------------------------------------------------------- */

it("resolves a real contact, with its cue, from the ticks alone", async () => {
  // A rat posed overlapping the lamplighter with enemyContact on hits on the
  // next tick, removing its damage and playing `hurt`. Nothing poses the
  // outcome: the tick decides it.
  isolate(h);
  spawnEnemyAt(h, "rat", 10, 0);
  enable(h, "enemyContact");
  const cues = onCue(h);

  const after = await h.tick(1);

  expect(after.run.player.hp).toBeCloseTo(BASE_MAX_HP - ENEMIES.rat.damage, 9);
  expect(cuesNamed(cues, "hurt")).toHaveLength(1);
});

it("traces a schedule tick by tick", async () => {
  isolate(h);
  spawnEnemyAt(h, "moth", 10, 0);
  enable(h, "enemyContact");

  const seen = await h.trace(31);

  expect(seen).toHaveLength(31);
  const hits = seen
    .map((snapshot, i) => ({ tick: i + 1, hp: snapshot.run.player.hp }))
    .filter((sample, i, all) => i === 0 || sample.hp !== all[i - 1].hp)
    .map((sample) => sample.tick);
  expect(hits).toEqual([1, 31]);
});

/* -------------------------------------------------------------------------- */
/* The host: sprites, and cues                                                */
/* -------------------------------------------------------------------------- */

it("serves the produced sprites and sounds to the engine's loader", async () => {
  // Node has neither a page for a relative URL to resolve against, an image
  // decoder, nor an AudioContext, so without the host this harness stands up,
  // the build is asked to draw art and bind cues nobody gave it, and every
  // presentation point fails a build that did exactly what it was asked.
  expect(h.assetFailures).toEqual([]);
  expect(h.assetsLoaded.map((asset) => asset.path)).toContain(
    LAMPLIGHTER_IDLE_PATH,
  );
  expect(producedFile(LAMPLIGHTER_IDLE_PATH)).not.toBeNull();

  isolate(h);
  const blits = await h.frameBlits();
  const onLamplighter = blitsNear(h, blits, STAGE_CX, STAGE_CY, 20);

  expect(blits.length).toBeGreaterThan(0);
  expect(onLamplighter.length).toBeGreaterThan(0);
  const idle = blitsOfFile(onLamplighter, LAMPLIGHTER_IDLE_PATH);
  expect(idle.length).toBeGreaterThan(0);
  expect(idle[0].id).toBe(assetPath(LAMPLIGHTER_IDLE_PATH));
  expect(idle[0].w).toBe(LAMPLIGHTER_SPRITE_WIDTH);
  expect(idle[0].h).toBe(LAMPLIGHTER_SPRITE_HEIGHT);
});

it("withholds a named file from the loader alone", async () => {
  const withheld = await createHarness({
    withhold: [LAMPLIGHTER_IDLE_PATH],
  });
  try {
    expect(withheld.assetFailures.map((asset) => asset.path)).toEqual([
      LAMPLIGHTER_IDLE_PATH,
    ]);
    expect(withheld.assetsLoaded.map((asset) => asset.path)).not.toContain(
      LAMPLIGHTER_IDLE_PATH,
    );
  } finally {
    withheld.dispose();
  }
  // The refusal ends with that harness: this one loaded everything.
  expect(h.assetFailures).toEqual([]);
});

it("watches only the cues that sounded during the drive", async () => {
  h.reset();
  await h.tick();
  const cues = onCue(h);
  expect(cues).toEqual([]);

  await tap(h, "ArrowDown");

  expect(cues.map((cue) => cue.name)).toContain("menu-move");
});

it("reads a loop as looping only while it loops", async () => {
  // The music loops on `playing` and stops on `title` (specs/ui.md); the
  // reading comes off the engine's cue bus, kept between its looped and
  // stopped announcements.
  h.reset();
  h.debug.setScreen("playing");
  await h.tick();
  expect(h.looping("music")).toBe(true);
  expect(h.loopingCues()).toContain("music");
  const starts = h.loopStarts();

  h.debug.setScreen("title");
  await h.tick();
  expect(h.looping("music")).toBe(false);
  expect(h.loopStarts()).toBe(starts);
});

it("names the file a cue sounded from, on the audio context it unlocked", async () => {
  // The bus binds a name to a decoded buffer inside the engine, so the file
  // behind a cue is observable only where the bus starts a sound: the
  // harness's stub context records each start with the buffer's source and
  // the cue announced a moment before it.
  h.reset();
  await h.tick();
  await tap(h, "ArrowDown");

  const moves = soundsOf(h, "menu-move");
  expect(moves.length).toBeGreaterThan(0);
  expect(moves[moves.length - 1].file).toBe(assetPath(CUE_PATHS["menu-move"]));
  expect(moves[moves.length - 1].loop).toBe(false);

  h.debug.setScreen("playing");
  await h.tick();
  const music = soundsOf(h, "music");
  expect(music.length).toBeGreaterThan(0);
  expect(music[music.length - 1].file).toBe(assetPath(CUE_PATHS.music));
  expect(music[music.length - 1].loop).toBe(true);
});

it("maps a world point onto the stage under the camera formula", async () => {
  // specs/world.md: a world point (wx, wy) is drawn at
  // (wx − player.x + STAGE_CX, wy − player.y + STAGE_CY). `stagePoint` is that
  // formula read against the lamplighter's posed position, and a produced
  // sprite drawn centered on its enemy lands where the formula says.
  isolate(h);
  h.debug.setPlayerPosition(50, 30);
  spawnEnemyAt(h, "moth", 250, 30);

  const at = h.stagePoint(250, 30);
  expect(at).toEqual({ x: STAGE_CX + 200, y: STAGE_CY });

  const blits = await h.frameBlits();
  const onMoth = blitsNear(h, blits, at.x, at.y, ENEMIES.moth.radius);
  expect(onMoth.length).toBeGreaterThan(0);
  const frame = blitsOfFile(onMoth, enemyFramePath("moth", 0));
  expect(frame.length).toBeGreaterThan(0);
  expect(frame[0].w).toBe(enemySpriteSize("moth"));
  expect(frame[0].h).toBe(enemySpriteSize("moth"));
});

it("reads a produced file's pixels at the canvas the specification fixes", async () => {
  const file = producedFile(LAMPLIGHTER_IDLE_PATH);
  expect(file).not.toBeNull();
  const pixels = await imagePixels(file ?? "");
  expect(pixels).not.toBeNull();
  expect(pixels?.width).toBe(LAMPLIGHTER_SPRITE_WIDTH);
  expect(pixels?.height).toBe(LAMPLIGHTER_SPRITE_HEIGHT);
  expect(
    paintedPixels(
      pixels ?? { width: 0, height: 0, data: new Uint8ClampedArray(0) },
    ),
  ).toBeGreaterThan(0);

  expect(await imagePixels(join(mediaDir, "nothing-here.png"))).toBeNull();
});

it("reads a rectangle of the stage back in logical units and mirrors it", async () => {
  isolate(h);
  await h.tick();

  const rect = h.pixelRect(STAGE_CX - 16, STAGE_CY - 16, 32, 32);
  expect(rect.width).toBe(32);
  expect(rect.height).toBe(32);
  expect(rect.data.length).toBe(32 * 32 * 4);
  expect(paintedPixels(rect)).toBe(32 * 32);

  const mirrored = mirrorRect(rect);
  expect(mirrored.width).toBe(rect.width);
  expect(rectsEqual(mirrorRect(mirrored), rect)).toBe(true);
  const [r, g, b, a] = h.pixel(STAGE_CX - 16, STAGE_CY - 16);
  expect([rect.data[0], rect.data[1], rect.data[2], rect.data[3]]).toEqual([
    r,
    g,
    b,
    a,
  ]);
});

/* -------------------------------------------------------------------------- */
/* The overlay                                                                */
/* -------------------------------------------------------------------------- */

it("reads the registered diagnostics and toggles the overlay with a real key", async () => {
  isolate(h);
  const readings = h.diagnostics();
  expect(readings.length).toBeGreaterThan(0);
  expect(readings.every((reading) => reading.error === undefined)).toBe(true);

  const { calls: before } = await h.frameDraw();
  await pressToggle(h);
  const { calls: shown } = await h.frameDraw();
  expect(
    minusLines(drawnText(shown), drawnText(before)).length,
  ).toBeGreaterThan(0);
});

/* -------------------------------------------------------------------------- */
/* Evidence capture                                                           */
/* -------------------------------------------------------------------------- */

/** What this suite wrote into its own output directory, by file name. */
function written(): string[] {
  try {
    return readdirSync(join(mediaDir, SUITE_DIR)).sort();
  } catch {
    // The directory is made only when there is something to put in it.
    return [];
  }
}

/** A recording read back off disk, in the shape the assertions below read. */
interface WrittenRecording {
  format: number;
  ops: unknown[];
  states: unknown[];
  frames: {
    count: number;
    timeMs: number;
    deltaMs: number;
    state: number;
    stack: number[];
    ops: number[];
  }[];
}

/** The recording written under `name`, read back off disk. */
function readBack(name: string): WrittenRecording {
  const bytes = readFileSync(join(mediaDir, SUITE_DIR, name));
  // The framing read off the bytes rather than off the name: a gzip member
  // opens `0x1f 0x8b` (RFC 1952), so this is the capture actually being
  // compressed rather than named as though it were.
  expect([bytes[0], bytes[1]]).toEqual([0x1f, 0x8b]);
  return JSON.parse(gunzipSync(bytes).toString("utf8")) as WrittenRecording;
}

it("writes a captured section as gzip, under the declared name", async () => {
  isolate(h);
  await captureReplay(h, "section", () => h.tick(10));

  expect(written()).toEqual(["section.json.gz"]);
  const recording = readBack("section.json.gz");
  expect(recording.format).toBeGreaterThan(0);
  expect(recording.frames.length).toBe(10);
});

it("writes nothing at all for a section that drew no frames", async () => {
  await captureReplay(h, "nothing", () => undefined);

  expect(written()).toEqual([]);
});

it("hands the scenario's own value back", async () => {
  isolate(h);
  const after = await captureReplay(h, "walk", () => hold(h, "ArrowRight", 30));

  expect(after.run.player.x).toBeCloseTo(90, 6);
  expect(written()).toEqual(["walk.json.gz"]);
});

it("keeps the whole of an over-long section, at a lower frame rate", async () => {
  isolate(h);
  await captureReplay(h, "long", () => h.advance(1000));

  const recording = readBack("long.json.gz");
  expect(recording.frames.length).toBeGreaterThan(1);
  expect(recording.frames.length).toBeLessThanOrEqual(300);
  const counts = recording.frames.map((frame) => frame.count);
  expect([...counts].sort((a, b) => a - b)).toEqual(counts);
  expect(counts[counts.length - 1] - counts[0]).toBe(999);
  const elapsed = recording.frames.reduce((sum, f) => sum + f.deltaMs, 0);
  expect(elapsed).toBeCloseTo(1000 * TICK_MS, 3);
  const named = new Set(recording.frames.flatMap((frame) => frame.ops));
  expect(named.size).toBe(recording.ops.length);
  for (const frame of recording.frames) {
    expect(frame.state).toBeGreaterThanOrEqual(0);
    expect(frame.state).toBeLessThan(recording.states.length);
    for (const op of frame.ops) {
      expect(op).toBeGreaterThanOrEqual(0);
      expect(op).toBeLessThan(recording.ops.length);
    }
  }
});

it("rewrites a field named __proto__ as a field", () => {
  const held = JSON.parse('{"__proto__": {"tainted": true}}') as Record<
    string,
    never
  >;
  const recording: Recording = {
    format: 1,
    width: 8,
    height: 8,
    background: null,
    images: [],
    resources: [],
    ops: [{ op: "set", property: "fillStyle", value: held }],
    states: [
      {
        properties: held,
        transform: null,
        lineDash: null,
        clip: [],
        path: [],
      },
    ],
    frames: [
      {
        count: 1,
        timeMs: 8,
        deltaMs: 8,
        surface: { width: 8, height: 8 },
        state: 0,
        stack: [],
        ops: [0],
      },
    ],
  };

  const rewritten = retable(recording, recording.frames);
  const value = (rewritten.ops[0] as { value: object }).value;
  expect(Object.prototype.hasOwnProperty.call(value, "__proto__")).toBe(true);
  expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
  const properties = rewritten.states[0].properties;
  expect(Object.prototype.hasOwnProperty.call(properties, "__proto__")).toBe(
    true,
  );
  expect(Object.getPrototypeOf(properties)).toBe(Object.prototype);
});

it("keeps a still of the frame on the canvas, as a PNG", async () => {
  poseScene(h, "playing");
  await h.tick();
  captureStill(h, "night");

  expect(written()).toEqual(["night.png"]);
  const bytes = readFileSync(join(mediaDir, SUITE_DIR, "night.png"));
  expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
});

it("addresses a capture by the suite that made it", async () => {
  isolate(h);
  await captureReplay(h, "addressed", () => h.advance(5));

  expect(readdirSync(join(mediaDir, "validation", "harness.test.ts"))).toEqual([
    "addressed.json.gz",
  ]);
});
