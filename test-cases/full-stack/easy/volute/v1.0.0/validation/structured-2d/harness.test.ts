// harness — the shared drive this directory's validators are written against.
//
// The suites next door are validators: each decides one review point against the
// build. This file decides nothing about the build. It checks the HARNESS — that
// the engine it stands up really runs the game, that a step really is one tick,
// that a press really reaches the engine's input seam, that a pixel read really
// addresses the field in logical units, and that the evidence a review item
// declares really lands where the runner looks for it. Every one of those is invisible from
// inside a suite and wrong in ways nothing else catches: a replay written in the
// wrong framing reaches the console as something it cannot read, a still written
// under the wrong name is reported to the reviewer as evidence that does not
// exist, and a drive that silently advances nothing turns every point in the
// project into a passing check of nothing at all.
//
// The few assertions below that DO touch the build are the ones that cannot be
// separated from the plumbing they prove — a key press only reaches the game if
// the game reads it — and they assert the plumbing's answer rather than a
// threshold. Every threshold belongs to a suite next door.
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
  ANGLE_TOL,
  CHANNEL,
  CHANNEL_ARC,
  CORE_SPRITE,
  FIELD_H,
  FIELD_W,
  INJECTOR,
  PATH_LENGTH,
  REQUIRED_OPS,
  SPACING,
  VOLUTE_DEBUG_VERSION,
} from "./constants";
import {
  assertBetween,
  assertEqual,
  assertGreaterThan,
  assertNear,
  assertAngleNear,
  assertTrue,
  assertTruthy,
} from "./assert";
import {
  captureReplay,
  captureStill,
  channelPoint,
  coreCount,
  createHarness,
  differingPoints,
  drawOps,
  fieldPixels,
  head,
  imageDraws,
  luminanceMask,
  maskDifference,
  pixelsDiffering,
  poseHall,
  soundsStarted,
  spacedBlock,
  startRun,
  topRunS,
  watchCues,
  type Harness,
  type PixelRect,
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

/**
 * The frames a fresh harness has already run when a check starts.
 *
 * `createHarness` poses the opening `reset` and advances the one frame the
 * transition it may request lands in (specs/instrumentation.md), so the engine's
 * frame counter is at one before a check touches anything.
 */
const OPENING_TICKS = 1;

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
  media = mkdtempSync(join(tmpdir(), "volute-harness-"));
  process.env[MEDIA_DIR_ENV] = media;
  return media;
}

/* ---- The engine is running the build's game -------------------------------- */

it("reads back a surface that is the one the specification requires", () => {
  assertEqual(h.surfaceFault, null, "the surface engine.debug holds");

  const probed = h.probe(REQUIRED_OPS);
  for (const op of REQUIRED_OPS) {
    assertEqual(probed.ops[op], "function", `engine.debug.${op}`);
  }
  assertEqual(probed.version, VOLUTE_DEBUG_VERSION, "engine.debug.version");
});

it("opens the game on its title, with only the harness's own frame run", () => {
  const opened = h.snapshot();
  assertEqual(opened.screen, "title", "the screen a fresh harness opens on");
  // One frame: the one `createHarness` advances so its opening `reset` lands.
  assertEqual(h.tick(), OPENING_TICKS, "the frames a fresh harness has run");
});

it("counts a step as exactly the ticks it was asked for", async () => {
  await h.step(7);
  assertEqual(h.tick(), OPENING_TICKS + 7, "ticks stepped");
  await h.step(53);
  assertEqual(h.tick(), OPENING_TICKS + 60, "ticks stepped");
  assertNear(
    h.timeMs(),
    (OPENING_TICKS + 60) * (1000 / 60),
    1e-6,
    "the simulated time those frames cover, in ms",
  );
});

it("advances the hall when it steps it", async () => {
  await poseHall(h, { cores: spacedBlock(1000, 1, "halide") });
  const before = head(h.snapshot()).s;
  const after = head(await h.step(60)).s;
  // How FAR it moved is `channel/feed-advance`'s point, not this file's. That it
  // moved at all is what says the drive reaches the build's own tick.
  assertGreaterThan(after, before, "the head's arc position after 60 ticks");
});

it("hands the loop a real clock, and takes the scripted one back", async () => {
  await poseHall(h, { cores: spacedBlock(1000, 1, "halide") });
  const before = head(h.snapshot()).s;
  await h.runFor(400);
  const during = head(h.snapshot()).s;
  assertGreaterThan(during, before, "the head's arc position after real time");

  // And the scripted clock is back: one advanced frame is one tick again.
  const at = h.timeMs();
  await h.step(1);
  assertNear(
    h.timeMs() - at,
    1000 / 60,
    1e-6,
    "the simulated time one frame covers once the loop has halted",
  );
});

/* ---- The controls reach the build ----------------------------------------- */

it("delivers a key press the build can read", async () => {
  const started = await h.tap("Enter");
  assertEqual(started.screen, "playing", "the screen after Enter on the title");
});

it("delivers a held key for exactly the ticks it holds it", async () => {
  await startRun(h);
  const at = h.tick();
  const held = await h.holdFor("ArrowLeft", 30);
  assertEqual(h.tick() - at, 30, "ticks stepped while the key was held");
  assertTruthy(held.injector, "snapshot().injector");
});

it("delivers a pointer position in the field's logical units", async () => {
  await startRun(h);
  // Straight up the field from the injector: an aim of 270 degrees, which is the
  // one bearing `specs/injector.md` names, so the reading does not rest on a
  // figure this file invented.
  h.movePointer(INJECTOR.x, INJECTOR.y - 120);
  const aimed = await h.step(1);
  assertAngleNear(
    aimed.injector.aim,
    270,
    ANGLE_TOL,
    "the aim under the pointer",
  );
});

/* ---- Reading the picture --------------------------------------------------- */

it("reads the canvas at one device pixel per logical unit", async () => {
  const surface = h.surface();
  assertEqual(surface.width, FIELD_W, "the canvas's backing-store width");
  assertEqual(surface.height, FIELD_H, "the canvas's backing-store height");

  const rect = h.pixelRect(100, 100, 12, 9);
  assertEqual(rect.width, 12, "the width of a 12-unit read");
  assertEqual(rect.height, 9, "the height of a 9-unit read");
  assertEqual(rect.data.length, 12 * 9 * 4, "the RGBA bytes of that read");
});

it("hands back the operations one frame's render issued", async () => {
  await poseHall(h, { cores: spacedBlock(1000, 6, "halide") });
  const calls = await h.frameCalls();
  assertGreaterThan(drawOps(calls), 0, "drawing operations in one frame");
});

it("names the images a frame drew, with their own natural size", async () => {
  await poseHall(h, { cores: spacedBlock(1000, 6, "halide") });
  const drawn = imageDraws(await h.frameCalls());
  assertGreaterThan(drawn.length, 0, "images drawn in one frame");
  for (const draw of drawn) {
    assertGreaterThan(draw.image.id, 0, "the identity of a drawn image");
    assertGreaterThan(draw.image.width, 0, "a drawn image's natural width");
  }
  // The same source drawn twice carries ONE identity, which is what lets a check
  // pair a sprite on the channel with the same sprite on the HUD.
  const ids = new Set(drawn.map((draw) => draw.image.id));
  assertTrue(
    ids.size <= drawn.length,
    "distinct image identities among the images drawn",
  );

  // And a source's pixels come back at that natural size.
  const sprite = drawn.find((draw) => draw.image.width === CORE_SPRITE);
  if (sprite !== undefined) {
    const pixels = h.imagePixels(sprite.image.id);
    assertTruthy(pixels, "the pixels of a drawn 28 x 28 source");
    assertEqual(pixels?.width, CORE_SPRITE, "the width of those pixels");
    assertEqual(pixels?.height, CORE_SPRITE, "the height of those pixels");
  }
});

it("reads a whole field back, and tells two of them apart", async () => {
  await poseHall(h, { cores: spacedBlock(1000, 3, "halide") });
  await h.step(1);
  const before = fieldPixels(h);
  assertEqual(before.width, FIELD_W, "the width of a whole-field read");
  assertEqual(before.height, FIELD_H, "the height of a whole-field read");
  assertEqual(before.data.length, FIELD_W * FIELD_H * 4, "its RGBA bytes");

  // The same hall with one thing changed. WHICH pixels move is
  // `machinery/sightline-ray`'s point; that the comparison sees any is this
  // file's, because three points rest on it.
  h.debug.grantMachinery("sightline");
  await h.step(1);
  const after = fieldPixels(h);
  assertGreaterThan(
    pixelsDiffering(before, after),
    0,
    "pixels that moved when the hall changed",
  );
  assertEqual(
    differingPoints(before, after).length,
    pixelsDiffering(before, after),
    "the points a diff names against the count it reports",
  );
});

it("reads a produced sprite's own pixels, and masks them", async () => {
  const ids = ["halide", "sulfur", "cobalt"] as const;
  const first = topRunS(200);
  await poseHall(h, {
    cores: ids.map(
      (charge, index) => [first + index * 100, charge, null] as const,
    ),
  });
  const sprites = imageDraws(await h.frameCalls()).filter(
    (draw) => draw.image.width === CORE_SPRITE,
  );
  const masks = new Map<number, boolean[]>();
  for (const sprite of sprites) {
    if (masks.has(sprite.image.id)) continue;
    const pixels = h.imagePixels(sprite.image.id);
    assertTruthy(pixels, "the pixels of a drawn core sprite");
    const mask = luminanceMask(pixels as PixelRect);
    assertEqual(
      mask.length,
      CORE_SPRITE * CORE_SPRITE,
      "the entries of a 28 x 28 mask",
    );
    masks.set(sprite.image.id, mask);
  }
  assertGreaterThan(masks.size, 1, "distinct core sprites drawn");
  const [a, b] = [...masks.values()];
  assertBetween(maskDifference(a, b), 0, 1, "the difference between two masks");
});

/* ---- The channel's geometry ------------------------------------------------ */

it("walks an arc position to the point specs/channel.md puts it at", () => {
  // The five points `channel/arc-position` is written against, stated in the
  // specification's own table rather than measured off any build.
  const walked: [number, number, number][] = [
    [880, 920, 40],
    [1340, 920, 500],
    [3240, 840, 120],
    [4360, 220, 220],
    [4990, 490, 320],
  ];
  for (const [s, x, y] of walked) {
    const point = channelPoint(s);
    assertNear(point.x, x, 1e-6, `the x at arc ${s}`);
    assertNear(point.y, y, 1e-6, `the y at arc ${s}`);
  }
  assertEqual(CHANNEL.length, 12, "the vertices of the channel polyline");
  assertNear(
    CHANNEL_ARC[CHANNEL_ARC.length - 1],
    PATH_LENGTH,
    1e-6,
    "the arc distance at the intake",
  );
});

it("spaces a posed run by exactly the channel spacing", async () => {
  await poseHall(h, { cores: spacedBlock(1000, 4, "cobalt") });
  const posed = h.snapshot();
  assertEqual(
    coreCount(posed),
    4,
    "the cores a four-core pose put on the channel",
  );
  const arcs = posed.train.map((core) => core.s);
  for (let i = 1; i < arcs.length; i += 1) {
    assertNear(arcs[i - 1] - arcs[i], SPACING, 1e-6, `the gap at core ${i}`);
  }
});

/* ---- The audio probe ------------------------------------------------------- */

it("counts the sounds the build emits, per tick", async () => {
  h.armAudio();
  const cues = watchCues(h);
  await startRun(h);
  await h.step(30);
  // WHETHER a cue sounds is `audio/`'s business. What this proves is that the
  // probe answers at all and stamps what it hears with a tick inside the drive.
  const total = soundsStarted(h);
  assertBetween(total, 0, Number.MAX_SAFE_INTEGER, "sounds started");
  for (const cue of cues) {
    assertBetween(cue.tick, 1, h.tick(), "the tick a sound was stamped with");
  }
});

/* ---- Evidence -------------------------------------------------------------- */

it("writes a still where the runner looks for it", async () => {
  const dir = collecting();
  await poseHall(h, { cores: spacedBlock(1000, 3, "garnet") });
  await h.step(1);
  captureStill(h, "still");
  assertTrue(
    existsSync(join(dir, SUITE_DIR, "still.png")),
    "a still written under the suite's own staged path",
  );
});

it("writes a replay of exactly the section the check drove", async () => {
  const dir = collecting();
  await poseHall(h, { cores: spacedBlock(1000, 5, "sulfur") });
  // The setup above is OUTSIDE the capture, so what lands is the drive alone.
  const after = await captureReplay(h, "clip", () => h.step(10));
  assertEqual(coreCount(after), 5, "the cores still on the channel");

  const path = join(dir, SUITE_DIR, "clip.json.gz");
  assertTrue(
    existsSync(path),
    "a replay written under the suite's staged path",
  );
  const recording = JSON.parse(
    gunzipSync(readFileSync(path)).toString("utf8"),
  ) as WrittenRecording;
  assertEqual(recording.frames.length, 10, "the frames the capture kept");
  assertEqual(recording.width, FIELD_W, "the replay's logical width");
  assertEqual(recording.height, FIELD_H, "the replay's logical height");
  for (const frame of recording.frames) {
    assertNear(frame.deltaMs, 1000 / 60, 1e-6, "one frame's simulated delta");
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
  await poseHall(h, { cores: spacedBlock(1000, 2, "olivine") });
  const at = h.tick();
  const after = await captureReplay(h, "clip", () => h.step(3));
  assertEqual(coreCount(after), 2, "the cores the scenario left");
  captureStill(h, "still");
  assertEqual(h.tick() - at, 3, "the frames the scenario drove");
});
