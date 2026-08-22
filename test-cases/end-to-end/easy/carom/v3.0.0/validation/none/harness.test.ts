// harness — the replay capture the suites in this directory record their evidence
// with.
//
// The suites next door are validators: each decides one review point against the
// build. This file decides nothing about the build. It checks the harness's own
// `captureReplay`, because two of its rules are invisible from inside a suite and
// wrong in ways nothing else catches. A recording written in the wrong framing
// reaches the console as something it cannot read, and a recording written for a
// section that drew nothing is reported to the reviewer as evidence that exists.
//
// It also checks the two things that are the browser's rather than the format's:
// that a frame the recorder keeps is one frame the GAME ran, and that the frames
// are the ones the check's own section drove rather than whatever the page's own
// animation loop painted while nobody was looking.
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
import { FIELD_H, FIELD_W, COLOR } from "./constants";
import {
  captureReplay,
  createHarness,
  startPlaying,
  type Harness,
} from "./harness";

/** The environment variable the runner names the media directory in. */
const MEDIA_DIR_ENV = "TCAB_VALIDATION_MEDIA_DIR";

/**
 * Where this file's own outputs land: the staged project directory, then the
 * suite's path within the project, which for this file is its own name.
 */
const SUITE_DIR = join("validation", "harness.test.ts");

interface WrittenRecording {
  format: number;
  width: number;
  height: number;
  background: string | null;
  frames: { count: number; deltaMs: number; ops: unknown[] }[];
}

let mediaDir: string;
let collecting: string | undefined;
let h: Harness;

beforeEach(async () => {
  collecting = process.env[MEDIA_DIR_ENV];
  mediaDir = mkdtempSync(join(tmpdir(), "carom-replay-"));
  process.env[MEDIA_DIR_ENV] = mediaDir;
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
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

/** The recording written under `name`, read back off disk. */
function readBack(name: string): WrittenRecording {
  const bytes = readFileSync(join(mediaDir, SUITE_DIR, name));
  // The framing read off the bytes rather than off the name: a gzip member opens
  // `0x1f 0x8b` (RFC 1952), so this is the capture actually being compressed
  // rather than named as though it were.
  expect([bytes[0], bytes[1]]).toEqual([0x1f, 0x8b]);
  return JSON.parse(gunzipSync(bytes).toString("utf8")) as WrittenRecording;
}

it("writes a captured section as gzip, under both extensions", async () => {
  await captureReplay(h, "flight", () => h.advance(4));

  expect(written()).toEqual(["flight.json.gz"]);
  const recording = readBack("flight.json.gz");
  expect(recording.format).toBeGreaterThan(0);
  expect(recording.frames.length).toBeGreaterThan(0);
  // The design size and background the console's player opens the canvas at.
  expect(recording.width).toBe(FIELD_W);
  expect(recording.height).toBe(FIELD_H);
  expect(recording.background).toBe(COLOR.bg);
});

it("keeps one recorded frame per frame the game ran", async () => {
  // The page keeps rendering while the game is off the wall clock, so a recorder
  // bracketing on the animation frame would keep frames nobody drove and lose the
  // ones a driven `advance` produced. Every frame here is bracketed around one
  // `advance`, inside one crossing into the page, so the two counts agree exactly.
  await startPlaying(h);
  await captureReplay(h, "counted", () => h.advance(12));

  const recording = readBack("counted.json.gz");
  expect(recording.frames).toHaveLength(12);
  for (const frame of recording.frames) {
    expect(frame.ops.length).toBeGreaterThan(0);
  }
});

it("writes nothing at all for a section that drew no frames", async () => {
  // A scenario that runs no frame closes no frame, so there is no picture to
  // write. Leaving the file unwritten reports the output absent, which is the
  // truthful answer; a file holding an empty frame list would tell the reviewer
  // there is a replay to watch and then open a player on nothing.
  await captureReplay(h, "nothing", () => undefined);

  expect(written()).toEqual([]);
});

it("hands the scenario's own value back", async () => {
  // Capture sits beside a check's assertions rather than in place of them, so
  // what the scenario computed has to survive being recorded.
  const frames = await captureReplay(h, "value", async () => {
    await h.advance(2);
    return 2;
  });

  expect(frames).toBe(2);
  expect(written()).toEqual(["value.json.gz"]);
});

it("keeps the whole of an over-long section, at a lower frame rate", async () => {
  // Far more frames than a written recording holds. What comes back covers the
  // whole section — the last frame driven is in it — rather than its opening.
  await startPlaying(h);
  await captureReplay(h, "long", () => h.advance(1500));

  const recording = readBack("long.json.gz");
  expect(recording.frames.length).toBeGreaterThan(1);
  expect(recording.frames.length).toBeLessThanOrEqual(300);
  const counts = recording.frames.map((frame) => frame.count);
  expect([...counts].sort((a, b) => a - b)).toEqual(counts);
  // The deltas are restated against the frame kept before, so they still sum to
  // the section's elapsed time however many frames were dropped between them.
  const elapsed = recording.frames.reduce((sum, f) => sum + f.deltaMs, 0);
  expect(elapsed).toBeCloseTo((1500 * 1000) / 120, 3);
});
