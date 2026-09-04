// harness — self-checks for the shared machinery the suites in this directory
// stand on.
//
// The suites next door are validators: each decides one review point against
// the build. This file decides nothing about the build. It proves the
// HARNESS's own load-bearing pieces against the reference implementation,
// because each is invisible from inside a suite and wrong in ways nothing else
// catches: a surface the harness cannot reach fails every suite at once, a
// course walk that does not really solve boards poses nothing, a solver sweep
// that cannot crack a generated board stalls the cascade suites, and media
// written in the wrong framing reaches the console as something it cannot
// read.
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
import { CUES, TITLE_TEXT } from "./constants";
import {
  canvasPixels,
  captureReplay,
  captureStill,
  clearCues,
  createHarness,
  cuesNamed,
  drawnText,
  drewText,
  driveCourse,
  loadBoard,
  pixelsChanged,
  resetTo,
  sampleBackground,
  sampleColor,
  solveGenerated,
  toggleOverlay,
  traceCells,
  type Harness,
} from "./harness";
import { GEO_3X3 } from "./fixtures";
import { cellCenter } from "./notation";
import { REFRACT_DEBUG_VERSION, REQUIRED_OPS } from "./surface";

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
  mediaDir = mkdtempSync(join(tmpdir(), "refract-media-"));
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
  expect(api.version).toBe(REFRACT_DEBUG_VERSION);
  for (const op of REQUIRED_OPS) {
    expect(typeof api[op], op).toBe("function");
  }
});

it("poses a fixture through loadBoard, exactly as the oracle parses it", async () => {
  await resetTo(h, 1);
  const oracle = await loadBoard(h, GEO_3X3);

  const board = h.snapshot().board;
  expect(board.cols).toBe(oracle.cols);
  expect(board.rows).toBe(oracle.rows);
  expect(board.nodes).toHaveLength(oracle.nodes.length);
  for (const node of oracle.nodes) {
    const posed = board.nodes.find(
      (candidate) => candidate.col === node.col && candidate.row === node.row,
    );
    expect(posed, `node at (${node.col}, ${node.row})`).toBeDefined();
    expect(posed?.kind).toBe(node.kind);
    expect(posed?.channel).toBe(node.channel);
    expect(posed?.charges).toBe(node.charges);
    const center = cellCenter(node.col, node.row, oracle.cols, oracle.rows);
    expect(posed?.x).toBeCloseTo(center.x, 6);
    expect(posed?.y).toBeCloseTo(center.y, 6);
  }
});

it("draws through trace: the snapshot and the canvas both move", async () => {
  await resetTo(h, 1);
  await loadBoard(h, GEO_3X3);
  const before = canvasPixels(h);

  // T(0,0) to t(1,1): one legal diagonal segment, short of solving.
  traceCells(h, [
    { col: 0, row: 0 },
    { col: 1, row: 1 },
  ]);
  const snapshot = h.snapshot();
  expect(snapshot.beams.triangle?.cells).toEqual([
    { col: 0, row: 0 },
    { col: 1, row: 1 },
  ]);
  expect(snapshot.solved).toBe(false);

  await h.advance(1);
  expect(pixelsChanged(before, canvasPixels(h))).toBeGreaterThan(0);
});

it("really solves campaign boards: driveCourse(2)", async () => {
  const entered = await driveCourse(h, 2, 1);

  expect(entered).toHaveLength(2);
  expect(entered[0].boardIndex).toBe(0);
  expect(entered[1].boardIndex).toBe(1);
  const after = h.snapshot();
  expect(after.screen).toBe("solved");
  expect(after.solvedBoards).toContain(0);
  expect(after.solvedBoards).toContain(1);
  expect(after.unlockedCount).toBeGreaterThanOrEqual(3);
});

it("really solves generated boards: solveGenerated(2, 1)", async () => {
  const swept = await solveGenerated(h, 2, 1);

  expect(swept).toHaveLength(2);
  const after = h.snapshot();
  expect(after.mode).toBe("cascade");
  expect(after.screen).toBe("solved");
  expect(after.solvedCount).toBe(2);
});

it("samples pixels, finds text draws, and hears cues", async () => {
  // Text: the title frame draws the case-fixed copy.
  await resetTo(h, 1);
  h.calls.length = 0;
  await h.advance(1);
  expect(drewText(h.calls, TITLE_TEXT)).toBe(true);

  // Pixels: a posed node's centre and the bare bench both read as colours.
  await loadBoard(h, GEO_3X3);
  const node = sampleColor(
    h,
    cellCenter(1, 1, 3, 3).x,
    cellCenter(1, 1, 3, 3).y,
  );
  const bench = sampleBackground(h);
  for (const value of [node.r, node.g, node.b, bench.r, bench.g, bench.b]) {
    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(255);
  }

  // Cues: a segment added plays the connect cue on its frame (specs/ui.md).
  clearCues(h);
  traceCells(h, [
    { col: 0, row: 0 },
    { col: 1, row: 1 },
  ]);
  await h.advance(1);
  expect(cuesNamed(h, CUES.connect).length).toBeGreaterThanOrEqual(1);
});

it("observes the diagnostics overlay through the recorded context", async () => {
  await resetTo(h, 1);
  await loadBoard(h, GEO_3X3);

  h.calls.length = 0;
  await h.advance(1);
  const bare = drawnText(h.calls);

  // Backquote toggles the engine-owned overlay; its column draws through the
  // same recorded context, so new text runs appear — the engine's own world
  // line among them.
  h.calls.length = 0;
  await toggleOverlay(h);
  const overlaid = drawnText(h.calls);
  expect(overlaid.length).toBeGreaterThan(bare.length);
  expect(overlaid.some((text) => text.startsWith("level:"))).toBe(true);

  // And toggling again takes it back down.
  h.calls.length = 0;
  await toggleOverlay(h);
  const down = drawnText(h.calls);
  expect(down.some((text) => text.startsWith("level:"))).toBe(false);
});

it("writes a still and a replay under the suite's own address", async () => {
  await resetTo(h, 1);
  await loadBoard(h, GEO_3X3);
  captureStill(h, "posed");

  await captureReplay(h, "flight", async () => {
    traceCells(h, [
      { col: 0, row: 0 },
      { col: 1, row: 1 },
    ]);
    await h.advance(4);
  });

  expect(written()).toEqual(["flight.json.gz", "posed.png"]);

  // The still is a PNG: the eight-byte signature opens the file.
  const png = readFileSync(join(mediaDir, SUITE_DIR, "posed.png"));
  expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);

  // The replay is really gzip-framed (RFC 1952), and the document inside holds
  // the frames the section drew.
  const bytes = readFileSync(join(mediaDir, SUITE_DIR, "flight.json.gz"));
  expect([bytes[0], bytes[1]]).toEqual([0x1f, 0x8b]);
  const recording = JSON.parse(gunzipSync(bytes).toString("utf8")) as {
    format: number;
    frames: unknown[];
  };
  expect(recording.format).toBeGreaterThan(0);
  expect(recording.frames.length).toBeGreaterThan(0);
});
