// harness — self-checks for the shared scaffolding the suites in this directory
// stand on, run against the case's reference implementation.
//
// The suites next door are validators: each decides one review item against the
// build. This file decides nothing about any build. It proves that the harness's
// own machinery — the browser reach, the compound scenario helpers, the two
// clocks, the shared arithmetic, the observation channels, and the evidence
// writers — really does what the suites assume of it, because a helper that
// silently did less would turn every item that leans on it into a wrong verdict
// with a confident face.
//
// What is pinned here, and why:
//
//   - THE REACH. `createHarness` really finds `window.__meltdown` on the built
//     site, it carries every operation `REQUIRED_OPS` names, and it answers.
//   - THE POSES. `startRun` really leaves an empty, quiet, live run; `poseTower`
//     appends the tower it names; the three faculty poses each set the faculty
//     they are for and leave the other alone; `poseTarget` stands still,
//     `poseWalker` walks, and `boxIn` really seals all four faces.
//   - THE STEPPED CLOCK. `advance` runs exactly the frames it is asked for and
//     `skip` covers game time off camera.
//   - THE BUILD'S OWN CLOCK. `withOwnClock` hands the clock over and takes it
//     back however the scenario ends, and the three-leg contrast the pause items
//     are written as reads the way it must: the floor runs, the pause stops it,
//     resuming runs it again — with nothing calling `advance` at any point.
//   - THE SHARED ARITHMETIC. `thermal.ts` and `routes.ts` compute the same
//     numbers the reference produces, over a floor this file posed. They are
//     what every thermal and mazing check asserts against, so a slip in either
//     would be a slip in forty verdicts.
//   - THE CHANNELS. A pixel sample, a text-draw query and a cue capture each
//     return something sane, and the overlay is observable through its fixed
//     Backquote binding plus the draw recorder.
//   - THE EVIDENCE. `captureStill` and `captureReplay` write real files under
//     the media directory, at the staged suite's address, and a capture keeps
//     the frames `advance` drove and not the ones `skip` passed over.
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
  assertLessThan,
  assertLessThanOrEqual,
  assertTrue,
} from "./assert";
import {
  BINDINGS,
  BUILD_PHASE_TIME,
  LEFT_VENT_ROWS,
  MELTDOWN_DEBUG_VERSION,
  TRIP_TIME,
  TITLE_TEXT,
  tileCX,
  tileCY,
  worldRadiators,
} from "./constants";
import { BOXED_SITE, FREE_SITE, freeSite, laneTile } from "./fixtures";
import {
  REQUIRED_OPS,
  captureReplay,
  captureStill,
  colorDistance,
  createHarness,
  distance,
  drawnText,
  drewText,
  failSurface,
  framesFor,
  lastTower,
  poseIdleTower,
  posePinnedTower,
  poseTarget,
  poseTower,
  poseTrippedTower,
  poseWalker,
  requireTower,
  requireUnit,
  sampleFloor,
  sampleTower,
  seconds,
  startRun,
  tapAction,
  textDraws,
  toggleOverlay,
  towerById,
  watchCues,
  boxIn,
  type Harness,
  type Recording,
} from "./harness";
import { accountEdges, resolveFrame, towerFrom } from "./thermal";
import { blockedFrom, routeLength } from "./routes";

/** The environment variable the runner names the media directory in. */
const MEDIA_DIR_ENV = "TCAB_VALIDATION_MEDIA_DIR";

/**
 * Where this file's own outputs land: the staged project directory, then the
 * suite's path within the project, which for this file is its own name.
 */
const SUITE_DIR = join("validation", "harness.test.ts");

/**
 * The real window each leg of the own-clock contrast is measured over, and the
 * bounds the three legs are held to.
 *
 * These are this FILE's figures, not the harness's: `waves/pause-freezes-the-
 * floor` and its three siblings state their own, and the harness carries none.
 * They are sized the way that item's are — a Mote covers 60 logical units a
 * second, a build may clamp its per-frame delta and lose time to the handover,
 * and a build may resolve an injected key on its next frame rather than inside
 * the call.
 */
const WINDOW_MS = 1500;
const MIN_TRAVEL = 20;
const MAX_DRIFT = 4;
const MAX_CLOCK_DRIFT = 0.1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reaches the reference's surface, whole", async () => {
  if (h.surfaceFault !== null) failSurface(h.surfaceFault);
  const probed = await h.probe(REQUIRED_OPS);
  assertEqual(probed.version, MELTDOWN_DEBUG_VERSION);
  for (const op of REQUIRED_OPS) {
    assertEqual(probed.ops[op], "function", op);
  }

  // And it is live rather than merely present: a posed field reads back.
  await h.debug.setMoney(137);
  assertEqual((await h.snapshot()).money, 137);
});

it("startRun leaves an empty, quiet, live run at the row's own figures", async () => {
  // Something on both rosters, the gate open, and every field wrong, so the
  // helper has work to do.
  await h.debug.addTower("arc", 4, 4, 0);
  await h.debug.addUnit("mote", "left");
  await h.debug.setScreen("title");
  await h.debug.setSpeed(2);
  await h.debug.setArmed("lance");
  await h.debug.setWaveSpawning(true);
  await h.debug.setScore(999);

  await startRun(h, "containment", "hard");
  const snapshot = await h.snapshot();

  assertEqual(snapshot.screen, "playing");
  assertEqual(snapshot.phase, "building");
  assertEqual(snapshot.wave, 1);
  assertEqual(snapshot.buildTimer, BUILD_PHASE_TIME);
  assertEqual(snapshot.wavePending, 0);
  assertEqual(snapshot.waveSpawning, false, "the world gate");
  assertLength(snapshot.towers, 0, "towers");
  assertLength(snapshot.surge, 0, "surge");
  // The row's own figures, computed from `specs/modes.md` rather than read back.
  assertEqual(snapshot.money, 200, "Containment Hard's starting money");
  assertEqual(snapshot.lives, 20, "Containment Hard's starting lives");
  assertEqual(snapshot.waveCount, 26, "Containment Hard's wave count");
  assertEqual(snapshot.score, 0);
  assertEqual(snapshot.speed, 1);
  assertEqual(snapshot.selected, null);
  assertEqual(snapshot.hoverShop, null);
  assertEqual(snapshot.build, null);
});

it("poseTower appends the tower it names, at the rotation it was given", async () => {
  await startRun(h);
  const id = await poseTower(h, "arc", FREE_SITE.col, FREE_SITE.row, 1);

  const posed = requireTower(await h.snapshot(), id, "poseTower");
  assertEqual(lastTower(await h.snapshot())?.id, id, "appended to the roster");
  assertEqual(posed.type, "arc");
  assertEqual(posed.col, FREE_SITE.col);
  assertEqual(posed.row, FREE_SITE.row);
  assertEqual(posed.rotation, 1);
  assertEqual(posed.level, 1);
  assertEqual(posed.heat, 0);
  assertEqual(posed.tripped, false);
  assertEqual(posed.fresh, true);
  assertEqual(posed.firingEnabled, true, "the firing faculty, on by default");
  assertEqual(posed.thermalEnabled, true, "the thermal faculty, on by default");
  // A rotation turns the local faces N -> E -> S -> W, so an Arc's N and S
  // radiators read as E and W at rotation 1 (specs/towers.md).
  assertDeepEqual(
    [...posed.radiatorFaces].sort(),
    [...worldRadiators("arc", 1)].sort(),
    "the world-oriented radiator faces",
  );
});

it("the faculty poses each hold one faculty and leave the other running", async () => {
  await startRun(h);

  // Firing off, thermal on: the heat model runs, so a hot idle tower cools.
  const idle = await poseIdleTower(h, "arc", FREE_SITE.col, FREE_SITE.row, {
    heat: 80,
  });
  let posed = requireTower(await h.snapshot(), idle, "poseIdleTower");
  assertEqual(posed.firingEnabled, false, "the firing gate");
  assertEqual(posed.thermalEnabled, true, "the thermal model, left running");
  assertEqual(posed.heat, 80, "the heat posed after the gate");
  await h.advance(framesFor(1));
  assertLessThan(
    requireTower(await h.snapshot(), idle, "one second of cooling").heat,
    80,
    "an idle tower still sheds heat to air",
  );

  // Thermal off, firing on: the heat holds exactly where it was pinned.
  const site = freeSite(1);
  const pinned = await posePinnedTower(h, "arc", site.col, site.row, 60);
  posed = requireTower(await h.snapshot(), pinned, "posePinnedTower");
  assertEqual(posed.thermalEnabled, false, "the thermal gate");
  assertEqual(posed.firingEnabled, true, "the guns, left running");
  await h.advance(framesFor(1));
  assertEqual(
    requireTower(await h.snapshot(), pinned, "one second pinned").heat,
    60,
    "a pinned tower's heat cannot drift under a measurement",
  );

  // And an already-tripped tower, posed rather than manufactured.
  const third = freeSite(2);
  const down = await poseTrippedTower(h, "arc", third.col, third.row);
  posed = requireTower(await h.snapshot(), down, "poseTrippedTower");
  assertEqual(posed.tripped, true);
  assertEqual(posed.tripTimer, TRIP_TIME);
  assertEqual(posed.heat, 100);
});

it("poseTarget stands still and poseWalker walks", async () => {
  await startRun(h);

  const target = await poseTarget(h, "mote", 30, 8);
  const posed = requireUnit(await h.snapshot(), target, "poseTarget");
  assertEqual(posed.motion, false, "the motion gate");
  assertCloseTo(posed.x, tileCX(30), 6, "the target's centre x");
  assertCloseTo(posed.y, tileCY(8), 6, "the target's centre y");
  assertGreaterThan(posed.hp, 1000, "effectively unkillable");

  const walker = await poseWalker(h, "mote", "left");
  const before = requireUnit(await h.snapshot(), walker, "poseWalker");
  assertEqual(before.motion, true, "a walker's motion, left on");
  assertEqual(before.vent, "left");
  assertEqual(before.exhaust, "right", "the vent's fixed opposite");

  await h.advance(framesFor(1));
  const after = await h.snapshot();
  // A Mote covers 60 logical units a second (specs/surge.md); the band is this
  // FILE's, and it is wide because what is being pinned is that the helper
  // produced a unit that moves at all.
  assertBetween(
    distance(before, requireUnit(after, walker, "one second of walking")),
    50,
    70,
    "the walker's travel over a second",
  );
  assertDeepEqual(
    { x: requireUnit(after, target, "the target").x },
    { x: posed.x },
    "the stationary target held its position",
  );
});

it("boxIn seals all four faces, and the two-phase rule holds the centre", async () => {
  await startRun(h);
  const centre = await poseIdleTower(h, "arc", BOXED_SITE.col, BOXED_SITE.row, {
    heat: 80,
  });
  const walls = await boxIn(h, centre, ["arc", "arc", "arc", "arc"]);
  assertLength(walls, 4, "one tower against each face");
  for (const wall of walls) {
    await h.debug.setTowerFiring(wall, false);
    await h.debug.setTowerHeat(wall, 80);
  }

  const towers = (await h.snapshot()).towers.map(towerFrom);
  const boxed = towers.find((tower) => tower.id === centre);
  assertTrue(boxed !== undefined, "the boxed tower is still on the floor");
  const account = accountEdges(boxed as (typeof towers)[number], towers);
  assertEqual(account.radiatorEdges, 0, "no radiator edge left facing air");
  assertEqual(account.plainEdges, 0, "no plain edge left facing air");
  assertEqual(account.shared.size, 4, "four abutting neighbours");
  for (const [, edges] of account.shared) {
    assertEqual(edges, 2, "a whole 2x2 face shared with each");
  }

  // Every neighbour opened the frame at the same heat, so conduction is nil and
  // air cooling has nowhere to happen: the centre holds exactly. That the
  // neighbours themselves cooled during the same frame is the two-phase rule —
  // every term is read from the heats the frame opened with.
  await h.advance(1);
  const after = await h.snapshot();
  assertCloseTo(
    requireTower(after, centre, "one boxed frame").heat,
    80,
    6,
    "the boxed tower's heat, over one frame",
  );
  assertLessThan(
    requireTower(after, walls[0], "the northern wall").heat,
    80,
    "a neighbour with faces on air still cools",
  );
});

it("advance runs exactly the frames it is asked for, and skip covers time off camera", async () => {
  await startRun(h);
  const before = (await h.snapshot()).simTime;

  await h.advance(framesFor(1));
  const driven = await h.snapshot();
  assertCloseTo(
    driven.simTime - before,
    1,
    3,
    "a second driven frame by frame",
  );
  assertEqual(h.frame(), framesFor(1), "the frames the harness counted");
  assertCloseTo(
    seconds(framesFor(1)),
    1,
    6,
    "the frame arithmetic round-trips",
  );

  await h.skip(2);
  assertCloseTo(
    (await h.snapshot()).simTime - driven.simTime,
    2,
    3,
    "two seconds skipped off camera",
  );
});

it("thermal.ts computes the heat the build's own frame produces", async () => {
  await startRun(h);
  const id = await poseIdleTower(h, "arc", FREE_SITE.col, FREE_SITE.row, {
    heat: 70,
  });

  const dt = seconds(1);
  const towers = (await h.snapshot()).towers.map(towerFrom);
  const expected = resolveFrame(towers, dt).get(id);
  assertTrue(expected !== undefined, "the model resolved the posed tower");

  await h.advance(1);
  assertCloseTo(
    requireTower(await h.snapshot(), id, "one frame").heat,
    (expected as { heat: number }).heat,
    6,
    "one frame of air cooling, computed from specs/heat.md's own figures",
  );
});

it("routes.ts computes the route lengths the build reports", async () => {
  await startRun(h);

  const open = await h.snapshot();
  const empty = blockedFrom(open.towers);
  assertCloseTo(
    open.paths.left.length,
    routeLength(empty, "left"),
    6,
    "the open left route",
  );
  assertCloseTo(
    open.paths.top.length,
    routeLength(empty, "top"),
    6,
    "the open top route",
  );

  // A wall across the WHOLE of the left corridor lengthens it, and the two
  // computations must still agree on how much. It takes a Lance to do it: the
  // opening is four rows deep, so anything narrower leaves a straight lane open
  // beside it and the route is unchanged.
  const across = laneTile("left", 10);
  await poseTower(h, "lance", across.col, LEFT_VENT_ROWS[0]);
  const walled = await h.snapshot();
  assertGreaterThan(
    walled.paths.left.length,
    open.paths.left.length,
    "a wall across the lane lengthens the route",
  );
  assertCloseTo(
    walled.paths.left.length,
    routeLength(blockedFrom(walled.towers), "left"),
    6,
    "the lengthened left route",
  );
});

it("withOwnClock hands the clock over and takes it back, however it ends", async () => {
  await startRun(h);
  assertEqual((await h.snapshot()).autoStep, false, "off the clock to begin");

  const seen = await h.withOwnClock(async (clock) => {
    return (await clock.read()).autoStep;
  });
  assertEqual(seen, true, "the build drives itself inside the scope");
  assertEqual(
    (await h.snapshot()).autoStep,
    false,
    "and the harness has it back after",
  );

  // And after a scenario that threw, which is the case a `finally` is for.
  let threw = false;
  try {
    await h.withOwnClock(async () => {
      throw new Error("the scenario failed");
    });
  } catch {
    threw = true;
  }
  assertTrue(threw, "the scenario's failure travels on");
  assertEqual(
    (await h.snapshot()).autoStep,
    false,
    "the clock came back anyway",
  );
});

it("reads the running floor, the pause and the resume on the build's own clock", async () => {
  await startRun(h);
  const walker = await poseWalker(h, "mote", "left");

  // NOTHING IN HERE CALLS `advance`. That is the whole point: `advance` bottoms
  // out in a debug operation a build may gate separately from its own frame
  // loop, so it measures where the pause gate sits rather than whether the floor
  // moved. Three legs of the same length on the build's own clock, with both
  // readings of the paused leg taken from the ONE snapshot on the press.
  const legs = await h.withOwnClock(async (clock) => {
    const opened = await clock.read();
    await clock.settle(WINDOW_MS);
    await clock.press(BINDINGS.pause);
    const pressed = await clock.read();
    await clock.settle(WINDOW_MS);
    const held = await clock.read();
    await clock.press(BINDINGS.pause);
    await clock.settle(WINDOW_MS);
    return { opened, pressed, held, resumed: await clock.read() };
  });

  const at = (snapshot: typeof legs.opened) =>
    requireUnit(snapshot, walker, "the own-clock legs");

  assertGreaterThan(
    distance(at(legs.opened), at(legs.pressed)),
    MIN_TRAVEL,
    "the Mote was walking before the pause, on the build's own clock",
  );
  assertEqual(legs.pressed.screen, "paused", "the press reached the game");
  assertLessThan(
    distance(at(legs.pressed), at(legs.held)),
    MAX_DRIFT,
    "the Mote holds its position through the paused window",
  );
  assertLessThan(
    legs.held.simTime - legs.pressed.simTime,
    MAX_CLOCK_DRIFT,
    "the simulation clock does not advance while paused",
  );
  assertGreaterThan(
    distance(at(legs.held), at(legs.resumed)),
    MIN_TRAVEL,
    "and resuming runs the floor again",
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

  // A cue sounds on the frame a menu move is delivered, once audio is armed with
  // a genuine browser gesture. What is read is that a sound was emitted and
  // when; the NAME is unobservable under this engine and nothing asserts it.
  await h.armAudio();
  const played = watchCues(h);
  const before = await h.sounds();
  await tapAction(h, "down");
  assertGreaterThanOrEqual(played.length, 1, "a sound on the menu-move frame");
  assertGreaterThan(await h.sounds(), before, "the raw sound count moved");

  // And a tower reads apart from the bare floor it stands on.
  await startRun(h);
  const id = await poseTower(h, "lance", FREE_SITE.col, FREE_SITE.row);
  await h.advance(1);
  const floor = await sampleFloor(h);
  const tower = await sampleTower(
    h,
    requireTower(await h.snapshot(), id, "the scene"),
  );
  assertGreaterThan(colorDistance(tower, floor), 0, "a tower's drawn colour");
});

it("observes the overlay through Backquote and the draw recorder", async () => {
  await startRun(h);
  await poseTower(h, "arc", FREE_SITE.col, FREE_SITE.row);
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
  assertEqual(after.money, before.money);
  assertDeepEqual(after.surge, before.surge);
  assertEqual(
    towerById(after, before.towers[0].id)?.heat,
    before.towers[0].heat,
  );

  await toggleOverlay(h);
  assertLessThanOrEqual(
    drawnText(await h.frameCalls()).length,
    drawnText(bare).length,
    "toggling again hides the overlay",
  );
});

it("writes a still and a replay under the media directory", async () => {
  const mediaDir = mkdtempSync(join(tmpdir(), "meltdown-media-"));
  const hadMediaDir = process.env[MEDIA_DIR_ENV];
  process.env[MEDIA_DIR_ENV] = mediaDir;
  try {
    await startRun(h);
    await poseIdleTower(h, "arc", FREE_SITE.col, FREE_SITE.row, { heat: 90 });
    await h.advance(1);

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
      // Off camera, then on: the recording must hold the twelve driven frames
      // and nothing of the half-second the skip passed over, which is what lets
      // a trip check record the cooldown rather than the wait before it.
      await h.skip(0.5);
      await h.advance(12);
      return "returned";
    });
    assertEqual(value, "returned", "the scenario's own value comes back");

    const raw = readFileSync(join(mediaDir, SUITE_DIR, "replay-check.json.gz"));
    const recording = JSON.parse(gunzipSync(raw).toString("utf8")) as Recording;
    assertEqual(recording.width, 1280);
    assertEqual(recording.height, 720);
    assertLength(recording.frames, 12, "one recorded frame per driven frame");
    assertGreaterThan(recording.ops.length, 0, "the frames carry operations");
  } finally {
    if (hadMediaDir === undefined) delete process.env[MEDIA_DIR_ENV];
    else process.env[MEDIA_DIR_ENV] = hadMediaDir;
    rmSync(mediaDir, { recursive: true, force: true });
  }
});
