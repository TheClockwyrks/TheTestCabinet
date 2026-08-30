// harness — self-checks for the shared scaffolding the suites in this directory
// stand on, run against the case's reference implementation.
//
// The suites next door are validators: each decides one review item against the
// build. This file decides nothing about any build. It proves that the harness's
// own machinery — the browser reach, the compound scenario helpers, the tick
// clock, the observation channels, and the evidence writers — really does what
// the suites assume of it, because a helper that silently did less would turn
// every item that leans on it into a wrong verdict with a confident face.
//
// What is pinned here, and why:
//
//   - THE REACH. `createHarness` really finds `window.__shatter` on the built
//     site, it carries every operation `REQUIRED_OPS` names at
//     `SHATTER_DEBUG_VERSION`, and it is live rather than merely present.
//   - THE POSES. `startPlaying` really leaves an empty, quiet, live field;
//     `poseRock` puts exactly the rock it was given on the field and the well
//     then moves it; `poseSaucer` poses the three faculties the saucer items
//     pair; `poseBullet` and `poseEnemyBullet` each land on their own roster.
//   - THE CLOCK. `advance` runs exactly the ticks it is asked for and `skip`
//     covers game time off camera, both measured against the build's own
//     `simTime`; `tap` really delivers a press edge the game acts on.
//   - SHOOTING THINGS DOWN. `aimedRound` puts the round on the side facing away
//     from the star and aims it inward carrying the target's motion;
//     `shootRock` destroys a rock through the build's own collision and scoring;
//     and `shootFieldDown` empties a field by DESTROYING it rather than by
//     clearing it, which is the whole of what the `waves` items rest on.
//   - THE CHANNELS. A pixel sample, a text-draw query, a cue capture and the
//     overlay each return something sane, and the overlay is a pure read.
//   - THE EVIDENCE. `captureStill` and `captureReplay` write real files under the
//     media directory, at the staged suite's address, and a capture keeps the
//     ticks `advance` drove and not the ones `skip` passed over.
//
// No review item names this file, so a run never loads it. It runs with the whole
// project, which is how a case author runs these suites while writing them:
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
  BULLET_R,
  FACE_UP,
  FIELD_H,
  FIELD_W,
  KEY_FIRE,
  KEY_PAUSE,
  KEYS_THRUST,
  MUZZLE_SPEED,
  ROCK_CHILD,
  ROCK_RADIUS,
  SAFE_X,
  SAFE_Y,
  SAUCER_SPEED,
  SCORE_SMALL,
  START_LIVES,
  STAR_X,
  STAR_Y,
  TICK_DT,
  TITLE_TEXT,
} from "./constants";
import { starDistance, wrappedDistance } from "./geometry";
import {
  aimedRound,
  captureReplay,
  captureStill,
  colorDistance,
  createHarness,
  destroyRock,
  drewText,
  drawnText,
  driveBullet,
  failSurface,
  fireAt,
  fitViewport,
  lastRock,
  poseBullet,
  poseEnemyBullet,
  poseRock,
  poseSaucer,
  REQUIRED_OPS,
  requireRock,
  rockById,
  requireSaucer,
  ROUND_STANDOFF,
  sampleColor,
  sampleField,
  SHATTER_DEBUG_VERSION,
  shootFieldDown,
  shootRock,
  startPlaying,
  textDraws,
  ticksFor,
  toggleOverlay,
  watchCues,
  watchStops,
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

/**
 * A corner of the field far from the star and clear of the ship's safe point.
 *
 * 412 units out, where the well pulls at about 26 units per second squared, so a
 * scenario that runs for a fraction of a second is not moved by gravity in any way
 * a self-check has to reason about.
 */
const FAR = { x: 320, y: 620 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reaches the reference's surface, whole and live", async () => {
  if (h.surfaceFault !== null) failSurface(h.surfaceFault);
  const probed = await h.probe(REQUIRED_OPS);
  assertEqual(probed.version, SHATTER_DEBUG_VERSION);
  for (const op of REQUIRED_OPS) {
    assertEqual(probed.ops[op], "function", op);
  }

  // And it is live rather than merely present: a posed rock reads back.
  await h.debug.clearRocks();
  await h.debug.addRock("medium", 200, 200);
  const rock = lastRock(await h.snapshot());
  assertEqual(rock?.size, "medium");
  assertEqual(rock?.x, 200);
  assertEqual(rock?.radius, ROCK_RADIUS.medium);

  // The harness opened by taking the game off its own clock, which is the state
  // every scenario below is posed in.
  assertEqual((await h.snapshot()).autoStep, false, "the clock is held");
});

it("startPlaying leaves an empty, quiet, live field", async () => {
  // Something on every roster, both gates open and the contact test running, so
  // the helper has work to do.
  await poseRock(h, "large", 400, 200);
  await poseBullet(h, 100, 100, 0, -10);
  await poseEnemyBullet(h, 120, 120, 0, 10);
  await poseSaucer(h, 200, 300);
  await h.debug.setWaveSpawning(true);
  await h.debug.setSaucerSpawning(true);
  await h.debug.setShipCollision(true);
  await h.debug.setScore(4321);

  await startPlaying(h, { wave: 3 });
  const s = await h.snapshot();

  assertEqual(s.screen, "playing");
  assertEqual(s.menuIndex, 0);
  assertEqual(s.score, 0);
  assertEqual(s.lives, START_LIVES);
  assertEqual(s.wave, 3);
  assertEqual(s.waveBanner, 0);
  assertLength(s.rocks, 0, "rocks");
  assertLength(s.bullets, 0, "bullets");
  assertLength(s.enemyBullets, 0, "enemy bullets");
  assertEqual(s.saucer, null, "the saucer slot");
  assertEqual(s.waveSpawning, false, "the wave gate");
  assertEqual(s.saucerSpawning, false, "the saucer gate");
  assertEqual(s.ship.collision, false, "the ship's contact gate");
  assertEqual(s.ship.x, SAFE_X);
  assertEqual(s.ship.y, SAFE_Y);
  assertCloseTo(s.ship.speed, 0, 6, "the ship's speed");
  assertCloseTo(s.ship.angle, FACE_UP, 6, "the ship's facing");
  assertEqual(s.ship.invuln, 0);
  assertEqual(s.ship.fireCooldown, 0);

  // And the field really is quiet: ten seconds of game time raise no wave and
  // bring in no saucer, which is what lets every mechanic suite pose a scenario.
  await h.skip(ticksFor(10));
  const quiet = await h.snapshot();
  assertLength(quiet.rocks, 0, "rocks ten seconds on");
  assertEqual(quiet.saucer, null, "the saucer ten seconds on");
  assertEqual(quiet.wave, 3, "the wave ten seconds on");
});

it("poseRock puts exactly the rock it was given on the field, and the well moves it", async () => {
  await startPlaying(h);
  const id = await poseRock(h, "small", FAR.x, FAR.y, 40, -30);
  const posed = requireRock(await h.snapshot(), id, "poseRock");

  assertEqual(posed.size, "small");
  assertEqual(posed.radius, ROCK_RADIUS.small);
  assertCloseTo(posed.x, FAR.x, 6, "the rock's centre x");
  assertCloseTo(posed.y, FAR.y, 6, "the rock's centre y");
  assertCloseTo(posed.vx, 40, 6, "the posed vx");
  assertCloseTo(posed.vy, -30, 6, "the posed vy");
  assertEqual(lastRock(await h.snapshot())?.id, id, "appended to the roster");

  // A second of game time, and the well has bent it toward the star: the rock is
  // the build's own from here, and nothing in the harness moved it.
  const before = starDistance(posed);
  await h.advance(ticksFor(1));
  const moved = requireRock(await h.snapshot(), id, "a second on");
  assertLessThan(starDistance(moved), before, "the well pulled it inward");
});

it("poseSaucer poses the three faculties the saucer items pair", async () => {
  await startPlaying(h);
  const id = await poseSaucer(h, 100, 300, {
    mind: false,
    gun: false,
    travel: true,
  });
  const posed = requireSaucer(await h.snapshot(), "poseSaucer");
  assertEqual(posed.id, id);
  assertEqual(posed.mind, false, "the mind faculty");
  assertEqual(posed.gun, false, "the gun faculty");
  assertEqual(posed.travel, true, "the travel faculty");
  assertCloseTo(
    posed.vx,
    SAUCER_SPEED,
    6,
    "addSaucer sends it right at cruise",
  );
  assertCloseTo(posed.vy, 0, 6, "and with no vertical component");

  // With its mind and gun off, a second of game time is pure travel.
  await h.advance(ticksFor(1));
  const flown = requireSaucer(await h.snapshot(), "a second on");
  assertCloseTo(flown.x - posed.x, SAUCER_SPEED, 0, "a second of cruise");
  assertCloseTo(flown.y, posed.y, 3, "and no weave");
});

it("advance runs exactly the ticks it is asked for, and skip covers time off camera", async () => {
  await startPlaying(h);
  const opened = (await h.snapshot()).simTime;

  await h.advance(ticksFor(1));
  const driven = await h.snapshot();
  assertCloseTo(driven.simTime - opened, 1, 6, "a second driven tick by tick");
  assertEqual(h.tick(), ticksFor(1), "the ticks the harness counted");

  await h.skip(ticksFor(2));
  const skipped = await h.snapshot();
  assertCloseTo(
    skipped.simTime - driven.simTime,
    2,
    6,
    "two seconds skipped off camera",
  );

  // And a single tick is exactly one TICK_DT, which every duration in this
  // project is counted in.
  const one = await h.snapshot();
  await h.advance(1);
  assertCloseTo(
    (await h.snapshot()).simTime - one.simTime,
    TICK_DT,
    6,
    "one tick",
  );
});

it("tap delivers a press edge the game acts on", async () => {
  await startPlaying(h);
  await h.tap(KEY_PAUSE);
  assertEqual((await h.snapshot()).screen, "paused", "the pause key's edge");
});

it("aimedRound puts the round on the far side from the star and fires it inward", async () => {
  // Pure geometry, no page: the placement is the case's, and every check that
  // shoots something depends on it being on the side that cannot be absorbed by
  // the core on the way in.
  const target = {
    x: FAR.x,
    y: FAR.y,
    vx: 25,
    vy: -15,
    radius: ROCK_RADIUS.large,
  };
  const round = aimedRound(target);

  const reach = ROCK_RADIUS.large + BULLET_R + ROUND_STANDOFF;
  assertCloseTo(
    wrappedDistance(round, target),
    reach,
    3,
    "the standoff outside the surface",
  );
  assertGreaterThan(
    starDistance(round),
    starDistance(target),
    "placed further from the star than its target",
  );
  // Its velocity is the target's plus the muzzle speed straight at it.
  assertCloseTo(
    round.vx - target.vx,
    ((target.x - round.x) / reach) * MUZZLE_SPEED,
    3,
    "vx",
  );
  assertCloseTo(
    round.vy - target.vy,
    ((target.y - round.y) / reach) * MUZZLE_SPEED,
    3,
    "vy",
  );
});

it("shootRock destroys a rock through the build's own collision and scoring", async () => {
  await startPlaying(h);
  const id = await poseRock(h, "small", FAR.x, FAR.y, 90, 40);
  const before = (await h.snapshot()).score;

  const shot = await shootRock(h, id);
  assertEqual(shot.hit, true, "the round resolved");
  assertEqual(
    shot.snapshot.rocks.find((rock) => rock.id === id),
    undefined,
    "the Small it destroyed",
  );
  assertEqual(
    shot.snapshot.score - before,
    SCORE_SMALL,
    "the score the kill paid",
  );
});

it("shootFieldDown empties a field by destroying it, never by clearing it", async () => {
  await startPlaying(h);
  await poseRock(h, "large", FAR.x, FAR.y);
  const before = (await h.snapshot()).score;

  const rounds = await shootFieldDown(h);
  const cleared = await h.snapshot();
  assertLength(cleared.rocks, 0, "the rocks left standing");
  // A Large is one, two Mediums and four Smalls under `base`, so seven kills at
  // one round each. What matters is that every one of them was a real kill:
  // `clearRocks` scores nothing, and the whole ladder here paid.
  assertGreaterThanOrEqual(rounds, 7, "rounds fired");
  assertGreaterThan(cleared.score - before, 0, "the score the ladder paid");

  // And `leave` stops on Smalls as well as on a count, which is what lets a wave
  // item destroy a genuine last rock.
  await poseRock(h, "large", FAR.x, FAR.y);
  await shootFieldDown(h, { leave: 1 });
  const remaining = (await h.snapshot()).rocks;
  assertLength(remaining, 1, "the one rock left");
  assertEqual(remaining[0].size, "small", "and it is a Small");
});

it("samples pixels, reads text draws, and captures cues", async () => {
  // A pixel is four sane channel values.
  const pixel = await h.pixel(STAR_X, STAR_Y);
  assertLength(pixel, 4);
  for (const channel of pixel) assertBetween(channel, 0, 255);

  // The title frame draws text, and among it the case's own copy.
  const title = await h.frameCalls();
  assertGreaterThan(drawnText(title).length, 0, "text draws on the title");
  assertTrue(drewText(title, TITLE_TEXT), `the title draws ${TITLE_TEXT}`);
  assertGreaterThan(textDraws(title).length, 0, "anchored text draws");

  // The star reads apart from the bare field it stands on.
  await startPlaying(h);
  await h.advance(1);
  const bare = await sampleField(h);
  const core = await sampleColor(h, STAR_X, STAR_Y);
  assertGreaterThan(colorDistance(core, bare), 0, "the star's core colour");

  // A cue sounds on the tick the fire key is delivered, once audio is armed with
  // a genuine browser gesture. What is read is that a sound was emitted and when;
  // the NAME is unobservable under this engine and nothing asserts it.
  await h.armAudio();
  const played = watchCues(h);
  const soundsBefore = await h.sounds();
  await h.tap(KEY_FIRE);
  assertGreaterThanOrEqual(played.length, 1, "a sound on the firing tick");
  assertGreaterThan(
    await h.sounds(),
    soundsBefore,
    "the raw sound count moved",
  );
  assertLength((await h.snapshot()).bullets, 1, "and the shot it went with");
});

it("maps the field onto the canvas one unit to one pixel at the default shape", async () => {
  const view = h.viewport();
  assertEqual(view.width, FIELD_W);
  assertEqual(view.height, FIELD_H);
  assertEqual(view.scale, 1, "one device pixel per logical unit");
  assertDeepEqual(h.device(0, 0), { x: 0, y: 0 }, "the top-left corner");
  assertDeepEqual(
    h.device(STAR_X, STAR_Y),
    { x: STAR_X, y: STAR_Y },
    "the star's centre",
  );
  // And the fit is the one `specs/overview.md` fixes at any other shape: the whole
  // field inside, centred, with the leftover split into two bars.
  const tall = fitViewport(1280, 960, 1);
  assertEqual(tall.scale, 1, "the scale a taller window fits at");
  assertEqual(tall.offsetX, 0, "no bar at the sides");
  assertEqual(tall.offsetY, 120, "and half the leftover above");

  const surface = await h.surface();
  assertEqual(surface.width, FIELD_W, "the canvas's backing store width");
  assertEqual(surface.height, FIELD_H, "and its height");
});

it("observes the overlay through Backquote, and watching it changes nothing", async () => {
  await startPlaying(h);
  await poseRock(h, "medium", FAR.x, FAR.y);
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

  // And watching it is a pure read: the game-facing state is as it was, bar the
  // three ticks the reads themselves ran.
  const after = await h.snapshot();
  assertEqual(after.screen, before.screen);
  assertEqual(after.score, before.score);
  assertEqual(after.lives, before.lives);
  assertLength(after.rocks, before.rocks.length, "the rock roster");

  await toggleOverlay(h);
  const cleared = await h.frameCalls();
  assertLessThanOrEqual(
    drawnText(cleared).length,
    drawnText(bare).length,
    "toggling again hides the overlay",
  );
});

it("writes a still and a replay under the media directory", async () => {
  const mediaDir = mkdtempSync(join(tmpdir(), "shatter-media-"));
  const hadMediaDir = process.env[MEDIA_DIR_ENV];
  process.env[MEDIA_DIR_ENV] = mediaDir;
  try {
    await startPlaying(h);
    await poseRock(h, "large", FAR.x, FAR.y, -40, -40);
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
      // Off camera, then on: the recording must hold the twelve driven ticks and
      // nothing of the half-second the skip passed over, which is what lets an
      // item record the beat rather than the march that got there.
      await h.skip(ticksFor(0.5));
      await h.advance(12);
      return "returned";
    });
    assertEqual(value, "returned", "the scenario's own value comes back");

    const raw = readFileSync(join(mediaDir, SUITE_DIR, "replay-check.json.gz"));
    const recording = JSON.parse(gunzipSync(raw).toString("utf8")) as Recording;
    assertEqual(recording.width, FIELD_W);
    assertEqual(recording.height, FIELD_H);
    assertLength(recording.frames, 12, "one recorded frame per driven tick");
    assertGreaterThan(recording.ops.length, 0, "the frames carry operations");
  } finally {
    if (hadMediaDir === undefined) delete process.env[MEDIA_DIR_ENV];
    else process.env[MEDIA_DIR_ENV] = hadMediaDir;
    rmSync(mediaDir, { recursive: true, force: true });
  }
});

it("fireAt and driveBullet run one round through the build's own rules", async () => {
  await startPlaying(h);
  const id = await poseRock(h, "medium", FAR.x, FAR.y, 0, 0);
  const rock = requireRock(await h.snapshot(), id, "the posed Medium");
  const bullet = await fireAt(h, rock);

  // The round is in flight and is the last of the roster, which is where
  // `specs/instrumentation.md` says an added entity lands.
  assertEqual(
    (await h.snapshot()).bullets.some((shot) => shot.id === bullet),
    true,
    "the round in flight",
  );

  const landed = await driveBullet(h, bullet);
  assertEqual(landed.hit, true, "the round resolved");
  assertGreaterThan(landed.ticks, 0, "and it took real ticks to get there");
});

it("destroyRock takes a rock apart however many hits its armor needs", async () => {
  await startPlaying(h);
  const id = await poseRock(h, "medium", FAR.x, FAR.y);
  const { rounds, result } = await destroyRock(h, id);

  assertGreaterThanOrEqual(rounds, 1, "the rounds it took");
  assertEqual(rockById(result.snapshot, id), undefined, "the Medium is gone");
  // And what it left is what `specs/rocks.md` says a Medium leaves: two of the
  // size below it, appended in order.
  const left = result.snapshot.rocks;
  assertLength(left, 2, "the fragments it left");
  for (const fragment of left) {
    assertEqual(fragment.size, ROCK_CHILD.medium, "each fragment's size");
  }
});

it("holdFor holds a key down, and the held cue starts and stops with it", async () => {
  await startPlaying(h);
  await h.armAudio();
  const played = watchCues(h);
  const stopped = watchStops(h);

  await h.holdFor(KEYS_THRUST[0], ticksFor(0.5));
  const burning = await h.snapshot();
  assertGreaterThan(burning.ship.speed, 0, "the burn built speed");
  assertGreaterThanOrEqual(played.length, 1, "the held cue started");

  // The key is released by `holdFor`; the tick that follows is the one on which
  // the game sees it released and lets the voice go.
  const stopsBefore = stopped.length;
  await h.advance(2);
  assertGreaterThan(stopped.length, stopsBefore, "the held cue stopped");
  assertEqual(
    (await h.snapshot()).ship.thrusting,
    false,
    "and the ship is coasting",
  );
});

it("presentCalls redraws without advancing, and scanDevice reads a whole line", async () => {
  await startPlaying(h);
  const before = (await h.snapshot()).simTime;
  const calls = await h.presentCalls();
  assertGreaterThan(calls.length, 0, "the render the loop made");
  assertCloseTo(
    (await h.snapshot()).simTime,
    before,
    6,
    "and nothing advanced",
  );

  // The star is drawn as a bright core with a halo fading outward, so the row
  // through its centre is brighter at the centre than at the field's edge.
  const row = await h.scanDevice("row", STAR_Y);
  assertLength(row, FIELD_W, "one reading per device pixel of the row");
  assertGreaterThan(row[STAR_X], row[4], "the core against the far field");
});

it("runFor hands the loop back for real time, and takes it away again", async () => {
  await startPlaying(h);
  const held = await h.snapshot();
  assertEqual(held.autoStep, false, "the clock starts held");

  await h.runFor(250);
  const ran = await h.snapshot();
  assertEqual(ran.autoStep, false, "and is held again afterwards");
  assertGreaterThan(
    ran.simTime,
    held.simTime,
    "the build's own loop advanced the game",
  );

  // And it is held for real: a quarter second of wall time with the clock away
  // advances nothing at all.
  await h.page.waitForTimeout(250);
  assertCloseTo(
    (await h.snapshot()).simTime,
    ran.simTime,
    6,
    "nothing advanced while the clock was held",
  );
});
