// harness — self-checks for the shared scaffolding the suites in this directory
// stand on, run against the case's reference implementation.
//
// The suites next door are validators: each decides one review item against the
// build. This file decides nothing about any build. It proves that the harness's
// own machinery — the browser reach, the compound scenario helpers, the clock,
// the observation channels, and the evidence writers — really does what the
// suites assume of it, because a helper that silently did less would turn every
// item that leans on it into a wrong verdict with a confident face.
//
// What is pinned here, and why:
//
//   - THE REACH. `createHarness` really finds `window.__floe` on the built site,
//     it carries every operation `REQUIRED_OPS` names, and it answers.
//   - THE POSES. `startCrossing` really leaves an empty, quiet, live strait;
//     `poseLane` lays exactly the run of items it was given, on the right roster,
//     with the lane held still; `poseBear` settles a bear with exactly the
//     faculties the scenario asked for; `hop` and `crossTo` move the critter by
//     real key presses through the game's own hop.
//   - THE CLOCK. `advance` runs exactly the ticks it is asked for, a division
//     into calls reaches the same state as one call, and `skip` covers game time
//     off camera.
//   - THE CHANNELS. A pixel sample, a text-draw query, a sprite match and a cue
//     capture each return something sane, and the overlay is observable through
//     its fixed Backquote binding plus the draw recorder.
//   - THE EVIDENCE. `captureStill` and `captureReplay` write real files under the
//     media directory, at the staged suite's address, and a capture keeps the
//     ticks `advance` drove and not the ones `skip` passed over.
//   - BOTH FRAME MODES. `specs/instrumentation.md` specifies `advance` as a move
//     of the simulation and leaves drawing to the loop, so a conformant build may
//     draw in either place; the harness decides which this build does and reads
//     its render either way. The reference draws inside `advance`, so the other
//     mode is exercised here by forcing it.
//
// No review item names this file, so a run never loads it. It runs with the
// whole project, which is how a case author runs these suites while writing
// them:
//
//   npx vitest run --config validation/vitest.config.ts

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, beforeEach, it } from "vitest";
import {
  assertBetween,
  assertCloseTo,
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertLength,
  assertMatches,
  assertLessThanOrEqual,
  assertTrue,
} from "./assert";
import {
  BEAR_FRAMES,
  CAR_FRAMES,
  CROSSER_FRAMES,
  DOGSLED_FRAMES,
  FLOE_DEBUG_VERSION,
  PAN_FRAMES,
  PLOW_FRAMES,
  RAFT_FRAMES,
  ROW_NEAR,
  START_COL,
  START_LIVES,
  TILE,
  TITLE_TEXT,
  crossingTimer,
  tileCX,
  tileCY,
  tileLeft,
} from "./constants";
import {
  ConstantClock,
  JitterClock,
  REQUIRED_OPS,
  blitsOfFrame,
  captureReplay,
  captureStill,
  colorDistance,
  createHarness,
  crossTo,
  critterTile,
  divide,
  drawnFrom,
  drawnRegion,
  drawnText,
  drewText,
  failSurface,
  hop,
  itemArtCentre,
  lastBear,
  poseBear,
  poseLane,
  requireBear,
  requireItem,
  sampleRow,
  sampleTile,
  seconds,
  seededFrames,
  startCrossing,
  textDraws,
  ticksFor,
  toggleOverlay,
  vehicleById,
  watchCues,
  type Harness,
  type Recording,
} from "./harness";

/** The environment variable the runner names the media directory in. */
const MEDIA_DIR_ENV = "TCAB_VALIDATION_MEDIA_DIR";

/**
 * Where this file's own outputs land: the staged project directory, then the
 * suite's path within the project, which for this file is its own name.
 */
const SUITE_DIR = join("validation", "harness.test.ts");

let h: Harness;
const spares: Harness[] = [];

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
  while (spares.length > 0) await spares.pop()?.dispose();
});

it("reaches the reference's surface, whole", async () => {
  if (h.surfaceFault !== null) failSurface(h.surfaceFault);
  const probed = await h.probe(REQUIRED_OPS);
  assertEqual(probed.version, FLOE_DEBUG_VERSION);
  for (const op of REQUIRED_OPS) {
    assertEqual(probed.ops[op], "function", op);
  }

  // And it is live rather than merely present: a posed critter reads back.
  await h.debug.addCritter(7, 12);
  assertDeepEqual(critterTile(await h.snapshot()), { col: 7, row: 12 });
});

it("names a missing surface as a verdict, in the pair the runner stores", () => {
  // The shape every point falls back on when a build installed no usable
  // surface: the harness's account of what it found, paired with what the
  // specification requires, as two lines the runner parses. Every operation of
  // an unexposed surface fails through exactly this, so a suite that built its
  // harness in a hook still reports the fault from the check.
  let message = "";
  try {
    failSurface("window.__floe was still absent 120s after the page loaded");
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assertMatches(message, /^Expected: a usable debug and automation surface/);
  assertMatches(message, /\nActual: "window\.__floe was still absent/);
});

it("startCrossing leaves an empty, quiet, live strait", async () => {
  // Something on every roster and every gate open, so the helper has work to do.
  await h.debug.setLevel(6);
  await h.debug.addBear(4, 19);
  await h.debug.setBay(2, true);
  await h.debug.setFishBay(1);

  await startCrossing(h, 3);
  const s = await h.snapshot();

  assertEqual(s.screen, "playing");
  assertEqual(s.phase, "crossing");
  assertEqual(s.phaseTimer, 0);
  assertEqual(s.level, 3);
  assertLength(s.vehicles, 0, "vehicles");
  assertLength(s.floes, 0, "floes");
  assertLength(s.bears, 0, "bears");
  assertDeepEqual(s.bays, [false, false, false, false, false], "the bays");
  assertEqual(s.fishBay, null, "the bonus catch");
  assertEqual(s.bearEmergence, false, "the bear-emergence gate");
  assertEqual(s.catchTest, false, "the catch-test gate");
  assertEqual(s.fishCadence, false, "the fish-cadence gate");
  assertEqual(s.timerRunning, false, "the timer-running gate");
  assertEqual(s.lives, START_LIVES);
  assertEqual(s.score, 0);
  assertEqual(s.timer, crossingTimer(3), "the level's own crossing timer");
  assertEqual(s.critter.present, true);
  assertDeepEqual(critterTile(s), { col: START_COL, row: ROW_NEAR });
  assertEqual(s.critter.facing, "up");
  assertEqual(s.critter.hopCooldown, 0);
  assertEqual(s.critter.bestRow, ROW_NEAR);

  // The sixteen lanes are still laid out — a level MEANS its lanes — and the
  // rosters are empty, which is the state every scenario builds on.
  assertLength(s.iceLanes, 8, "ice lanes");
  assertLength(s.waterLanes, 8, "water lanes");
});

it("poseLane lays exactly the run it was given, on the right roster, held still", async () => {
  await startCrossing(h);

  const plows = await poseLane(h, 17, "plow", [5, 20]);
  const rafts = await poseLane(h, 3, "raft4", [8]);
  assertLength(plows, 2, "the ids poseLane handed back");
  assertLength(rafts, 1, "the ids poseLane handed back");

  const s = await h.snapshot();
  assertLength(s.vehicles, 2, "the vehicle roster");
  assertLength(s.floes, 1, "the floe roster");

  const first = requireItem(s, plows[0], "poseLane");
  assertEqual(first.row, 17);
  assertEqual(first.kind, "plow");
  assertEqual(first.len, 3, "a plow spans three tiles");
  assertEqual(
    first.x,
    tileLeft(5),
    "its LEFT EDGE, at the column it was given",
  );
  assertEqual(requireItem(s, plows[1], "poseLane").x, tileLeft(20));
  assertEqual(requireItem(s, rafts[0], "poseLane").len, 4);

  // The lane is stopped, so a scenario reads exactly what it posed.
  assertEqual(s.iceLanes.find((lane) => lane.row === 17)?.speed, 0);
  await h.advance(ticksFor(1));
  assertEqual(
    requireItem(await h.snapshot(), plows[0], "a second at speed 0").x,
    tileLeft(5),
    "a stopped lane holds its items",
  );
});

it("poseBear settles a bear with exactly the faculties asked for", async () => {
  await startCrossing(h);
  const id = await poseBear(h, 20, 15, {
    travel: false,
    target: { col: 2, row: 2 },
  });

  const posed = requireBear(await h.snapshot(), id, "poseBear");
  assertEqual(posed.col, 20);
  assertEqual(posed.row, 15);
  assertEqual(posed.stepCol, 20, "settled: its step tile is its own tile");
  assertEqual(posed.stepRow, 15);
  assertCloseTo(posed.x, tileCX(20), 6, "its centre x");
  assertCloseTo(posed.y, tileCY(15), 6, "its centre y");
  assertEqual(posed.travel, false, "the faculty the pose held off");
  assertEqual(posed.sense, true, "a faculty the pose left alone");
  assertEqual(posed.routing, true, "a faculty the pose left alone");
  assertEqual(lastBear(await h.snapshot())?.id, id, "appended to the roster");

  // Travel held, the bear does not move however long the scenario runs.
  await h.advance(ticksFor(1));
  const held = requireBear(await h.snapshot(), id, "a second with travel off");
  assertCloseTo(held.x, tileCX(20), 6, "its centre x, held");
  assertCloseTo(held.y, tileCY(15), 6, "its centre y, held");
});

it("advance runs exactly the ticks it is asked for, and skip covers time off camera", async () => {
  await startCrossing(h);
  const before = (await h.snapshot()).simTime;

  await h.advance(ticksFor(1));
  const driven = await h.snapshot();
  assertCloseTo(driven.simTime - before, 1, 3, "a second, driven");
  assertEqual(h.tick(), ticksFor(1), "the ticks the harness counted");

  await h.skip(2);
  const skipped = await h.snapshot();
  assertCloseTo(
    skipped.simTime - driven.simTime,
    2,
    3,
    "two seconds skipped off camera",
  );
  assertEqual(h.frame(), 0, "a skip closes no recorded frame");
});

it("a divided interval reaches the state one call reaches", async () => {
  const other = await createHarness();
  spares.push(other);

  const pose = async (target: Harness): Promise<void> => {
    await startCrossing(target);
    await poseLane(target, 5, "pan", [10]);
    await target.debug.setLaneSpeed(5, 3.6);
    await target.debug.setCritterTile(10, 5);
  };
  await pose(h);
  await pose(other);

  // One second, as one call and as a seeded jitter of calls.
  const calls = divide(ticksFor(1), new JitterClock(1, 17, 4));
  assertEqual(
    calls.reduce((sum, n) => sum + n, 0),
    ticksFor(1),
    "a division covers the whole interval",
  );
  assertGreaterThan(calls.length, 1, "the jitter really divided it");

  await h.advance(ticksFor(1));
  await other.advance(ticksFor(1), new JitterClock(1, 17, 4));

  const one = await h.snapshot();
  const many = await other.snapshot();
  assertCloseTo(many.critter.x, one.critter.x, 6, "the carried critter's x");
  assertCloseTo(many.simTime, one.simTime, 6, "the game time covered");

  // And a ConstantClock divides evenly, which is what a check that wants a
  // known number of calls reaches for.
  assertDeepEqual(divide(10, new ConstantClock(4)), [4, 4, 2]);
});

it("hop and crossTo move the critter through the game's own hop", async () => {
  await startCrossing(h);
  await hop(h, "up");
  const hopped = await h.snapshot();
  assertDeepEqual(
    critterTile(hopped),
    { col: START_COL, row: ROW_NEAR - 1 },
    "one tile up",
  );
  assertEqual(hopped.critter.facing, "up", "the facing the hop took");
  assertEqual(hopped.critter.bestRow, ROW_NEAR - 1, "the row newly reached");

  await crossTo(h, START_COL + 2, ROW_NEAR - 3);
  assertDeepEqual(
    critterTile(await h.snapshot()),
    { col: START_COL + 2, row: ROW_NEAR - 3 },
    "the tile crossTo was asked for",
  );
});

it("sweeps with until and skipUntil, and hands the clock back with runFor", async () => {
  await startCrossing(h);
  const [car] = await poseLane(h, 18, "car", [10]);
  await h.debug.setLaneSpeed(18, 1.8);

  // A fine sweep: tick by tick until the car's left edge has crossed a tile.
  const swept = await h.until(
    (s) => (vehicleById(s, car)?.x ?? 0) >= tileLeft(11),
    { maxTicks: ticksFor(2) },
  );
  assertTrue(swept.hit, "the sweep found the crossing it was waiting for");
  assertGreaterThan(swept.ticks, 0, "it took ticks to get there");
  assertGreaterThanOrEqual(
    vehicleById(swept.snapshot, car)?.x ?? 0,
    tileLeft(11),
    "the snapshot the sweep stopped on",
  );

  // A coarse sweep: the bonus catch's own eight-second cadence, off camera.
  await h.debug.setFishCadence(true);
  const arrived = await h.skipUntil((s) => s.fishBay !== null, {
    maxSeconds: 20,
  });
  assertTrue(arrived.hit, "a bonus catch arrived within its cadence");
  assertEqual(h.frame(), 0, "a coarse sweep closes no recorded frame");

  // And the clock really goes back and forth: the loop advances the game on its
  // own while `runFor` holds it, and stops again the moment it is taken back.
  const before = (await h.snapshot()).simTime;
  await h.runFor(300);
  const ran = (await h.snapshot()).simTime;
  assertGreaterThan(ran - before, 0, "the build's own loop advanced the game");
  await h.page.waitForTimeout(150);
  assertEqual(
    (await h.snapshot()).simTime,
    ran,
    "and it is off the wall clock again",
  );
});

it("samples pixels, reads text draws, and captures cues", async () => {
  // A pixel is four sane channel values.
  const pixel = await h.pixel(640, 360);
  assertLength(pixel, 4);
  for (const channel of pixel) assertBetween(channel, 0, 255);

  // The title frame draws text, and among it the case's own copy.
  const title = await h.frameCalls();
  assertGreaterThan(drawnText(title).length, 0, "text draws on the title");
  assertTrue(drewText(title, TITLE_TEXT), `the title draws ${TITLE_TEXT}`);
  assertGreaterThan(textDraws(title).length, 0, "anchored text draws");

  // The two solid bands read apart from the water between them.
  await startCrossing(h);
  await h.step(1);
  const median = await sampleRow(h, 10);
  const water = await sampleTile(h, 6, 6);
  assertGreaterThan(
    colorDistance(median, water),
    0,
    "the median shelf against open water",
  );

  // A cue sounds on the tick a hop is delivered, once audio is armed with a
  // genuine browser gesture. What is read is that a sound was emitted and when;
  // the NAME is unobservable under this engine and nothing asserts it.
  await h.armAudio();
  const played = watchCues(h);
  const soundsBefore = await h.sounds();
  await hop(h, "up");
  assertGreaterThanOrEqual(played.length, 1, "a sound on the hop");
  assertGreaterThan(
    await h.sounds(),
    soundsBefore,
    "the raw sound count moved",
  );
});

it("matches drawn sprites against the seeded art, regions and mirroring included", async () => {
  const seeded = await seededFrames();
  assertLength(
    seeded,
    CROSSER_FRAMES +
      BEAR_FRAMES +
      PLOW_FRAMES +
      DOGSLED_FRAMES +
      CAR_FRAMES +
      PAN_FRAMES +
      RAFT_FRAMES +
      2,
    "every seeded frame, plus the two long-floe regions",
  );

  await startCrossing(h);
  // Row 17 runs leftward and row 18 rightward (specs/ice.md), so one plow is
  // mirrored and one car is not.
  const [plow] = await poseLane(h, 17, "plow", [6]);
  const [car] = await poseLane(h, 18, "car", [24]);
  const [raft3] = await poseLane(h, 2, "raft3", [10]);
  const [raft4] = await poseLane(h, 3, "raft4", [24]);
  const bear = await poseBear(h, 12, 15, { travel: false });

  const s = await h.snapshot();
  const blits = await blitsOfFrame(h);

  assertGreaterThanOrEqual(
    drawnFrom(blits, "crosser", { x: s.critter.x, y: s.critter.y }, TILE / 2)
      .length,
    1,
    "the critter drawn from assets/crosser/",
  );
  const bearView = requireBear(s, bear, "the scene");
  assertGreaterThanOrEqual(
    drawnFrom(blits, "bear", { x: bearView.x, y: bearView.y }, TILE / 2).length,
    1,
    "the bear drawn from assets/bear/",
  );

  const plowBlits = drawnFrom(
    blits,
    "plow",
    itemArtCentre(requireItem(s, plow, "the scene")),
    TILE / 2,
  );
  const carBlits = drawnFrom(
    blits,
    "car",
    itemArtCentre(requireItem(s, car, "the scene")),
    TILE / 2,
  );
  assertGreaterThanOrEqual(plowBlits.length, 1, "the plow's draw");
  assertGreaterThanOrEqual(carBlits.length, 1, "the car's draw");
  assertEqual(
    plowBlits[0].flipX,
    true,
    "a leftward lane's vehicle is mirrored",
  );
  assertEqual(carBlits[0].flipX, false, "a rightward lane's vehicle is not");
  assertCloseTo(plowBlits[0].width, TILE * 3, 0, "the plow's drawn span");

  assertGreaterThanOrEqual(
    drawnRegion(
      blits,
      "raft",
      "raft3",
      itemArtCentre(requireItem(s, raft3, "the scene")),
      TILE / 2,
    ).length,
    1,
    "the three-tile raft, from the left 96x32 of assets/raft/0.png",
  );
  assertGreaterThanOrEqual(
    drawnRegion(
      blits,
      "raft",
      "raft4",
      itemArtCentre(requireItem(s, raft4, "the scene")),
      TILE / 2,
    ).length,
    1,
    "the four-tile raft, from the whole of assets/raft/1.png",
  );
});

it("observes the overlay through Backquote and the draw recorder", async () => {
  await startCrossing(h);
  await poseBear(h, 12, 15, { travel: false });
  const bare = await h.frameCalls();
  const before = await h.snapshot();

  await toggleOverlay(h);
  const overlaid = await h.frameCalls();

  assertGreaterThan(
    drawnText(overlaid).length,
    drawnText(bare).length,
    "the overlay adds text draws",
  );
  assertTrue(
    drewText(overlaid, "playing"),
    "the overlay names the current screen",
  );

  // And watching it is a pure read: the game-facing state is as it was.
  const after = await h.snapshot();
  assertEqual(after.screen, before.screen);
  assertDeepEqual(after.bears, before.bears);
  assertDeepEqual(after.bays, before.bays);

  await toggleOverlay(h);
  const cleared = await h.frameCalls();
  assertLessThanOrEqual(
    drawnText(cleared).length,
    drawnText(bare).length,
    "toggling again hides the overlay",
  );
});

it("reads a render with the frame boundary on the animation frame too", async () => {
  // The reference draws inside `advance`, so this is the mode the probe does not
  // choose. Forcing it is what proves a build that draws only from its own loop
  // is read at all — its render, its cues, and its evidence.
  const looped = await createHarness({ frames: "raf" });
  spares.push(looped);
  assertEqual(looped.frameMode, "raf");
  assertEqual(h.frameMode, "advance", "what the reference's own probe chose");

  await startCrossing(looped);
  await poseBear(looped, 12, 15, { travel: false });
  const calls = await looped.frameCalls();
  assertGreaterThan(calls.length, 0, "the loop's own frame was recorded");

  const s = await looped.snapshot();
  const blits = await blitsOfFrame(looped);
  assertGreaterThanOrEqual(
    drawnFrom(blits, "crosser", { x: s.critter.x, y: s.critter.y }, TILE / 2)
      .length,
    1,
    "the critter, read through an animation frame",
  );
});

it("writes a still and a replay under the media directory", async () => {
  const mediaDir = mkdtempSync(join(tmpdir(), "floe-media-"));
  const hadMediaDir = process.env[MEDIA_DIR_ENV];
  process.env[MEDIA_DIR_ENV] = mediaDir;
  try {
    await startCrossing(h);
    await poseLane(h, 5, "pan", [10]);
    await h.step(1);

    await captureStill(h, "still-check");
    const png = readFileSync(join(mediaDir, SUITE_DIR, "still-check.png"));
    assertGreaterThan(png.length, 8, "a PNG on disk");
    // The PNG signature, so what landed is an image rather than an error page.
    assertDeepEqual(
      [...png.subarray(0, 4)],
      [0x89, 0x50, 0x4e, 0x47],
      "the PNG signature",
    );

    const value = await captureReplay(h, "replay-check", async () => {
      // Off camera, then on: the recording must hold the driven ticks and
      // nothing of the half-second the skip passed over, which is what lets an
      // item record the moment rather than the wait before it.
      await h.skip(0.5);
      await h.advance(24);
      return "returned";
    });
    assertEqual(value, "returned", "the scenario's own value comes back");

    const raw = readFileSync(join(mediaDir, SUITE_DIR, "replay-check.json.gz"));
    const recording = JSON.parse(gunzipSync(raw).toString("utf8")) as Recording;
    assertEqual(recording.width, 1280);
    assertEqual(recording.height, 720);
    assertLength(
      recording.frames,
      6,
      "the driven ticks, four to a recorded frame, and nothing of the skip",
    );
    assertGreaterThan(recording.ops.length, 0, "the frames carry operations");
    assertCloseTo(
      recording.frames.reduce((sum, frame) => sum + frame.deltaMs, 0),
      seconds(24) * 1000,
      3,
      "the recorded deltas sum to the game time driven",
    );
  } finally {
    if (hadMediaDir === undefined) delete process.env[MEDIA_DIR_ENV];
    else process.env[MEDIA_DIR_ENV] = hadMediaDir;
    rmSync(mediaDir, { recursive: true, force: true });
  }
});
