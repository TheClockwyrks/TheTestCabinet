// harness — self-checks for the shared scaffolding the suites in this directory
// stand on, run against the case's reference implementation.
//
// The suites next door are validators: each decides one review point against the
// build. This file decides nothing about any build. It proves that the harness's
// own machinery — the browser reach, the compound scenario helpers, the clock,
// the observation channels, and the evidence writers — really does what the
// suites assume of it, because a helper that silently did less would turn every
// point that leans on it into a wrong verdict with a confident face.
//
// What is pinned here, and why:
//
//   - THE REACH. `createHarness` really finds `window.__spectra` on the built
//     site, it carries every operation `REQUIRED_OPS` names, and it answers.
//   - THE POSES. `startPosed` really leaves an empty, quiet, live wave;
//     `poseDrone` lays exactly the drone it was given with every faculty off;
//     `poseFormation` puts each drone on its slot; `startStage` opens the wave
//     the GAME builds; `startRunFromTitle` opens a run through a real key;
//     `shootDrone` and `fireAtShip` drive a real shot to its real outcome.
//   - THE CLOCK. `advance` runs exactly the frames it is asked for and `skip`
//     covers game time off camera, both measured against the game's own
//     `simTime`.
//   - THE CHANNELS. A pixel sample, a region reading, a text-draw query, a sprite
//     silhouette and a cue capture each return something sane, and the overlay is
//     observable through its fixed Backquote binding plus the draw recorder.
//   - THE EVIDENCE. `captureStill` and `captureReplay` write real files under the
//     media directory, at the staged suite's address, and a capture keeps the
//     frames `advance` drove and not the ones `skip` passed over.
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
import { ParticleSimulator } from "@clockwyrks/particle-runtime";
import {
  assertBetween,
  assertCloseTo,
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertLength,
  assertLessThanOrEqual,
  assertTrue,
} from "./assert";
import {
  FORM_CENTER_X,
  SHARD_SIZE,
  SPECTRA_DEBUG_VERSION,
  SPRITE_SIZE,
  START_LIVES,
  STAGE_H,
  STAGE_W,
  TITLE_TEXT,
  slotX,
  slotY,
} from "./constants";
import {
  REQUIRED_OPS,
  blitsNear,
  blitsOfFrame,
  captureReplay,
  captureStill,
  colorDistance,
  createHarness,
  drawnText,
  drewText,
  droneById,
  failSurface,
  fireAtShip,
  footprint,
  framesFor,
  lastDrone,
  poseDrone,
  poseFormation,
  readRegion,
  regionDistance,
  requireDrone,
  sampleColor,
  sampleField,
  seededBurstSystem,
  seededSprites,
  shootDrone,
  silhouetteArea,
  startPosed,
  startRunFromTitle,
  startStage,
  textDraws,
  toggleOverlay,
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

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reaches the reference's surface, whole", async () => {
  if (h.surfaceFault !== null) failSurface(h.surfaceFault);
  const probed = await h.probe(REQUIRED_OPS);
  assertEqual(probed.version, SPECTRA_DEBUG_VERSION);
  for (const op of REQUIRED_OPS) {
    assertEqual(probed.ops[op], "function", op);
  }

  // And it is live rather than merely present: a posed field reads back.
  await h.debug.setStage(4);
  await h.debug.setResonance(42);
  const snapshot = await h.snapshot();
  assertEqual(snapshot.stage, 4);
  assertEqual(snapshot.resonance, 42);
});

it("startPosed leaves an empty, quiet, live wave", async () => {
  // Something on every roster and every gate open, so the helper has work to do.
  await startStage(h, 1);
  await h.debug.addPlayerBullet(FORM_CENTER_X, 400, "cyan");
  await h.debug.addEnemyBullet(FORM_CENTER_X, 200, "magenta");
  await h.debug.setScore(4321);
  await h.debug.setLives(1);

  await startPosed(h, { stage: 3 });
  const snapshot = await h.snapshot();

  assertEqual(snapshot.screen, "inWave");
  assertEqual(snapshot.phase, "live");
  assertEqual(snapshot.phaseTimer, 0);
  assertEqual(snapshot.stage, 3);
  assertLength(snapshot.drones, 0, "drones");
  assertLength(snapshot.bullets, 0, "bullets");
  assertLength(snapshot.bursts, 0, "bursts");
  assertEqual(snapshot.waveEntry, false, "the wave-entry gate");
  assertEqual(snapshot.diveLaunching, false, "the dive-launching gate");
  assertEqual(snapshot.ship.contact, false, "the ship's contact gate");
  assertEqual(snapshot.ship.x, FORM_CENTER_X);
  assertEqual(snapshot.ship.band, "cyan");
  assertEqual(snapshot.ship.lockout, 0);
  assertEqual(snapshot.ship.cooldown, 0);
  assertEqual(snapshot.resonance, 0);
  assertEqual(snapshot.inversion, 0);
  assertEqual(snapshot.lives, START_LIVES);
  assertEqual(snapshot.score, 0);
  assertEqual(snapshot.extraLifeAwarded, false);
  assertEqual(snapshot.diveClock, 0);

  // And it really is quiet: ten seconds of live play with nothing posed brings
  // nothing in, launches nothing, and does not clear the stage.
  await h.skip(10);
  const after = await h.snapshot();
  assertLength(after.drones, 0, "drones after ten seconds");
  assertEqual(after.screen, "inWave", "still in the wave");
});

it("poseDrone lays one drone with every faculty off", async () => {
  await startPosed(h);
  const id = await poseDrone(h, "flux", 500, 300, {
    band: "magenta",
    slotX: 480,
    slotY: 280,
    bandClock: 0.5,
  });

  const posed = requireDrone(await h.snapshot(), id, "poseDrone");
  assertEqual(posed.kind, "flux");
  assertEqual(posed.x, 500, "the centre it was placed at");
  assertEqual(posed.y, 300);
  assertEqual(posed.band, "magenta", "the stored band the spec posed");
  assertEqual(posed.slotX, 480, "the slot the spec posed");
  assertEqual(posed.slotY, 280);
  assertCloseTo(posed.bandClock, 0.5, 6, "the band clock the spec posed");
  assertEqual(posed.travel, false, "travel, off by default");
  assertEqual(posed.oscillation, false, "oscillation, off by default");
  assertEqual(posed.fire, false, "fire, off by default");
  assertEqual(lastDrone(await h.snapshot())?.id, id, "appended to the roster");

  // A prop, and it stays one: a second of live play moves nothing about it.
  await h.advance(framesFor(1));
  const held = requireDrone(await h.snapshot(), id, "a second of play");
  assertEqual(held.x, 500, "its centre, held");
  assertEqual(held.y, 300);
  assertEqual(held.band, "magenta", "its band, held");
  assertCloseTo(held.bandClock, 0.5, 6, "its band clock, held");
});

it("poseFormation puts each drone on its slot", async () => {
  await startPosed(h);
  const ids = await poseFormation(h, [
    { kind: "shard", col: 0, row: 0 },
    { kind: "flux", col: 4, row: 2, band: "magenta" },
    { kind: "prism", col: 8, row: 4 },
  ]);
  assertLength(ids, 3, "the ids it handed back");

  const snapshot = await h.snapshot();
  const expected = [
    { col: 0, row: 0 },
    { col: 4, row: 2 },
    { col: 8, row: 4 },
  ];
  for (const [index, id] of ids.entries()) {
    const drone = requireDrone(snapshot, id, "poseFormation");
    const { col, row } = expected[index];
    assertEqual(drone.phase, "formation", `drone ${index}: the phase`);
    assertEqual(drone.x, slotX(col), `drone ${index}: the slot's x`);
    assertEqual(drone.y, slotY(row), `drone ${index}: the slot's y`);
    assertEqual(drone.slotX, slotX(col), `drone ${index}: the slot it holds`);
    assertEqual(drone.slotY, slotY(row));
  }
});

it("startStage opens the wave the game itself builds", async () => {
  await startStage(h, 1);
  const opened = await h.snapshot();
  assertEqual(opened.screen, "inWave", "the wave opened");
  assertEqual(opened.stage, 1);

  // The wave is the build's, so its drones arrive over the entry schedule rather
  // than all at once. Two seconds is enough for some of them to be on the field.
  await h.skip(2);
  const arriving = await h.snapshot();
  assertGreaterThan(arriving.drones.length, 0, "drones the wave released");
});

it("startRunFromTitle opens a run through a real key", async () => {
  const opened = await h.snapshot();
  assertEqual(opened.screen, "title", "a fresh harness opens on the title");

  await startRunFromTitle(h);
  const run = await h.snapshot();
  assertEqual(
    run.screen,
    "stageIntro",
    "confirming the first item opens stage one",
  );
  assertEqual(run.stage, 1);
  assertEqual(run.lives, START_LIVES);
  assertEqual(run.score, 0);
});

it("advance runs exactly the frames it is asked for, and skip covers time off camera", async () => {
  await startPosed(h);
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

  await h.skip(2);
  const skipped = await h.snapshot();
  assertCloseTo(
    skipped.simTime - driven.simTime,
    2,
    3,
    "two seconds skipped off camera",
  );
});

it("shootDrone drives a real shot to its real outcome", async () => {
  await startPosed(h);
  const target = await poseDrone(h, "shard", 400, 300, { band: "cyan" });
  const spared = await poseDrone(h, "shard", 800, 300, { band: "cyan" });

  // A matching shot destroys it, and the game's own rules are what did:
  // nothing here removed a drone.
  const matched = await shootDrone(h, target, "cyan", { below: 120 });
  assertEqual(matched.hit, true, "the bullet resolved");
  assertEqual(
    droneById(matched.snapshot, target),
    undefined,
    "the destroyed drone",
  );
  assertEqual(
    matched.snapshot.screen,
    "inWave",
    "the wave the shut stage-clear gate kept live",
  );

  // And a mismatched shot leaves the drone standing.
  const missed = await shootDrone(h, spared, "magenta", { below: 120 });
  assertEqual(missed.hit, true, "the mismatched bullet resolved too");
  assertEqual(
    droneById(missed.snapshot, spared)?.id,
    spared,
    "the drone a mismatched shot left standing",
  );
});

it("startPosed keeps a posed wave running once its last drone falls", async () => {
  // `startPosed` shuts `stageClearing`, so a scenario that poses one drone and
  // destroys it reads what the kill did rather than what a stage end did: the
  // field empties and the wave stays live. Nothing here asserts the clear rule
  // itself — that is `stages/clears-on-last-drone`'s, over the game's own wave,
  // and `instrumentation/stage-clearing-gate`'s for the gate.
  await startPosed(h);
  const target = await poseDrone(h, "shard", 400, 300, { band: "cyan" });
  const kept = await shootDrone(h, target, "cyan", { below: 120 });

  assertEqual(
    droneById(kept.snapshot, target),
    undefined,
    "the drone the shot destroyed",
  );
  assertEqual(kept.snapshot.screen, "inWave", "the wave still running");
  assertLength(kept.snapshot.drones, 0, "the field it left empty");
});

it("fireAtShip drives an enemy bullet into the ship", async () => {
  await startPosed(h);
  // The contact gate is the requirement here, so it goes back on.
  await h.debug.setShipContact(true);
  const before = await h.snapshot();

  const swept = await fireAtShip(h, "magenta", { above: 120 });
  assertEqual(swept.hit, true, "the enemy bullet resolved");
  assertEqual(
    swept.snapshot.lives,
    before.lives - 1,
    "an opposite-band bullet costs one life",
  );
});

it("samples pixels, reads regions and text draws, and captures cues", async () => {
  // A pixel is four sane channel values.
  const pixel = await h.pixel(FORM_CENTER_X, 360);
  assertLength(pixel, 4);
  for (const channel of pixel) assertBetween(channel, 0, 255);

  // The title frame draws text, and among it the case's own copy.
  const title = await h.frameCalls();
  assertGreaterThan(drawnText(title).length, 0, "text draws on the title");
  assertTrue(drewText(title, TITLE_TEXT), `the title draws ${TITLE_TEXT}`);
  assertGreaterThan(textDraws(title).length, 0, "anchored text draws");

  // A posed drone reads apart from the empty field it stands on, and the region
  // it occupies reads differently once it is there.
  await startPosed(h);
  await h.advance(1);
  const empty = await readRegion(h, footprint(400, 300, SHARD_SIZE), 2);
  const field = await sampleField(h);

  const id = await poseDrone(h, "shard", 400, 300, { band: "magenta" });
  await h.advance(1);
  const occupied = await readRegion(h, footprint(400, 300, SHARD_SIZE), 2);
  assertLength(occupied, empty.length, "the same region, sample for sample");
  assertGreaterThan(
    regionDistance(empty, occupied),
    0,
    "the drone changed the region it occupies",
  );
  const drone = await sampleColor(h, 400, 300);
  assertGreaterThan(colorDistance(drone, field), 0, "the drone's own colour");
  await h.debug.removeDrone(id);

  // A cue sounds on the frame the fire action is delivered, once audio is armed
  // with a genuine browser gesture. What is read is that a sound was emitted and
  // when; the NAME is unobservable under this engine and nothing asserts it.
  await h.armAudio();
  const played = watchCues(h);
  const soundsBefore = await h.sounds();
  await h.tap("Space");
  assertGreaterThanOrEqual(played.length, 1, "a sound on the fire frame");
  assertGreaterThan(
    await h.sounds(),
    soundsBefore,
    "the raw sound count moved",
  );
});

it("measures a drawn sprite against the seeded art", async () => {
  const seeded = await seededSprites();
  assertLength(Object.keys(seeded), 4, "the four seeded sprites");
  for (const sprite of Object.values(seeded)) {
    assertEqual(sprite.width, SPRITE_SIZE, `${sprite.file}: its width`);
    assertEqual(sprite.height, SPRITE_SIZE, `${sprite.file}: its height`);
    assertEqual(
      sprite.silhouette.length,
      SPRITE_SIZE * SPRITE_SIZE,
      `${sprite.file}: its silhouette`,
    );
    assertGreaterThan(
      silhouetteArea(sprite.silhouette),
      0,
      `${sprite.file}: pixels it actually draws`,
    );
  }

  await startPosed(h);
  await poseDrone(h, "shard", 400, 300, { band: "cyan" });
  await poseDrone(h, "prism", 800, 300, { band: "magenta" });
  const blits = await blitsOfFrame(h);

  const shard = blitsNear(blits, { x: 400, y: 300 }, SHARD_SIZE);
  assertGreaterThanOrEqual(shard.length, 1, "a blit centred on the Shard");
  assertEqual(shard[0].captured, true, "the recorder captured its source");
  // The reference bakes a per-band copy of the seeded art, so what is compared
  // is the SHAPE. A self-check rather than a validator, so the number here pins
  // the harness's own measurement, not the case's requirement.
  assertGreaterThan(
    shard[0].agreement.shard,
    0.99,
    "the Shard's blit carries assets/shard.png's silhouette",
  );
  assertCloseTo(shard[0].width, SHARD_SIZE, 0, "the destination box's width");

  const prism = blitsNear(blits, { x: 800, y: 300 }, SHARD_SIZE);
  assertGreaterThanOrEqual(prism.length, 1, "a blit centred on the Prism");
  assertGreaterThan(
    prism[0].agreement.prism,
    0.99,
    "the Prism's blit carries assets/prism.png's silhouette",
  );
});

it("reads the seeded burst system off the workspace's assets", async () => {
  const system = seededBurstSystem();
  assertEqual(seededBurstSystem(), system, "parsed once per worker and shared");

  // It really simulates: a tenth of a second in, the one-shot is holding
  // particles, which is the reading a burst point compares a live burst's own
  // count against.
  const sim = new ParticleSimulator(system, { seed: 1 });
  sim.step(100);
  assertGreaterThan(sim.liveCount, 0, "live particles a tenth of a second in");
  assertEqual(
    sim.capture().length,
    sim.liveCount,
    "the particles it reports back",
  );
});

it("observes the overlay through Backquote and the draw recorder", async () => {
  await startPosed(h);
  await poseDrone(h, "shard", 400, 300, { band: "cyan" });
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
    drewText(overlaid, "inWave"),
    "the overlay names the current screen",
  );

  // And watching it is a pure read: the game-facing state is as it was.
  const after = await h.snapshot();
  assertEqual(after.screen, before.screen);
  assertDeepEqual(after.drones, before.drones);
  assertDeepEqual(after.ship, before.ship);

  await toggleOverlay(h);
  const cleared = await h.frameCalls();
  assertLessThanOrEqual(
    drawnText(cleared).length,
    drawnText(bare).length,
    "toggling again hides the overlay",
  );
});

it("writes a still and a replay under the media directory", async () => {
  const mediaDir = mkdtempSync(join(tmpdir(), "spectra-media-"));
  const hadMediaDir = process.env[MEDIA_DIR_ENV];
  process.env[MEDIA_DIR_ENV] = mediaDir;
  try {
    await startPosed(h);
    await poseDrone(h, "prism", 600, 300, { band: "cyan" });
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
      // a discharge point record the wave rather than the wait before it.
      await h.skip(0.5);
      await h.advance(12);
      return "returned";
    });
    assertEqual(value, "returned", "the scenario's own value comes back");

    const raw = readFileSync(join(mediaDir, SUITE_DIR, "replay-check.json.gz"));
    const recording = JSON.parse(gunzipSync(raw).toString("utf8")) as Recording;
    assertEqual(recording.width, STAGE_W);
    assertEqual(recording.height, STAGE_H);
    assertLength(recording.frames, 12, "one recorded frame per driven frame");
    assertGreaterThan(recording.ops.length, 0, "the frames carry operations");
  } finally {
    if (hadMediaDir === undefined) delete process.env[MEDIA_DIR_ENV];
    else process.env[MEDIA_DIR_ENV] = hadMediaDir;
    rmSync(mediaDir, { recursive: true, force: true });
  }
});

it("holds the ship in its lane while it drives a real key", async () => {
  await startPosed(h);
  const before = await h.snapshot();
  await h.holdFor("ArrowLeft", framesFor(0.5));
  const after = await h.snapshot();
  assertGreaterThan(
    before.ship.x - after.ship.x,
    0,
    "the ship moved left under a held key",
  );
});
