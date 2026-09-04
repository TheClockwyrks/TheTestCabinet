// harness — the harness's own self-test.
//
// The suites next door are validators: each decides one review point against the
// build. This file decides nothing about the build. It checks the HARNESS, because
// several of its rules are invisible from inside a suite and wrong in ways nothing
// else catches: an engine that never stood up, a surface never read off it, a
// compound sequence that arranges something other than what it says, and a replay
// written in the wrong framing or written for a section that drew nothing — which
// reaches the console as evidence that exists and then opens on nothing.
//
// It is deliberately NOT a validator, so it asserts with vitest's own `expect`
// rather than through `assert.ts`: there is no reviewer-facing expected/actual pair
// to render, because no review item names this file and a run never loads it. It
// runs with the whole project, which is how a case author runs these suites while
// writing them:
//
//   npx vitest run --config validation/vitest.config.ts

import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

import type { Recording } from "@test-cabinet/simple-2d";
import { afterEach, beforeEach, expect, it } from "vitest";

import {
  STAGE_H,
  STAGE_W,
  STAMPS_PER_LEVEL,
  START_CHARGE,
} from "../src/constants";
import {
  DEFAULT_SEED,
  FOUNDRY_DEBUG_VERSION,
  REQUIRED_OPS,
  captureReplay,
  captureStill,
  clearColor,
  clickControl,
  colorDistance,
  createHarness,
  emptyYard,
  holdWaveOpen,
  lastStructure,
  menuControl,
  openRun,
  openYard,
  parkUnit,
  pressAction,
  releaseUnit,
  retable,
  sampleColor,
  standBlocker,
  standCandidate,
  standCombo,
  standComponent,
  statusControl,
  structureById,
  structureCenter,
  tileCenter,
  unitById,
  watchCues,
  type Harness,
} from "./harness";

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
  mediaDir = mkdtempSync(join(tmpdir(), "arc-foundry-replay-"));
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

/* -------------------------------------------------------------------------- */
/* The engine, the surface, and the driver                                    */
/* -------------------------------------------------------------------------- */

it("stands the build's game up on a real engine, with no page behind it", () => {
  const snapshot = h.snapshot();
  expect(snapshot.version).toBe(FOUNDRY_DEBUG_VERSION);
  expect(snapshot.screen).toBe("title");
  expect(snapshot.phase).toBeNull();
});

it("reads the surface off the engine, carrying every required operation", () => {
  const { version, ops } = h.probe(REQUIRED_OPS);
  expect(version).toBe(FOUNDRY_DEBUG_VERSION);
  const absent = REQUIRED_OPS.filter((op) => ops[op] !== "function");
  expect(absent).toEqual([]);
});

it("drives a pose through engine.apply and a reading against engine.state", async () => {
  openRun(h);
  h.debug.setCharge(500);
  expect(h.snapshot().charge).toBe(500);
  // The pose is the state the NEXT frame receives, rather than something the
  // harness holds beside the engine's.
  await h.advance(1);
  expect(h.snapshot().charge).toBe(500);
});

it("draws frames, and clears the stage to the background the build declares", async () => {
  await h.advance(2);
  expect(h.frame()).toBe(2);
  expect(h.timeMs()).toBeCloseTo(2 * (1000 / 120), 6);
  // A corner of the stage, which no screen draws over.
  const corner = sampleColor(h, 3, 3);
  expect(colorDistance(corner, clearColor())).toBeLessThan(8);
});

/* -------------------------------------------------------------------------- */
/* The compound sequences                                                     */
/* -------------------------------------------------------------------------- */

it("opens a run at its first build phase with the stated allocation", () => {
  openRun(h, { map: "switchyard", difficulty: "easy" });
  const snapshot = h.snapshot();
  expect(snapshot.screen).toBe("playing");
  expect(snapshot.phase).toBe("build");
  expect(snapshot.map).toBe("switchyard");
  expect(snapshot.difficulty).toBe("easy");
  expect(snapshot.charge).toBe(START_CHARGE);
  expect(snapshot.stampsLeft).toBe(STAMPS_PER_LEVEL);
  expect(snapshot.waypoints).toHaveLength(6);
});

it("empties the yard of structures, units, and projectiles", () => {
  openRun(h);
  standComponent(h, "capacitor", 1, 10, 10);
  releaseUnit(h, "mote");
  expect(h.snapshot().structures.length).toBeGreaterThan(0);
  expect(h.snapshot().units.length).toBeGreaterThan(0);

  emptyYard(h);
  const snapshot = h.snapshot();
  expect(snapshot.structures).toEqual([]);
  expect(snapshot.units).toEqual([]);
  expect(snapshot.projectiles).toEqual([]);
  expect(snapshot.selected).toBeNull();
  expect(snapshot.combineSet).toEqual([]);
});

it("poses the resources openYard was asked for, over the opening allocation", () => {
  openYard(h, { seed: 7, wave: 12, charge: 900, integrity: 4, refinement: 3 });
  const snapshot = h.snapshot();
  expect(snapshot.wave).toBe(12);
  expect(snapshot.charge).toBe(900);
  expect(snapshot.integrity).toBe(4);
  expect(snapshot.refinement).toBe(3);
  expect(snapshot.structures).toEqual([]);
});

it("stands one structure of each kind up, and hands back its id", () => {
  openYard(h);
  const component = standComponent(h, "capacitor", 3, 10, 10);
  const combo = standCombo(h, "fusecluster", 14, 10, 2);
  const blocker = standBlocker(h, 18, 10);

  const snapshot = h.snapshot();
  expect(snapshot.structures).toHaveLength(3);
  expect(structureById(snapshot, component).kind).toBe("component");
  expect(structureById(snapshot, component).quality).toBe(3);
  expect(structureById(snapshot, combo).kind).toBe("combo");
  expect(structureById(snapshot, combo).level).toBe(2);
  expect(structureById(snapshot, blocker).kind).toBe("blocker");
  expect(structureById(snapshot, blocker).type).toBeNull();
  expect(lastStructure(snapshot).id).toBe(blocker);
});

it("drops a candidate through the real press and leaves the hand empty", () => {
  openYard(h);
  const before = h.snapshot().stampsLeft;
  const candidate = standCandidate(h, "coil", 4, 10, 10);

  const snapshot = h.snapshot();
  expect(structureById(snapshot, candidate).kind).toBe("candidate");
  expect(structureById(snapshot, candidate).type).toBe("coil");
  expect(structureById(snapshot, candidate).quality).toBe(4);
  // One stamp spent, and nothing left on the cursor — which is what makes the
  // inspector, rather than the held-rock read, what the panel shows.
  expect(snapshot.stampsLeft).toBe(before - 1);
  expect(snapshot.held.active).toBe(false);
  expect(snapshot.nextRoll).toBeNull();

  h.debug.select(candidate);
  const panel = h.debug.panelButtons().map((c) => c.action);
  expect(panel).toContain("keep");
  expect(panel).toContain("dismantle");
});

it("releases one unit, posed one faculty at a time", () => {
  openYard(h, { wave: 3 });
  const at = tileCenter(20, 15);
  const id = parkUnit(h, "slug", at, {
    hp: 12,
    slow: { amount: 0.5, seconds: 4 },
  });

  const unit = unitById(h.snapshot(), id);
  expect(unit.type).toBe("slug");
  expect(unit.x).toBeCloseTo(at.x, 6);
  expect(unit.y).toBeCloseTo(at.y, 6);
  expect(unit.hp).toBe(12);
  expect(unit.frozen).toBe(true);
  expect(unit.slowFactor).toBeCloseTo(0.5, 6);
  expect(unit.speed).toBeCloseTo(unit.baseSpeed * 0.5, 6);
});

it("holds a wave open with one unit nothing is shooting at", async () => {
  openYard(h);
  const bystander = holdWaveOpen(h);
  await h.advance(240);
  const snapshot = h.snapshot();
  expect(snapshot.waveActive).toBe(true);
  expect(unitById(snapshot, bystander).frozen).toBe(true);
});

/* -------------------------------------------------------------------------- */
/* The controls, the keyboard, and the pointer                                */
/* -------------------------------------------------------------------------- */

it("activates a status-bar control at the rectangle the reading reports", async () => {
  openYard(h);
  const speed = statusControl(h, "speed");
  expect(speed.state).toBe(1);
  expect(speed.x).toBeGreaterThanOrEqual(0);
  expect(speed.x + speed.w).toBeLessThanOrEqual(STAGE_W);
  expect(speed.y + speed.h).toBeLessThanOrEqual(STAGE_H);

  await clickControl(h, speed);
  expect(h.snapshot().speed).toBe(2);
  expect(statusControl(h, "speed").state).toBe(2);
});

it("takes a menu choice at the rectangle the reading reports", async () => {
  const salvage = menuControl(h, "salvage");
  await clickControl(h, salvage);
  expect(h.snapshot().screen).toBe("mapselect");
});

it("fires one action per press from the keyboard", async () => {
  openYard(h);
  await pressAction(h, "stamp");
  expect(h.snapshot().held.active).toBe(true);
  await pressAction(h, "back");
  expect(h.snapshot().held.active).toBe(false);
});

it("reports the cues the build played, by name and by frame", async () => {
  openYard(h);
  const played = watchCues(h);
  h.debug.placeRock(10, 10);
  await h.advance(1);
  const stamp = played.find((c) => c.cue === "stamp");
  expect(stamp).toBeDefined();
  expect(stamp?.frame).toBe(h.frame());
});

/* -------------------------------------------------------------------------- */
/* Evidence capture                                                           */
/* -------------------------------------------------------------------------- */

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
  // `0x1f 0x8b` (RFC 1952), so this is the capture actually being compressed rather
  // than named as though it were.
  expect([bytes[0], bytes[1]]).toEqual([0x1f, 0x8b]);
  return JSON.parse(gunzipSync(bytes).toString("utf8")) as WrittenRecording;
}

/**
 * Every index in `recording` that addresses nothing, named.
 *
 * A recording is almost entirely indices — a frame names its state, the states saved
 * under it and each of its operations by index, and an operation names the gradients
 * and images it draws with the same way. Every one of them has to address the table
 * it belongs to, because a player that resolves an index past the end of a table
 * draws a frame the build never drew and says nothing about it.
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

it("writes a captured section as gzip, under the replay extension", async () => {
  openYard(h);
  await captureReplay(h, "yard", () => h.advance(4));

  expect(written()).toEqual(["yard.json.gz"]);
  const recording = readBack("yard.json.gz");
  expect(recording.format).toBeGreaterThan(0);
  expect(recording.frames.length).toBeGreaterThan(0);
});

it("writes nothing at all for a section that drew no frames", async () => {
  // A scenario that runs no frame closes no frame, so there is no picture to write.
  // Leaving the file unwritten reports the output absent, which is the truthful
  // answer; a file holding an empty frame list would tell the reviewer there is a
  // replay to watch and then open a player on nothing.
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

it("leaves the evidence behind when the scenario throws", async () => {
  // A failing check is the one whose replay a reviewer most wants, so the write is
  // in a `finally` and the failure travels on untouched.
  openYard(h);
  await expect(
    captureReplay(h, "failed", async () => {
      await h.advance(3);
      throw new Error("the scenario failed");
    }),
  ).rejects.toThrow("the scenario failed");

  expect(written()).toEqual(["failed.json.gz"]);
  expect(readBack("failed.json.gz").frames.length).toBeGreaterThan(0);
});

it("writes a still of the frame the canvas is holding", async () => {
  openYard(h);
  standComponent(h, "capacitor", 5, 10, 10);
  await h.advance(1);
  captureStill(h, "posed");

  expect(written()).toEqual(["posed.png"]);
  const bytes = readFileSync(join(mediaDir, SUITE_DIR, "posed.png"));
  // The PNG signature (RFC 2083), read off the bytes rather than off the name.
  expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
});

it("keeps the whole of an over-long section, at a lower frame rate", async () => {
  // Far more frames than a written recording holds. What comes back covers the whole
  // section — the last frame driven is in it — rather than its opening.
  openYard(h);
  await captureReplay(h, "long", () => h.advance(1500));

  const recording = readBack("long.json.gz");
  expect(recording.frames.length).toBeGreaterThan(1);
  expect(recording.frames.length).toBeLessThanOrEqual(300);
  const counts = recording.frames.map((frame) => frame.count);
  expect([...counts].sort((a, b) => a - b)).toEqual(counts);
  // The deltas are restated against the frame kept before, so they still sum to the
  // section's elapsed time however many frames were dropped between them.
  const elapsed = recording.frames.reduce((sum, f) => sum + f.deltaMs, 0);
  expect(elapsed).toBeCloseTo((1500 * 1000) / 120, 3);
  // Dropping a frame drops the last reference to whatever only that frame drew with,
  // and the four tables in front of a recording are shared by every frame in it. What
  // is written names every entry of the tables it carries, so nothing dropped is
  // still being paid for.
  const named = new Set(recording.frames.flatMap((frame) => frame.ops));
  expect(named.size).toBe(recording.ops.length);
  const inherited = new Set(
    recording.frames.flatMap((frame) => [frame.state, ...frame.stack]),
  );
  expect(inherited.size).toBe(recording.states.length);
  // Minimal is only half of it. A table rebuilt against the wrong indices is the same
  // size as one rebuilt against the right ones, and it addresses entries that are not
  // there. Every index a frame carries has to address the table it was interned into.
  expect(inRange(recording)).toEqual([]);
});

it("spends the budget on the section, never one frame past it", async () => {
  // The stride rounds up, which puts the sharp edge of the cap at a section whose
  // length is an exact multiple of it: the strided frames come to exactly the cap and
  // stop one stride short of the end. Both rules still hold there. Nothing over the
  // cap, because the cap is what makes `captureReplay` safe to wrap any section in;
  // and the section's last frame written, because it is the frame the check's sweep
  // stopped at. So the last frame takes the place of the frame the stride stopped on
  // rather than being written beside it, and the three lengths driven here are that
  // multiple and one frame either side of it.
  openYard(h);
  for (const length of [599, 600, 601]) {
    const at = `edge-${length}`;
    await captureReplay(h, at, () => h.advance(length));
    const frames = readBack(`${at}.json.gz`).frames;

    expect(frames.length, at).toBeLessThanOrEqual(300);
    // The first frame of a section is always kept — the stride opens on it — so the
    // span between the first count and the last is the whole section exactly when the
    // frame it ended on is the frame written last.
    expect(frames[frames.length - 1].count - frames[0].count, at).toBe(
      length - 1,
    );
    // Displacing a frame leaves the deltas summing to the elapsed time, the same as
    // dropping one does: the frame that replaces it is measured from where the frame
    // before it was kept.
    const elapsed = frames.reduce((sum, frame) => sum + frame.deltaMs, 0);
    expect(elapsed, at).toBeCloseTo((length * 1000) / 120, 3);
  }
});

it("rewrites a field named __proto__ as a field", () => {
  // The tables a recording carries are rebuilt out of the frames that survived
  // decimation, and every value inside one is rewritten as it is reached. A field
  // named `__proto__` written with an assignment reaches the prototype setter instead
  // of becoming a field, so the rewrite would silently drop it and replace the
  // object's prototype with whatever it held.
  //
  // The engine's recorder writes such a field for a build that passes one, and this
  // build passes none — so the rewrite is handed one directly rather than through a
  // drawing nothing in this case makes.
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

/* -------------------------------------------------------------------------- */
/* Determinism                                                                */
/* -------------------------------------------------------------------------- */

it("reaches the same yard from the same seed and the same calls", async () => {
  const roll = async (): Promise<string> => {
    const other = await createHarness();
    try {
      openRun(other, { seed: DEFAULT_SEED });
      for (let i = 0; i < 4; i += 1) other.debug.placeRock(6 + 4 * i, 10);
      await other.advance(30);
      return other
        .snapshot()
        .structures.map((s) => `${String(s.type)}@${String(s.quality)}`)
        .join(",");
    } finally {
      other.dispose();
    }
  };

  expect(await roll()).toBe(await roll());
});

it("puts a structure where structureCenter says it is", () => {
  openYard(h);
  const id = standComponent(h, "discharge", 2, 12, 8);
  const at = structureCenter(12, 8);
  const structure = structureById(h.snapshot(), id);
  expect(structure.cx).toBeCloseTo(at.x, 6);
  expect(structure.cy).toBeCloseTo(at.y, 6);
});
