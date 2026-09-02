// harness — the parts of the harness that nothing else can catch.
//
// The suites next door are validators: each decides one review point against the
// build. This file decides nothing about the build. It checks the harness's own
// machinery, because several of its rules are invisible from inside a suite and
// wrong in ways nothing else notices. A recording written in the wrong framing
// reaches the console as something it cannot read; a recording written for a
// section that drew nothing is reported to the reviewer as evidence that exists;
// a rectangle mapped through the wrong transform attributes a draw to the wrong
// tile, and every presentation check built on it then agrees with itself about the
// wrong answer; a window whose two readings come from different moments answers a
// question nobody asked.
//
// The three expectation modules — `geometry.ts`, `thermal.ts` and `routes.ts` —
// are checked here too, and against arithmetic done by hand rather than against
// the build. They exist precisely so that no threshold in this suite is a number a
// reference produced, and a check of them that read the build back would give that
// away.
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
import type { Recording } from "@test-cabinet/simple-2d";
import { BASE_K, RAD_K, STAGE_H, STAGE_W } from "./constants";
import { edgeTiles, worldRadiators } from "./geometry";
import {
  boxIn,
  captureReplay,
  captureStill,
  createHarness,
  createRealtimeHarness,
  drawFrame,
  drawnRects,
  overRealWindow,
  overWindow,
  poseIdleTower,
  poseWalker,
  retable,
  seconds,
  startRun,
  ticksFor,
  towerOf,
  unitOf,
  type Harness,
} from "./harness";
import { blockedOf, costBetween, ventRouteLength } from "./routes";
import { facesOf, floorOf, heatsAfter, termsFor } from "./thermal";

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
  mediaDir = mkdtempSync(join(tmpdir(), "meltdown-media-"));
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

/** One operation of a recording, as the console's player reads it. */
type RecordedOp =
  | { op: "call"; method: string; args: unknown[] }
  | { op: "set"; property: string; value: unknown };

/** One run of path operations, and the transform they were issued under. */
interface RecordedPathSegment {
  transform: number[] | null;
  ops: RecordedOp[];
}

/** A recording read back off disk, in the shape the assertions below read. */
interface WrittenRecording {
  format: number;
  images: unknown[];
  resources: {
    make: { method: string; args: unknown[] };
    then: RecordedOp[];
  }[];
  ops: RecordedOp[];
  states: {
    properties: Record<string, unknown>;
    clip: RecordedPathSegment[];
    path: RecordedPathSegment[];
  }[];
  frames: {
    count: number;
    timeMs: number;
    deltaMs: number;
    state: number;
    stack: number[];
    ops: number[];
  }[];
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

/* ---- Evidence capture ----------------------------------------------------- */

it("writes a captured section as gzip, under its output's extension", async () => {
  await captureReplay(h, "crossing", () => h.advance(4));

  expect(written()).toEqual(["crossing.json.gz"]);
  const recording = readBack("crossing.json.gz");
  expect(recording.format).toBeGreaterThan(0);
  expect(recording.frames.length).toBeGreaterThan(0);
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
  // Capture sits beside a check's assertions rather than in place of them, so what
  // the scenario computed has to survive being recorded.
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
  startRun(h);
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
  // Dropping a frame drops the last reference to whatever only that frame drew
  // with, and the four tables in front of a recording are shared by every frame in
  // it. What is written names every entry of the tables it carries, so nothing
  // dropped is still being paid for.
  const named = new Set(recording.frames.flatMap((frame) => frame.ops));
  expect(named.size).toBe(recording.ops.length);
  const inherited = new Set(
    recording.frames.flatMap((frame) => [frame.state, ...frame.stack]),
  );
  expect(inherited.size).toBe(recording.states.length);
  // Minimal is only half of it. A table rebuilt against the wrong indices is the
  // same size as one rebuilt against the right ones, and it addresses entries that
  // are not there: naming {0, 5} of a two-entry table names as many entries as it
  // has. Every index a frame carries has to address the table it was interned
  // into.
  expect(inRange(recording)).toEqual([]);
});

it("spends the budget on the section, never one frame past it", async () => {
  // The stride rounds up, which puts the sharp edge of the cap at a section whose
  // length is an exact multiple of it: the strided frames come to exactly the cap
  // and stop one stride short of the end. Both rules still hold there. Nothing
  // over the cap, because the cap is what makes `captureReplay` safe to wrap any
  // section in; and the section's last frame written, because it is the frame the
  // check's sweep stopped at. So the last frame takes the place of the frame the
  // stride stopped on rather than being written beside it, and the three lengths
  // driven here are that multiple and one frame either side of it.
  startRun(h);
  for (const length of [599, 600, 601]) {
    const at = `edge-${length}`;
    await captureReplay(h, at, () => h.advance(length));
    const frames = readBack(`${at}.json.gz`).frames;

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
    expect(elapsed, at).toBeCloseTo((length * 1000) / 120, 3);
  }
});

it("rewrites a field named __proto__ as a field", async () => {
  // The tables a recording carries are rebuilt out of the frames that survived
  // decimation, and every value inside one is rewritten as it is reached. A field
  // named `__proto__` written with an assignment reaches the prototype setter
  // instead of becoming a field, so the rewrite silently drops it and replaces the
  // object's prototype with whatever it held.
  //
  // The engine's recorder writes such a field for a build that passes one, and
  // this build passes none — so the rewrite is handed one directly rather than
  // through a drawing nothing in this case makes.
  const held = JSON.parse('{"__proto__": {"tainted": true}}') as Record<
    string,
    never
  >;
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
        properties: held,
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
  const value = (rewritten.ops[0] as { value: object }).value;
  expect(Object.prototype.hasOwnProperty.call(value, "__proto__")).toBe(true);
  expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
  const properties = rewritten.states[0].properties;
  expect(Object.prototype.hasOwnProperty.call(properties, "__proto__")).toBe(
    true,
  );
  expect(Object.getPrototypeOf(properties)).toBe(Object.prototype);
});

it("writes the frame on the canvas as a still", async () => {
  startRun(h);
  await h.advance(1);
  captureStill(h, "floor");

  expect(written()).toEqual(["floor.png"]);
  const bytes = readFileSync(join(mediaDir, SUITE_DIR, "floor.png"));
  // A PNG opens with the eight-byte signature (RFC 2083), so this is the canvas
  // actually being encoded rather than named as though it were.
  expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
});

/* ---- Reading a frame ------------------------------------------------------ */

it("maps a drawn rectangle back into logical stage units", async () => {
  // A build draws by translating and scaling as it likes, and the canvas the
  // engine hands it is in DEVICE pixels: at a device pixel ratio of 2 on a
  // half-size element, one logical unit is one device pixel only by accident.
  // `drawnRects` is what maps a call's own arguments back through the transform
  // the context held and the engine's letterboxed fit, and every presentation
  // check that attributes a draw to a tile or to the panel strip rests on it —
  // agreeing with itself whether it is right or wrong. So it is read here against
  // the one thing true of every build: what it drew, it drew on the stage.
  const fitted = await createHarness({
    cssWidth: STAGE_W / 2,
    cssHeight: STAGE_H / 2,
    dpr: 2,
  });
  try {
    startRun(fitted);
    const rects = drawnRects(fitted, await drawFrame(fitted));

    expect(rects.length).toBeGreaterThan(0);
    // Half a unit of slack for a build that strokes a hairline on the stage's own
    // edge, and no more: a rect left in device pixels would be off by a factor.
    const off = rects.filter(
      (rect) =>
        rect.left < -0.5 ||
        rect.top < -0.5 ||
        rect.right > STAGE_W + 0.5 ||
        rect.bottom > STAGE_H + 0.5,
    );
    expect(off).toEqual([]);
    // And something reached the far side of the stage, so the mapping is not
    // merely collapsing everything into the top-left corner.
    expect(Math.max(...rects.map((rect) => rect.right))).toBeGreaterThan(
      STAGE_W / 2,
    );
  } finally {
    fitted.dispose();
  }
});

it("puts a pointer event where the logical position asked for", async () => {
  // `h.point` feeds the ENGINE's own pointer input rather than the debug surface,
  // which is the path a check about a cue has to take. The engine maps a client
  // position through the same letterboxed fit the game draws under, so the mapping
  // has to be inverted exactly — and at a device pixel ratio of 2 an inversion
  // that forgot the ratio would land at half the position it named.
  const fitted = await createHarness({
    cssWidth: STAGE_W / 2,
    cssHeight: STAGE_H / 2,
    dpr: 2,
  });
  try {
    startRun(fitted);
    fitted.point("move", 640, 360);
    await fitted.advance(1);

    const { pointer } = fitted.snapshot();
    expect(pointer.x).toBeCloseTo(640, 0);
    expect(pointer.y).toBeCloseTo(360, 0);
  } finally {
    fitted.dispose();
  }
});

/* ---- The clock rule ------------------------------------------------------- */

it("brackets a window with one snapshot at each end", async () => {
  // The measurement the pause pair rests on. Both readings a check takes come from
  // the same pair of snapshots, so a drift and a clock gain span the same window
  // and cannot be read a leg apart — which is the defect the rule was bought with.
  startRun(h);
  const mote = poseWalker(h, "mote", "left");
  const opened = h.snapshot();

  const window = await overWindow(h, ticksFor(0.5));

  expect(window.frames).toBe(ticksFor(0.5));
  expect(window.before.simTime).toBe(opened.simTime);
  expect(window.after.simTime).toBe(h.snapshot().simTime);
  expect(window.clockGain).toBeCloseTo(seconds(ticksFor(0.5)), 6);
  const from = unitOf(window.before, mote);
  const to = unitOf(window.after, mote);
  expect(window.travel(mote)).toBeCloseTo(
    Math.hypot(to.x - from.x, to.y - from.y),
    9,
  );
});

it("reports a tower's heat change across the window it bracketed", async () => {
  startRun(h);
  const arc = poseIdleTower(h, "arc", 20, 18, 0, 60);
  const window = await overWindow(h, ticksFor(0.5));

  expect(window.heatChange(arc)).toBeCloseTo(
    towerOf(window.after, arc).heat - towerOf(window.before, arc).heat,
    9,
  );
});

it("refuses a real window on a harness with no real clock", async () => {
  // A real window spent on a `ConstantClock` harness would measure the loop's own
  // scheduling rather than the passage of time, and would quietly report a number.
  // That is a fault in the check, so it is refused rather than answered.
  startRun(h);
  await expect(overRealWindow(h, 10)).rejects.toThrow(/createRealtimeHarness/);
});

it("hands the clock back to the build over a real window", async () => {
  // Nothing steps the game here: the engine's own frame loop schedules its frames
  // and its `WallClock` measures them, exactly as in a browser. This is what
  // `waves.game-runs-on-its-own-clock` needs, and it is the machinery that item
  // rests on rather than the item itself — what is asserted is that time reached
  // the game at all, not any figure the specification fixes.
  const live = await createRealtimeHarness();
  try {
    startRun(live);
    const mote = poseWalker(live, "mote", "left");
    const window = await overRealWindow(live, 500);

    expect(window.frames).toBeGreaterThan(0);
    expect(window.elapsedMs).toBeGreaterThanOrEqual(400);
    expect(window.clockGain).toBeGreaterThan(0);
    expect(window.travel(mote)).toBeGreaterThan(0);
  } finally {
    live.dispose();
  }
});

/* ---- The expectation modules ---------------------------------------------- */

it("turns a placement rotation on the radiator faces", () => {
  // The Arc's radiators are N and S at rotation 0, so rotation 1 turns them onto E
  // and W and rotation 2 puts them back. Hand-checked against specs/towers.md
  // rather than against the build, which has its own copy of this arithmetic.
  expect(worldRadiators("arc", 0).sort()).toEqual(["N", "S"]);
  expect(worldRadiators("arc", 1).sort()).toEqual(["E", "W"]);
  expect(worldRadiators("arc", 2).sort()).toEqual(["N", "S"]);
  expect(worldRadiators("forge", 3)).toEqual([]);
});

it("counts one perimeter edge-tile per tile of each side", () => {
  // A 2x2 face is two edge-tiles and a 4x4 face is four (specs/heat.md), so the
  // whole perimeter is four per side.
  expect(edgeTiles("arc", 10, 10)).toHaveLength(8);
  expect(edgeTiles("bloom", 10, 10)).toHaveLength(12);
  expect(edgeTiles("lance", 10, 10)).toHaveLength(16);
});

it("computes the four flows from the specification's own figures", () => {
  // An Arc alone in open air at heat 100: 2x2, radiators N and S, so four radiator
  // edge-tiles and four plain ones, and thermal mass 1.0.
  //
  //   airLoss = (RAD_K * 4 + BASE_K * 4) * (100 / 100) = 18.8
  //
  // Hand-computed from specs/heat.md and `src/constants.ts`, never read off the
  // build — which is the whole reason `thermal.ts` exists.
  const alone = [
    {
      id: 1,
      type: "arc" as const,
      col: 10,
      row: 10,
      rotation: 0,
      level: 1,
      heat: 100,
      tripped: false,
      thermalEnabled: true,
    },
  ];
  const faces = facesOf(alone, 1);
  expect(faces.radiator).toBe(4);
  expect(faces.plain).toBe(4);
  expect(faces.shared.size).toBe(0);

  const terms = termsFor(alone, 1, 1);
  expect(terms.airLoss).toBeCloseTo(RAD_K * 4 + BASE_K * 4, 9);
  expect(terms.airLoss).toBeCloseTo(18.8, 9);
  expect(terms.conduct).toBe(0);
  expect(terms.delta).toBeCloseTo(-18.8, 9);
  expect(heatsAfter(alone, 1).get(1)).toBeCloseTo(100 - 18.8, 9);
});

it("holds a boxed-in tower's air cooling at nothing", async () => {
  // An edge-tile facing another tower sheds nothing to air (specs/heat.md), so a
  // tower boxed on all four faces sheds nothing at all — which is what the thermal
  // blanket items rest on, and what `boxIn` is for.
  startRun(h);
  const arc = poseIdleTower(h, "arc", 20, 18, 0, 80);
  const around = boxIn(h, arc, { N: "arc", E: "arc", S: "arc", W: "arc" });
  expect(Object.keys(around).sort()).toEqual(["E", "N", "S", "W"]);

  const floor = floorOf(h.snapshot());
  const faces = facesOf(floor, arc);
  expect(faces.radiator).toBe(0);
  expect(faces.plain).toBe(0);
  expect(termsFor(floor, arc, 1).airLoss).toBe(0);
});

it("measures the open floor's routes by the specification's own metric", () => {
  // With nothing on it, the left vent's opening on column 0 reaches the right
  // exhaust's opening on column 49 in 49 orthogonal steps, and the top vent's on
  // row 0 reaches the bottom exhaust's on row 35 in 35. Hand-counted from
  // specs/floor.md's grid, never read off the build.
  expect(ventRouteLength([], "left")).toBeCloseTo(49, 9);
  expect(ventRouteLength([], "top")).toBeCloseTo(35, 9);
});

it("refuses a diagonal that cuts between two touching towers", () => {
  // A diagonal step is only a step when BOTH of the orthogonal tiles it cuts past
  // are open (specs/mazing.md), so a wall built as a diagonal chain is a wall.
  const open = blockedOf([]);
  expect(
    costBetween(open, [{ col: 5, row: 5 }], [{ col: 6, row: 6 }]),
  ).toBeCloseTo(Math.SQRT2, 9);

  const pinched = blockedOf([
    { type: "arc", col: 6, row: 4 },
    { type: "arc", col: 4, row: 6 },
  ]);
  // The corner is still open, but both tiles the diagonal cuts past are blocked,
  // so the cheapest way round costs more than the diagonal it refused.
  expect(
    costBetween(pinched, [{ col: 5, row: 5 }], [{ col: 6, row: 6 }]),
  ).toBeGreaterThan(Math.SQRT2 + 0.5);
});
