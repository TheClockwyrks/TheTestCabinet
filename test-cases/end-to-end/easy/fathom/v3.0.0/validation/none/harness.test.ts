// harness — the evidence capture the suites in this directory record with, and
// the two drives that decide what lands in it.
//
// The suites next door are validators: each decides one review point against the
// build. This file decides nothing about the build. It checks the harness's own
// rules, because they are invisible from inside a suite and wrong in ways nothing
// else catches. A recording written in the wrong framing reaches the console as
// something it cannot read; a recording written for a section that drew nothing is
// reported to the reviewer as evidence that exists; a `skip` that quietly recorded
// its ticks would spend a clip's whole budget on the march to the scenario and
// leave the scenario itself on the cutting-room floor.
//
// It also checks the two things that are the BROWSER's rather than the format's:
// that a frame the recorder keeps is one TICK the game ran, and that the frames
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
import { STAGE_H, STAGE_W, TICK_MS } from "./constants";
import {
  captureReplay,
  captureStill,
  createHarness,
  REPLAY_BACKGROUND,
  retable,
  thinReplay,
  type Harness,
  type RecordedFrame,
  type RecordedOp,
  type Recording,
  startPlaying,
} from "./harness";

/** The environment variable the runner names the media directory in. */
const MEDIA_DIR_ENV = "TCAB_VALIDATION_MEDIA_DIR";

/**
 * Where this file's own outputs land: the staged project directory, then the
 * suite's path within the project, which for this file is its own name.
 */
const SUITE_DIR = join("validation", "harness.test.ts");

/** A recording as it is written and read back, with only what is asserted named. */
interface WrittenRecording {
  format: number;
  width: number;
  height: number;
  background: string | null;
  images: unknown[];
  resources: {
    make: { method: string; args: unknown[] };
    then: RecordedOp[];
  }[];
  ops: RecordedOp[];
  states: {
    properties: Record<string, unknown>;
    clip: { transform: number[] | null; ops: RecordedOp[] }[];
    path: { transform: number[] | null; ops: RecordedOp[] }[];
  }[];
  frames: {
    count: number;
    deltaMs: number;
    state: number;
    stack: number[];
    ops: number[];
  }[];
}

let mediaDir: string;
let collecting: string | undefined;
let h: Harness;

beforeEach(async () => {
  collecting = process.env[MEDIA_DIR_ENV];
  mediaDir = mkdtempSync(join(tmpdir(), "fathom-replay-"));
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

it("writes a captured section as gzip, under the extension a replay is served at", async () => {
  await captureReplay(h, "dive", () => h.advance(4));

  expect(written()).toEqual(["dive.json.gz"]);
  const recording = readBack("dive.json.gz");
  expect(recording.format).toBeGreaterThan(0);
  expect(recording.frames.length).toBeGreaterThan(0);
  // The design size and background the console's player opens the canvas at.
  expect(recording.width).toBe(STAGE_W);
  expect(recording.height).toBe(STAGE_H);
  expect(recording.background).toBe(REPLAY_BACKGROUND);
});

it("keeps one recorded frame per TICK the game ran", async () => {
  // The page keeps rendering while the game is off the wall clock
  // (specs/instrumentation.md: "Drawing is unaffected either way"), so a recorder
  // bracketing on the animation frame would keep frames nobody drove and lose the
  // ones a driven `advance` produced. Every frame here is bracketed around one
  // `advance(1)`, inside one crossing into the page, so the two counts agree
  // exactly.
  await startPlaying(h);
  await captureReplay(h, "counted", () => h.advance(12));

  const recording = readBack("counted.json.gz");
  expect(recording.frames).toHaveLength(12);
  for (const frame of recording.frames) {
    expect(frame.ops.length).toBeGreaterThan(0);
  }
});

it("closes no frame for a skipped march, and runs the same ticks", async () => {
  // The whole reason both drives exist. A scenario reaches its subject by waiting
  // out a cooldown, losing a life, settling a pose — tens of seconds of simulation
  // a reviewer has no reason to watch. `skip` runs those ticks for real and keeps
  // none of them, so the clip is the part the point is about.
  await startPlaying(h);
  const before = await h.snapshot();
  await captureReplay(h, "marched", async () => {
    await h.skip(240);
    await h.advance(5);
  });
  const after = await h.snapshot();

  const recording = readBack("marched.json.gz");
  expect(recording.frames).toHaveLength(5);
  // And the skipped ticks were real: the game's own clock moved by all 245 of
  // them, so what `skip` saves is the recording rather than the simulation.
  expect(after.simTime - before.simTime).toBeCloseTo(245 / 120, 6);
  expect(h.tick()).toBe(245);
});

it("writes nothing at all for a section that drew no frames", async () => {
  // A scenario that runs no tick closes no frame, so there is no picture to write.
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
  // Capture sits beside a check's assertions rather than in place of them, so what
  // the scenario computed has to survive being recorded.
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
  // Far more ticks than a written recording holds. What comes back covers the
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
  const elapsed = recording.frames.reduce(
    (sum, frame) => sum + frame.deltaMs,
    0,
  );
  expect(elapsed).toBeCloseTo(1500 * TICK_MS, 3);
  // Frames are dropped twice over — in the page as the section runs, and again
  // when it is written — and each drop is the last reference to whatever only that
  // frame drew with. What is written names every entry of the tables it carries,
  // so nothing dropped is still being paid for.
  const named = new Set(recording.frames.flatMap((frame) => frame.ops));
  expect(named.size).toBe(recording.ops.length);
  const inherited = new Set(
    recording.frames.flatMap((frame) => [frame.state, ...frame.stack]),
  );
  expect(inherited.size).toBe(recording.states.length);
  // Minimal is only half of it. A table rebuilt against the wrong indices is the
  // same size as one rebuilt against the right ones, and it addresses entries that
  // are not there. Every index a frame carries has to address the table it was
  // interned into.
  expect(inRange(recording)).toEqual([]);
});

it("spends the budget on the section, never one frame past it", () => {
  // The stride the writer thins by rounds up, which puts the sharp edge of the cap
  // at a section whose length is an exact multiple of it: the strided frames come
  // to exactly the cap and stop one stride short of the end. Both rules still hold
  // there. Nothing over the cap, because the cap is what makes `captureReplay` safe
  // to wrap any section in; and the section's last frame written, because it is the
  // frame the check's sweep stopped at. So the last frame takes the place of the
  // frame the stride stopped on rather than being written beside it, and the three
  // lengths here are that multiple and one frame either side of it.
  for (const length of [599, 600, 601]) {
    const at = `${length} frames`;
    const frames = thinReplay(synthetic(length)).frames;

    expect(frames.length, at).toBeLessThanOrEqual(300);
    // The first frame of a section is always kept — the stride opens on it — so
    // the span between the first count and the last is the whole section exactly
    // when the frame it ended on is the frame written last.
    expect(frames[frames.length - 1].count - frames[0].count, at).toBe(
      length - 1,
    );
    // Displacing a frame leaves the deltas summing to the elapsed time, the same
    // as dropping one does: the frame that replaces it is measured from where the
    // frame before it was kept.
    const elapsed = frames.reduce((sum, frame) => sum + frame.deltaMs, 0);
    expect(elapsed, at).toBeCloseTo(length * TICK_MS, 3);
  }
});

it("rewrites a field named __proto__ as a field", () => {
  // A build's own object may carry a field named `__proto__` — a tile key, a
  // palette entry, whatever it happened to index by — and rewriting a table by
  // assigning that name reaches the prototype setter instead of writing a field
  // the document carries, so the value silently disappears from the replay.
  //
  // Driven through `retable` directly rather than through a captured section:
  // Playwright's serializer drops an own field of that name on the way out of the
  // page, so a recording carrying one cannot be produced by driving a build.
  const carrier: Record<string, unknown> = {};
  Object.defineProperty(carrier, "__proto__", {
    value: "kept",
    enumerable: true,
    writable: true,
    configurable: true,
  });
  const recording = synthetic(1);
  recording.ops = [{ op: "call", method: "fillRect", args: [carrier] }];

  const rewritten = retable(recording, recording.frames);

  const op = rewritten.ops[0];
  expect(op.op).toBe("call");
  const arg = op.op === "call" ? (op.args[0] as Record<string, unknown>) : {};
  expect(Object.prototype.hasOwnProperty.call(arg, "__proto__")).toBe(true);
  expect(Object.getOwnPropertyDescriptor(arg, "__proto__")?.value).toBe("kept");
});

/**
 * A recording of `length` frames, one operation apiece, at the rate the game runs
 * at.
 *
 * Stated rather than driven because the recorder in the page thins as the section
 * runs: it halves its own kept set at twice the written cap, so a section however
 * long hands the writer somewhere between the cap and twice it and never the exact
 * multiple of the cap the writer's arithmetic turns on. What the writer does with a
 * frame list is decided by how long the list is, so a list of the length in
 * question is the whole of what this needs to be.
 */
function synthetic(length: number): Recording {
  const frames: RecordedFrame[] = [];
  for (let i = 0; i < length; i += 1) {
    frames.push({
      count: i + 1,
      timeMs: (i + 1) * TICK_MS,
      deltaMs: TICK_MS,
      surface: { width: STAGE_W, height: STAGE_H },
      state: 0,
      stack: [],
      ops: [i],
    });
  }
  return {
    format: 1,
    width: STAGE_W,
    height: STAGE_H,
    background: REPLAY_BACKGROUND,
    images: [],
    resources: [],
    // One operation of its own per frame, so what the tables are rebuilt out of is
    // the frames that survived rather than a single entry every frame shares.
    ops: frames.map((frame) => ({
      op: "call" as const,
      method: "fillRect",
      args: [frame.count, 0, 1, 1],
    })),
    states: [
      {
        properties: { fillStyle: "#0a1014" },
        transform: null,
        lineDash: null,
        clip: [],
        path: [],
      },
    ],
    frames,
  };
}

/**
 * Every index in `recording` that addresses nothing, named.
 *
 * A recording is almost entirely indices — a frame names its state, the states
 * saved under it and each of its operations by index, and an operation names the
 * gradients and images it draws with the same way. Every one of them has to
 * address the table it belongs to, because a player that resolves an index past
 * the end of a table draws a frame the build never drew and says nothing about it.
 */
function inRange(recording: WrittenRecording): string[] {
  const faults: string[] = [];
  const check = (label: string, index: number, table: unknown[]): void => {
    if (!Number.isInteger(index) || index < 0 || index >= table.length) {
      faults.push(`${label}: ${index} of ${table.length}`);
    }
  };
  const value = (label: string, entry: unknown): void => {
    if (Array.isArray(entry)) {
      for (const held of entry) value(label, held);
      return;
    }
    if (entry === null || typeof entry !== "object") return;
    const record = entry as Record<string, unknown>;
    if (typeof record.$img === "number") {
      check(`${label} $img`, record.$img, recording.images);
      return;
    }
    if (typeof record.$res === "number") {
      check(`${label} $res`, record.$res, recording.resources);
      return;
    }
    for (const held of Object.values(record)) value(label, held);
  };
  const operation = (label: string, op: RecordedOp): void => {
    if (op.op === "call") for (const arg of op.args) value(label, arg);
    else value(label, op.value);
  };

  for (const [at, op] of recording.ops.entries()) operation(`ops[${at}]`, op);
  for (const [at, state] of recording.states.entries()) {
    for (const held of Object.values(state.properties)) {
      value(`states[${at}]`, held);
    }
    for (const segment of state.clip) {
      for (const op of segment.ops) operation(`states[${at}].clip`, op);
    }
    for (const segment of state.path) {
      for (const op of segment.ops) operation(`states[${at}].path`, op);
    }
  }
  for (const [at, resource] of recording.resources.entries()) {
    for (const arg of resource.make.args) value(`resources[${at}]`, arg);
    for (const op of resource.then) operation(`resources[${at}]`, op);
  }
  for (const [at, frame] of recording.frames.entries()) {
    check(`frames[${at}].state`, frame.state, recording.states);
    for (const saved of frame.stack) {
      check(`frames[${at}].stack`, saved, recording.states);
    }
    for (const op of frame.ops) check(`frames[${at}].ops`, op, recording.ops);
  }
  return faults;
}
