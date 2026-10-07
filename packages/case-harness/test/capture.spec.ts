// The evidence a review point is decided on: what `captureReplay` and
// `captureStill` write, and — the part nothing else can see — what they refuse to
// write.
//
// These rules are invisible from inside a suite and wrong in ways nothing else
// catches. A recording written in the wrong framing reaches the console as
// something it cannot play; a recording written for a section that drove nothing
// is reported to the reviewer as evidence that exists; a `skip` that quietly
// recorded its march would spend a clip's whole budget getting to the scenario
// and leave the scenario itself on the cutting-room floor.

import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  DEFAULT_REPLAY_BACKGROUND,
  MAX_REPLAY_FRAMES,
  MEDIA_DIR_ENV,
  STAGED_PROJECT_DIR,
  type Recording,
} from "../src/index";
import {
  STAGE,
  TICK_MS,
  captureReplay,
  captureStill,
  createHarness,
  type Harness,
} from "./fixture";

/**
 * Where this file's own outputs land: the staged project directory, then the
 * suite's path within the project, which for this file is its own name.
 */
const SUITE_DIR = join(STAGED_PROJECT_DIR, "capture.spec.ts");

let mediaDir: string;
let collecting: string | undefined;
let h: Harness;

beforeEach(async () => {
  collecting = process.env[MEDIA_DIR_ENV];
  mediaDir = mkdtempSync(join(tmpdir(), "case-harness-media-"));
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
function readBack(name: string): Recording {
  const bytes = readFileSync(join(mediaDir, SUITE_DIR, name));
  // The framing read off the bytes rather than off the name: a gzip member opens
  // `0x1f 0x8b` (RFC 1952), so this is the capture actually being compressed
  // rather than merely named as though it were.
  expect([bytes[0], bytes[1]]).toEqual([0x1f, 0x8b]);
  return JSON.parse(gunzipSync(bytes).toString("utf8")) as Recording;
}

it("writes a captured section as gzip, at the address the runner collects", async () => {
  await captureReplay(h, "opening", () => h.advance(4));

  expect(written()).toEqual(["opening.json.gz"]);
  const recording = readBack("opening.json.gz");
  expect(recording.format).toBeGreaterThan(0);
  // The design the console's player opens its canvas at: the harness's own
  // viewport and the case's configured ground, never a case constant.
  expect(recording.width).toBe(STAGE.width);
  expect(recording.height).toBe(STAGE.height);
  expect(recording.background).toBe(DEFAULT_REPLAY_BACKGROUND);
});

it("keeps one recorded frame per frame the game ran", async () => {
  // The page keeps rendering while the game is off the wall clock
  // (`specs/instrumentation.md`: drawing is unaffected either way), so a recorder
  // bracketing on the animation frame would keep frames nobody drove and lose the
  // ones a driven step produced. Every frame is bracketed around one step inside
  // one crossing into the page, so the two counts agree exactly.
  await captureReplay(h, "counted", () => h.advance(12));

  const recording = readBack("counted.json.gz");
  expect(recording.frames).toHaveLength(12);
  for (const frame of recording.frames) {
    expect(frame.ops.length).toBeGreaterThan(0);
  }
});

it("closes no frame for a skipped march, and runs the same frames", async () => {
  // The whole reason both drives exist. A scenario reaches its subject by waiting
  // out a cooldown or settling a pose — seconds of simulation a reviewer has no
  // reason to watch. `skip` runs those frames for real and keeps none of them, so
  // the clip is the part the point is about.
  await captureReplay(h, "marched", async () => {
    await h.skip(240);
    await h.advance(5);
  });

  expect(readBack("marched.json.gz").frames).toHaveLength(5);
  expect((await h.snapshot()).frames).toBe(245);
  expect(h.frame()).toBe(245);
});

it("writes nothing at all for a section that drove no frame", async () => {
  // A scenario that runs no frame closes none, so there is no picture to write.
  // Leaving the file unwritten reports the output absent, which is the truthful
  // answer; a file holding an empty frame list would tell the reviewer there is a
  // replay to watch and then open the player on nothing.
  await captureReplay(h, "nothing", () => undefined);
  // A section made entirely of a march is the same case, and it is the one a
  // scenario reaches by accident.
  await captureReplay(h, "onlyskipped", () => h.skip(30));

  expect(written()).toEqual([]);
});

it("hands the scenario's own value back", async () => {
  // Capture sits beside a check's assertions rather than in place of them, so
  // what the scenario computed has to survive being recorded.
  const count = await captureReplay(h, "value", async () => {
    await h.advance(2);
    return 2;
  });

  expect(count).toBe(2);
  expect(written()).toEqual(["value.json.gz"]);
});

it("leaves the evidence behind when the scenario itself fails", async () => {
  // A failing check is the one whose replay a reviewer most wants, so the write
  // happens in a `finally` and the failure travels on untouched.
  await expect(
    captureReplay(h, "failed", async () => {
      await h.advance(3);
      throw new Error("the scenario's own failure");
    }),
  ).rejects.toThrow("the scenario's own failure");

  expect(written()).toEqual(["failed.json.gz"]);
  expect(readBack("failed.json.gz").frames).toHaveLength(3);
});

it("writes a still under its own name, beside no replay", async () => {
  await h.advance(1);
  await captureStill(h, "board");

  expect(written()).toEqual(["board.png"]);
  const bytes = readFileSync(join(mediaDir, SUITE_DIR, "board.png"));
  // A PNG opens with the eight-byte signature RFC 2083 fixes.
  expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
});

it("costs nothing when nobody is collecting", async () => {
  // Outside a run the media directory is unset and capture is a no-op that still
  // runs the scenario — so a check cannot pass in one place and fail in the other.
  delete process.env[MEDIA_DIR_ENV];
  const count = await captureReplay(h, "uncollected", async () => {
    await h.advance(3);
    return 3;
  });
  await captureStill(h, "uncollected");

  expect(count).toBe(3);
  expect(written()).toEqual([]);
});

it("keeps the whole of an over-long section, at a lower frame rate", async () => {
  // Far more frames than a written recording holds. What comes back covers the
  // whole section — the last frame driven is in it — rather than its opening.
  await captureReplay(h, "long", () => h.advance(1500));

  const recording = readBack("long.json.gz");
  expect(recording.frames.length).toBeGreaterThan(1);
  expect(recording.frames.length).toBeLessThanOrEqual(MAX_REPLAY_FRAMES);
  const counts = recording.frames.map((frame) => frame.count);
  expect([...counts].sort((a, b) => a - b)).toEqual(counts);
  // The deltas are restated against the frame kept before, so they still sum to
  // the section's elapsed time however many frames were dropped between them.
  const elapsed = recording.frames.reduce(
    (sum, frame) => sum + frame.deltaMs,
    0,
  );
  expect(elapsed).toBeCloseTo(1500 * TICK_MS, 3);
  // Frames are dropped twice over — in the page as the section runs, and again
  // when it is written — and each drop is the last reference to whatever only
  // that frame drew with. What is written names every entry of the tables it
  // carries, so nothing dropped is still being paid for.
  const named = new Set(recording.frames.flatMap((frame) => frame.ops));
  expect(named.size).toBe(recording.ops.length);
  const inherited = new Set(
    recording.frames.flatMap((frame) => [frame.state, ...frame.stack]),
  );
  expect(inherited.size).toBe(recording.states.length);
});
