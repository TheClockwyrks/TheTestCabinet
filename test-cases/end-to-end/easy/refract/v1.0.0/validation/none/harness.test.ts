// harness — self-checks for the shared scaffolding the suites in this directory
// stand on, run against the case's reference implementation.
//
// The suites next door are validators: each decides one review point against
// the build. This file decides nothing about any build. It proves that the
// harness's own machinery — the browser reach, the compound scenario helpers,
// the observation channels, and the evidence writers — really does what the
// suites assume of it, because a helper that silently does less would turn
// every point that leans on it into a wrong verdict with a confident face.
//
// What is pinned here, and why:
//
//   - THE REACH. `createHarness` really finds `window.__refract` on the built
//     site, and the surface answers.
//   - THE POSES. `loadBoard` puts exactly the notation it was handed into play,
//     and `traceCells` draws through the real pointer path, visible in both the
//     snapshot and the pixels.
//   - THE COMPOUND WALKS. `driveCourse` really solves campaign boards (campaign
//     progress has no pose, so every course suite rides on this), and
//     `solveGenerated` really cracks and solves generated cascade boards with
//     the spec-derived solver.
//   - THE CHANNELS. A pixel sample, a text-draw query, and a cue capture each
//     return something sane, and the overlay is observable through its fixed
//     Backquote binding plus the draw recorder.
//   - THE EVIDENCE. `captureStill` and `captureReplay` write real files under
//     the media directory, at the staged suite's address.
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
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertLength,
  assertLessThanOrEqual,
  assertTrue,
} from "./assert";
import { TITLE_TEXT } from "./constants";
import { R2_FOREIGN, R3_REDRAW } from "./fixtures";
import {
  boardFromSnapshot,
  captureReplay,
  captureStill,
  center,
  colorDistance,
  createHarness,
  drawnText,
  drewText,
  driveCourse,
  failSurface,
  loadBoard,
  mouseTrace,
  REFRACT_DEBUG_VERSION,
  REQUIRED_OPS,
  sampleColor,
  segmentMidpoint,
  solveGenerated,
  textDraws,
  toggleOverlay,
  traceCells,
  watchCues,
  type Harness,
  type Recording,
} from "./harness";
import { parseBoard, validateBoard } from "./notation";

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

it(`reaches the reference's surface, whole`, async () => {
  if (h.surfaceFault !== null) failSurface(h.surfaceFault);
  const probed = await h.probe(REQUIRED_OPS);
  assertEqual(probed.version, REFRACT_DEBUG_VERSION);
  for (const op of REQUIRED_OPS) {
    assertEqual(probed.ops[op], "function", op);
  }
});

it("loadBoard poses exactly the notation it was handed", async () => {
  // Two channels and a full 3x3 of kinds, so every column of the readback is
  // exercised: kind, channel, charges, and the cell-center formula.
  const posed = await loadBoard(h, R2_FOREIGN);
  const snapshot = await h.snapshot();

  assertEqual(snapshot.screen, "playing");
  assertEqual(snapshot.board.cols, posed.cols);
  assertEqual(snapshot.board.rows, posed.rows);
  assertLength(snapshot.board.nodes, posed.nodes.length, "nodes reported");

  const want = new Map(
    posed.nodes.map((node) => [`${node.col},${node.row}`, node]),
  );
  for (const node of snapshot.board.nodes) {
    const expected = want.get(`${node.col},${node.row}`);
    assertTrue(
      expected !== undefined,
      `a posed node at (${node.col}, ${node.row})`,
    );
    if (expected === undefined) continue;
    assertEqual(node.kind, expected.kind, `kind at (${node.col}, ${node.row})`);
    assertEqual(
      node.channel,
      expected.channel,
      `channel at (${node.col}, ${node.row})`,
    );
    assertEqual(
      node.charges,
      expected.charges,
      `charges at (${node.col}, ${node.row})`,
    );
    const at = center(posed, node);
    assertEqual(node.x, at.x, `x at (${node.col}, ${node.row})`);
    assertEqual(node.y, at.y, `y at (${node.col}, ${node.row})`);
  }
});

it("traceCells draws through the real pointer path, onto the canvas", async () => {
  const board = await loadBoard(h, R3_REDRAW);
  const midpoint = segmentMidpoint(
    board,
    { col: 0, row: 0 },
    { col: 1, row: 0 },
  );
  const bare = await sampleColor(h, midpoint.x, midpoint.y);

  await traceCells(h, [
    { col: 0, row: 0 },
    { col: 1, row: 0 },
  ]);
  const snapshot = await h.snapshot();
  assertDeepEqual(snapshot.beams.triangle?.cells, [
    { col: 0, row: 0 },
    { col: 1, row: 0 },
  ]);

  await h.advance(1);
  const drawn = await sampleColor(h, midpoint.x, midpoint.y);
  assertGreaterThan(colorDistance(drawn, bare), 0, "the segment's midpoint");
});

it("driveCourse really solves campaign boards", async () => {
  const walk = await driveCourse(h, 2);

  // Two boards entered, each fresh on arrival.
  assertLength(walk.entered, 2, "boards entered");
  assertEqual(walk.entered[0].boardIndex, 0);
  assertEqual(walk.entered[1].boardIndex, 1);
  for (const [index, snapshot] of walk.entered.entries()) {
    for (const beam of Object.values(snapshot.beams)) {
      assertLength(
        beam.cells,
        0,
        `board ${index + 1} entered with empty beams`,
      );
    }
  }

  // And really solved: the course's own progress moved, which nothing can pose.
  assertEqual(walk.final.screen, "solved");
  assertDeepEqual(walk.final.solvedBoards, [0, 1]);
  assertEqual(walk.final.unlockedCount, 3);
});

it("solveGenerated really solves generated cascade boards", async () => {
  const sweep = await solveGenerated(h, 2, 1);

  assertLength(sweep.boards, 2, "boards swept");
  for (const [index, verdict] of sweep.verdicts.entries()) {
    assertEqual(
      verdict.status,
      "solved",
      `solver verdict on board ${index + 1}`,
    );
  }
  for (const [index, board] of sweep.boards.entries()) {
    assertDeepEqual(
      validateBoard(board),
      [],
      `board ${index + 1} is a well-formed board`,
    );
  }
  assertEqual(sweep.afterSolve[0].solved, true, "first board solved");
  assertEqual(sweep.afterSolve[1].solved, true, "second board solved");
  assertEqual(sweep.afterSolve[1].solvedCount, 2);
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

  // A cue plays from update, off the pointer samples the build's own input
  // layer hands it (specs/ui.md) — so the move is made with the REAL mouse,
  // one driven frame per sample, after audio is armed with a real gesture.
  await h.armAudio();
  const board = await loadBoard(h, R3_REDRAW);
  const played = watchCues(h);
  const before = await h.sounds();
  await mouseTrace(h, board, [
    { col: 0, row: 0 },
    { col: 1, row: 0 },
  ]);
  assertGreaterThanOrEqual(played.length, 1, "a sound on the connect frame");
  assertGreaterThan(await h.sounds(), before, "the raw sound count moved");
});

it("observes the overlay through Backquote and the draw recorder", async () => {
  // The path the overlay item leans on: the runtime layer the build writes
  // toggles its read-only overlay on the backtick key
  // (specs/instrumentation.md), and what it draws lands on the recorded 2D
  // context like every other draw.
  const board = await loadBoard(h, R2_FOREIGN);
  const bare = await h.frameCalls();
  const snapshotBefore = await h.snapshot();

  await toggleOverlay(h);
  const overlaid = await h.frameCalls();

  // The overlay reports at least the screen and the board's dimensions among
  // its diagnostics, so the overlaid frame draws strictly more text and that
  // text names them.
  assertGreaterThan(
    drawnText(overlaid).length,
    drawnText(bare).length,
    "the overlay adds text draws",
  );
  assertTrue(
    drewText(overlaid, "playing"),
    "the overlay names the current screen",
  );
  assertTrue(
    drewText(overlaid, String(board.cols)),
    "the overlay names the board's cols",
  );

  // And watching it is a pure read: the game-facing state is exactly as it was.
  const snapshotAfter = await h.snapshot();
  assertEqual(snapshotAfter.screen, snapshotBefore.screen);
  assertDeepEqual(snapshotAfter.board, snapshotBefore.board);
  assertDeepEqual(snapshotAfter.beams, snapshotBefore.beams);
  assertDeepEqual(snapshotAfter.tracing, snapshotBefore.tracing);

  await toggleOverlay(h);
  const cleared = await h.frameCalls();
  assertLessThanOrEqual(
    drawnText(cleared).length,
    drawnText(bare).length,
    "toggling again hides the overlay",
  );
});

it("writes a still and a replay under the media directory", async () => {
  const mediaDir = mkdtempSync(join(tmpdir(), "refract-media-"));
  const hadMediaDir = process.env[MEDIA_DIR_ENV];
  process.env[MEDIA_DIR_ENV] = mediaDir;
  try {
    const board = await loadBoard(h, R3_REDRAW);

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
      await traceCells(h, [
        { col: 0, row: 0 },
        { col: 1, row: 0 },
      ]);
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
    assertEqual(board.cols, 3, "the fixture is the one posed");
  } finally {
    if (hadMediaDir === undefined) delete process.env[MEDIA_DIR_ENV];
    else process.env[MEDIA_DIR_ENV] = hadMediaDir;
    rmSync(mediaDir, { recursive: true, force: true });
  }
});

it("boardFromSnapshot restates the reported board as the library's", async () => {
  await loadBoard(h, R2_FOREIGN);
  const snapshot = await h.snapshot();
  const restated = boardFromSnapshot(snapshot);
  assertDeepEqual(restated, parseBoard(R2_FOREIGN));
});
