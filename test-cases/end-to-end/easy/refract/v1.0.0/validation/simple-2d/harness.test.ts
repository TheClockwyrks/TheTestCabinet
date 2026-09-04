// harness — self-checks for the shared machinery the suites in this directory
// stand on.
//
// The suites next door are validators: each decides one review point against
// the build. This file decides nothing about the build. It proves, against the
// reference implementation, that the harness's own seams work: the surface is
// really reachable off `engine.debug`, a posed board and a traced route really
// reach the game, the course and cascade walkers really solve boards, the
// pixel, text, and cue readings return something sane, and the two evidence
// writers really put files where the runner collects them. A harness broken in
// any of these ways would fail every suite with a message about the build, and
// this file is what catches that before it can.
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
import { TITLE_TEXT } from "./constants";
import { GEO_3X3 } from "./fixtures";
import {
  captureReplay,
  captureStill,
  clearColor,
  colorDistance,
  createHarness,
  drewText,
  driveCourse,
  loadBoard,
  resetTo,
  sampleBackground,
  sampleColor,
  solveGenerated,
  startCampaign,
  startCascade,
  toggleOverlay,
  watchCues,
  nodeCenter,
  traceCells,
  type Harness,
} from "./harness";
import { parseBoard } from "./notation";
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

it("reaches the surface the reference returned beside its state", () => {
  const api = h.engine.debug as unknown as Record<string, unknown>;
  expect(typeof api).toBe("object");
  expect(api).not.toBeNull();
  expect(api.version).toBe(REFRACT_DEBUG_VERSION);
  for (const op of REQUIRED_OPS) {
    expect(typeof api[op], op).toBe("function");
  }
});

it("poses a fixture board through loadBoard", async () => {
  await resetTo(h, 1);
  await loadBoard(h, GEO_3X3);

  const want = parseBoard(GEO_3X3);
  const snapshot = h.snapshot();
  expect(snapshot.screen).toBe("playing");
  expect(snapshot.board.cols).toBe(want.cols);
  expect(snapshot.board.rows).toBe(want.rows);
  const got = snapshot.board.nodes
    .map((n) => `${n.col},${n.row}:${n.kind}:${n.channel}:${n.charges}`)
    .sort();
  const expected = want.nodes
    .map((n) => `${n.col},${n.row}:${n.kind}:${n.channel}:${n.charges}`)
    .sort();
  expect(got).toEqual(expected);
});

it("draws a route: the snapshot and the canvas both change", async () => {
  await resetTo(h, 1);
  await loadBoard(h, GEO_3X3);
  const before = h.ctx.getImageData(0, 0, h.canvas.width, h.canvas.height);

  traceCells(h, [
    { col: 0, row: 0 },
    { col: 1, row: 1 },
  ]);
  await h.advance(1);

  const snapshot = h.snapshot();
  expect(snapshot.beams.triangle?.cells).toEqual([
    { col: 0, row: 0 },
    { col: 1, row: 1 },
  ]);
  const after = h.ctx.getImageData(0, 0, h.canvas.width, h.canvas.height);
  expect(Buffer.from(after.data).equals(Buffer.from(before.data))).toBe(false);
});

it("driveCourse(2) really solves the first two campaign boards", async () => {
  await resetTo(h, 1);
  await startCampaign(h);
  const snapshot = await driveCourse(h, 2);

  expect(snapshot.screen).toBe("solved");
  expect(snapshot.mode).toBe("campaign");
  expect(snapshot.solvedBoards).toEqual([0, 1]);
  expect(snapshot.unlockedCount).toBeGreaterThanOrEqual(3);
});

it("solveGenerated(2) really solves two generated cascade boards", async () => {
  await resetTo(h, 1);
  await startCascade(h);
  const snapshot = await solveGenerated(h, 2);

  expect(snapshot.screen).toBe("solved");
  expect(snapshot.mode).toBe("cascade");
  expect(snapshot.solvedCount).toBe(2);
});

it("samples pixels: a posed node reads against the bench", async () => {
  await resetTo(h, 1);
  await loadBoard(h, GEO_3X3);

  const background = sampleBackground(h);
  for (const channel of ["r", "g", "b"] as const) {
    expect(background[channel]).toBeGreaterThanOrEqual(0);
    expect(background[channel]).toBeLessThanOrEqual(255);
  }
  // The lens at (1,1) is a filled form at its cell centre (specs/board.md), so
  // its cluster reads apart from the bare bench on any conformant build.
  const centre = nodeCenter(1, 1, 3, 3);
  const lens = sampleColor(h, centre.x, centre.y);
  expect(colorDistance(lens, background)).toBeGreaterThan(0);
  // And the rasterized clear colour is a colour at all.
  const clear = clearColor();
  expect(Number.isFinite(clear.r + clear.g + clear.b)).toBe(true);
});

it("reads text draws: the title frame draws TITLE_TEXT", async () => {
  await resetTo(h, 1);
  h.calls.length = 0;
  await h.advance(1);
  expect(drewText(h.calls, TITLE_TEXT)).toBe(true);
});

it("reads the overlay's text off the recorded context", async () => {
  await resetTo(h, 1);
  await loadBoard(h, GEO_3X3);
  h.calls.length = 0;
  await h.advance(1);
  const withoutOverlay = h.calls.filter(
    (call) => call.kind === "call" && call.method === "fillText",
  ).length;

  h.calls.length = 0;
  await toggleOverlay(h);
  const withOverlay = h.calls.filter(
    (call) => call.kind === "call" && call.method === "fillText",
  ).length;

  // The engine draws one line per registered diagnostic source plus its own
  // metrics line, all through the context this harness records.
  expect(withOverlay).toBeGreaterThan(withoutOverlay);

  // Toggle it back off so no other reading inherits the panel.
  await toggleOverlay(h);
});

it("captures cues, stamped with the frame they played on", async () => {
  // The plumbing is proven over the REAL pointer path: a player's segment add
  // plays the connect cue from the update that reads the sample, and the
  // handler stamps it with that frame's own count. This self-check drives that
  // path because its job is to prove the capture machinery, not to decide the
  // cue point, which the audio suites own.
  await resetTo(h, 1);
  await loadBoard(h, GEO_3X3);
  const played = watchCues(h);

  const a = nodeCenter(0, 0, 3, 3);
  const b = nodeCenter(1, 1, 3, 3);
  h.pointer("pointerdown", a.x, a.y);
  await h.advance(1);
  h.pointer("pointermove", b.x, b.y);
  await h.advance(1);
  h.pointer("pointerup", b.x, b.y);
  await h.advance(1);

  expect(played.length).toBeGreaterThan(0);
  const first = played[0];
  expect(typeof first.cue).toBe("string");
  expect(typeof first.gain).toBe("number");
  expect(first.frame).toBeGreaterThan(0);
  expect(first.frame).toBeLessThanOrEqual(h.engine.frame().count);
});

it("writes a still where the runner collects it", async () => {
  await resetTo(h, 1);
  await loadBoard(h, GEO_3X3);
  captureStill(h, "state");

  expect(written()).toEqual(["state.png"]);
  const bytes = readFileSync(join(mediaDir, SUITE_DIR, "state.png"));
  // The PNG signature, read off the bytes rather than off the name.
  expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
});

it("writes a replay as gzip, and hands the scenario's value back", async () => {
  await resetTo(h, 1);
  await loadBoard(h, GEO_3X3);

  const value = await captureReplay(h, "drawn", async () => {
    traceCells(h, [
      { col: 0, row: 0 },
      { col: 1, row: 1 },
    ]);
    await h.advance(4);
    return 4;
  });

  expect(value).toBe(4);
  expect(written()).toEqual(["drawn.json.gz"]);
  const bytes = readFileSync(join(mediaDir, SUITE_DIR, "drawn.json.gz"));
  // A gzip member opens 0x1f 0x8b (RFC 1952).
  expect([bytes[0], bytes[1]]).toEqual([0x1f, 0x8b]);
  const recording = JSON.parse(gunzipSync(bytes).toString("utf8")) as {
    format: number;
    frames: unknown[];
  };
  expect(recording.format).toBeGreaterThan(0);
  expect(recording.frames.length).toBeGreaterThan(0);
});

it("writes nothing at all for a section that drew no frames", async () => {
  await captureReplay(h, "nothing", () => undefined);
  expect(written()).toEqual([]);
});
