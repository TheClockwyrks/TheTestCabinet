// The replay a 2D engine's own recorder produces, and what is written from it.

import { gunzipSync } from "node:zlib";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  captureEngineReplay,
  makeReplayCapture,
  replayBytes,
  type EngineRecording,
  type RecordingEngine,
} from "../src/engine/replay";
import { MAX_REPLAY_FRAMES, type Recording } from "../src/replay/format";
import { MEDIA_DIR_ENV } from "../src/media";

const PROJECT_ROOT = new URL(".", import.meta.url).pathname.replace(/\/$/, "");

/** A recording of `count` frames, in the format the console's player reads. */
function recordingOf(count: number): EngineRecording {
  return {
    format: 1,
    width: 200,
    height: 100,
    background: null,
    images: [],
    resources: [],
    ops: [{ op: "call", method: "fillRect", args: [0, 0, 1, 1] }],
    states: [
      { properties: {}, transform: null, lineDash: null, clip: [], path: [] },
    ],
    frames: Array.from({ length: count }, (_unused, i) => ({
      count: i + 1,
      timeMs: (i + 1) * 16,
      deltaMs: 16,
      surface: { width: 200, height: 100 },
      state: 0,
      stack: [],
      ops: [0],
    })),
  };
}

/** An engine whose recorder answers whatever the spec handed it. */
function engineOver(recording: EngineRecording): RecordingEngine & {
  armed: number;
  stopped: number;
} {
  return {
    armed: 0,
    stopped: 0,
    startRecording() {
      this.armed += 1;
    },
    stopRecording() {
      this.stopped += 1;
      return recording;
    },
  };
}

it("a capture that closed no frames writes nothing at all", () => {
  expect(replayBytes(recordingOf(0))).toBeNull();
});

it("writes the document gzipped, and it inflates to what was recorded", () => {
  const bytes = replayBytes(recordingOf(3));
  const document = JSON.parse(
    gunzipSync(bytes as Uint8Array).toString("utf8"),
  ) as Recording;
  expect(document.format).toBe(1);
  expect(document.frames).toHaveLength(3);
  expect(document.frames[0]?.count).toBe(1);
});

it("an over-long section is thinned to the cap, keeping its last frame", () => {
  const bytes = replayBytes(recordingOf(MAX_REPLAY_FRAMES * 3));
  const document = JSON.parse(
    gunzipSync(bytes as Uint8Array).toString("utf8"),
  ) as Recording;
  expect(document.frames.length).toBeLessThanOrEqual(MAX_REPLAY_FRAMES);
  // The frame the check's sweep stopped at is the one a reviewer looks at first.
  expect(document.frames.at(-1)?.count).toBe(MAX_REPLAY_FRAMES * 3);
  // The deltas still sum to the section's elapsed time.
  const elapsed = document.frames.reduce((sum, f) => sum + f.deltaMs, 0);
  expect(elapsed).toBe(MAX_REPLAY_FRAMES * 3 * 16);
});

let mediaDir: string | null = null;

beforeEach(() => {
  mediaDir = mkdtempSync(join(tmpdir(), "case-harness-replay-"));
  process.env[MEDIA_DIR_ENV] = mediaDir;
});

afterEach(() => {
  delete process.env[MEDIA_DIR_ENV];
  if (mediaDir !== null) rmSync(mediaDir, { recursive: true, force: true });
  mediaDir = null;
});

function written(outputId: string): Recording {
  const at = join(
    mediaDir as string,
    "validation",
    "engine-replay.spec.ts",
    `${outputId}.json.gz`,
  );
  return JSON.parse(gunzipSync(readFileSync(at)).toString("utf8")) as Recording;
}

it("arms the recorder around the section and hands the scenario's value back", async () => {
  const engine = engineOver(recordingOf(2));
  const answer = await captureEngineReplay(
    "fake",
    PROJECT_ROOT,
    engine,
    "section",
    () => {
      expect(engine.armed).toBe(1);
      expect(engine.stopped).toBe(0);
      return "the check's own value";
    },
  );
  expect(answer).toBe("the check's own value");
  expect(engine.stopped).toBe(1);
  expect(written("section").frames).toHaveLength(2);
});

it("a scenario that THROWS still leaves what it had recorded", async () => {
  const engine = engineOver(recordingOf(4));
  await expect(
    captureEngineReplay("fake", PROJECT_ROOT, engine, "failed", () => {
      throw new Error("the check failed");
    }),
  ).rejects.toThrow("the check failed");
  // A failing check is the one whose replay a reviewer most wants.
  expect(written("failed").frames).toHaveLength(4);
});

it("costs nothing, and arms nothing, when nobody is collecting", async () => {
  delete process.env[MEDIA_DIR_ENV];
  const engine = engineOver(recordingOf(2));
  let ran = false;
  await captureEngineReplay("fake", PROJECT_ROOT, engine, "unwatched", () => {
    ran = true;
  });
  expect(ran).toBe(true);
  expect(engine.armed).toBe(0);
  expect(readdirSync(mediaDir as string)).toEqual([]);
});

it("a bound capture is the one a case exports as its own captureReplay", async () => {
  const captureReplay = makeReplayCapture("fake", PROJECT_ROOT);
  const engine = engineOver(recordingOf(1));
  await captureReplay({ engine }, "bound", () => undefined);
  expect(written("bound").frames).toHaveLength(1);
});
