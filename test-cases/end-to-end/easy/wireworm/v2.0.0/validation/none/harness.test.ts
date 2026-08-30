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
//   - THE REACH. `createHarness` really finds `window.__wireworm` on the built
//     site, it carries every operation `REQUIRED_OPS` names, and it answers.
//   - THE POSES. `startPlaying` really leaves an empty, quiet, live board;
//     `poseWorm` lays exactly the chain it was given and the worm the surface
//     reports back is the one that then steps; `poseFoe`, `poseNodes` and
//     `shootTile` each put the board in the state the suites assume of them.
//   - THE CLOCK. `advance` runs exactly the frames it is asked for, and
//     `framesForSteps` really carries a worm through exactly that many steps —
//     the one piece of arithmetic in this project that a floating-point
//     accumulator could round either way. `skip` covers game time off camera.
//   - THE CHANNELS. A pixel sample, a text-draw query, a sprite match and a cue
//     capture each return something sane, and the overlay is observable through
//     its fixed Backquote binding plus the draw recorder.
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
  BAND_CX,
  BAND_CY,
  CHARGE_MAX,
  CURSOR_FRAMES,
  GLITCH_FRAMES,
  NODE_FRAMES,
  TILE,
  TITLE_TEXT,
  tileCX,
  tileCY,
  WORM_FRAMES,
  CORRUPTOR_FRAMES,
  DROPPER_FRAMES,
} from "./constants";
import {
  blitsOfFrame,
  captureReplay,
  captureStill,
  colorDistance,
  createHarness,
  drawnFrom,
  drewText,
  drawnText,
  driveSteps,
  failSurface,
  framesFor,
  framesForSteps,
  headOf,
  lastWorm,
  nodeAt,
  poseFoe,
  poseNodes,
  poseWorm,
  REQUIRED_OPS,
  requireWorm,
  sampleBoard,
  sampleTile,
  seededFrames,
  shootTile,
  startPlaying,
  textDraws,
  toggleOverlay,
  watchCues,
  WIREWORM_DEBUG_VERSION,
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
  assertEqual(probed.version, WIREWORM_DEBUG_VERSION);
  for (const op of REQUIRED_OPS) {
    assertEqual(probed.ops[op], "function", op);
  }

  // And it is live rather than merely present: a posed node reads back.
  await h.debug.setNode(7, 7, 2);
  assertEqual(nodeAt(await h.snapshot(), 7, 7)?.charge, 2);
});

it("startPlaying leaves an empty, quiet, live board", async () => {
  // Something on every roster and every gate open, so the helper has work to do.
  await h.debug.setNode(4, 4, 1);
  await poseWorm(h, { c: 20, r: 3, length: 3 });
  await poseFoe(h, "glitch", 10, 10);
  await h.debug.addBolt(tileCX(5), tileCY(15));
  await h.debug.setLevel(6);

  await startPlaying(h, { level: 3 });
  const snapshot = await h.snapshot();

  assertEqual(snapshot.screen, "playing");
  assertEqual(snapshot.phase, "active");
  assertEqual(snapshot.phaseTimer, 0);
  assertEqual(snapshot.level, 3);
  assertLength(snapshot.nodes, 0, "nodes");
  assertLength(snapshot.worms, 0, "worms");
  assertLength(snapshot.foes, 0, "foes");
  assertLength(snapshot.bolts, 0, "bolts");
  assertEqual(snapshot.foeSpawning, false, "the foe-spawning gate");
  assertEqual(snapshot.wormEntry, false, "the worm-entry gate");
  assertEqual(snapshot.cursor.contact, false, "the cursor's contact gate");
  assertEqual(snapshot.cursor.x, BAND_CX);
  assertEqual(snapshot.cursor.y, BAND_CY);
  assertEqual(snapshot.cursor.invulnerable, 0);
  assertEqual(snapshot.fireCooldown, 0);
});

it("poseWorm lays exactly the chain it was given, and it is the one that steps", async () => {
  await startPlaying(h);
  const id = await poseWorm(h, {
    c: 20,
    r: 5,
    length: 4,
    dh: 1,
    dv: 1,
    body: false,
  });

  const posed = requireWorm(await h.snapshot(), id, "poseWorm");
  assertDeepEqual(
    posed.segments,
    [
      { c: 20, r: 5 },
      { c: 19, r: 5 },
      { c: 18, r: 5 },
      { c: 17, r: 5 },
    ],
    "the chain, head first, laid behind the head against its heading",
  );
  assertEqual(posed.dh, 1);
  assertEqual(posed.dv, 1);
  assertEqual(posed.body, false, "the body faculty the spec posed");
  assertEqual(
    posed.stepping,
    true,
    "the step faculty, left as addWorm gives it",
  );
  assertEqual(lastWorm(await h.snapshot())?.id, id, "appended to the roster");

  // With the body held, one step moves the head one tile and nothing else.
  await driveSteps(h, 1);
  const stepped = requireWorm(await h.snapshot(), id, "one step");
  assertDeepEqual(headOf(stepped), { c: 21, r: 5 }, "the head after one step");
  assertDeepEqual(
    stepped.segments.slice(1),
    posed.segments.slice(1),
    "the trailing segments, held",
  );
});

it("framesForSteps carries a worm through exactly that many steps", async () => {
  await startPlaying(h);
  const id = await poseWorm(h, { c: 2, r: 5, length: 1, body: false });

  // Five steps along a clear row, then five more: the count is what a check that
  // wants a worm N tiles further along depends on, and a build's accumulator
  // must not be able to round it either way.
  await h.advance(framesForSteps(5));
  assertDeepEqual(
    headOf(requireWorm(await h.snapshot(), id, "five steps")),
    { c: 7, r: 5 },
    "the head after five steps",
  );
  await driveSteps(h, 5);
  assertDeepEqual(
    headOf(requireWorm(await h.snapshot(), id, "ten steps")),
    { c: 12, r: 5 },
    "the head after five more",
  );
});

it("advance runs exactly the frames it is asked for, and skip covers time off camera", async () => {
  await startPlaying(h);
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

it("poseFoe, poseNodes and shootTile put the board where the suites assume", async () => {
  await startPlaying(h);

  // A glitch standing still eats the node under it: travel off, mind on.
  await poseNodes(h, [[10, 12, 0]]);
  await poseFoe(h, "glitch", 10, 12, { travel: false });
  const foe = (await h.snapshot()).foes[0];
  assertEqual(foe.travel, false, "the travel faculty");
  assertEqual(foe.mind, true, "the mind faculty");
  assertCloseTo(foe.x, tileCX(10), 6, "the foe's centre x");
  assertCloseTo(foe.y, tileCY(12), 6, "the foe's centre y");
  await h.advance(framesFor(0.2));
  assertEqual(nodeAt(await h.snapshot(), 10, 12), undefined, "the eaten node");

  // A bolt fired from the tile below an inert node clears it.
  await poseNodes(h, [[8, 10, 0]]);
  const shot = await shootTile(h, 8, 10);
  assertEqual(shot.hit, true, "the bolt resolved");
  assertEqual(nodeAt(shot.snapshot, 8, 10), undefined, "the node it cleared");
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

  // A posed node reads apart from the bare board it stands on.
  await startPlaying(h);
  await poseNodes(h, [[10, 6, CHARGE_MAX]]);
  await h.advance(1);
  const bare = await sampleBoard(h);
  const node = await sampleTile(h, 10, 6);
  assertGreaterThan(colorDistance(node, bare), 0, "a critical node's colour");

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

it("matches drawn sprites against the seeded art, mirroring included", async () => {
  const seeded = await seededFrames();
  assertLength(
    seeded,
    NODE_FRAMES +
      WORM_FRAMES +
      CURSOR_FRAMES +
      GLITCH_FRAMES +
      DROPPER_FRAMES +
      CORRUPTOR_FRAMES,
    "seeded frames read off the workspace's assets/",
  );

  await startPlaying(h);
  await poseNodes(h, [[10, 6, 0]]);
  const right = await poseWorm(h, {
    c: 20,
    r: 8,
    length: 2,
    dh: 1,
    stepping: false,
  });
  const left = await poseWorm(h, {
    c: 30,
    r: 12,
    length: 2,
    dh: -1,
    stepping: false,
  });
  const blits = await blitsOfFrame(h);

  const drawnNode = drawnFrom(
    blits,
    "node",
    { x: tileCX(10), y: tileCY(6) },
    TILE / 2,
  );
  assertGreaterThanOrEqual(
    drawnNode.length,
    1,
    "a node drawn from assets/node/",
  );

  const rightHead = headOf(requireWorm(await h.snapshot(), right, "the scene"));
  const leftHead = headOf(requireWorm(await h.snapshot(), left, "the scene"));
  const rightBlits = drawnFrom(
    blits,
    "worm",
    { x: tileCX(rightHead.c), y: tileCY(rightHead.r) },
    TILE / 2,
  );
  const leftBlits = drawnFrom(
    blits,
    "worm",
    { x: tileCX(leftHead.c), y: tileCY(leftHead.r) },
    TILE / 2,
  );
  assertGreaterThanOrEqual(rightBlits.length, 1, "the rightward head's draw");
  assertGreaterThanOrEqual(leftBlits.length, 1, "the leftward head's draw");
  assertEqual(rightBlits[0].flipX, false, "a rightward head is not mirrored");
  assertEqual(leftBlits[0].flipX, true, "a leftward head is mirrored");
  assertCloseTo(leftBlits[0].width, TILE, 0, "the mirrored box's width");
});

it("observes the overlay through Backquote and the draw recorder", async () => {
  await startPlaying(h);
  await poseNodes(h, [[12, 9, 1]]);
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
  assertDeepEqual(after.nodes, before.nodes);
  assertDeepEqual(after.worms, before.worms);
  assertDeepEqual(after.cursor, before.cursor);

  await toggleOverlay(h);
  const cleared = await h.frameCalls();
  assertLessThanOrEqual(
    drawnText(cleared).length,
    drawnText(bare).length,
    "toggling again hides the overlay",
  );
});

it("writes a still and a replay under the media directory", async () => {
  const mediaDir = mkdtempSync(join(tmpdir(), "wireworm-media-"));
  const hadMediaDir = process.env[MEDIA_DIR_ENV];
  process.env[MEDIA_DIR_ENV] = mediaDir;
  try {
    await startPlaying(h);
    await poseNodes(h, [[15, 7, CHARGE_MAX]]);
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
      // a discharge point record the burst rather than the wait before it.
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
