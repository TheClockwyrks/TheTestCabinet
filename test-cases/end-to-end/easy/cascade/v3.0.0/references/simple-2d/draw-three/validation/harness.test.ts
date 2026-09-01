// harness — the parts of the harness that nothing else can catch.
//
// The suites next door are validators: each decides one review point against the
// build. This file decides nothing about the build. It checks the harness's own
// machinery, because several of its rules are invisible from inside a suite and
// wrong in ways nothing else notices. A recording written in the wrong framing
// reaches the console as something it cannot read; a recording written for a section
// that drew nothing is reported to the reviewer as evidence that exists; a rectangle
// mapped through the wrong transform attributes a card to the wrong pile, and every
// table check built on it then agrees with itself about the wrong answer; a driver
// that handed a verdict pair to `engine.apply` would store the tuple as the state
// and corrupt every frame after it.
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
import {
  CARD_H,
  CARD_W,
  COLUMN_X,
  DOUBLE_CLICK_WINDOW,
  TABLEAU_Y,
} from "../src/constants";
import {
  captureReplay,
  captureStill,
  cardSpec,
  cardBoxes,
  createHarness,
  drawFrame,
  drawnBoxes,
  framesFor,
  openTable,
  poseColumn,
  poseFoundation,
  pressPoint,
  retable,
  seconds,
  startCascade,
  TICK_HZ,
  type Harness,
} from "./harness";

/** The environment variable the runner names the media directory in. */
const MEDIA_DIR_ENV = "TCAB_VALIDATION_MEDIA_DIR";

/**
 * Where this file's own outputs land: the staged project directory, then the suite's
 * path within the project, which for this file is its own name.
 */
const SUITE_DIR = join("validation", "harness.test.ts");

let mediaDir: string;
let collecting: string | undefined;
let h: Harness;

beforeEach(async () => {
  collecting = process.env[MEDIA_DIR_ENV];
  mediaDir = mkdtempSync(join(tmpdir(), "cascade-media-"));
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
  // `0x1f 0x8b` (RFC 1952), so this is the capture actually being compressed rather
  // than named as though it were.
  expect([bytes[0], bytes[1]]).toEqual([0x1f, 0x8b]);
  return JSON.parse(gunzipSync(bytes).toString("utf8")) as WrittenRecording;
}

/**
 * Every index in `recording` that addresses nothing, named.
 *
 * A recording is almost entirely indices: a frame names its state, the states saved
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

it("stands the two browser drawing surfaces up over a node canvas", () => {
  // specs/victory.md has the cascade paint onto a persistent layer, which a browser
  // build makes with an offscreen canvas or a detached canvas element. Neither
  // exists in vitest's node environment, so `canvas-shim.ts` installs both; without
  // it a build that reaches for either throws inside every check that draws.
  expect(typeof OffscreenCanvas).toBe("function");
  const offscreen = new OffscreenCanvas(64, 32);
  expect(offscreen.getContext("2d")).not.toBeNull();

  const element = document.createElement("canvas") as HTMLCanvasElement;
  element.width = 64;
  element.height = 32;
  expect(element.getContext("2d")).not.toBeNull();
});

it("writes a captured section as gzip, under the replay extension", async () => {
  openTable(h);
  await captureReplay(h, "flight", () => h.advance(4));

  expect(written()).toEqual(["flight.json.gz"]);
  const recording = readBack("flight.json.gz");
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

it("keeps the whole of an over-long section, at a lower frame rate", async () => {
  // Far more frames than a written recording holds. What comes back covers the whole
  // section, the last frame driven included, rather than its opening.
  openTable(h);
  await captureReplay(h, "long", () => h.advance(1500));

  const recording = readBack("long.json.gz");
  expect(recording.frames.length).toBeGreaterThan(1);
  expect(recording.frames.length).toBeLessThanOrEqual(300);
  const counts = recording.frames.map((frame) => frame.count);
  expect([...counts].sort((a, b) => a - b)).toEqual(counts);
  // The deltas are restated against the frame kept before, so they still sum to the
  // section's elapsed time however many frames were dropped between them.
  const elapsed = recording.frames.reduce((sum, f) => sum + f.deltaMs, 0);
  expect(elapsed).toBeCloseTo(seconds(1500) * 1000, 3);
  // Dropping a frame drops the last reference to whatever only that frame drew with,
  // and the four tables in front of a recording are shared by every frame in it.
  // What is written names every entry of the tables it carries, so nothing dropped
  // is still being paid for.
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

it("spends the budget on the section, never one frame past it", async () => {
  // The stride rounds up, which puts the sharp edge of the cap at a section whose
  // length is an exact multiple of it: the strided frames come to exactly the cap and
  // stop one stride short of the end. Both rules still hold there. Nothing over the
  // cap, because the cap is what makes `captureReplay` safe to wrap any section in;
  // and the section's last frame written, because it is the frame the check's sweep
  // stopped at. So the last frame takes the place of the frame the stride stopped on
  // rather than being written beside it, and the three lengths driven here are that
  // multiple and one frame either side of it.
  openTable(h);
  for (const length of [599, 600, 601]) {
    const at = `edge-${length}`;
    await captureReplay(h, at, () => h.advance(length));
    const frames = readBack(`${at}.json.gz`).frames;

    expect(frames.length, at).toBeLessThanOrEqual(300);
    // The first frame of a section is always kept, the stride opens on it, so the
    // span between the first count and the last is the whole section exactly when
    // the frame it ended on is the frame written last.
    expect(frames[frames.length - 1].count - frames[0].count, at).toBe(
      length - 1,
    );
    // Displacing a frame leaves the deltas summing to the elapsed time, the same as
    // dropping one does: the frame that replaces it is measured from where the frame
    // before it was kept.
    const elapsed = frames.reduce((sum, frame) => sum + frame.deltaMs, 0);
    expect(elapsed, at).toBeCloseTo((length * 1000) / TICK_HZ, 3);
  }
});

it("rewrites a field named __proto__ as a field", async () => {
  // The tables a recording carries are rebuilt out of the frames that survived
  // decimation, and every value inside one is rewritten as it is reached. A field
  // named `__proto__` written with an assignment reaches the prototype setter instead
  // of becoming a field, so the rewrite silently drops it and replaces the object's
  // prototype with whatever it held.
  //
  // The engine's recorder writes such a field for a build that passes one, and this
  // build passes none, so the rewrite is handed one directly rather than through a
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
  const written = (rewritten.ops[0] as { value: object }).value;
  expect(Object.prototype.hasOwnProperty.call(written, "__proto__")).toBe(true);
  expect(Object.getPrototypeOf(written)).toBe(Object.prototype);
  const properties = rewritten.states[0].properties;
  expect(Object.prototype.hasOwnProperty.call(properties, "__proto__")).toBe(
    true,
  );
  expect(Object.getPrototypeOf(properties)).toBe(Object.prototype);
});

it("writes the frame on the canvas as a still", async () => {
  openTable(h);
  await h.advance(1);
  captureStill(h, "table");

  expect(written()).toEqual(["table.png"]);
  const bytes = readFileSync(join(mediaDir, SUITE_DIR, "table.png"));
  // A PNG opens with the eight-byte signature (RFC 2083), so this is the canvas
  // actually being encoded rather than named as though it were.
  expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
});

it("places a drawn card on the pile it was posed on", async () => {
  // A build is free to draw a card by translating to its corner and drawing the
  // footprint about the origin, so a call's own arguments say nothing about where it
  // landed: `drawnBoxes` is what maps the box back through the transform the context
  // held and the engine's fit. Every table check that attributes a drawn card to a
  // pile rests on that mapping, and it agrees with itself whether it is right or
  // wrong, so it is read here against a card posed on a column of the harness's own
  // choosing.
  openTable(h);
  poseColumn(h, 3, ["KS"]);
  const calls = await drawFrame(h);

  const boxes = cardBoxes(drawnBoxes(h, calls));
  expect(boxes.length).toBeGreaterThan(0);
  const onColumn = boxes.filter(
    (box) =>
      Math.abs(box.x - COLUMN_X[3]) <= 2 && Math.abs(box.y - TABLEAU_Y) <= 2,
  );
  expect(onColumn.length).toBeGreaterThan(0);
  expect(onColumn[0].w).toBeCloseTo(CARD_W, 0);
  expect(onColumn[0].h).toBeCloseTo(CARD_H, 0);
});

it("splits a verdict pair inside the transition it applies", async () => {
  // `move` and `autoMove` return `[nextState, verdict]`. Handing that pair to
  // `engine.apply` would store the tuple as the state, so the driver splits it
  // inside the transition: the state half is stored and the verdict half is handed
  // back. A stored tuple would leave the game unable to run another frame, and the
  // snapshot unable to report the move, so both are read here.
  openTable(h);
  poseFoundation(h, 0, "spades", 1);
  poseColumn(h, 0, ["2S"]);

  const accepted = h.debug.move("tableau", 0, 0, "foundation", 0);
  expect(accepted).toBe(true);

  const after = h.snapshot();
  expect(after.tableau[0]).toEqual([]);
  expect(after.foundations[0].map(cardSpec)).toEqual(["AS", "2S"]);

  // The state the transition stored is a state and nothing else, so the next frame
  // runs over it and the reading still answers.
  await h.advance(2);
  expect(h.snapshot().foundations[0]).toHaveLength(2);
});

it("maps a real pointer event to the same logical point a pose reaches", async () => {
  // `h.pointer` dispatches through the engine's own pointer input, which reads a
  // client position and maps it through the viewport; the harness has to invert that
  // mapping exactly, or a check driving the player's path presses somewhere the
  // check never named. Read here by pressing the same card both ways and comparing
  // what the game lifted.
  openTable(h);
  poseColumn(h, 2, ["KH"]);
  const at = pressPoint(h.snapshot(), "tableau", 2, 0);

  h.debug.pointerDown(at.x, at.y);
  const posed = h.snapshot().drag;
  expect(posed?.cards.map(cardSpec)).toEqual(["KH"]);
  h.debug.pointerUp(at.x, at.y);

  // Past `DOUBLE_CLICK_WINDOW` of game time, so the second press is its own press
  // rather than the second half of a double click on the card the first one pressed.
  await h.advance(framesFor(DOUBLE_CLICK_WINDOW) + 1);

  h.pointer("pointerdown", at.x, at.y);
  await h.advance(1);
  const real = h.snapshot().drag;
  expect(real?.cards.map(cardSpec)).toEqual(["KH"]);
  expect(real?.fromIndex).toBe(2);
});

it("enters the cascade through the game's own win path", async () => {
  // `startCascade` is the ground under every launch item, and what it promises is
  // that the cascade was ENTERED rather than posed: the win came from a real move of
  // the fifty-second card onto its foundation. A helper that posed the won screen
  // instead would hand those items a cascade no build had earned.
  const pending = startCascade(h);

  const won = h.snapshot();
  expect(won.screen).toBe("won");
  expect(won.foundations[pending.foundation]).toHaveLength(13);
  expect(won.launched).toBe(0);

  await h.advance(1);
  expect(h.snapshot().launched).toBeGreaterThan(0);
});

it("reads logical units back under a letterboxed, scaled surface", async () => {
  // `table.stage-fit` builds its harnesses at other window shapes and pixel ratios,
  // and every geometry reading it makes goes back through the engine's fit. A fit
  // inverted only for the default surface would agree with itself at `1280 x 720`
  // and quietly misplace every card anywhere else, so it is read here at a shape
  // that letterboxes and a ratio that scales.
  const wide = await createHarness({ cssWidth: 900, cssHeight: 500, dpr: 2 });
  try {
    openTable(wide);
    poseColumn(wide, 0, ["AC"]);
    const boxes = cardBoxes(drawnBoxes(wide, await drawFrame(wide)));
    const onColumn = boxes.filter(
      (box) =>
        Math.abs(box.x - COLUMN_X[0]) <= 2 && Math.abs(box.y - TABLEAU_Y) <= 2,
    );
    expect(onColumn.length).toBeGreaterThan(0);

    // The same point, read the other way: a logical point maps into the backing
    // store, whose fit is in DEVICE pixels, so the scale carries the pixel ratio.
    const view = wide.engine.viewport();
    expect(view.scale).toBeCloseTo((500 * 2) / 720, 6);
    const middle = wide.device(640, 360);
    expect(middle.x).toBe(Math.round(view.offsetX + 640 * view.scale));
    expect(middle.y).toBe(Math.round(view.offsetY + 360 * view.scale));
  } finally {
    wide.dispose();
  }
});
