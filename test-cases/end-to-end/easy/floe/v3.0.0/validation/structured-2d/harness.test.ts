// harness — self-checks for the shared machinery the suites in this directory
// stand on.
//
// The suites next door are validators: each decides one review point against
// the build. This file decides nothing about the build. It proves the
// HARNESS's own load-bearing pieces against the reference implementation,
// because each is invisible from inside a suite and wrong in ways nothing else
// catches: a surface the harness cannot reach fails every suite at once, a
// `startCrossing` that leaves a world gate open pollutes every scenario posed
// on it, an id read from the wrong end of a roster addresses the wrong entity,
// a sprite shim that does not serve the seeded tree grades every art check
// against fallback shapes, and media written in the wrong framing reaches the
// console as something it cannot read.
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
import {
  BAYS,
  CUES,
  HOP_COOLDOWN,
  ROW_NEAR,
  STAGE_W,
  START_COL,
  START_LIVES,
  TITLE_TEXT,
  TOTAL_LEVELS,
  crossingTimer,
  laneSpeed,
  tileCX,
  tileCY,
  tileLeft,
} from "./constants";
import {
  bandOf,
  bayAtColumn,
  bayColumns,
  bearById,
  bearSettled,
  canvasPixels,
  captureReplay,
  captureStill,
  clearCues,
  createHarness,
  critterTile,
  cuesNamed,
  drawnImages,
  drawnPoints,
  drawnText,
  drawnTextSpans,
  drawOps,
  drewText,
  filledBays,
  floeById,
  floeCovering,
  floesOn,
  hop,
  itemCoversTile,
  laneAt,
  nearestSeededFrame,
  pixelsChanged,
  poseBear,
  poseLane,
  resetTo,
  restHop,
  sampleTile,
  startCrossing,
  tapAction,
  ticksFor,
  tileAtPoint,
  toggleOverlay,
  vehiclesOn,
  watchCues,
  type Harness,
} from "./harness";
import { FLOE_DEBUG_VERSION, REQUIRED_OPS } from "./surface";

/** The environment variable the runner names the media directory in. */
const MEDIA_DIR_ENV = "TCAB_VALIDATION_MEDIA_DIR";

/**
 * Where this file's own outputs land: the staged project directory, then the
 * suite's path within the project, which for this file is its own name.
 */
const SUITE_DIR = join("validation", "harness.test.ts");

/**
 * One stretch of real time the engine's own frame loop is handed the clock for,
 * in milliseconds.
 *
 * A stretch rather than the whole wait: see the handback below.
 */
const HANDBACK_MS = 300;

/**
 * The most real time those stretches are given altogether, in milliseconds.
 *
 * A `runFor` that hands the clock over clears the first stretch on any machine
 * that runs a frame in it, and a host too busy to run one is given more stretches
 * rather than a failure. Only a `runFor` that never hands the clock over at all
 * spends the whole of this, which is the thing being pinned.
 */
const PATIENT_MS = 30_000;

let mediaDir: string;
let collecting: string | undefined;
let h: Harness;

beforeEach(async () => {
  collecting = process.env[MEDIA_DIR_ENV];
  mediaDir = mkdtempSync(join(tmpdir(), "floe-media-"));
  process.env[MEDIA_DIR_ENV] = mediaDir;
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
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

it("reaches the surface the reference returned from initialize", () => {
  expect(h.engine.debug).not.toBeNull();
  expect(typeof h.engine.debug).toBe("object");
  const api = h.engine.debug as unknown as Record<string, unknown>;
  expect(api.version).toBe(FLOE_DEBUG_VERSION);
  for (const op of REQUIRED_OPS) {
    expect(typeof api[op], op).toBe("function");
  }
});

it("resets to the title without advancing a frame", () => {
  h.debug.setScreen("playing");
  h.debug.setScore(4321);
  h.debug.setLevel(6);
  h.debug.setBay(2, true);
  h.debug.setBearEmergence(false);

  resetTo(h, 7);

  const s = h.snapshot();
  expect(s.screen).toBe("title");
  expect(s.phase).toBe("crossing");
  expect(s.menuIndex).toBe(0);
  expect(s.score).toBe(0);
  expect(s.lives).toBe(START_LIVES);
  expect(s.level).toBe(1);
  expect(s.reachedLevel).toBe(1);
  expect(s.timer).toBeCloseTo(crossingTimer(1), 6);
  expect(s.timerMax).toBeCloseTo(crossingTimer(1), 6);
  expect(s.bays).toEqual([false, false, false, false, false]);
  expect(s.fishBay).toBeNull();
  expect(s.critter.present).toBe(false);
  expect(s.bears).toHaveLength(0);
  expect(s.simTime).toBe(0);
  // The four world gates come back on, whatever a scenario left them at.
  expect(s.bearEmergence).toBe(true);
  expect(s.catchTest).toBe(true);
  expect(s.fishCadence).toBe(true);
  expect(s.timerRunning).toBe(true);
});

it("poses an empty, quiet crossing with startCrossing", async () => {
  startCrossing(h, 5);

  const posed = h.snapshot();
  expect(posed.screen).toBe("playing");
  expect(posed.phase).toBe("crossing");
  expect(posed.phaseTimer).toBe(0);
  expect(posed.level).toBe(5);
  expect(posed.lives).toBe(START_LIVES);
  expect(posed.score).toBe(0);
  expect(posed.vehicles).toHaveLength(0);
  expect(posed.floes).toHaveLength(0);
  expect(posed.bears).toHaveLength(0);
  expect(posed.bays).toEqual([false, false, false, false, false]);
  expect(posed.fishBay).toBeNull();
  expect(posed.bearEmergence).toBe(false);
  expect(posed.catchTest).toBe(false);
  expect(posed.fishCadence).toBe(false);
  expect(posed.timerRunning).toBe(false);
  expect(critterTile(posed)).toEqual({ col: START_COL, row: ROW_NEAR });
  expect(posed.critter.present).toBe(true);
  expect(posed.critter.hopCooldown).toBe(0);

  // The LEVEL is set before the clears, so the level's own layout is what the
  // clears empty. The lanes still carry level 5's figures.
  expect(laneAt(posed, 11)?.speed).toBeCloseTo(laneSpeed(11, 5), 6);
  expect(posed.timer).toBeCloseTo(crossingTimer(5), 6);

  // Quiet holds while the game runs. At level 5 two bear slots are open and a
  // critter three rows off the near shore would draw the first one out; with
  // the gates off no bear emerges, no bonus catch turns up, and the crossing
  // timer holds where it was posed.
  h.debug.setCritterTile(START_COL, ROW_NEAR - 6);
  await h.skip(6);
  const after = h.snapshot();
  expect(after.bears).toHaveLength(0);
  expect(after.fishBay).toBeNull();
  expect(after.timer).toBeCloseTo(crossingTimer(5), 6);
  expect(after.screen).toBe("playing");
  expect(after.simTime).toBeCloseTo(6, 3);
});

it("lays a lane the build then drives, and hands back its ids", async () => {
  startCrossing(h);

  // A water lane held still, carrying three pans on the columns named.
  const ids = poseLane(h, 5, "pan", [4, 10, 16]);
  expect(ids).toHaveLength(3);
  expect(new Set(ids).size).toBe(3);

  const posed = h.snapshot();
  expect(floesOn(posed, 5)).toHaveLength(3);
  expect(laneAt(posed, 5)?.speed).toBe(0);
  expect(floeById(posed, ids[1])?.x).toBeCloseTo(tileLeft(10), 6);
  expect(floeById(posed, ids[1])?.len).toBe(1);
  expect(itemCoversTile(floeById(posed, ids[1])!, 10)).toBe(true);
  expect(itemCoversTile(floeById(posed, ids[1])!, 11)).toBe(false);

  // Held still means still: the build moves nothing until the check says so.
  await h.advanceSeconds(0.5);
  expect(floeById(h.snapshot(), ids[1])?.x).toBeCloseTo(tileLeft(10), 6);
  expect(floeCovering(h.snapshot(), 5, tileCX(10))?.id).toBe(ids[1]);
  expect(floeCovering(h.snapshot(), 5, tileCX(11))).toBeUndefined();

  // The FIGURE is the check's. Row 5 runs rightward, so a second of drift at
  // two tiles a second carries every floe 64 units along it.
  h.debug.setLaneSpeed(5, 2);
  await h.advanceSeconds(1);
  expect(floeById(h.snapshot(), ids[1])?.x).toBeCloseTo(tileLeft(10) + 64, 1);

  // And the ice band takes vehicles rather than floes, from the same helper.
  const plows = poseLane(h, 11, "plow", [5]);
  const withPlow = h.snapshot();
  expect(vehiclesOn(withPlow, 11)).toHaveLength(1);
  expect(withPlow.vehicles[0].id).toBe(plows[0]);
  expect(withPlow.vehicles[0].len).toBe(3);
});

it("poses a bear, gating only the faculties it was asked to", async () => {
  startCrossing(h);

  // Held completely still: every faculty the check named is off, and nothing
  // it did not name is touched.
  const still = poseBear(h, 20, 15, {
    sense: false,
    routing: false,
    travel: false,
  });
  // Left as `addBear` gives it: all three on.
  const free = poseBear(h, 10, 15);

  const posed = h.snapshot();
  const one = bearById(posed, still);
  expect(one?.x).toBeCloseTo(tileCX(20), 6);
  expect(one?.y).toBeCloseTo(tileCY(15), 6);
  expect(bearSettled(one!)).toBe(true);
  expect(one?.sense).toBe(false);
  expect(one?.routing).toBe(false);
  expect(one?.travel).toBe(false);

  const other = bearById(posed, free);
  expect(other?.sense).toBe(true);
  expect(other?.routing).toBe(true);
  expect(other?.travel).toBe(true);
  expect(still).not.toBe(free);

  // The frozen one holds; the free one is the build's from here, and the build
  // is what moves it.
  await h.advanceSeconds(1);
  const ran = h.snapshot();
  expect(bearById(ran, still)?.x).toBeCloseTo(tileCX(20), 6);
  expect(bearById(ran, still)?.y).toBeCloseTo(tileCY(15), 6);
  expect(ran.bears).toHaveLength(2);
});

it("serves the seeded art to a headless host, mirroring included", async () => {
  startCrossing(h);
  // Lane 11 runs leftward, so its plow — whose art faces right — is mirrored.
  poseLane(h, 11, "plow", [5]);

  h.calls.length = 0;
  await h.advance(1);

  expect(h.assetFailures).toEqual([]);
  const images = drawnImages(h);

  const critter = images.find(
    (image) =>
      Math.abs(image.x - tileCX(START_COL)) < 1 &&
      Math.abs(image.y - tileCY(ROW_NEAR)) < 1,
  );
  expect(
    critter,
    "a bitmap blitted on the critter's tile centre",
  ).toBeDefined();
  expect(critter?.w).toBeCloseTo(32, 3);
  const crosser = await nearestSeededFrame(critter!.source);
  expect(crosser.folder).toBe("crosser");
  // Identity, within the one lossy step of reading a bitmap back off a canvas.
  expect(crosser.distance).toBeLessThan(1);

  // The plow spans three tiles from column 5, so its centre is 48 units in.
  const plow = images.find((image) => Math.abs(image.w - 96) < 1);
  expect(plow, "a three-tile bitmap blitted on the plow").toBeDefined();
  expect(plow?.x).toBeCloseTo(tileLeft(5) + 48, 1);
  expect(plow?.mirrored).toBe(true);
  expect((await nearestSeededFrame(plow!.source)).folder).toBe("plow");
});

it("drives the real input path: menus by edge, hops by hold", async () => {
  // A menu moves through the registered action, on the EDGE a tap delivers.
  resetTo(h, 1);
  const played = watchCues(h);
  await tapAction(h, "down");
  expect(h.snapshot().menuIndex).toBe(1);
  expect(played.filter((cue) => cue.cue === CUES.menu)).toHaveLength(1);
  expect(played[0].frame).toBeGreaterThan(0);

  // A hop is a frame with the direction HELD, and it is the build's own rules
  // that accept it: one absolute tile, up the strait.
  startCrossing(h);
  clearCues(h);
  expect(await hop(h, "up")).toBe(true);
  expect(critterTile(h.snapshot())).toEqual({
    col: START_COL,
    row: ROW_NEAR - 1,
  });
  expect(cuesNamed(h, CUES.hop).length).toBeGreaterThanOrEqual(1);
  expect(h.snapshot().critter.facing).toBe("up");
  expect(h.snapshot().critter.hopCooldown).toBeCloseTo(HOP_COOLDOWN, 3);

  // A second hop inside the cooldown is refused; one after `restHop` is not.
  expect(await hop(h, "up")).toBe(false);
  await restHop(h);
  expect(h.snapshot().critter.hopCooldown).toBe(0);
  expect(await hop(h, "up")).toBe(true);
  expect(critterTile(h.snapshot()).row).toBe(ROW_NEAR - 2);

  // A hop the rules refuse is reported as refused rather than thrown.
  h.debug.setCritterTile(0, ROW_NEAR);
  h.debug.setHopCooldown(0);
  expect(await hop(h, "left")).toBe(false);
});

it("samples pixels and finds the text a frame drew", async () => {
  // Text: the title frame draws the case-fixed copy.
  resetTo(h, 1);
  h.calls.length = 0;
  await h.advance(1);
  expect(drewText(h.calls, TITLE_TEXT)).toBe(true);
  expect(drawnText(h.calls).length).toBeGreaterThan(0);

  // Pixels: the frame that put a plow on a bare ice lane changed the canvas.
  startCrossing(h);
  await h.advance(1);
  const before = canvasPixels(h);
  poseLane(h, 14, "plow", [12]);
  await h.advance(1);
  expect(pixelsChanged(before, canvasPixels(h))).toBeGreaterThan(0);

  for (const sample of [sampleTile(h, 12, 14), sampleTile(h, 2, 3)]) {
    for (const channel of [sample.r, sample.g, sample.b]) {
      expect(Number.isFinite(channel)).toBe(true);
      expect(channel).toBeGreaterThanOrEqual(0);
      expect(channel).toBeLessThanOrEqual(255);
    }
  }

  // The geometry a frame named is read back in stage units, and the title copy
  // is placed inside the stage.
  expect(drawOps(h.calls)).toBeGreaterThan(0);
  expect(drawnPoints(h.calls).length).toBeGreaterThan(0);

  resetTo(h, 1);
  h.calls.length = 0;
  await h.advance(1);
  const title = drawnTextSpans(h).find((span) =>
    span.text.toLowerCase().includes(TITLE_TEXT.toLowerCase()),
  );
  expect(title, "the title copy, placed").toBeDefined();
  expect(title!.left).toBeLessThan(title!.right);
  expect(title!.x).toBeGreaterThanOrEqual(0);
  expect(title!.x).toBeLessThanOrEqual(STAGE_W);
});

it("observes the diagnostics overlay through the recorded context", async () => {
  startCrossing(h);
  h.calls.length = 0;
  await h.advance(1);
  const bare = drawnText(h.calls);

  // Backquote toggles the engine-owned overlay; the sources the build
  // registered draw through the same recorded context, so new text runs appear.
  h.calls.length = 0;
  await toggleOverlay(h);
  const overlaid = drawnText(h.calls);
  expect(overlaid.length).toBeGreaterThan(bare.length);

  // And toggling again takes it back down.
  h.calls.length = 0;
  await toggleOverlay(h);
  expect(drawnText(h.calls).length).toBeLessThan(overlaid.length);
});

it("maps the strait: bands, bays, tiles and the points between them", () => {
  expect(bandOf(0)).toBe("cap");
  expect(bandOf(1)).toBe("bays");
  expect(bandOf(5)).toBe("water");
  expect(bandOf(10)).toBe("median");
  expect(bandOf(14)).toBe("ice");
  expect(bandOf(19)).toBe("near");
  expect(bandOf(20)).toBe("off");

  expect(bayColumns(2)).toEqual(BAYS[2]);
  expect(bayAtColumn(BAYS[3][1])).toBe(3);
  expect(bayAtColumn(0)).toBeNull();

  // The inverse of the tile-centre map lands back on the tile it came from.
  expect(tileAtPoint(tileCX(18), tileCY(10))).toEqual({ col: 18, row: 10 });
  // A point in the HUD bar is honestly above the strait.
  expect(tileAtPoint(tileCX(3), 40).row).toBeLessThan(0);

  expect(filledBays(h.snapshot())).toEqual([]);
  h.debug.setBay(1, true);
  h.debug.setBay(4, true);
  expect(filledBays(h.snapshot())).toEqual([1, 4]);
});

it("writes a still and a replay under the suite's own address", async () => {
  startCrossing(h);
  poseLane(h, 5, "raft4", [8]);
  await h.advance(1);
  captureStill(h, "posed");

  await captureReplay(h, "drift", async () => {
    h.debug.setLaneSpeed(5, 3);
    await h.advanceSeconds(0.4);
  });

  // A capture that closed no frames leaves no file: a declared output that
  // never turned up is the truthful reading of a section that drew nothing.
  await captureReplay(h, "empty", async () => {});

  expect(written()).toEqual(["drift.json.gz", "posed.png"]);

  // The still is a PNG: the eight-byte signature opens the file.
  const png = readFileSync(join(mediaDir, SUITE_DIR, "posed.png"));
  expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);

  // The replay is really gzip-framed (RFC 1952), and the document inside holds
  // the frames the section drew.
  const bytes = readFileSync(join(mediaDir, SUITE_DIR, "drift.json.gz"));
  expect([bytes[0], bytes[1]]).toEqual([0x1f, 0x8b]);
  const recording = JSON.parse(gunzipSync(bytes).toString("utf8")) as {
    format: number;
    frames: unknown[];
  };
  expect(recording.format).toBeGreaterThan(0);
  expect(recording.frames.length).toBeGreaterThan(0);
});

it("costs nothing and changes nothing when nobody is collecting media", async () => {
  delete process.env[MEDIA_DIR_ENV];
  startCrossing(h);

  const value = await captureReplay(h, "unused", async () => {
    await h.advance(2);
    return "the scenario's own value";
  });
  captureStill(h, "unused");

  expect(value).toBe("the scenario's own value");
  expect(written()).toEqual([]);
});

it("hands a scenario's failure on, and still writes what it recorded", async () => {
  startCrossing(h);
  poseLane(h, 16, "dogsled", [7]);

  await expect(
    captureReplay(h, "failing", async () => {
      await h.advance(6);
      throw new Error("the check's own failure");
    }),
  ).rejects.toThrow("the check's own failure");

  expect(written()).toEqual(["failing.json.gz"]);
});

it("sweeps with until, paces the clock, and drives the engine's own loop", async () => {
  startCrossing(h);
  const [id] = poseLane(h, 5, "pan", [10]);
  h.debug.setLaneSpeed(5, 4);

  // `until` samples the game as it runs and reports where it stopped.
  const found = await h.until(
    (s) => (floeById(s, id)?.x ?? 0) >= tileLeft(14),
    {
      maxFrames: ticksFor(2),
      poll: 4,
    },
  );
  expect(found.hit).toBe(true);
  expect(found.frames).toBeGreaterThan(0);
  expect(floeById(found.snapshot, id)!.x).toBeGreaterThanOrEqual(tileLeft(14));

  // A sweep that never sees its predicate reports so rather than hanging.
  const missed = await h.until((s) => s.screen === "victory", { maxFrames: 8 });
  expect(missed.hit).toBe(false);
  expect(missed.frames).toBe(8);

  // A coarse frame runs the same ticks: `skip` covers its seconds of game time
  // exactly, and leaves the clock at one tick a frame.
  const before = h.snapshot().simTime;
  const frames = h.engine.frame().count;
  await h.skip(2);
  expect(h.snapshot().simTime - before).toBeCloseTo(2, 3);
  expect(h.engine.frame().count - frames).toBeLessThan(ticksFor(2));
  const oneAtATime = h.engine.frame().count;
  await h.advanceSeconds(0.5);
  expect(h.engine.frame().count - oneAtATime).toBe(ticksFor(0.5));

  // `runFor` hands the engine its own frame loop for a stretch of real time.
  //
  // THE HANDBACK IS EXTENDED, NOT LENGTHENED. How many frames a machine presents
  // in a fixed stretch of real time is the MACHINE's business, and a busy one
  // presents none in sixty milliseconds — so the loop is handed the clock in
  // `HANDBACK_MS` stretches until it has run a frame, up to `PATIENT_MS`. What is
  // pinned is that `runFor` hands the clock over at all, which any machine shows
  // in a stretch or two and a `runFor` that never hands it over shows in none.
  const ran = h.engine.frame().count;
  let handed = 0;
  while (h.engine.frame().count === ran && handed < PATIENT_MS) {
    await h.runFor(HANDBACK_MS);
    handed += HANDBACK_MS;
  }
  expect(h.engine.frame().count).toBeGreaterThan(ran);
});

it("reports a level the run actually has, and reads the lanes back", () => {
  startCrossing(h, TOTAL_LEVELS);
  const s = h.snapshot();
  expect(s.level).toBe(TOTAL_LEVELS);
  expect(s.iceLanes).toHaveLength(8);
  expect(s.waterLanes).toHaveLength(8);
  for (const lane of [...s.iceLanes, ...s.waterLanes]) {
    expect(laneAt(s, lane.row)).toEqual(lane);
    expect(Math.abs(lane.dir)).toBe(1);
    expect(lane.speed).toBeCloseTo(laneSpeed(lane.row, TOTAL_LEVELS), 6);
  }
});
