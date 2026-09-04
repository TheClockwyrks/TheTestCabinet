// harness — self-checks for the shared machinery the suites in this directory
// stand on.
//
// The suites next door are validators: each decides one review point against the
// build. This file decides nothing about the build. It proves the HARNESS's own
// load-bearing pieces against the reference implementation, because each is
// invisible from inside a suite and wrong in ways nothing else catches: a surface
// the harness cannot reach fails every suite at once, a `startPosed` that leaves a
// gate open pollutes every scenario posed on it, an id read from the wrong end of
// a roster addresses the wrong entity, a sprite shim that does not serve the
// seeded tree grades every art check against fallback shapes, a silhouette
// comparison that resamples wrongly fails a build that drew exactly the provided
// art, and media written in the wrong framing reaches the console as something it
// cannot read.
//
// No review item names this file, so a run never loads it. It runs with the whole
// project, which is how a case author runs these suites while writing them:
//
//   npx vitest run --config validation/vitest.config.ts

import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  BURST_DURATION,
  CUES,
  DIVE_FIRST_DELAY,
  ENEMY_BULLET_SPEED,
  PLAYER_BULLET_SPEED,
  RESONANCE_MAX,
  SHARD_HALF,
  SHIP_X_MAX,
  SPECTRA_DEBUG_VERSION,
  STAGE_W,
  START_LIVES,
  TITLE_TEXT,
  slotX,
  slotY,
} from "./constants";
import {
  canvasPixels,
  captureReplay,
  captureStill,
  clearCues,
  colorDistance,
  createHarness,
  cuesNamed,
  distanceBetween,
  drawnImages,
  drawnText,
  drawnTextSpans,
  drawOps,
  drewText,
  drewWord,
  droneById,
  droneFootprint,
  enemyBullets,
  expectedLiveParticles,
  fireAt,
  fireAtShip,
  holdFor,
  imagesNear,
  litDrone,
  LANE_CENTER,
  nearestSeededSprite,
  pixelsChanged,
  paintedFraction,
  playerBullets,
  poseDrone,
  poseFormation,
  regionDistance,
  regionPixels,
  resetTo,
  sampleField,
  seededBurstSystem,
  silhouetteMatch,
  SHIP_LANE_Y,
  slotCenter,
  startPosed,
  startRun,
  startStage,
  tapAction,
  ticksFor,
  toggleOverlay,
  watchCues,
  type Harness,
} from "./harness";
import { REQUIRED_OPS } from "./surface";

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
  mediaDir = mkdtempSync(join(tmpdir(), "spectra-media-"));
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
  expect(api.version).toBe(SPECTRA_DEBUG_VERSION);
  for (const op of REQUIRED_OPS) {
    expect(typeof api[op], op).toBe("function");
  }
});

it("resets to the title without advancing a frame", () => {
  h.debug.setScreen("inWave");
  h.debug.setScore(4321);
  h.debug.setStage(6);
  h.debug.setResonance(RESONANCE_MAX);
  poseDrone(h, "shard", 400, 200);

  resetTo(h, 7);

  const s = h.snapshot();
  expect(s.screen).toBe("title");
  expect(s.phase).toBe("live");
  expect(s.score).toBe(0);
  expect(s.lives).toBe(START_LIVES);
  expect(s.stage).toBe(1);
  expect(s.resonance).toBe(0);
  expect(s.inversion).toBe(0);
  expect(s.drones).toHaveLength(0);
  expect(s.bullets).toHaveLength(0);
  expect(s.bursts).toHaveLength(0);
  expect(s.simTime).toBe(0);
  // The three world gates come back on, whatever a scenario left them at.
  expect(s.waveEntry).toBe(true);
  expect(s.diveLaunching).toBe(true);
  expect(s.ship.contact).toBe(true);
});

it("poses an empty, quiet field with startPosed", async () => {
  startPosed(h);

  const posed = h.snapshot();
  expect(posed.screen).toBe("inWave");
  expect(posed.phase).toBe("live");
  expect(posed.stage).toBe(1);
  expect(posed.drones).toHaveLength(0);
  expect(posed.bullets).toHaveLength(0);
  expect(posed.bursts).toHaveLength(0);
  expect(posed.waveEntry).toBe(false);
  expect(posed.diveLaunching).toBe(false);
  expect(posed.ship.contact).toBe(false);
  expect(posed.ship.x).toBeCloseTo(LANE_CENTER, 6);
  expect(posed.ship.lockout).toBe(0);
  expect(posed.ship.cooldown).toBe(0);
  expect(posed.diveClock).toBe(0);

  // Quiet holds while the game runs. With the gates off, no entry group arrives
  // and no dive is launched over more than the first delay, and the stage does
  // not clear underneath the scenario either.
  await h.advance(ticksFor(DIVE_FIRST_DELAY * 1.5));
  const after = h.snapshot();
  expect(after.drones).toHaveLength(0);
  expect(after.bullets).toHaveLength(0);
  expect(after.screen).toBe("inWave");
  expect(after.stage).toBe(1);
});

it("poses a drone as a prop, and lets the rules drive it once asked", async () => {
  startPosed(h);
  const slot = slotCenter(4, 2);
  const id = poseDrone(h, "flux", slot.x, slot.y, {
    band: "magenta",
    phase: "formation",
    slot,
  });

  const posed = droneById(h.snapshot(), id);
  expect(posed).toBeDefined();
  expect(posed?.kind).toBe("flux");
  expect(posed?.band).toBe("magenta");
  expect(posed?.phase).toBe("formation");
  expect(posed?.slotX).toBeCloseTo(slot.x, 6);
  expect(posed?.slotY).toBeCloseTo(slot.y, 6);
  // Every faculty is off, which is what makes a posed drone a prop.
  expect(posed?.travel).toBe(false);
  expect(posed?.oscillation).toBe(false);
  expect(posed?.fire).toBe(false);

  // A prop holds its exact centre and its exact band for a whole second.
  await h.advanceSeconds(1);
  const still = droneById(h.snapshot(), id);
  expect(still?.x).toBeCloseTo(slot.x, 6);
  expect(still?.y).toBeCloseTo(slot.y, 6);
  expect(still?.band).toBe("magenta");
  expect(still?.bandClock).toBeCloseTo(0, 6);

  // And the build's own rules are what move it, once the check asks for one.
  h.debug.setDroneOscillation(id, true);
  await h.advanceSeconds(0.5);
  expect(droneById(h.snapshot(), id)?.bandClock).toBeGreaterThan(0);
});

it("lays a formation on the slot grid, in the order it was given", () => {
  startPosed(h);
  const ids = poseFormation(h, [
    { kind: "shard", col: 0, row: 0 },
    { kind: "flux", col: 4, row: 1, band: "magenta" },
    { kind: "prism", col: 8, row: 2, shell: false },
  ]);

  expect(ids).toHaveLength(3);
  const s = h.snapshot();
  expect(s.drones.map((drone) => drone.id)).toEqual(ids);

  const first = droneById(s, ids[0]);
  expect(first?.x).toBeCloseTo(slotX(0), 6);
  expect(first?.y).toBeCloseTo(slotY(0), 6);
  expect(first?.phase).toBe("formation");

  expect(droneById(s, ids[1])?.band).toBe("magenta");
  expect(droneById(s, ids[2])?.shellAlive).toBe(false);
});

it("places bullets both ways, and flies one into a drone", async () => {
  startPosed(h);
  const drone = poseDrone(h, "shard", 500, 300, { band: "cyan" });

  // An enemy bullet down the ship's own lane, and the ship's contact gate off,
  // so the shot is the only thing the scenario is about.
  const enemy = await fireAtShip(h, "magenta", 40, 1);
  const flying = enemyBullets(h.snapshot()).find(
    (bullet) => bullet.id === enemy,
  );
  expect(flying?.friendly).toBe(false);
  expect(flying?.band).toBe("magenta");
  expect(flying?.vy).toBeGreaterThan(0);
  expect(Math.abs(flying!.vy)).toBeCloseTo(ENEMY_BULLET_SPEED, 0);
  h.debug.clearEnemyBullets();

  // A matching shot fired from below, run for exactly as long as it takes to
  // cross the drone's half-extent. It is the build's from the moment it lands:
  // the real collision code is what resolves it.
  const below = 60;
  const frames = ticksFor((below + SHARD_HALF) / PLAYER_BULLET_SPEED);
  await fireAt(h, 500, 300, "cyan", below, frames);
  expect(droneById(h.snapshot(), drone)).toBeUndefined();
  expect(playerBullets(h.snapshot())).toHaveLength(0);
  // The kill left a burst behind, which the seeded system plays.
  expect(h.snapshot().bursts.length).toBeGreaterThan(0);
});

it("serves the seeded art to a headless host, silhouettes and all", async () => {
  startPosed(h);
  const id = poseDrone(h, "shard", 600, 300);
  h.calls.length = 0;
  await h.advance(1);

  expect(h.assetFailures).toEqual([]);

  const drone = droneById(h.snapshot(), id)!;
  const blits = imagesNear(h, drone.x, drone.y, droneFootprint("shard"));
  expect(blits.length, "a bitmap blitted on the Shard").toBeGreaterThan(0);
  expect(blits[0].w).toBeCloseTo(droneFootprint("shard"), 0);

  // The build blitted the provided art: its alpha silhouette is the file's.
  expect(await silhouetteMatch(blits[0].source, "shard")).toBeGreaterThan(0.99);
  // And it is that file rather than one of the other three.
  const match = await nearestSeededSprite(blits[0].source);
  expect(match.name).toBe("shard");
  expect(match.distance).toBeLessThan(1);
});

it("reads the seeded drone-burst's own emitters", () => {
  const system = seededBurstSystem();
  expect(system.field.width).toBeGreaterThan(0);
  expect(system.emitters.length).toBeGreaterThan(0);
  // Every emitter is alive a tenth of a second in; none of them by the time the
  // effect's whole duration has passed.
  expect(expectedLiveParticles(system, 0.1)).toBeGreaterThan(0);
  expect(expectedLiveParticles(system, system.durationMs / 1000 + 1)).toBe(0);
  expect(BURST_DURATION).toBeGreaterThan(0);
});

it("drives the real input path: menus, holds, and the cues they play", async () => {
  // The menu moves through the registered action, and says so.
  resetTo(h, 1);
  const played = watchCues(h);
  await tapAction(h, "down");
  expect(h.snapshot().menuIndex).toBe(1);
  expect(played.filter((cue) => cue.cue === CUES.menu).length).toBe(1);
  expect(played[0].frame).toBeGreaterThan(0);

  // Confirming the title's first item opens the run on its stage intro.
  await startRun(h, 1);
  expect(h.snapshot().screen).toBe("stageIntro");

  // A held key moves the ship, at the build's own rate against our clock.
  startPosed(h);
  const from = h.snapshot().ship.x;
  await holdFor(h, "ArrowRight", ticksFor(0.25));
  const moved = h.snapshot().ship.x;
  expect(moved).toBeGreaterThan(from);
  expect(moved).toBeLessThanOrEqual(SHIP_X_MAX);
  // And the release lands: the next frames move it no further.
  await h.advance(10);
  expect(h.snapshot().ship.x).toBeCloseTo(moved, 6);

  // Firing plays its cue and puts a bullet up, through the same action path.
  clearCues(h);
  h.debug.setFireCooldown(0);
  await holdFor(h, "Space", 2);
  expect(cuesNamed(h, CUES.fire).length).toBeGreaterThanOrEqual(1);
  expect(playerBullets(h.snapshot()).length).toBeGreaterThanOrEqual(1);
});

it("builds the stage's own wave with startStage", async () => {
  resetTo(h, 3);
  await startStage(h, 1);

  const opened = h.snapshot();
  expect(opened.screen).toBe("inWave");
  expect(opened.stage).toBe(1);
  // The wave is built as the intro gives way, so the drones exist immediately.
  expect(opened.drones.length).toBeGreaterThan(0);
  expect(opened.drones.every((drone) => drone.travel)).toBe(true);
});

it("samples pixels and finds the text a frame drew", async () => {
  // Text: the title frame draws the case-fixed copy, as a standalone token.
  resetTo(h, 1);
  h.calls.length = 0;
  await h.advance(1);
  expect(drewText(h.calls, TITLE_TEXT)).toBe(true);
  expect(drewWord(h.calls, TITLE_TEXT)).toBe(true);
  // A token that only APPEARS inside a drawn word is not that word.
  expect(drewWord(h.calls, `${TITLE_TEXT}X`)).toBe(false);

  // Text is placed in logical units, whatever transform the build drew under.
  const title = drawnTextSpans(h).find((span) =>
    span.text.toLowerCase().includes(TITLE_TEXT.toLowerCase()),
  );
  expect(title, "the title copy, placed").toBeDefined();
  expect(title!.left).toBeLessThan(title!.right);
  expect(title!.x).toBeGreaterThanOrEqual(0);
  expect(title!.x).toBeLessThanOrEqual(STAGE_W);

  // Pixels: a drone reads as a colour, told apart from the field behind it, and
  // the frame that drew it changed the canvas.
  startPosed(h);
  await h.advance(1);
  const before = canvasPixels(h);
  const field = sampleField(h);
  const id = poseDrone(h, "shard", 700, 300, { band: "magenta" });
  await h.advance(1);
  expect(pixelsChanged(before, canvasPixels(h))).toBeGreaterThan(0);
  const drone = litDrone(h, droneById(h.snapshot(), id)!);
  expect(colorDistance(drone, field)).toBeGreaterThan(0);
  for (const channel of [drone.r, drone.g, drone.b]) {
    expect(Number.isFinite(channel)).toBe(true);
    expect(channel).toBeGreaterThanOrEqual(0);
    expect(channel).toBeLessThanOrEqual(255);
  }

  // A frame with something on the field issues geometry, and the ship sits in
  // the lane every ship sample looks down.
  expect(drawOps(h.calls)).toBeGreaterThan(0);
  expect(
    distanceBetween({ x: LANE_CENTER, y: SHIP_LANE_Y }, { x: 0, y: 0 }),
  ).toBeGreaterThan(0);
});

it("observes the diagnostics overlay through the recorded context", async () => {
  startPosed(h);
  h.calls.length = 0;
  await h.advance(1);
  const bare = drawnText(h.calls);

  // The overlay key toggles the engine-owned overlay; the sources the build
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

it("writes a still and a replay under the suite's own address", async () => {
  startPosed(h);
  poseFormation(h, [
    { kind: "shard", col: 3, row: 1 },
    { kind: "prism", col: 5, row: 1 },
  ]);
  await h.advance(1);
  captureStill(h, "posed");

  await captureReplay(h, "shot", async () => {
    await fireAt(h, slotX(3), slotY(1), "cyan", 120, ticksFor(0.3));
  });

  expect(written()).toEqual(["posed.png", "shot.json.gz"]);

  // The still is a PNG: the eight-byte signature opens the file.
  const png = readFileSync(join(mediaDir, SUITE_DIR, "posed.png"));
  expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);

  // The replay is really gzip-framed (RFC 1952), and the document inside holds
  // the frames the section drew.
  const bytes = readFileSync(join(mediaDir, SUITE_DIR, "shot.json.gz"));
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
  startPosed(h);

  const value = await captureReplay(h, "unused", async () => {
    await h.advance(2);
    return "the scenario's own value";
  });
  captureStill(h, "unused");

  expect(value).toBe("the scenario's own value");
  expect(written()).toEqual([]);
});

it("hands a scenario's failure on, and still writes what it recorded", async () => {
  startPosed(h);
  poseDrone(h, "shard", 400, 240);

  await expect(
    captureReplay(h, "failing", async () => {
      await h.advance(6);
      throw new Error("the check's own failure");
    }),
  ).rejects.toThrow("the check's own failure");

  expect(written()).toEqual(["failing.json.gz"]);
});

it("sweeps with until, and drives the engine's own loop with runFor", async () => {
  startPosed(h);
  const id = poseDrone(h, "shard", 300, 200, { phase: "diving", travel: true });

  // `until` samples the game as it runs and reports where it stopped.
  const found = await h.until((s) => (droneById(s, id)?.y ?? 0) > 260, {
    maxFrames: ticksFor(2),
    poll: 4,
  });
  expect(found.hit).toBe(true);
  expect(found.frames).toBeGreaterThan(0);
  expect(droneById(found.snapshot, id)?.y).toBeGreaterThan(260);

  // A sweep that never sees its predicate reports so rather than hanging.
  const missed = await h.until((s) => s.screen === "gameOver", {
    maxFrames: 8,
  });
  expect(missed.hit).toBe(false);
  expect(missed.frames).toBe(8);

  // `runFor` hands the engine its own frame loop for a stretch of real time.
  const before = h.engine.frame().count;
  await h.runFor(60);
  expect(h.engine.frame().count).toBeGreaterThan(before);
});

it("maps a blit's destination back to logical units under any transform", async () => {
  startPosed(h);
  const drone = poseDrone(h, "prism", 640, 300);
  h.calls.length = 0;
  await h.advance(1);

  const posed = droneById(h.snapshot(), drone)!;
  const near = drawnImages(h).filter(
    (image) => distanceBetween(image, posed) < droneFootprint("prism"),
  );
  expect(near.length).toBeGreaterThan(0);
  for (const image of near) {
    expect(Number.isFinite(image.x)).toBe(true);
    expect(image.w).toBeGreaterThan(0);
    expect(image.h).toBeGreaterThan(0);
  }
});

it("reads regions, and reads them the same through a fit and a density", async () => {
  startPosed(h);
  const at = { x: 700, y: 300 };
  const size = droneFootprint("shard");
  await h.advance(1);

  // The empty box, and the same box with a drone standing in it.
  const bare = regionPixels(h, at.x, at.y, size, size);
  const id = poseDrone(h, "shard", at.x, at.y, { band: "cyan" });
  await h.advance(1);
  const drawn = regionPixels(h, at.x, at.y, size, size);

  expect(bare.length).toBe(drawn.length);
  expect(regionDistance(bare, drawn)).toBeGreaterThan(0);
  // A region compared with itself is identical, and one of another size is not
  // comparable at all.
  expect(regionDistance(drawn, drawn)).toBe(0);
  expect(
    regionDistance(drawn, regionPixels(h, at.x, at.y, size * 2, size)),
  ).toBe(Infinity);

  // The drone painted part of its own box over the field behind it, and the
  // empty box painted none of it.
  const field = sampleField(h);
  expect(paintedFraction(drawn, field, 20)).toBeGreaterThan(0);
  expect(paintedFraction(bare, field, 200)).toBe(0);

  // The same scene through a letterboxed fit at twice the device density reads
  // the same drone in the same place: every reading maps through the viewport.
  const fitted = await createHarness({
    cssWidth: 900,
    cssHeight: 700,
    dpr: 2,
  });
  try {
    startPosed(fitted);
    const other = poseDrone(fitted, "shard", at.x, at.y, { band: "cyan" });
    await fitted.advance(1);
    const blits = imagesNear(fitted, at.x, at.y, size);
    expect(blits.length).toBeGreaterThan(0);
    expect(blits[0].w).toBeCloseTo(size, 0);
    expect(
      colorDistance(
        litDrone(fitted, droneById(fitted.snapshot(), other)!),
        litDrone(h, droneById(h.snapshot(), id)!),
      ),
    ).toBeLessThan(60);
  } finally {
    fitted.dispose();
  }
});
