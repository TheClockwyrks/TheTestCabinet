// harness — the replay capture the suites in this directory record their evidence
// with, and the injected recorder that produces it.
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
// AND IT CHECKS THE RECORDER ITSELF. `recorder-init.js` is the case's own port of
// the engine's recorder, and it has to write the document the console's player
// reads — the shared tables, the recipe of every value the context produced, the
// pixels a frame blits, the state a frame inherited down to its clip and its save
// stack — or a reviewer scrubs a picture the build never drew. Nothing else in
// this project looks at any of that: the suites read which CALLS a frame made,
// which is one field of one table. The tests below drive the page's own 2D
// context through scripted frames, so each rule of the format is asserted against
// the recorder that will actually record a run.
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
import { FIELD_H, FIELD_W } from "./constants";
import {
  captureReplay,
  createHarness,
  REPLAY_BACKGROUND,
  retable,
  startPlaying,
  thinReplay,
  TICK_MS,
  type Harness,
  type RecordedFrame,
  type Recording,
} from "./harness";

/** The environment variable the runner names the media directory in. */
const MEDIA_DIR_ENV = "TCAB_VALIDATION_MEDIA_DIR";

/**
 * Where this file's own outputs land: the staged project directory, then the
 * suite's path within the project, which for this file is its own name.
 */
const SUITE_DIR = join("validation", "harness.test.ts");

/** One operation, as the recorder writes it and as `last()` reports it. */
type RecordedOp =
  | { op: "call"; method: string; args: unknown[] }
  | { op: "set"; property: string; value: unknown };

/** One run of path operations, and the transform they were issued under. */
interface RecordedPathSegment {
  transform: number[] | null;
  ops: RecordedOp[];
}

/** The context state a frame is drawn from, before its own operations. */
interface RecordedState {
  properties: Record<string, unknown>;
  transform: number[] | null;
  lineDash: number[] | null;
  clip: RecordedPathSegment[];
  path: RecordedPathSegment[];
}

/** A value the context produced, as the recipe that rebuilds it. */
interface RecordedResource {
  make: { method: string; args: unknown[] };
  then: RecordedOp[];
}

/** A bitmap or pixel buffer the operations draw. */
type CapturedImage =
  | { kind: "bitmap"; width: number; height: number; src: string }
  | { kind: "pixels"; width: number; height: number; data: string };

interface WrittenRecording {
  format: number;
  width: number;
  height: number;
  background: string | null;
  images: CapturedImage[];
  resources: RecordedResource[];
  ops: RecordedOp[];
  states: RecordedState[];
  frames: {
    count: number;
    deltaMs: number;
    state: number;
    stack: number[];
    ops: number[];
    truncated?: boolean;
  }[];
}

/** The one recording a scripted evaluation hands back, which is never null. */
function scripted(recording: WrittenRecording | null): WrittenRecording {
  expect(recording).not.toBeNull();
  return recording!;
}

/** A captured bitmap's data URL, and the assertion that the entry is one. */
function bitmap(image: CapturedImage): string {
  expect(image.kind).toBe("bitmap");
  return image.kind === "bitmap" ? image.src : "";
}

/** The recorder as the page exposes it, for the tests that drive it directly. */
interface PageRecorder {
  arm(design: {
    width: number;
    height: number;
    background: string | null;
  }): boolean;
  begin(): void;
  end(deltaMs: number): void;
  disarm(): WrittenRecording | null;
  last(): RecordedOp[];
}

/** The design a scripted recording states, which no assertion below reads. */
const DESIGN = { width: 64, height: 64, background: null };

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
  expect(recording.background).toBe(REPLAY_BACKGROUND);
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
  // Minimal is only half of it. A table rebuilt against the wrong indices is the
  // same size as one rebuilt against the right ones, and it addresses entries
  // that are not there: naming {0, 5} of a two-entry table names as many entries
  // as it has. Every index a frame carries has to address the table it was
  // interned into.
  expect(inRange(recording)).toEqual([]);
});

it("spends the budget on the section, never one frame past it", () => {
  // The stride the writer thins by rounds up, which puts the sharp edge of the cap
  // at a section whose length is an exact multiple of it: the strided frames come
  // to exactly the cap and stop one stride short of the end. Both rules still hold
  // there. Nothing over the cap, because the cap is what makes `captureReplay`
  // safe to wrap any section in; and the section's last frame written, because it
  // is the frame the check's sweep stopped at. So the last frame takes the place
  // of the frame the stride stopped on rather than being written beside it, and
  // the three lengths here are that multiple and one frame either side of it.
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

/**
 * A recording of `length` frames, one operation apiece, at the rate the game runs
 * at.
 *
 * Stated rather than driven because the recorder in the page thins as the section
 * runs: it halves its own kept set at twice the written cap, so a section however
 * long hands the writer somewhere between the cap and twice it and never the exact
 * multiple of the cap the writer's arithmetic turns on. What the writer does with
 * a frame list is decided by how long the list is, so a list of the length in
 * question is the whole of what this needs to be.
 */
function synthetic(length: number): Recording {
  const frames: RecordedFrame[] = [];
  for (let i = 0; i < length; i += 1) {
    frames.push({
      count: i + 1,
      timeMs: (i + 1) * TICK_MS,
      deltaMs: TICK_MS,
      surface: { width: FIELD_W, height: FIELD_H },
      state: 0,
      stack: [],
      ops: [i],
    });
  }
  return {
    format: 1,
    width: FIELD_W,
    height: FIELD_H,
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
        properties: { fillStyle: "#f2f5f7" },
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
 * the end of a table draws a frame the build never drew and says nothing about
 * it.
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

/* -------------------------------------------------------------------------- */
/* The injected recorder                                                      */
/* -------------------------------------------------------------------------- */
//
// Each of these drives the page's own 2D context — the one the recorder wrapped
// before the build's first line ran — through frames it brackets itself, and
// reads the document that comes back. `ctx.reset()` opens every script, so what
// is asserted is the script's own drawing rather than whatever state the build's
// last render happened to leave behind.

it("records a gradient the context made before the recorder was armed", async () => {
  // The defect the shared resource table exists to close. A build is free to
  // create its gradients once at startup and fill with them for the rest of its
  // life, and this harness arms the recorder around a section — so a recorder
  // that only watched while armed would write an opaque marker for every fill of
  // every frame and hand the reviewer a picture with no fills in it.
  const recording = await h.page.evaluate((design) => {
    const rec = (window as unknown as { __caromRec: PageRecorder }).__caromRec;
    const ctx = document.querySelector("canvas")!.getContext("2d")!;
    ctx.reset();
    const fill = ctx.createLinearGradient(0, 0, 8, 0);
    fill.addColorStop(0, "#ff0000");

    rec.arm(design);
    rec.begin();
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, 8, 8);
    rec.end(8);
    return rec.disarm();
  }, DESIGN);

  expect(recording).not.toBeNull();
  expect(recording!.resources).toEqual([
    {
      make: { method: "createLinearGradient", args: [0, 0, 8, 0] },
      then: [{ op: "call", method: "addColorStop", args: [0, "#ff0000"] }],
    },
  ]);
  const ops = recording!.frames[0].ops.map((at) => recording!.ops[at]);
  expect(ops[0]).toEqual({
    op: "set",
    property: "fillStyle",
    value: { $res: 0 },
  });
  // The creating call and the colour stop belong to the recipe, so the frame
  // holds neither: every operation a frame names is one the context performed on
  // itself, which is what lets a player issue them without asking what each one
  // is being applied to.
  expect(ops.map((op) => (op.op === "call" ? op.method : op.property))).toEqual(
    ["fillStyle", "fillRect"],
  );
});

it("gives each use of a gradient the stops that use actually had", async () => {
  // A recipe is taken at the moment the value is USED, and it has to be a copy:
  // a gradient that is filled, given another stop, and filled again paints
  // differently the second time, and a recipe list shared between the two uses
  // would paint the first fill under a stop it never had.
  const recording = await h.page.evaluate((design) => {
    const rec = (window as unknown as { __caromRec: PageRecorder }).__caromRec;
    const ctx = document.querySelector("canvas")!.getContext("2d")!;
    ctx.reset();
    rec.arm(design);
    rec.begin();
    const fill = ctx.createLinearGradient(0, 0, 8, 0);
    fill.addColorStop(0, "#ff0000");
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, 4, 8);
    fill.addColorStop(1, "#0000ff");
    ctx.fillStyle = fill;
    ctx.fillRect(4, 0, 4, 8);
    rec.end(8);
    return rec.disarm();
  }, DESIGN);

  const { resources, ops, frames } = recording!;
  expect(resources).toHaveLength(2);
  expect(resources[0].then).toEqual([
    { op: "call", method: "addColorStop", args: [0, "#ff0000"] },
  ]);
  expect(resources[1].then).toEqual([
    { op: "call", method: "addColorStop", args: [0, "#ff0000"] },
    { op: "call", method: "addColorStop", args: [1, "#0000ff"] },
  ]);
  const sets = frames[0].ops
    .map((at) => ops[at])
    .filter((op) => op.op === "set")
    .map((op) => (op as { value: unknown }).value);
  expect(sets).toEqual([{ $res: 0 }, { $res: 1 }]);
});

it("carries a matrix a context call answered as data, not as a recipe", async () => {
  // A recipe is re-issued against the canvas a player is drawing into, which is
  // faithful only for a value whose content does not depend on that canvas's
  // state. `getTransform()` is the counter-example: treated as a recipe it would
  // answer the player's transform instead of the build's, and every operation
  // after it would draw in the wrong place with the frame reported as clean.
  const recording = await h.page.evaluate((design) => {
    const rec = (window as unknown as { __caromRec: PageRecorder }).__caromRec;
    const ctx = document.querySelector("canvas")!.getContext("2d")!;
    ctx.reset();
    rec.arm(design);
    rec.begin();
    ctx.translate(3, 4);
    const saved = ctx.getTransform();
    ctx.resetTransform();
    ctx.setTransform(saved);
    ctx.fillRect(0, 0, 1, 1);
    rec.end(8);
    return rec.disarm();
  }, DESIGN);

  expect(recording!.resources).toEqual([]);
  const ops = recording!.frames[0].ops.map((at) => recording!.ops[at]);
  const put = ops.find(
    (op) => op.op === "call" && op.method === "setTransform",
  );
  expect(put).toEqual({
    op: "call",
    method: "setTransform",
    args: [{ a: 1, b: 0, c: 0, d: 1, e: 3, f: 4 }],
  });
});

it("captures what a frame blits, and captures it again when its pixels change", async () => {
  // A canvas a build draws from is repainted in place, and one that changed looks
  // exactly like one that did not. Capturing such a source once and reusing the
  // bytes is a silently wrong picture, which is worse than the opaque marker it
  // replaces — so it is captured at every use and the entries are shared only
  // when the bytes match.
  const recording = await h.page.evaluate((design) => {
    const rec = (window as unknown as { __caromRec: PageRecorder }).__caromRec;
    const ctx = document.querySelector("canvas")!.getContext("2d")!;
    ctx.reset();
    const source = document.createElement("canvas");
    source.width = 2;
    source.height = 2;
    const paint = source.getContext("2d")!;
    paint.fillStyle = "#ff0000";
    paint.fillRect(0, 0, 2, 2);

    rec.arm(design);
    rec.begin();
    ctx.drawImage(source, 0, 0);
    ctx.drawImage(source, 4, 0);
    paint.fillStyle = "#0000ff";
    paint.fillRect(0, 0, 2, 2);
    ctx.drawImage(source, 8, 0);
    rec.end(8);
    return rec.disarm();
  }, DESIGN);

  const { images, ops, frames } = scripted(recording);
  expect(images).toHaveLength(2);
  for (const image of images) {
    expect(image).toMatchObject({ width: 2, height: 2 });
    expect(bitmap(image).startsWith("data:image/png;base64,")).toBe(true);
  }
  expect(bitmap(images[0])).not.toBe(bitmap(images[1]));
  // Two draws of one unchanged source share an entry; the third names the picture
  // the source was actually holding when it was drawn.
  expect(
    frames[0].ops
      .map((at) => ops[at])
      .map((op) => (op as { args: unknown[] }).args[0]),
  ).toEqual([{ $img: 0 }, { $img: 0 }, { $img: 1 }]);
});

it("writes a coordinate to nine significant digits", async () => {
  // The full expansion of a physics position is seventeen characters, on every
  // argument of every operation of every frame, and it is what stops two
  // operations a frame apart from being the same operation. Nine digits over the
  // field's own units resolve to about a millionth of a pixel.
  const recording = await h.page.evaluate((design) => {
    const rec = (window as unknown as { __caromRec: PageRecorder }).__caromRec;
    const ctx = document.querySelector("canvas")!.getContext("2d")!;
    ctx.reset();
    rec.arm(design);
    rec.begin();
    ctx.fillRect(1 / 3, 2 / 3, 1, 1);
    rec.end(8);
    return rec.disarm();
  }, DESIGN);

  expect(recording!.ops[recording!.frames[0].ops[0]]).toEqual({
    op: "call",
    method: "fillRect",
    args: [0.333333333, 0.666666667, 1, 1],
  });
});

it("carries the states a frame had saved under it", async () => {
  // A build may `save` on one frame and `restore` on the next. A player that
  // pushed nothing would run everything after that restore under the state the
  // frame left rather than the state it returned to, so the stack is part of what
  // a frame inherits.
  const recording = await h.page.evaluate((design) => {
    const rec = (window as unknown as { __caromRec: PageRecorder }).__caromRec;
    const ctx = document.querySelector("canvas")!.getContext("2d")!;
    ctx.reset();
    rec.arm(design);
    rec.begin();
    ctx.fillStyle = "#112233";
    ctx.save();
    ctx.fillStyle = "#445566";
    ctx.fillRect(0, 0, 1, 1);
    rec.end(8);
    rec.begin();
    ctx.restore();
    ctx.fillRect(1, 0, 1, 1);
    rec.end(8);
    return rec.disarm();
  }, DESIGN);

  const { states, frames } = recording!;
  expect(frames[0].stack).toEqual([]);
  expect(frames[1].stack).toHaveLength(1);
  // The state on top is the one the frame opened under; the state beneath it is
  // the one its `restore` returns to.
  expect(states[frames[1].state].properties.fillStyle).toBe("#445566");
  expect(states[frames[1].stack[0]].properties.fillStyle).toBe("#112233");
});

it("carries the clip a frame inherited, with the transform it was cut under", async () => {
  // No context reports its clip and a player blanks the canvas before every
  // frame, so a clip established on one frame reaches a later one only by being
  // part of what that frame inherits. The recorder shadows it: the path since the
  // last `beginPath`, the `clip` call itself, and the transform in force, because
  // a clip path is given in user space.
  const recording = await h.page.evaluate((design) => {
    const rec = (window as unknown as { __caromRec: PageRecorder }).__caromRec;
    const ctx = document.querySelector("canvas")!.getContext("2d")!;
    ctx.reset();
    rec.arm(design);
    rec.begin();
    ctx.translate(5, 6);
    ctx.beginPath();
    ctx.rect(2, 3, 10, 10);
    ctx.clip();
    ctx.fillRect(0, 0, 1, 1);
    rec.end(8);
    rec.begin();
    ctx.fillRect(1, 0, 1, 1);
    rec.end(8);
    return rec.disarm();
  }, DESIGN);

  const { states, frames } = recording!;
  // The clip was applied during the first frame, so that frame did not inherit it.
  expect(states[frames[0].state].clip).toEqual([]);
  expect(states[frames[1].state].clip).toEqual([
    {
      transform: [1, 0, 0, 1, 5, 6],
      ops: [
        { op: "call", method: "beginPath", args: [] },
        { op: "call", method: "rect", args: [2, 3, 10, 10] },
        { op: "call", method: "clip", args: [] },
      ],
    },
  ]);
});

it("draws the same pixels for a value it cannot carry", async () => {
  // The recorder can never change what a build draws. A cyclic object assigned to
  // `fillStyle` is a silent no-op on a bare canvas, and it has to stay one here
  // rather than becoming a `RangeError` thrown out of a proxy trap — so encoding
  // carries a visited set, a depth bound and a guard, and a value it cannot walk
  // records as the marker every other uncarriable value gets.
  const recording = await h.page.evaluate((design) => {
    const rec = (window as unknown as { __caromRec: PageRecorder }).__caromRec;
    const ctx = document.querySelector("canvas")!.getContext("2d")!;
    ctx.reset();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const throwing: Record<string, unknown> = {};
    Object.defineProperty(throwing, "boom", {
      enumerable: true,
      get() {
        throw new Error("this getter refuses to be read");
      },
    });
    let deep: Record<string, unknown> = { leaf: 1 };
    for (let i = 0; i < 40; i += 1) deep = { down: deep };

    rec.arm(design);
    rec.begin();
    ctx.fillStyle = "#00ff00";
    ctx.fillStyle = cyclic as unknown as string;
    ctx.fillStyle = throwing as unknown as string;
    ctx.fillStyle = deep as unknown as string;
    ctx.fillRect(0, 0, 4, 4);
    rec.end(8);
    // Read back inside the same evaluation. The page keeps presenting on its own
    // animation frame even with the game off the wall clock, so a pixel read that
    // crossed out and back would be reading whatever it repainted.
    const pixel = Array.from(ctx.getImageData(1, 1, 1, 1).data);
    return { written: rec.disarm(), pixel };
  }, DESIGN);

  const { written, pixel } = recording;
  const ops = written!.frames[0].ops.map((at) => written!.ops[at]);
  const values = ops
    .filter((op) => op.op === "set")
    .map((op) => (op as { value: unknown }).value);
  expect(values[0]).toBe("#00ff00");
  expect(values[1]).toEqual({ self: { $opaque: "Object" } });
  expect(values[2]).toEqual({ $opaque: "Object" });
  // Somewhere down the chain the encoder stops walking and names what is left.
  expect(JSON.stringify(values[3])).toContain('{"$opaque":"Object"}');
  expect(ops[ops.length - 1]).toEqual({
    op: "call",
    method: "fillRect",
    args: [0, 0, 4, 4],
  });
  // The three refused assignments were no-ops on the canvas, exactly as they are
  // on one nobody is watching, so the rect is still the green that was set before
  // them.
  expect(pixel).toEqual([0, 255, 0, 255]);
});

it("reports the same operations to a check whether or not a capture is running", async () => {
  // `frameCalls` is about which calls a frame made. A check that asked it inside
  // a `captureReplay` and outside one has to get the same answer, and it cannot
  // resolve an index into tables it never receives — least of all into tables a
  // finished recording has already emptied.
  const both = await h.page.evaluate((design) => {
    const rec = (window as unknown as { __caromRec: PageRecorder }).__caromRec;
    const ctx = document.querySelector("canvas")!.getContext("2d")!;
    const draw = (): void => {
      ctx.measureText("carom");
      const fill = ctx.createLinearGradient(0, 0, 4, 0);
      fill.addColorStop(0, "#ff0000");
      ctx.fillStyle = fill;
      ctx.fillRect(0, 0, 4, 4);
    };
    ctx.reset();

    rec.begin();
    draw();
    rec.end(8);
    const idle = rec.last();

    rec.arm(design);
    rec.begin();
    draw();
    rec.end(8);
    const armed = rec.last();
    rec.disarm();

    return { idle, armed, afterwards: rec.last() };
  }, DESIGN);

  expect(both.armed).toEqual(both.idle);
  // A call that answers an object is still a call the frame made, and a value the
  // context produced is named by what it is rather than by where a table the
  // caller has never seen happens to hold it.
  expect(both.idle).toEqual([
    { op: "call", method: "measureText", args: ["carom"] },
    {
      op: "set",
      property: "fillStyle",
      value: { $opaque: "CanvasGradient" },
    },
    { op: "call", method: "fillRect", args: [0, 0, 4, 4] },
  ]);
  // The last frame's operations belong to the recording that has just been handed
  // over, and go with its tables.
  expect(both.afterwards).toEqual([]);
});

it("captures an SVG image, and captures it again when it is re-pointed", async () => {
  // The one bitmap source that reports its size as an animated length rather than
  // as a number, and the one that names what it is pointing at in `href` rather
  // than in `currentSrc`. A recorder that reads only numbers and only
  // `currentSrc` leaves the whole type opaque and, once it does capture one,
  // keeps handing back the file it used to hold.
  const recording = await h.page.evaluate(async (design) => {
    const rec = (window as unknown as { __caromRec: PageRecorder }).__caromRec;
    const ctx = document.querySelector("canvas")!.getContext("2d")!;
    ctx.reset();

    const source = document.createElement("canvas");
    source.width = 2;
    source.height = 2;
    const paint = source.getContext("2d")!;
    paint.fillStyle = "#ff0000";
    paint.fillRect(0, 0, 2, 2);
    const red = source.toDataURL("image/png");
    paint.fillStyle = "#0000ff";
    paint.fillRect(0, 0, 2, 2);
    const blue = source.toDataURL("image/png");

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.style.position = "absolute";
    svg.style.left = "-9999px";
    const image = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "image",
    );
    image.setAttribute("width", "2");
    image.setAttribute("height", "2");
    svg.appendChild(image);
    document.body.appendChild(svg);
    const pointAt = (href: string): Promise<void> =>
      new Promise((done) => {
        image.addEventListener("load", () => done(), { once: true });
        image.setAttribute("href", href);
      });

    await pointAt(red);
    rec.arm(design);
    rec.begin();
    ctx.drawImage(image, 0, 0);
    rec.end(8);
    await pointAt(blue);
    rec.begin();
    ctx.drawImage(image, 0, 0);
    rec.end(8);
    const written = rec.disarm();
    svg.remove();
    return written;
  }, DESIGN);

  const { images, ops, frames } = recording!;
  expect(images).toHaveLength(2);
  expect(
    images.map((image) => [image.kind, image.width, image.height]),
  ).toEqual([
    ["bitmap", 2, 2],
    ["bitmap", 2, 2],
  ]);
  const drawn = frames.map(
    (frame) => (ops[frame.ops[0]] as { args: unknown[] }).args[0],
  );
  expect(drawn).toEqual([{ $img: 0 }, { $img: 1 }]);
});
/* -------------------------------------------------------------------------- */
/* The state a frame inherits                                                 */
/* -------------------------------------------------------------------------- */

it("carries the path a frame inherited, split by the transform it was built under", async () => {
  // A canvas keeps its current path across a frame boundary, so a build is free to
  // open a path on one frame and fill it on the next. Carrying it is also what an
  // inherited clip makes unavoidable: applying a clip means replaying that clip's
  // own path operations, which leaves the clip outline current, and a frame that
  // then issued a bare `fill()` would fill the outline of its clip instead of the
  // shape the build built.
  const recording = await h.page.evaluate((design) => {
    const rec = (window as unknown as { __caromRec: PageRecorder }).__caromRec;
    const ctx = document.querySelector("canvas")!.getContext("2d")!;
    ctx.reset();
    rec.arm(design);
    rec.begin();
    ctx.beginPath();
    ctx.moveTo(1, 2);
    ctx.translate(5, 6);
    ctx.lineTo(3, 4);
    rec.end(8);
    rec.begin();
    ctx.fill();
    rec.end(8);
    return rec.disarm();
  }, DESIGN);

  const { states, frames } = scripted(recording);
  // The path was opened during the first frame, so that frame did not inherit it.
  expect(states[frames[0].state].path).toEqual([]);
  // A path is given in user space, so the operations issued under one transform
  // share a segment and the translate part-way through opens the next.
  expect(states[frames[1].state].path).toEqual([
    {
      transform: [1, 0, 0, 1, 0, 0],
      ops: [
        { op: "call", method: "beginPath", args: [] },
        { op: "call", method: "moveTo", args: [1, 2] },
      ],
    },
    {
      transform: [1, 0, 0, 1, 5, 6],
      ops: [{ op: "call", method: "lineTo", args: [3, 4] }],
    },
  ]);
});

it("gives a saved state an empty path", async () => {
  // The current path sits outside the saved state: a `save` does not copy it and a
  // `restore` does not put it back. So the path in force is carried once, by the
  // state the frame opened with, and a stack entry that carried one would have the
  // player replay it again at every level it pushes.
  const recording = await h.page.evaluate((design) => {
    const rec = (window as unknown as { __caromRec: PageRecorder }).__caromRec;
    const ctx = document.querySelector("canvas")!.getContext("2d")!;
    ctx.reset();
    rec.arm(design);
    rec.begin();
    ctx.beginPath();
    ctx.rect(1, 1, 2, 2);
    ctx.save();
    rec.end(8);
    rec.begin();
    ctx.fill();
    rec.end(8);
    return rec.disarm();
  }, DESIGN);

  const { states, frames } = scripted(recording);
  expect(frames[1].stack).toHaveLength(1);
  expect(states[frames[1].stack[0]].path).toEqual([]);
  expect(states[frames[1].state].path).toEqual([
    {
      transform: [1, 0, 0, 1, 0, 0],
      ops: [
        { op: "call", method: "beginPath", args: [] },
        { op: "call", method: "rect", args: [1, 1, 2, 2] },
      ],
    },
  ]);
});

it("puts back the clip a restore returns to", async () => {
  // A `restore` undoes a clip, and the clip is the one part of the state it undoes
  // that nothing can be asked about afterwards. A recorder that let the inner clip
  // stand would hand every later frame a region the context is not clipped to, and
  // a player would draw them all through it with nothing reported.
  const recording = await h.page.evaluate((design) => {
    const rec = (window as unknown as { __caromRec: PageRecorder }).__caromRec;
    const ctx = document.querySelector("canvas")!.getContext("2d")!;
    ctx.reset();
    rec.arm(design);
    rec.begin();
    ctx.beginPath();
    ctx.rect(0, 0, 10, 10);
    ctx.clip();
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, 4, 4);
    ctx.clip();
    ctx.restore();
    rec.end(8);
    rec.begin();
    ctx.fillRect(0, 0, 1, 1);
    rec.end(8);
    return rec.disarm();
  }, DESIGN);

  const { states, frames } = scripted(recording);
  // The outer clip alone: clips intersect, so a second segment would be a region
  // the build had already left.
  expect(states[frames[1].state].clip).toEqual([
    {
      transform: [1, 0, 0, 1, 0, 0],
      ops: [
        { op: "call", method: "beginPath", args: [] },
        { op: "call", method: "rect", args: [0, 0, 10, 10] },
        { op: "call", method: "clip", args: [] },
      ],
    },
  ]);
});

it("throws away the save stack, the clip and the path on a reset", async () => {
  // `reset()` returns the context to the state it was created in, and the three
  // things the recorder shadows are the three a later frame would otherwise go on
  // inheriting from before it.
  const recording = await h.page.evaluate((design) => {
    const rec = (window as unknown as { __caromRec: PageRecorder }).__caromRec;
    const ctx = document.querySelector("canvas")!.getContext("2d")!;
    ctx.reset();
    rec.arm(design);
    rec.begin();
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, 4, 4);
    ctx.clip();
    ctx.moveTo(7, 7);
    ctx.reset();
    rec.end(8);
    rec.begin();
    ctx.fillRect(0, 0, 1, 1);
    rec.end(8);
    return rec.disarm();
  }, DESIGN);

  const { states, frames } = scripted(recording);
  expect(frames[1].stack).toEqual([]);
  expect(states[frames[1].state].clip).toEqual([]);
  expect(states[frames[1].state].path).toEqual([]);
});

it("throws away the same three when the canvas is resized", async () => {
  // Writing `canvas.width` RESETS the context — transform, properties, clip, save
  // stack — and says nothing about it through the context. An engineless build
  // fits its canvas to the window and does it from inside a frame, so a recording
  // has to survive one: the backing store size is read before each shadowed
  // operation and before each state snapshot, and a size that moved means
  // everything the recorder shadows is gone.
  const recording = await h.page.evaluate((design) => {
    const rec = (window as unknown as { __caromRec: PageRecorder }).__caromRec;
    const canvas = document.querySelector("canvas")!;
    const ctx = canvas.getContext("2d")!;
    ctx.reset();
    rec.arm(design);
    rec.begin();
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, 4, 4);
    ctx.clip();
    canvas.width = canvas.width + 1;
    // One shadowed operation after the resize, so what the frame inherits is what
    // the recorder made of the context AFTER it noticed, rather than what the next
    // frame open happened to tidy up.
    ctx.lineTo(9, 9);
    rec.end(8);
    rec.begin();
    ctx.fill();
    rec.end(8);
    return rec.disarm();
  }, DESIGN);

  const { states, frames } = scripted(recording);
  expect(frames[1].stack).toEqual([]);
  expect(states[frames[1].state].clip).toEqual([]);
  expect(states[frames[1].state].path).toEqual([
    {
      transform: [1, 0, 0, 1, 0, 0],
      ops: [{ op: "call", method: "lineTo", args: [9, 9] }],
    },
  ]);
});

it("retakes the state a frame inherits when the resize lands before it draws", async () => {
  // An engineless build fits its canvas to the window from inside its own frame,
  // before it has drawn anything. A frame inherits what its FIRST operation runs
  // under, so a snapshot taken before the reset describes a clip, a save stack and
  // a fill the context no longer has, and every operation of the frame replays
  // under them.
  const recording = await h.page.evaluate((design) => {
    const rec = (window as unknown as { __caromRec: PageRecorder }).__caromRec;
    const canvas = document.querySelector("canvas")!;
    const ctx = canvas.getContext("2d")!;
    ctx.reset();
    ctx.fillStyle = "#123456";
    ctx.beginPath();
    ctx.rect(0, 0, 4, 4);
    ctx.clip();
    ctx.save();

    rec.arm(design);
    rec.begin();
    canvas.width = canvas.width + 1;
    ctx.fillRect(0, 0, 1, 1);
    rec.end(8);
    return rec.disarm();
  }, DESIGN);

  const { states, frames } = scripted(recording);
  const inherited = states[frames[0].state];
  expect(frames[0].stack).toEqual([]);
  expect(inherited.clip).toEqual([]);
  expect(inherited.path).toEqual([]);
  // The properties are read back from the context, which the resize returned to
  // its defaults.
  expect(inherited.properties.fillStyle).toBe("#000000");
});

it("bounds an unbalanced save, and keeps the innermost levels", async () => {
  // Every frame re-encodes the whole stack, because a `save` stores a REFERENCE and
  // the recipe behind it goes on growing. A build that saves more often than it
  // restores would otherwise cost a longer stack at every frame open for the rest
  // of the recording. What is kept past the bound is what a `restore` can still
  // reach, which is the innermost end.
  const recording = await h.page.evaluate((design) => {
    const rec = (window as unknown as { __caromRec: PageRecorder }).__caromRec;
    const ctx = document.querySelector("canvas")!.getContext("2d")!;
    ctx.reset();
    rec.arm(design);
    rec.begin();
    for (let level = 0; level < 100; level += 1) {
      ctx.fillStyle = `#${level.toString(16).padStart(2, "0")}0000`;
      ctx.save();
    }
    rec.end(8);
    rec.begin();
    ctx.fillRect(0, 0, 1, 1);
    rec.end(8);
    return rec.disarm();
  }, DESIGN);

  const { states, frames } = scripted(recording);
  expect(frames[1].stack).toHaveLength(64);
  const held = frames[1].stack.map(
    (at) => states[at].properties.fillStyle as string,
  );
  // Levels 36 through 99: the hundred saved, less the thirty-six outermost the
  // bound dropped.
  expect(held[0]).toBe("#240000");
  expect(held[held.length - 1]).toBe("#630000");
  // And the frame says it was cut down. A build that saved deeper than the bound
  // and restores past it replays under the wrong state, and a reviewer has to be
  // able to tell that picture from one the format carried whole.
  expect(frames[1].truncated).toBe(true);
});

it("refuses a clip whole rather than carrying the region past the bound", async () => {
  // The clip region and the current path are each bounded at 1024 path operations,
  // and a clip is measured against the bound by the region it would LEAVE BEHIND
  // rather than by the one in force when it is taken. A clip cut from a region just
  // under the bound would otherwise be carried whole — 902 operations held, 901
  // taken, a shadow of 1,804 — and a build that approaches the bound one operation
  // at a time drives it to 2,047, which is a state every frame open re-encodes and
  // a figure the format says a document cannot carry.
  const recording = await h.page.evaluate((design) => {
    const rec = (window as unknown as { __caromRec: PageRecorder }).__caromRec;
    const ctx = document.querySelector("canvas")!.getContext("2d")!;
    ctx.reset();
    rec.arm(design);
    rec.begin();
    for (let taken = 0; taken < 2; taken += 1) {
      ctx.beginPath();
      for (let n = 0; n < 900; n += 1) ctx.lineTo(n, taken);
      ctx.clip();
    }
    rec.end(8);
    rec.begin();
    ctx.fillRect(0, 0, 1, 1);
    rec.end(8);
    return rec.disarm();
  }, DESIGN);

  const { states, frames } = scripted(recording);
  // The first clip alone: its `beginPath`, its 900 line segments and the `clip`
  // call that takes them. The second is refused whole, because half a clip path is
  // a region the build never had.
  const { clip } = states[frames[1].state];
  expect(clip).toHaveLength(1);
  expect(clip.reduce((total, segment) => total + segment.ops.length, 0)).toBe(
    902,
  );
  expect(frames[1].truncated).toBe(true);
});

it("holds no table entry a mid-frame wipe left with no frame naming it", async () => {
  // A wipe erases the pixels the frame has already drawn, so the operations that
  // drew them are dropped — and an entry the recording interned for one of them is
  // then a gradient rebuilt and an image decoded by every reader of a document that
  // never draws either. The tables are built from the frames that survived, so what
  // a dropped operation named goes with it.
  const recording = await h.page.evaluate((design) => {
    const rec = (window as unknown as { __caromRec: PageRecorder }).__caromRec;
    const canvas = document.querySelector("canvas")!;
    const ctx = canvas.getContext("2d")!;
    ctx.reset();
    rec.arm(design);
    rec.begin();
    const fill = ctx.createLinearGradient(0, 0, 32, 0);
    fill.addColorStop(0, "#ff0000");
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, 32, 32);
    // The self-assignment IS the subject: it is the canonical canvas clear, and
    // the wipe it performs is what has to leave the gradient unnamed. Writing
    // anything else here — a different width, a `ctx.reset()` — would pose a
    // different clear from the one a build actually issues.
    // eslint-disable-next-line no-self-assign
    canvas.width = canvas.width;
    ctx.fillRect(1, 1, 2, 2);
    rec.end(8);
    return rec.disarm();
  }, DESIGN);

  const written = scripted(recording);
  const { ops, resources, frames } = written;
  expect(frames[0].ops.map((at) => ops[at])).toEqual([
    { op: "call", method: "fillRect", args: [1, 1, 2, 2] },
  ]);
  expect(ops).toHaveLength(1);
  // The gradient was named by the fill the wipe erased and by nothing else. The
  // reset returned `fillStyle` to its default, so the state the rest of the frame
  // inherits does not name it either.
  expect(resources).toEqual([]);
  expect(inRange(written)).toEqual([]);
});

/* -------------------------------------------------------------------------- */
/* Values the context produced                                                */
/* -------------------------------------------------------------------------- */

it("resolves a gradient as of the paint, not as of the assignment", async () => {
  // A style property holds a LIVE REFERENCE. This build paints red, blue, red — the
  // stop added after the assignment counts, and the assignment is never made again
  // — so a recording that stated what the assignment stated would replay a solid
  // red fill over every pixel of the rect and report the frame as clean.
  const recording = await h.page.evaluate((design) => {
    const rec = (window as unknown as { __caromRec: PageRecorder }).__caromRec;
    const ctx = document.querySelector("canvas")!.getContext("2d")!;
    ctx.reset();
    rec.arm(design);
    rec.begin();
    const fill = ctx.createLinearGradient(0, 0, 64, 0);
    fill.addColorStop(0, "#ff0000");
    fill.addColorStop(1, "#ff0000");
    ctx.fillStyle = fill;
    fill.addColorStop(0.5, "#0000ff");
    ctx.fillRect(0, 0, 64, 64);
    // A second paint under the same value is worth no second correction.
    ctx.fillRect(0, 0, 8, 8);
    rec.end(8);
    return rec.disarm();
  }, DESIGN);

  const { resources, ops, frames } = scripted(recording);
  expect(frames[0].ops.map((at) => ops[at])).toEqual([
    { op: "set", property: "fillStyle", value: { $res: 0 } },
    // The corrective assignment, which the build never made: what follows it
    // states what the context is about to paint.
    { op: "set", property: "fillStyle", value: { $res: 1 } },
    { op: "call", method: "fillRect", args: [0, 0, 64, 64] },
    { op: "call", method: "fillRect", args: [0, 0, 8, 8] },
  ]);
  expect(resources[0].then).toHaveLength(2);
  expect(resources[1].then).toEqual([
    { op: "call", method: "addColorStop", args: [0, "#ff0000"] },
    { op: "call", method: "addColorStop", args: [1, "#ff0000"] },
    { op: "call", method: "addColorStop", args: [0.5, "#0000ff"] },
  ]);
});

it("resolves a gradient a restore put back the same way", async () => {
  // A `restore` restores a REFERENCE rather than a copy, so the property holds the
  // value that was saved, carrying every mutation made to it in between — and the
  // recording has to be measuring the paint that follows against THAT value rather
  // than against the plain colour the property held a moment ago. Here the build
  // paints a two-stop gradient and a recording that let the restore stand would
  // replay the one-stop gradient the state was pushed with.
  const recording = await h.page.evaluate((design) => {
    const rec = (window as unknown as { __caromRec: PageRecorder }).__caromRec;
    const ctx = document.querySelector("canvas")!.getContext("2d")!;
    ctx.reset();
    rec.arm(design);
    rec.begin();
    const fill = ctx.createLinearGradient(0, 0, 64, 0);
    fill.addColorStop(0, "#ff0000");
    ctx.fillStyle = fill;
    ctx.save();
    ctx.fillStyle = "#00ff00";
    fill.addColorStop(1, "#0000ff");
    ctx.restore();
    ctx.fillRect(0, 0, 64, 64);
    rec.end(8);
    return rec.disarm();
  }, DESIGN);

  const { resources, ops, frames } = scripted(recording);
  expect(frames[0].ops.map((at) => ops[at])).toEqual([
    { op: "set", property: "fillStyle", value: { $res: 0 } },
    { op: "call", method: "save", args: [] },
    { op: "set", property: "fillStyle", value: "#00ff00" },
    { op: "call", method: "restore", args: [] },
    // The correction: what the restore put back has moved on since it was saved.
    { op: "set", property: "fillStyle", value: { $res: 1 } },
    { op: "call", method: "fillRect", args: [0, 0, 64, 64] },
  ]);
  expect(resources[0].then).toHaveLength(1);
  expect(resources[1].then).toHaveLength(2);
});

it("re-encodes a saved state at the frame that carries it", async () => {
  // A `save` stores a reference too, so the gradient a saved state holds paints
  // under whatever stops it has when the frame a `restore` lands in resolves it.
  // Pinning the recipe at the save would replay the earlier picture.
  const recording = await h.page.evaluate((design) => {
    const rec = (window as unknown as { __caromRec: PageRecorder }).__caromRec;
    const ctx = document.querySelector("canvas")!.getContext("2d")!;
    ctx.reset();
    rec.arm(design);
    rec.begin();
    const fill = ctx.createLinearGradient(0, 0, 64, 0);
    fill.addColorStop(0, "#ff0000");
    ctx.fillStyle = fill;
    ctx.save();
    ctx.fillStyle = "#00ff00";
    fill.addColorStop(1, "#0000ff");
    rec.end(8);
    rec.begin();
    ctx.restore();
    ctx.fillRect(0, 0, 64, 64);
    rec.end(8);
    return rec.disarm();
  }, DESIGN);

  const { resources, states, frames } = scripted(recording);
  const saved = states[frames[1].stack[0]].properties.fillStyle as {
    $res: number;
  };
  expect(resources[saved.$res].then).toHaveLength(2);
});

it("holds a pattern to the picture its source had when it was made", async () => {
  // `createPattern` COPIES its source when it is called. A recipe whose arguments
  // were encoded at the use would carry whatever the source held later, and a build
  // that reuses one scratch canvas would have every pattern replay under the last
  // picture painted into it — every pixel of the fill wrong, and nothing reported.
  const recording = await h.page.evaluate((design) => {
    const rec = (window as unknown as { __caromRec: PageRecorder }).__caromRec;
    const ctx = document.querySelector("canvas")!.getContext("2d")!;
    ctx.reset();
    const source = document.createElement("canvas");
    source.width = 2;
    source.height = 2;
    const paint = source.getContext("2d")!;
    paint.fillStyle = "#ff0000";
    paint.fillRect(0, 0, 2, 2);
    const red = source.toDataURL("image/png");

    rec.arm(design);
    rec.begin();
    const fill = ctx.createPattern(source, "repeat")!;
    paint.fillStyle = "#0000ff";
    paint.fillRect(0, 0, 2, 2);
    const blue = source.toDataURL("image/png");
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, 64, 64);
    rec.end(8);
    return { written: rec.disarm(), red, blue };
  }, DESIGN);

  const { images, resources } = scripted(recording.written);
  expect(resources[0].make.method).toBe("createPattern");
  expect(resources[0].make.args).toEqual([{ $img: 0 }, "repeat"]);
  expect(recording.red).not.toBe(recording.blue);
  expect(bitmap(images[0])).toBe(recording.red);
});

it("finds a value the context produced inside an argument", async () => {
  // Only the arguments a call is made with cross the wrapper unwrapped, so a
  // gradient nested inside a value a build passed arrives at the encoder as the
  // wrapper it was handed. A lookup that did not unwrap would write an opaque
  // marker where the engine's recorder writes a resource, and two recorders that
  // answer one drawing with two documents are two formats.
  const recording = await h.page.evaluate((design) => {
    const rec = (window as unknown as { __caromRec: PageRecorder }).__caromRec;
    const ctx = document.querySelector("canvas")!.getContext("2d")!;
    ctx.reset();
    rec.arm(design);
    rec.begin();
    const fill = ctx.createLinearGradient(0, 0, 8, 0);
    fill.addColorStop(0, "#ff0000");
    ctx.fillStyle = { swatch: fill } as unknown as string;
    rec.end(8);
    return rec.disarm();
  }, DESIGN);

  const { resources, ops, frames } = scripted(recording);
  expect(ops[frames[0].ops[0]]).toEqual({
    op: "set",
    property: "fillStyle",
    value: { swatch: { $res: 0 } },
  });
  expect(resources[0].make.method).toBe("createLinearGradient");
});

/* -------------------------------------------------------------------------- */
/* What the recording carries                                                 */
/* -------------------------------------------------------------------------- */

it("carries an ImageData as its own bytes", async () => {
  // The canvas round trip a PNG needs is lossy. Drawing an image into a canvas
  // premultiplies each colour channel by the pixel's alpha and reading the pixels
  // back un-premultiplies them, so a partially transparent pixel is quantized to
  // eight bits twice and comes back a different colour. An `ImageData` is the one
  // kind of image a check compares byte for byte, so it is carried byte for byte.
  const recording = await h.page.evaluate((design) => {
    const rec = (window as unknown as { __caromRec: PageRecorder }).__caromRec;
    const ctx = document.querySelector("canvas")!.getContext("2d")!;
    ctx.reset();
    const pixels = ctx.createImageData(2, 1);
    pixels.data.set([200, 100, 50, 128, 7, 9, 11, 3]);
    rec.arm(design);
    rec.begin();
    ctx.putImageData(pixels, 0, 0);
    rec.end(8);
    return rec.disarm();
  }, DESIGN);

  const { images } = scripted(recording);
  expect(images).toHaveLength(1);
  const captured = images[0];
  expect(captured.kind).toBe("pixels");
  expect(captured).toMatchObject({ width: 2, height: 1 });
  // No `src`: a pixel buffer needs no image decoder and never becomes one.
  expect((captured as { src?: string }).src).toBeUndefined();
  const bytes =
    captured.kind === "pixels" ? [...Buffer.from(captured.data, "base64")] : [];
  expect(bytes).toEqual([200, 100, 50, 128, 7, 9, 11, 3]);
});

it("follows a value as deep as the format pins, and no deeper", async () => {
  // The depth bound is a fixed part of the format rather than this recorder's own
  // choice. Two recorders write these documents — the engine's and this one — and
  // a bound they disagreed on would have them answer the same drawing with two
  // different documents.
  const recording = await h.page.evaluate((design) => {
    const rec = (window as unknown as { __caromRec: PageRecorder }).__caromRec;
    const ctx = document.querySelector("canvas")!.getContext("2d")!;
    ctx.reset();
    const nest = (levels: number): Record<string, unknown> => {
      let value: Record<string, unknown> = { leaf: 1 };
      for (let at = 0; at < levels; at += 1) value = { down: value };
      return value;
    };
    rec.arm(design);
    rec.begin();
    ctx.fillStyle = nest(20) as unknown as string;
    ctx.fillStyle = nest(40) as unknown as string;
    rec.end(8);
    return rec.disarm();
  }, DESIGN);

  const { ops, frames } = scripted(recording);
  const values = frames[0].ops.map((at) =>
    JSON.stringify((ops[at] as { value: unknown }).value),
  );
  // Twenty levels is inside the bound and reaches the leaf.
  expect(values[0]).toContain('"leaf":1');
  expect(values[0]).not.toContain("$opaque");
  // Forty is past it, and terminates in the marker every value the recorder cannot
  // carry gets.
  expect(values[1]).toContain('{"$opaque":"Object"}');
});

it("writes a matrix to nine significant digits", async () => {
  // A matrix is carried as the six numbers `setTransform` accepts, and they are
  // part of the drawing: seventeen characters each, on every operation that puts a
  // transform back, and a pair of them that differ past the ninth digit are two
  // operations where the picture has one.
  const recording = await h.page.evaluate((design) => {
    const rec = (window as unknown as { __caromRec: PageRecorder }).__caromRec;
    const ctx = document.querySelector("canvas")!.getContext("2d")!;
    ctx.reset();
    rec.arm(design);
    rec.begin();
    ctx.translate(1 / 3, 2 / 3);
    const held = ctx.getTransform();
    ctx.resetTransform();
    ctx.setTransform(held);
    rec.end(8);
    return { written: rec.disarm(), exact: { e: held.e, f: held.f } };
  }, DESIGN);

  const { ops, frames } = scripted(recording.written);
  const put = frames[0].ops
    .map((at) => ops[at])
    .find((op) => op.op === "call" && op.method === "setTransform") as {
    args: { e: number; f: number }[];
  };
  const { e, f } = recording.exact;
  expect(put.args[0]).toEqual({
    a: 1,
    b: 0,
    c: 0,
    d: 1,
    e: Number(e.toPrecision(9)),
    f: Number(f.toPrecision(9)),
  });
  // The rounding is the point: the context answered a longer number than that.
  expect(put.args[0].e).not.toBe(e);
});

it("writes an inherited transform and dash to nine significant digits", async () => {
  // The state a frame inherits carries the same numbers as its operations, and it
  // carries one per frame whether or not anything about it changed. A state block
  // written at full expansion is also a state block that stops matching the one
  // before it, so the table holds a copy per frame.
  const recording = await h.page.evaluate((design) => {
    const rec = (window as unknown as { __caromRec: PageRecorder }).__caromRec;
    const ctx = document.querySelector("canvas")!.getContext("2d")!;
    ctx.reset();
    rec.arm(design);
    rec.begin();
    ctx.translate(1 / 3, 2 / 3);
    ctx.setLineDash([1 / 7, 2 / 7]);
    ctx.beginPath();
    ctx.rect(0, 0, 4, 4);
    ctx.clip();
    rec.end(8);
    rec.begin();
    ctx.fillRect(0, 0, 1, 1);
    rec.end(8);
    const held = ctx.getTransform();
    return {
      written: rec.disarm(),
      exact: { e: held.e, f: held.f, dash: ctx.getLineDash() },
    };
  }, DESIGN);

  const { states, frames } = scripted(recording.written);
  const { e, f, dash } = recording.exact;
  const rounded = (n: number): number => Number(n.toPrecision(9));
  const inherited = states[frames[1].state];
  expect(inherited.transform).toEqual([1, 0, 0, 1, rounded(e), rounded(f)]);
  expect(inherited.transform).not.toEqual([1, 0, 0, 1, e, f]);
  // A clip segment carries the transform it was cut under, and it is written the
  // same way.
  expect(inherited.clip[0].transform).toEqual([
    1,
    0,
    0,
    1,
    rounded(e),
    rounded(f),
  ]);
  expect(inherited.lineDash).toEqual(dash.map(rounded));
  expect(inherited.lineDash).not.toEqual(dash);
});

/* -------------------------------------------------------------------------- */
/* What a recording is about                                                  */
/* -------------------------------------------------------------------------- */

it("keeps recording the surface the section was armed on", async () => {
  // A recording belongs to ONE surface for its whole length. A build that asks for
  // a second 2D context part-way through a section would otherwise move which
  // surface that is: the frames would be closed against one recorder, `disarm`
  // would ask an idle one, and the review point's declared replay output would
  // simply never turn up.
  const recording = await h.page.evaluate((design) => {
    const rec = (window as unknown as { __caromRec: PageRecorder }).__caromRec;
    const ctx = document.querySelector("canvas")!.getContext("2d")!;
    ctx.reset();
    rec.arm(design);
    rec.begin();
    ctx.fillRect(0, 0, 4, 4);
    // Larger than the game's own canvas, and attached, so it wins every test the
    // primary surface is chosen by.
    const bigger = document.createElement("canvas");
    bigger.width = 4000;
    bigger.height = 4000;
    document.body.appendChild(bigger);
    bigger.getContext("2d");
    rec.end(8);
    const written = rec.disarm();
    bigger.remove();
    return written;
  }, DESIGN);

  const { ops, frames } = scripted(recording);
  expect(frames).toHaveLength(1);
  expect(frames[0].ops.map((at) => ops[at])).toEqual([
    { op: "call", method: "fillRect", args: [0, 0, 4, 4] },
  ]);
});

it("gives back what a frame the document will not hold was charged", async () => {
  // The budget is the bytes the DOCUMENT will hold. A frame is charged for the
  // images it names the moment it names them, so no single frame can blow past the
  // ceiling before it closes — but a frame decimation then drops is not in the
  // document, and a recording that went on paying for it would stop capturing far
  // below the ceiling and hand the reviewer a replay that stops drawing part-way
  // through. Each of the frames below blits a picture of its own, and the run
  // draws four times as many bytes as the budget holds while never holding more
  // than half of it.
  const BUDGET = 16 * 1024 * 1024;
  const FRAMES = 2401;
  const recording = await h.page.evaluate(
    ({ design, frames }) => {
      const rec = (window as unknown as { __caromRec: PageRecorder })
        .__caromRec;
      const ctx = document.querySelector("canvas")!.getContext("2d")!;
      ctx.reset();
      const source = document.createElement("canvas");
      source.width = 50;
      source.height = 50;
      const paint = source.getContext("2d")!;
      // Noise, because a picture that compresses is a picture that costs the
      // budget nothing, and opaque, because a channel behind a partial alpha does
      // not survive the canvas and two frames would capture the same bytes.
      const picture = paint.createImageData(50, 50);
      for (let at = 0; at < picture.data.length; at += 4) {
        picture.data[at] = (Math.random() * 256) | 0;
        picture.data[at + 1] = (Math.random() * 256) | 0;
        picture.data[at + 2] = (Math.random() * 256) | 0;
        picture.data[at + 3] = 255;
      }

      rec.arm(design);
      for (let frame = 0; frame < frames; frame += 1) {
        picture.data[0] = frame & 0xff;
        picture.data[1] = (frame >> 8) & 0xff;
        paint.putImageData(picture, 0, 0);
        rec.begin();
        ctx.drawImage(source, 0, 0);
        rec.end(8);
      }
      return rec.disarm();
    },
    { design: DESIGN, frames: FRAMES },
  );

  const written = scripted(recording);
  const { images, ops, frames } = written;
  // The arithmetic the assertion below rests on, stated rather than assumed: what
  // the document holds is comfortably inside the budget, and what the whole run
  // captured is far outside it.
  const each = bitmap(images[0]).length;
  expect(each * 600).toBeLessThan(BUDGET * 0.75);
  expect(each * FRAMES).toBeGreaterThan(BUDGET * 1.5);
  // Every frame the document holds draws the picture it drew. A recording that
  // never gave anything back reaches the ceiling part-way through and records the
  // rest as the marker a player reports and skips.
  const drawn = frames.map(
    (frame) => (ops[frame.ops[0]] as { args: unknown[] }).args[0],
  );
  expect(
    drawn.filter((arg) => typeof (arg as { $img?: number }).$img === "number"),
  ).toHaveLength(frames.length);
  expect(new Set(drawn.map((arg) => (arg as { $img: number }).$img)).size).toBe(
    frames.length,
  );
  expect(inRange(written)).toEqual([]);
}, 120_000);

it("sees a reset that leaves the canvas exactly the size it was", async () => {
  // `canvas.width = canvas.width` is the ordinary way a build clears its surface,
  // and it resets the context completely — transform, properties, clip, current
  // path, save stack — while changing no dimension. A recorder comparing sizes
  // sees nothing at all, and every frame after it inherits a clip and a stack the
  // context no longer has.
  const recording = await h.page.evaluate((design) => {
    const rec = (window as unknown as { __caromRec: PageRecorder }).__caromRec;
    const canvas = document.querySelector("canvas")!;
    const ctx = canvas.getContext("2d")!;
    ctx.reset();
    rec.arm(design);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, 8, 8);
    ctx.clip();

    rec.begin();
    // The self-assignment IS the subject: it is the canonical canvas clear, and
    // it is the one reset that leaves every dimension where it was. Assigning any
    // other value would change the size and so pose the reset a recorder can
    // already see, which is the opposite of what this check is about.
    // eslint-disable-next-line no-self-assign
    canvas.width = canvas.width;
    ctx.fillRect(0, 0, 4, 4);
    rec.end(8);
    return rec.disarm();
  }, DESIGN);

  const { states, frames } = scripted(recording);
  expect(frames[0].stack).toEqual([]);
  expect(states[frames[0].state].clip).toEqual([]);
  expect(states[frames[0].state].path).toEqual([]);
});

it("drops the operations a reset inside the frame wiped", async () => {
  // The wipe erased the pixels those operations drew, so replaying them would
  // paint the frame's own history back over a picture that never had it. What the
  // frame holds is what its last operation left on the canvas, and a check reading
  // the frame's calls is answered the same way.
  const scripts = await h.page.evaluate((design) => {
    const rec = (window as unknown as { __caromRec: PageRecorder }).__caromRec;
    const canvas = document.querySelector("canvas")!;
    const ctx = canvas.getContext("2d")!;
    ctx.reset();
    rec.arm(design);
    rec.begin();
    ctx.fillRect(0, 0, 64, 64);
    // The self-assignment IS the subject: it is the canonical canvas clear, and
    // the wipe it performs is what has to drop the operations before it. A clear
    // written any other way would not be the one a build issues.
    // eslint-disable-next-line no-self-assign
    canvas.width = canvas.width;
    ctx.fillRect(0, 0, 8, 8);
    rec.end(8);
    const calls = rec.last();
    return { recording: rec.disarm(), calls };
  }, DESIGN);

  const { ops, frames } = scripted(scripts.recording);
  expect(frames[0].ops.map((at) => ops[at])).toEqual([
    { op: "call", method: "fillRect", args: [0, 0, 8, 8] },
  ]);
  expect(scripts.calls).toEqual([
    { op: "call", method: "fillRect", args: [0, 0, 8, 8] },
  ]);
});

it("captures a blit's source as it was before the blit", async () => {
  // `ctx.drawImage(ctx.canvas, …)` is the ordinary trails or feedback blit: the
  // argument names the very surface the call is about to draw over. Read after the
  // call it holds what the blit produced, and the replay composites the picture on
  // top of itself.
  const probe = await h.page.evaluate(async (design) => {
    const rec = (window as unknown as { __caromRec: PageRecorder }).__caromRec;
    const canvas = document.querySelector("canvas")!;
    const ctx = canvas.getContext("2d")!;
    ctx.reset();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#ff0000";
    ctx.fillRect(0, 0, 8, 8);

    rec.arm(design);
    rec.begin();
    // Copies the red square eight to the right, so the pixel at (8, 0) is
    // transparent before the call and red after it.
    ctx.drawImage(canvas, 8, 0);
    rec.end(8);
    const recording = rec.disarm()!;

    const image = new Image();
    image.src = (recording.images[0] as { src: string }).src;
    await image.decode();
    const read = document.createElement("canvas");
    read.width = image.width;
    read.height = image.height;
    const into = read.getContext("2d")!;
    into.drawImage(image, 0, 0);
    return {
      images: recording.images.length,
      source: [...into.getImageData(0, 0, 1, 1).data],
      destination: [...into.getImageData(8, 0, 1, 1).data],
    };
  }, DESIGN);

  expect(probe.images).toBe(1);
  expect(probe.source).toEqual([255, 0, 0, 255]);
  // Transparent: the capture is the surface the call was given, not the one it
  // left behind.
  expect(probe.destination[3]).toBe(0);
});

it("records a mutation made through a value read back off the context", async () => {
  // `ctx.fillStyle` hands back the gradient the build assigned. A colour stop
  // added through that read is a mutation like any other, and a `get` trap that
  // returned the raw value would make every one of them invisible — the build
  // paints two stops and the replay paints one.
  const recording = await h.page.evaluate((design) => {
    const rec = (window as unknown as { __caromRec: PageRecorder }).__caromRec;
    const ctx = document.querySelector("canvas")!.getContext("2d")!;
    ctx.reset();
    rec.arm(design);
    rec.begin();
    const fill = ctx.createLinearGradient(0, 0, 8, 0);
    fill.addColorStop(0, "#ff0000");
    ctx.fillStyle = fill;
    (ctx.fillStyle as CanvasGradient).addColorStop(1, "#0000ff");
    ctx.fillRect(0, 0, 8, 8);
    rec.end(8);
    return rec.disarm();
  }, DESIGN);

  const { resources, ops, frames } = scripted(recording);
  const issued = frames[0].ops.map((at) => ops[at]);
  const painted = issued[issued.length - 1];
  expect(painted).toEqual({
    op: "call",
    method: "fillRect",
    args: [0, 0, 8, 8],
  });
  // The stop added through the read-back moved the value on from what the
  // assignment stated, so the paint is preceded by the corrective assignment that
  // states what the context is about to paint with.
  const stated = issued[issued.length - 2] as { value: { $res: number } };
  expect(resources[stated.value.$res].then).toEqual([
    { op: "call", method: "addColorStop", args: [0, "#ff0000"] },
    { op: "call", method: "addColorStop", args: [1, "#0000ff"] },
  ]);
});

it("bounds the current path, and says so on the frame", async () => {
  // The path buffer has no frame boundary to bound it: only `beginPath` and
  // `reset` empty it, so a build that calls neither accumulates operations for the
  // rest of the recording and every frame open pays to re-encode all of them. Past
  // the bound the operation is refused, and the frame that inherited the shortened
  // path says it was shortened.
  const SHADOW_OPS = 1024;
  const recording = await h.page.evaluate(
    ({ design, bound }) => {
      const rec = (window as unknown as { __caromRec: PageRecorder })
        .__caromRec;
      const ctx = document.querySelector("canvas")!.getContext("2d")!;
      ctx.reset();
      rec.arm(design);
      ctx.beginPath();
      for (let at = 0; at < bound + 200; at += 1) ctx.lineTo(at, at);

      rec.begin();
      ctx.stroke();
      rec.end(8);
      return rec.disarm();
    },
    { design: DESIGN, bound: SHADOW_OPS },
  );

  const { states, frames } = scripted(recording);
  const carried = states[frames[0].state].path.reduce(
    (sum, segment) => sum + segment.ops.length,
    0,
  );
  // The `beginPath` is kept as an operation of the path, so the bound holds it and
  // the 1023 `lineTo` calls that fit behind it.
  expect(carried).toBe(SHADOW_OPS);
  expect(frames[0].truncated).toBe(true);
});

it("bounds the clip region, and says so on the frame", async () => {
  // Clips intersect rather than replace, so the region in force is every segment
  // ever applied and nothing but `reset` empties it. A clip that would take the
  // region past the bound is refused whole rather than kept in part: half a clip
  // path is a region the build never had.
  const recording = await h.page.evaluate((design) => {
    const rec = (window as unknown as { __caromRec: PageRecorder }).__caromRec;
    const ctx = document.querySelector("canvas")!.getContext("2d")!;
    ctx.reset();
    rec.arm(design);
    for (let at = 0; at < 700; at += 1) {
      ctx.beginPath();
      ctx.rect(0, 0, 64 - at * 0.01, 64);
      ctx.clip();
    }

    rec.begin();
    ctx.fillRect(0, 0, 4, 4);
    rec.end(8);
    return rec.disarm();
  }, DESIGN);

  const { states, frames } = scripted(recording);
  const carried = states[frames[0].state].clip.reduce(
    (sum, segment) => sum + segment.ops.length,
    0,
  );
  // Each clip costs three operations — the `beginPath`, the `rect` and the `clip`
  // itself — so the bound falls part-way through and the rest are refused.
  expect(carried).toBeGreaterThan(0);
  expect(carried).toBeLessThanOrEqual(1024 + 3);
  expect(frames[0].truncated).toBe(true);
});

it("carries the remainder of an over-long value as one marker", async () => {
  // A depth bound alone does not bound the work, so encoding also bounds how many
  // values one value may expand into. Past that bound the REMAINDER is one marker:
  // replacing each of half a million elements with its own marker produces a
  // document larger than the data it declined to carry.
  const ENCODE_NODES = 65536;
  const summary = await h.page.evaluate(
    ({ design, bound }) => {
      const rec = (window as unknown as { __caromRec: PageRecorder })
        .__caromRec;
      const ctx = document.querySelector("canvas")!.getContext("2d")!;
      ctx.reset();
      rec.arm(design);
      rec.begin();
      ctx.setLineDash(new Array(bound + 20_000).fill(1));
      // A plain object the context ignores, so the encoder walks it and the canvas
      // does not: the remainder of an object needs a name where an array's is its
      // last element.
      const wide: Record<string, number> = {};
      for (let at = 0; at < bound + 1_000; at += 1) wide[`k${at}`] = at;
      ctx.fillStyle = wide as unknown as string;
      rec.end(8);

      const recording = rec.disarm()!;
      const dash = (
        recording.ops[recording.frames[0].ops[0]] as { args: unknown[][] }
      ).args[0];
      const object = (
        recording.ops[recording.frames[0].ops[1]] as {
          value: Record<string, unknown>;
        }
      ).value;
      const keys = Object.keys(object);
      return {
        dashLength: dash.length,
        dashLast: dash[dash.length - 1],
        objectKeys: keys.length,
        objectLast: keys[keys.length - 1],
        rest: object.$rest,
      };
    },
    { design: DESIGN, bound: ENCODE_NODES },
  );

  expect(summary.dashLength).toBe(ENCODE_NODES + 1);
  expect(summary.dashLast).toEqual({ $opaque: "truncated" });
  expect(summary.objectKeys).toBe(ENCODE_NODES + 1);
  expect(summary.objectLast).toBe("$rest");
  expect(summary.rest).toEqual({ $opaque: "truncated" });
});

it("resolves a value reached down many paths once", async () => {
  // Sharing is what a depth bound cannot see: twelve levels of a graph where each
  // node names the same next one twice is shallower than the bound and expands
  // into four thousand values. Without a memo beside the cycle guard the shared
  // node is walked once per path, which is two to the twelfth walks of it — and
  // the cycle guard cannot double as one, because a node still being walked is a
  // cycle where one that finished is sharing.
  const probe = await h.page.evaluate((design) => {
    const rec = (window as unknown as { __caromRec: PageRecorder }).__caromRec;
    const ctx = document.querySelector("canvas")!.getContext("2d")!;
    ctx.reset();
    let reads = 0;
    const shared = {
      get leaf(): number {
        reads += 1;
        return 1;
      },
    };
    let graph: unknown = shared;
    for (let level = 0; level < 12; level += 1) graph = { a: graph, b: graph };

    rec.arm(design);
    rec.begin();
    // A plain object assigned to a style property is a silent no-op on a canvas
    // and a value the encoder walks in full.
    ctx.fillStyle = graph as string;
    rec.end(8);
    const recording = rec.disarm()!;

    // The whole graph, written out: sharing is resolved once and carried every
    // time it is reached, so the document says what the value means.
    const deepest = (value: unknown): unknown => {
      let at = value;
      for (let level = 0; level < 12; level += 1) {
        at = (at as { a: unknown }).a;
      }
      return at;
    };
    const written = (
      recording.ops[recording.frames[0].ops[0]] as { value: unknown }
    ).value;
    return { reads, deepest: deepest(written) };
  }, DESIGN);

  // Twice: once for the pooled form the recording holds and once for the
  // self-contained form a check reads. Four thousand and ninety-six times each
  // without the memo.
  expect(probe.reads).toBe(2);
  expect(probe.deepest).toEqual({ leaf: 1 });
});

it("carries a field named __proto__ as a field", async () => {
  // A build's own object may carry a field named `__proto__`, and assigning that
  // name reaches the prototype setter instead of writing a field the document
  // carries. Asserted inside the page, because Playwright's serializer drops such
  // a field on the way out and would report the defect as the fix.
  const probe = await h.page.evaluate((design) => {
    const rec = (window as unknown as { __caromRec: PageRecorder }).__caromRec;
    const ctx = document.querySelector("canvas")!.getContext("2d")!;
    ctx.reset();
    rec.arm(design);
    rec.begin();
    ctx.fillStyle = JSON.parse('{"__proto__": {"tainted": true}}') as string;
    rec.end(8);
    const recording = rec.disarm()!;

    const written = (
      recording.ops[recording.frames[0].ops[0]] as {
        value: Record<string, unknown>;
      }
    ).value;
    return {
      own: Object.prototype.hasOwnProperty.call(written, "__proto__"),
      // The prototype the assignment would have replaced, and the field the
      // recording is supposed to be carrying.
      plain: Object.getPrototypeOf(written) === Object.prototype,
      keys: Object.keys(written),
    };
  }, DESIGN);

  expect(probe.own).toBe(true);
  expect(probe.plain).toBe(true);
  expect(probe.keys).toEqual(["__proto__"]);
});

it("charges the capture budget what a pixel buffer costs to carry", async () => {
  // A `pixels` entry carries its own RGBA bytes rather than a PNG, and those bytes
  // are the whole of its weight. A budget that charged the entry rather than its
  // payload would never cap a recording of `putImageData` blits at all, and a
  // reviewer would be handed tens of megabytes no browser can load.
  const SIDE = 1448;
  const summary = await h.page.evaluate(
    ({ design, side }) => {
      const rec = (window as unknown as { __caromRec: PageRecorder })
        .__caromRec;
      const ctx = document.querySelector("canvas")!.getContext("2d")!;
      ctx.reset();
      rec.arm(design);
      rec.begin();
      // Three buffers of eight megabytes of base64 each: the first two fit inside
      // the sixteen-megabyte ceiling and the third is past it. Each differs from
      // the last, so none of them shares an entry with another.
      for (let at = 0; at < 3; at += 1) {
        const buffer = new ImageData(side, side);
        buffer.data[0] = at + 1;
        ctx.putImageData(buffer, 0, 0);
      }
      rec.end(8);
      const recording = rec.disarm()!;
      return {
        images: recording.images.length,
        drawn: recording.frames[0].ops.map(
          (at) => (recording.ops[at] as { args: unknown[] }).args[0],
        ),
      };
    },
    { design: DESIGN, side: SIDE },
  );

  expect(summary.images).toBe(2);
  expect(summary.drawn).toEqual([
    { $img: 0 },
    { $img: 1 },
    // Past the ceiling a new capture degrades to the marker a player reports and
    // skips, which is a partly-drawn replay rather than no replay at all.
    { $opaque: "ImageData" },
  ]);
}, 120_000);

it("rewrites a field named __proto__ as a field", async () => {
  // The tables a recording carries are rebuilt out of the frames that survived
  // decimation, and every value inside one is rewritten as it is reached. A field
  // named `__proto__` written with an assignment reaches the prototype setter
  // instead of becoming a field, so the rewrite silently drops it and replaces the
  // object's prototype with whatever it held.
  //
  // Handed to the rewrite directly, because no browser can deliver one: the
  // recorder writes the field correctly and Playwright's serializer drops it on
  // the way out of the page.
  const held = JSON.parse('{"__proto__": {"tainted": true}}') as object;
  const recording: Recording = {
    format: 1,
    width: 8,
    height: 8,
    background: null,
    images: [],
    resources: [],
    ops: [{ op: "set", property: "fillStyle", value: held }],
    states: [
      {
        properties: JSON.parse('{"__proto__": 1}') as Record<string, unknown>,
        transform: null,
        lineDash: null,
        clip: [],
        path: [],
      },
    ],
    frames: [
      {
        count: 1,
        timeMs: 8,
        deltaMs: 8,
        surface: { width: 8, height: 8 },
        state: 0,
        stack: [],
        ops: [0],
      },
    ],
  };

  const rewritten = retable(recording, recording.frames);
  const written = (rewritten.ops[0] as { value: object }).value;
  expect(Object.prototype.hasOwnProperty.call(written, "__proto__")).toBe(true);
  expect(Object.getPrototypeOf(written)).toBe(Object.prototype);
  const properties = rewritten.states[0].properties;
  expect(Object.prototype.hasOwnProperty.call(properties, "__proto__")).toBe(
    true,
  );
  expect(Object.getPrototypeOf(properties)).toBe(Object.prototype);
});
