// harness — the shared machinery every validator in this project stands on.
//
// The suites next door are validators: each decides one review point against the
// build. This file decides nothing about the build. It checks the HARNESS, whose
// faults are invisible from inside a suite and wrong in ways nothing else
// catches:
//
//  - a page that never reached the build's surface reports a build that installed
//    one perfectly well as one that installed none;
//  - a clock that ran a different number of frames than a check asked for makes
//    every rate this specification states unreadable;
//  - a key put down through the surface that never reaches the game turns every
//    movement, drill and menu check into a check of nothing;
//  - a scene helper that leaves the previous check's terrain, cargo or faculty in
//    place makes a hundred isolated validators into a hundred that are not;
//  - a replay written in the wrong framing reaches the console as something it
//    cannot read, and one written for a section that drew nothing is reported to
//    the reviewer as evidence that exists.
//
// So each of those is exercised here, against the reference implementation the
// project is developed on. That does mean a few assertions below read the build:
// a held key has to move SOMETHING for the input path to be shown working. Those
// are deliberately the weakest readings that still prove the machinery — the
// miner moved east rather than by how much — because the figure is the business
// of the validator that owns it, and stating it twice would fail one build twice
// for one fault.
//
// No review item names this file, so a run never loads it. It runs with the whole
// project, which is how a case author runs these suites while writing them:
//
//   npx vitest run --config validation/vitest.config.ts validation/harness.test.ts

import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  BAND_HEALTH,
  CAVE_MOUTH_COL,
  DEEPCORE_DEBUG_VERSION,
  LIFE_SUPPORT_BURN,
  MINER_H,
  ORES,
  SPAWN_COL,
  STAGE_H,
  STAGE_W,
  TILE,
  UNBOUND_KEY,
} from "./constants";
import { REQUIRED_OPS } from "./surface";
import {
  ACTION_KEY,
  captureReplay,
  captureStill,
  cellCenter,
  colorDistance,
  createHarness,
  digShaft,
  driveCut,
  driveFall,
  driveHold,
  drewText,
  layCamp,
  layFloor,
  layOre,
  loadToFraction,
  minerXOn,
  minerYOn,
  openExpedition,
  openScene,
  pinDrill,
  pinMiner,
  REPLAY_BACKGROUND,
  sampleCell,
  stageCargo,
  stageItems,
  stageTiers,
  standAtBuilding,
  standAtCamp,
  standOn,
  startWithKeys,
  thinReplay,
  TICK_MS,
  watchCues,
  worldToStage,
  type Harness,
  type RecordedFrame,
  type Recording,
} from "./harness";

/** The environment variable the runner names the media directory in. */
const MEDIA_DIR_ENV = "TCAB_VALIDATION_MEDIA_DIR";

/**
 * Where this file's own outputs land: the staged project directory, then the
 * suite's path within the project, which for this file is its own name.
 */
const SUITE_DIR = join("validation", "harness.test.ts");

/** A column and a row well clear of the camp, the cave mouth, and the Core. */
const COL = 8;
const ROW = 12;

let mediaDir: string;
let collecting: string | undefined;
let h: Harness;

beforeEach(async () => {
  collecting = process.env[MEDIA_DIR_ENV];
  mediaDir = mkdtempSync(join(tmpdir(), "deepcore-replay-"));
  process.env[MEDIA_DIR_ENV] = mediaDir;
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
  if (collecting === undefined) delete process.env[MEDIA_DIR_ENV];
  else process.env[MEDIA_DIR_ENV] = collecting;
  rmSync(mediaDir, { recursive: true, force: true });
});

/** What this suite wrote into its own output directory, by file name. */
function written(): string[] {
  try {
    return readdirSync(join(mediaDir, SUITE_DIR)).sort();
  } catch {
    // The directory is made only when there is something to put in it.
    return [];
  }
}

/** The recording written under `name`, read back off disk. */
function readBack(name: string): Recording {
  const bytes = readFileSync(join(mediaDir, SUITE_DIR, name));
  // The framing read off the bytes rather than off the name: a gzip member opens
  // `0x1f 0x8b` (RFC 1952), so this is the capture actually being compressed
  // rather than named as though it were.
  expect([bytes[0], bytes[1]]).toEqual([0x1f, 0x8b]);
  return JSON.parse(gunzipSync(bytes).toString("utf8")) as Recording;
}

/* -------------------------------------------------------------------------- */
/* Reaching the build at all                                                  */
/* -------------------------------------------------------------------------- */

it("reaches a surface that carries every operation the specification requires", async () => {
  expect(h.surfaceFault).toBeNull();

  const { version, ops } = await h.probe(REQUIRED_OPS);
  expect(version).toBe(DEEPCORE_DEBUG_VERSION);
  const absent = REQUIRED_OPS.filter((name) => ops[name] !== "function");
  expect(absent).toEqual([]);
});

it("opens a page that loaded the built site without an error", async () => {
  // A full-stack build fetches the assets it produced on the way up, so a broken
  // asset path is a page error rather than a missing surface — and every check in
  // this project would then be reading a game drawn with nothing.
  await h.advance(4);
  expect(h.pageErrors).toEqual([]);
});

it("opens with the game off its own clock, at the title, on an empty mine", async () => {
  const snapshot = await h.snapshot();
  expect(snapshot.autoStep).toBe(false);
  expect(snapshot.screen).toBe("title");
  expect(snapshot.simTime).toBe(0);
  expect((await h.tileAt(COL, ROW)).kind).toBe("tunnel");
});

/* -------------------------------------------------------------------------- */
/* The clock                                                                  */
/* -------------------------------------------------------------------------- */

it("runs exactly the frames a check asks for, and no others", async () => {
  // The page keeps rendering while the game is off the wall clock, so a frame the
  // page painted on its own must not reach the game's simulated time.
  await openScene(h);
  const before = await h.snapshot();
  await h.advance(120);

  expect(h.frame()).toBe(120);
  expect(h.timeMs()).toBeCloseTo(120 * TICK_MS, 6);
  const after = await h.snapshot();
  expect(after.simTime - before.simTime).toBeCloseTo(1, 6);
  expect(after.autoStep).toBe(false);
});

it("covers a named span of game time in however many frames it is given", async () => {
  await openScene(h);
  const before = (await h.snapshot()).simTime;
  await h.advanceSeconds(30, 30);

  expect(h.frame()).toBe(30);
  expect((await h.snapshot()).simTime - before).toBeCloseTo(30, 6);
});

it("refuses a span it cannot divide into whole frames", async () => {
  await expect(h.advanceSeconds(1, 0)).rejects.toThrow(RangeError);
  await expect(h.advanceSeconds(1, 1.5)).rejects.toThrow(RangeError);
});

it("sweeps until a predicate holds and reports where it stopped", async () => {
  await openScene(h);
  await layFloor(h, ROW + 1);
  await standOn(h, COL, ROW + 1);
  await pinDrill(h);

  // The miner is standing; nothing moves it, so a predicate that never holds
  // spends the whole budget and says so rather than hanging.
  const missed = await h.until((s) => s.miner.vy > 100, { maxFrames: 20 });
  expect(missed.hit).toBe(false);
  expect(missed.frames).toBe(20);

  const found = await h.until((s) => s.miner.grounded, { maxFrames: 20 });
  expect(found.hit).toBe(true);
  expect(found.frames).toBe(0);
});

it("hands the game back to its own loop, and takes it back", async () => {
  await openScene(h);
  const before = (await h.snapshot()).simTime;
  await h.runFor(250);
  const after = await h.snapshot();

  // Real time passed and the build's own loop ran it, so the game moved on
  // without a single `advance` — and it is back off the clock afterwards.
  expect(after.simTime).toBeGreaterThan(before);
  expect(after.autoStep).toBe(false);
});

/* -------------------------------------------------------------------------- */
/* Input                                                                      */
/* -------------------------------------------------------------------------- */

it("drives the miner with a key held through the surface", async () => {
  await openScene(h);
  await layFloor(h, ROW + 1);
  await standOn(h, COL, ROW + 1, "west");
  await pinDrill(h);

  const moved = await driveHold(h, ACTION_KEY.right, 60);

  // The weakest reading that shows the key reached the game: it went east, and
  // the facing followed the input. How FAST it walks belongs to the movement
  // validator that owns `WALK_SPEED`.
  expect(moved.dx).toBeGreaterThan(0);
  expect(moved.snapshot.miner.facing).toBe("east");
});

it("lets a held key up when the drive is over, and on a reset", async () => {
  await openScene(h);
  await layFloor(h, ROW + 1);
  await standOn(h, COL, ROW + 1);
  await pinDrill(h);

  await h.hold(ACTION_KEY.right);
  await h.advance(30);
  await h.releaseAll();
  // The walk decays rather than stopping dead — how a build sheds lateral speed
  // with nothing held is its own business — so the reading is taken once it has
  // shed it: from there the miner stands still, which it would not do if the key
  // were still down.
  await h.advance(30);
  const settled = (await h.snapshot()).miner.x;
  await h.advance(60);
  expect((await h.snapshot()).miner.x).toBeCloseTo(settled, 6);

  // And a `reset` releases every key the game holds, so the harness's record of
  // what is down has to agree with it.
  await h.hold(ACTION_KEY.right);
  await openScene(h);
  await layFloor(h, ROW + 1);
  await standOn(h, COL, ROW + 1);
  await pinDrill(h);
  await h.advance(30);
  const from = (await h.snapshot()).miner.x;
  await h.advance(60);
  expect((await h.snapshot()).miner.x).toBeCloseTo(from, 6);
});

it("delivers a tap as a press a build reading edges or held state both see", async () => {
  await openScene(h, { screen: "title" });
  const before = (await h.snapshot()).menuIndex;
  await h.tap(ACTION_KEY.down);
  expect((await h.snapshot()).menuIndex).not.toBe(before);
});

it("reaches the game through Chromium's own keyboard as well", async () => {
  // The surface's `keyDown` proves the build's bindings; this proves the runtime
  // the build wrote reads a real `KeyboardEvent.code` off the page at all.
  await openScene(h, { screen: "title" });
  const before = (await h.snapshot()).menuIndex;
  await h.browserTap(ACTION_KEY.down);
  expect((await h.snapshot()).menuIndex).not.toBe(before);
});

it("arms the build's audio with a gesture that changes nothing", async () => {
  await openScene(h, { screen: "title" });
  const before = await h.snapshot();
  await h.armAudio();
  const after = await h.snapshot();

  expect(UNBOUND_KEY).toBe("KeyZ");
  expect(after.screen).toBe(before.screen);
  expect(after.menuIndex).toBe(before.menuIndex);
});

/* -------------------------------------------------------------------------- */
/* Isolation                                                                  */
/* -------------------------------------------------------------------------- */

it("opens a scene that carries nothing the check before it left behind", async () => {
  // Everything a scenario could leave lying around, put there on purpose.
  await openScene(h);
  await h.debug.setTile(COL, ROW, "gas");
  await stageCargo(h, { ferron: 5 });
  await stageItems(h, { dynamite: 3 });
  await stageTiers(h, { drill: 4 });
  await h.debug.setCredits(9000);
  await h.debug.setCameraLead(100);

  await openScene(h);

  const snapshot = await h.snapshot();
  expect((await h.tileAt(COL, ROW)).kind).toBe("tunnel");
  expect(snapshot.cargo.slotsUsed).toBe(0);
  expect(snapshot.items.dynamite).toBe(0);
  expect(snapshot.tiers.drill).toBe(1);
  expect(snapshot.credits).toBe(0);
  expect(snapshot.camera.lead).toBe(0);
  expect(snapshot.screen).toBe("in-mine");
  expect(snapshot.miner.travel).toBe(true);
  expect(snapshot.miner.drill).toBe(true);
});

it("opens a scene at a named size with a grid that agrees with it", async () => {
  // `setWorldSize` moves `coreRow` and leaves the cells where they were, so a
  // scene that named a size and did not regenerate would have a grid and a
  // `coreRow` that disagree.
  await openScene(h, { size: "quick" });
  const snapshot = await h.snapshot();

  expect(snapshot.worldSize).toBe("quick");
  expect(snapshot.coreRow).toBe(250);
  expect((await h.tileAt(COL, snapshot.coreRow)).kind).toBe("bedrock");
  expect((await h.tileAt(COL, snapshot.coreRow - 1)).kind).toBe("tunnel");
});

it("holds the miner's body still and leaves everything else running", async () => {
  await openScene(h);
  await h.debug.setTile(COL, ROW, "rock");
  await standOn(h, COL, ROW);
  await pinMiner(h);

  const before = await h.snapshot();
  await h.hold(ACTION_KEY.down);
  await h.advance(30);
  await h.releaseAll();
  const after = await h.snapshot();

  // Pinned: nothing moved it, though the mine is open all around.
  expect(after.miner.x).toBeCloseTo(before.miner.x, 6);
  expect(after.miner.y).toBeCloseTo(before.miner.y, 6);
  // And everything else carried on: it is still grounded on the cell it stands
  // on, and the drill it holds is cutting into it.
  expect(after.miner.grounded).toBe(true);
  const tile = await h.tileAt(COL, ROW);
  expect(tile.health).toBeLessThan(BAND_HEALTH.topsoil);
});

it("holds the miner's drill and leaves everything else running", async () => {
  await openScene(h);
  await h.debug.setTile(COL, ROW, "rock");
  await standOn(h, COL, ROW);
  await pinDrill(h);

  const fuelBefore = (await h.snapshot()).miner.fuel;
  await h.hold(ACTION_KEY.down);
  await h.advance(60);
  await h.releaseAll();

  // No cut started, so the cell is whole.
  const tile = await h.tileAt(COL, ROW);
  expect(tile.kind).toBe("rock");
  expect(tile.health).toBe(BAND_HEALTH.topsoil);
  // And no drill hit spent fuel: the half second the key was held cost exactly
  // the life support the miner burns underground doing nothing at all, where
  // four hits would have cost `DRILL_HIT_FUEL` apiece on top of it.
  const spent = fuelBefore - (await h.snapshot()).miner.fuel;
  expect(spent).toBeCloseTo(LIFE_SUPPORT_BURN * 0.5, 6);
});

it("stands the miner on the cell a held down cut bites into", async () => {
  await openScene(h);
  await h.debug.setTile(COL, ROW, "rock");
  await standOn(h, COL, ROW);

  const snapshot = await h.snapshot();
  expect(snapshot.miner.x).toBeCloseTo(minerXOn(COL), 6);
  expect(snapshot.miner.y).toBeCloseTo(minerYOn(ROW), 6);
  expect(snapshot.miner.y + MINER_H).toBeCloseTo(ROW * TILE, 6);
  expect(snapshot.miner.grounded).toBe(true);

  const cut = await driveCut(h, "down", { col: COL, row: ROW });
  expect(cut.broke).toBe(true);
});

it("lays a camp the miner stands on, with the cave mouth still open", async () => {
  await openScene(h);
  await layCamp(h);
  await standAtCamp(h);
  await h.advance(30);

  const snapshot = await h.snapshot();
  expect(snapshot.miner.grounded).toBe(true);
  expect(snapshot.miner.col).toBe(SPAWN_COL);
  expect((await h.tileAt(CAVE_MOUTH_COL, 1)).kind).toBe("tunnel");
});

it("digs a shaft with walls that hold a drifting miner inside it", async () => {
  await openScene(h);
  await digShaft(h, COL, 2, ROW);
  await standOn(h, COL, ROW + 1);
  await pinDrill(h);

  await driveHold(h, ACTION_KEY.right, 60);
  expect((await h.snapshot()).miner.col).toBe(COL);
  expect((await h.tileAt(COL + 1, ROW)).kind).toBe("rock");
  expect((await h.tileAt(COL, ROW)).kind).toBe("tunnel");
});

it("lays an ore vein a cut banks a unit of", async () => {
  await openScene(h);
  await layOre(h, COL, ROW, "ferron");
  await standOn(h, COL, ROW);

  expect((await h.tileAt(COL, ROW)).ore).toBe("ferron");
  const cut = await driveCut(h, "down", { col: COL, row: ROW });
  expect(cut.broke).toBe(true);
  expect(cut.snapshot.cargo.ore.ferron).toBe(1);
});

it("loads the bay to a named load fraction, off the tier's own lift limit", async () => {
  await openScene(h);
  await stageTiers(h, { jetpack: 3 });

  const light = await loadToFraction(h, 0.5, "ferron");
  expect(light.fraction).toBeGreaterThanOrEqual(0.5);
  expect(light.fraction).toBeLessThan(0.5 + ORES.ferron.weight / 2850);
  expect((await h.snapshot()).miner.overloaded).toBe(false);

  const heavy = await loadToFraction(h, 1, "ferron");
  expect(heavy.fraction).toBeGreaterThanOrEqual(1);
  expect((await h.snapshot()).miner.overloaded).toBe(true);
});

/* -------------------------------------------------------------------------- */
/* Compound sequences                                                         */
/* -------------------------------------------------------------------------- */

it("opens an expedition through the surface, on a generated mine", async () => {
  await openExpedition(h, { seed: 7, size: "quick", mode: "hardcore" });
  const snapshot = await h.snapshot();

  expect(snapshot.screen).toBe("in-mine");
  expect(snapshot.mode).toBe("hardcore");
  expect(snapshot.worldSize).toBe("quick");
  expect(snapshot.miner.col).toBe(SPAWN_COL);
  // Generated rather than cleared: there is rock down there.
  expect((await h.tileAt(COL, ROW)).kind).not.toBe("tunnel");
  // And the same seed reaches the same mine, which is what makes a generation
  // check reproducible at all.
  const first = await h.tileAt(COL, ROW);
  await openExpedition(h, { seed: 7, size: "quick" });
  expect(await h.tileAt(COL, ROW)).toEqual(first);
});

it("starts an expedition from the title with menu keys alone", async () => {
  await startWithKeys(h, { mode: "hardcore", size: "marathon" });
  const snapshot = await h.snapshot();

  expect(snapshot.screen).toBe("in-mine");
  expect(snapshot.mode).toBe("hardcore");
  expect(snapshot.worldSize).toBe("marathon");
  expect(snapshot.coreRow).toBe(1000);
});

it("stands the miner at a building the activate control opens", async () => {
  await openExpedition(h);
  await layCamp(h);
  const box = await standAtBuilding(h, "ore-market");

  expect(box.y + box.h).toBe(TILE);
  await h.tap(ACTION_KEY.activate);
  expect((await h.snapshot()).panel).toBe("ore-market");
});

it("names the building it could not find rather than throwing past the check", async () => {
  await openExpedition(h);
  await expect(standAtBuilding(h, "not-a-building")).rejects.toThrow(
    /Expected: a surface building with id "not-a-building"/,
  );
});

it("runs a real cut to the frame the cell breaks on", async () => {
  await openScene(h);
  await h.debug.setTile(COL, ROW, "rock");
  await standOn(h, COL, ROW);

  const cut = await driveCut(h, "down", { col: COL, row: ROW });

  expect(cut.broke).toBe(true);
  expect(cut.tile.kind).toBe("tunnel");
  // Four hits at 0.125 s is half a second, which is 60 frames of this clock. The
  // sweep is over the CELL, so it stops on the frame the last hit landed.
  expect(cut.frames).toBeGreaterThan(0);
  expect(cut.frames).toBeLessThanOrEqual(75);
  // And the key is let up before it returns, so the miner is not still boring.
  await h.advance(30);
  expect((await h.tileAt(COL, ROW + 1)).kind).toBe("tunnel");
});

it("drops the miner onto a floor and reports the landing", async () => {
  await openScene(h);
  await layFloor(h, ROW);
  const fall = await driveFall(h, COL, ROW, 6 * TILE);

  expect(fall.landed).toBe(true);
  expect(fall.impactSpeed).toBeGreaterThan(0);
  expect(fall.snapshot.miner.grounded).toBe(true);
  // Resting on the floor rather than a unit above it: the reading is the frame
  // the contact was resolved on, not the frame the miner was first told it was
  // about to touch down.
  expect(fall.snapshot.miner.y + MINER_H).toBeGreaterThan(ROW * TILE - 1);
  expect(fall.snapshot.miner.y + MINER_H).toBeLessThanOrEqual(ROW * TILE);
  expect(fall.snapshot.miner.vy).toBe(0);
});

/* -------------------------------------------------------------------------- */
/* Reading the picture                                                        */
/* -------------------------------------------------------------------------- */

it("maps a world cell to where the build drew it", async () => {
  await openScene(h);
  await h.debug.setTile(COL, ROW, "rock");
  await standOn(h, COL, ROW);
  await pinMiner(h);
  await pinDrill(h);
  await h.advance(2);

  const snapshot = await h.snapshot();
  const centre = cellCenter(COL, ROW);
  const at = worldToStage(snapshot, centre.x, centre.y);
  expect(at.x).toBeGreaterThan(0);
  expect(at.x).toBeLessThan(STAGE_W);
  expect(at.y).toBeGreaterThan(0);
  expect(at.y).toBeLessThan(STAGE_H);

  // The identity fit: at the stage's own size a logical unit is a canvas pixel.
  const view = h.viewport();
  expect(view.scale).toBe(1);
  expect(view.offsetX).toBe(0);
  expect(view.offsetY).toBe(0);
  const surface = await h.surface();
  expect(surface.width).toBe(STAGE_W);
  expect(surface.height).toBe(STAGE_H);
});

it("samples a posed cell, and tells two kinds apart", async () => {
  await openScene(h);
  await h.debug.setTile(COL, ROW, "rock");
  await h.debug.setTile(COL + 2, ROW, "lava");
  await standOn(h, COL, ROW);
  await pinMiner(h);
  await pinDrill(h);
  await h.advance(4);

  const snapshot = await h.snapshot();
  const rock = await sampleCell(h, snapshot, COL, ROW);
  const lava = await sampleCell(h, snapshot, COL + 2, ROW);
  // Not a verdict on the palette, which the specification leaves to the build:
  // the point is that the sampler reads two different cells rather than the same
  // pixel twice.
  expect(colorDistance(rock, lava)).toBeGreaterThan(0);
});

it("reads the runs of text a frame drew", async () => {
  await openScene(h, { screen: "title" });
  const calls = await h.frameCalls();

  expect(calls.length).toBeGreaterThan(0);
  expect(drewText(calls, "DEEPCORE")).toBe(true);
});

/* -------------------------------------------------------------------------- */
/* Evidence capture                                                           */
/* -------------------------------------------------------------------------- */

it("writes a captured section as gzip, under the replay extension", async () => {
  await openScene(h);
  await captureReplay(h, "descent", () => h.advance(4));

  expect(written()).toEqual(["descent.json.gz"]);
  const recording = readBack("descent.json.gz");
  expect(recording.format).toBeGreaterThan(0);
  expect(recording.frames.length).toBeGreaterThan(0);
  // The design size and background the console's player opens the canvas at.
  expect(recording.width).toBe(STAGE_W);
  expect(recording.height).toBe(STAGE_H);
  expect(recording.background).toBe(REPLAY_BACKGROUND);
});

it("keeps one recorded frame per frame the game ran", async () => {
  // The page keeps rendering while the game is off the wall clock, so a recorder
  // bracketing on the animation frame would keep frames nobody drove and lose the
  // ones a driven `advance` produced. Every frame here is bracketed around one
  // `advance`, inside one crossing into the page, so the two counts agree exactly.
  await openScene(h);
  await captureReplay(h, "counted", () => h.advance(12));

  const recording = readBack("counted.json.gz");
  expect(recording.frames).toHaveLength(12);
  for (const frame of recording.frames) {
    expect(frame.ops.length).toBeGreaterThan(0);
  }
});

it("writes nothing at all for a section that drew no frames", async () => {
  // A scenario that runs no frame closes no frame, so there is no picture to
  // write. Leaving the file unwritten reports the output absent, which is the
  // truthful answer; a file holding an empty frame list would tell the reviewer
  // there is a replay to watch and then open a player on nothing.
  await captureReplay(h, "nothing", () => undefined);

  expect(written()).toEqual([]);
});

it("hands the scenario's own value back", async () => {
  // Capture sits beside a check's assertions rather than in place of them, so
  // what the scenario computed has to survive being recorded.
  await openScene(h);
  const frames = await captureReplay(h, "value", async () => {
    await h.advance(2);
    return 2;
  });

  expect(frames).toBe(2);
  expect(written()).toEqual(["value.json.gz"]);
});

it("leaves the evidence of a section that failed", async () => {
  // The failing check is the one whose replay a reviewer most wants, so the write
  // is in a `finally` and the failure travels on unchanged.
  await openScene(h);
  await expect(
    captureReplay(h, "failed", async () => {
      await h.advance(3);
      throw new Error("the scenario failed");
    }),
  ).rejects.toThrow("the scenario failed");

  expect(written()).toEqual(["failed.json.gz"]);
  expect(readBack("failed.json.gz").frames).toHaveLength(3);
});

it("keeps the whole of an over-long section, at a lower frame rate", async () => {
  // Far more frames than a written recording holds. What comes back covers the
  // whole section — the last frame driven is in it — rather than its opening.
  await openScene(h);
  await captureReplay(h, "long", () => h.advance(900));

  const recording = readBack("long.json.gz");
  expect(recording.frames.length).toBeGreaterThan(1);
  expect(recording.frames.length).toBeLessThanOrEqual(300);
  const counts = recording.frames.map((frame) => frame.count);
  expect([...counts].sort((a, b) => a - b)).toEqual(counts);
  // The deltas are restated against the frame kept before, so they still sum to
  // the section's elapsed time however many frames were dropped between them.
  const elapsed = recording.frames.reduce((sum, f) => sum + f.deltaMs, 0);
  expect(elapsed).toBeCloseTo(900 * TICK_MS, 3);
  // Frames are dropped twice over — in the page as the section runs, and again
  // when it is written — and each drop is the last reference to whatever only
  // that frame drew with. What is written names every entry of the tables it
  // carries, so nothing dropped is still being paid for.
  const named = new Set(recording.frames.flatMap((frame) => frame.ops));
  expect(named.size).toBe(recording.ops.length);
  const inherited = new Set(
    recording.frames.flatMap((frame) => [frame.state, ...frame.stack]),
  );
  expect(inherited.size).toBe(recording.states.length);
  expect(outOfRange(recording)).toEqual([]);
});

it("spends the budget on the section, never one frame past it", () => {
  // The stride the writer thins by rounds up, which puts the sharp edge of the
  // cap at a section whose length is an exact multiple of it: the strided frames
  // come to exactly the cap and stop one stride short of the end. Both rules
  // still hold there. Nothing over the cap, because the cap is what makes
  // `captureReplay` safe to wrap any section in; and the section's last frame
  // written, because it is the frame the check's sweep stopped at.
  for (const length of [599, 600, 601]) {
    const at = `${length} frames`;
    const frames = thinReplay(synthetic(length)).frames;

    expect(frames.length, at).toBeLessThanOrEqual(300);
    // The first frame of a section is always kept — the stride opens on it — so
    // the span between the first count and the last is the whole section exactly
    // when the frame it ended on is the frame written last.
    expect(frames[frames.length - 1].count - frames[0].count, at).toBe(
      length - 1,
    );
    // Displacing a frame leaves the deltas summing to the elapsed time, the same
    // as dropping one does: the frame that replaces it is measured from where the
    // frame before it was kept.
    const elapsed = frames.reduce((sum, frame) => sum + frame.deltaMs, 0);
    expect(elapsed, at).toBeCloseTo(length * TICK_MS, 3);
  }
});

it("keeps a still of the picture as it stands", async () => {
  await openScene(h, { screen: "title" });
  await h.advance(1);
  await captureStill(h, "title");

  expect(written()).toEqual(["title.png"]);
  const bytes = readFileSync(join(mediaDir, SUITE_DIR, "title.png"));
  // The PNG signature, so this is a picture rather than a file named as one.
  expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
});

it("writes nothing anywhere when nothing is collecting", async () => {
  delete process.env[MEDIA_DIR_ENV];
  await openScene(h);
  const frames = await captureReplay(h, "uncollected", async () => {
    await h.advance(3);
    return 3;
  });
  await captureStill(h, "uncollected");

  // The scenario still ran, so a check cannot pass in one place and fail in the
  // other; there is simply nowhere for the evidence to go.
  expect(frames).toBe(3);
  expect(written()).toEqual([]);
});

/* -------------------------------------------------------------------------- */
/* Cues                                                                       */
/* -------------------------------------------------------------------------- */

it("attributes a sound to the frame of the drive that emitted it", async () => {
  // The build loads and decodes the audio it produced on the first real gesture,
  // so the probe has nothing to see until that is done. Waiting on the probe
  // itself rather than on a duration is what keeps this off the wall clock.
  await h.armAudio();
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline && (await h.sounds()) === 0) {
    await h.page.waitForTimeout(50);
  }

  await openScene(h);
  await layOre(h, COL, ROW, "ferron");
  await standOn(h, COL, ROW);

  const cues = watchCues(h);
  const opened = h.frame();
  const cut = await driveCut(h, "down", { col: COL, row: ROW });

  expect(cut.broke).toBe(true);
  expect(cues.length).toBeGreaterThan(0);
  for (const cue of cues) {
    expect(cue.frame).toBeGreaterThan(opened);
    expect(cue.frame).toBeLessThanOrEqual(h.frame());
  }
});

/* -------------------------------------------------------------------------- */
/* Helpers for the two pure checks above                                      */
/* -------------------------------------------------------------------------- */

/**
 * A recording of `length` frames, one operation apiece, at the rate the game runs
 * at.
 *
 * Stated rather than driven because the recorder in the page thins as the section
 * runs: it halves its own kept set at twice the written cap, so a section however
 * long hands the writer somewhere between the cap and twice it and never the
 * exact multiple of the cap the writer's arithmetic turns on. What the writer
 * does with a frame list is decided by how long the list is, so a list of the
 * length in question is the whole of what this needs to be.
 */
function synthetic(length: number): Recording {
  const frames: RecordedFrame[] = [];
  for (let i = 0; i < length; i += 1) {
    frames.push({
      count: i,
      timeMs: (i + 1) * TICK_MS,
      deltaMs: TICK_MS,
      surface: { width: STAGE_W, height: STAGE_H },
      state: 0,
      stack: [],
      ops: [0],
    });
  }
  return {
    format: 1,
    width: STAGE_W,
    height: STAGE_H,
    background: REPLAY_BACKGROUND,
    images: [],
    resources: [],
    ops: [{ op: "call", method: "fill", args: [] }],
    states: [
      {
        properties: {},
        transform: null,
        lineDash: null,
        clip: [],
        path: [],
      },
    ],
    frames,
  };
}

/** Every index a frame carries that addresses nothing in the table it names. */
function outOfRange(recording: Recording): string[] {
  const bad: string[] = [];
  for (const frame of recording.frames) {
    for (const op of frame.ops) {
      if (op < 0 || op >= recording.ops.length) bad.push(`ops[${op}]`);
    }
    for (const state of [frame.state, ...frame.stack]) {
      if (state < 0 || state >= recording.states.length) {
        bad.push(`states[${state}]`);
      }
    }
  }
  return bad;
}
