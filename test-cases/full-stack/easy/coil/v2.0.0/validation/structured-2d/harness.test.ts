// harness — the machinery the suites in this directory are built on.
//
// The suites next door are validators: each decides one review point against the
// build. This file decides nothing about the build. It checks the HARNESS, whose
// faults are invisible from inside a suite and wrong in ways nothing else
// catches: a replay written in the wrong framing reaches the console as
// something it cannot read, a replay written for a section that drew nothing is
// reported to the reviewer as evidence that exists, a step schedule that
// resolves the wrong number of ticks moves every duration this case states, an
// observer that read the build's own copy of a press would silently break the
// game it was watching, and a host that cannot serve the produced sprites would
// have every presentation point failing a build that draws exactly what it was
// asked to.
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
import type { Recording } from "@test-cabinet/structured-2d";
import {
  COMBO_WINDOW,
  CUES,
  OBSTACLE_CELLS,
  SPRITE_PATHS,
  START_CELLS,
  START_DIR,
  TICK_SECONDS,
} from "./constants";
import {
  FRAMES_PER_TICK,
  FRAME_MS,
  WALL_CELL,
  addObserver,
  ahead,
  arrangeApproach,
  arrangeEat,
  arrangeFullBoard,
  arrangeStep,
  captureReplay,
  captureStill,
  chainFrom,
  createHarness,
  emptyInteriorCell,
  laysObstacles,
  obstacleSurface,
  poseScene,
  retable,
  serpentine,
  spriteOnCell,
  startRoundWithKeys,
  tickFrames,
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
  mediaDir = mkdtempSync(join(tmpdir(), "coil-replay-"));
  process.env[MEDIA_DIR_ENV] = mediaDir;
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
  if (collecting === undefined) delete process.env[MEDIA_DIR_ENV];
  else process.env[MEDIA_DIR_ENV] = collecting;
  rmSync(mediaDir, { recursive: true, force: true });
});

/* -------------------------------------------------------------------------- */
/* The engine, the surface, and the step schedule                             */
/* -------------------------------------------------------------------------- */

it("stands the build up on a real engine and reaches its surface", () => {
  // Every check in this project reads the surface off `engine.debug` and never
  // builds one, so the harness having got that far is the precondition of the
  // whole suite. What is read back is the opening session `reset` restores.
  const opening = h.snapshot();

  expect(opening.version).toBe(1);
  expect(opening.screen).toBe("title");
  expect(opening.snake).toEqual([...START_CELLS]);
  expect(opening.dir).toBe(START_DIR);
  expect(opening.pellet).toBeNull();
  expect(opening.steering).toBe(true);
  expect(opening.travel).toBe(true);
  expect(opening.pelletRespawn).toBe(true);
});

it("hands back the framework objects the engine owns", async () => {
  // The engine's object model is the other half of what a check reads. Coil
  // runs in ONE level for the whole session, so the world the harness reports
  // is the same world across a round rather than one rebuilt by a transition —
  // which is why a scenario may pose a scene and then read the state it posed.
  const world = h.world;
  const state = h.state;

  await startRoundWithKeys(h);
  await h.tick();

  expect(h.instance).toBe(h.engine.instance);
  expect(h.world).toBe(world);
  expect(h.state).toBe(state);
  expect(h.state).toBe(h.world.state);
});

it("resolves exactly one tick every FRAMES_PER_TICK frames", async () => {
  // The whole suite states its durations in ticks, so the schedule this harness
  // drives at has to turn a tick's worth of frames into exactly one tick. At
  // 64 Hz a frame is 0.015625 s and a tick is eight of them, both exact in
  // binary, so nothing here rests on the last bit of a comparison.
  expect(FRAMES_PER_TICK).toBe(8);
  expect(FRAME_MS * FRAMES_PER_TICK).toBeCloseTo(TICK_SECONDS * 1000, 12);
  arrangeStep(h, { travel: false });

  const opening = h.snapshot();
  const after = await h.tick(4);

  expect(after.ticks - opening.ticks).toBe(4);
  expect(after.simTime - opening.simTime).toBeCloseTo(4 * TICK_SECONDS, 9);
});

it("runs a frame short of a tick without resolving one", async () => {
  arrangeStep(h, { travel: false });
  const opening = h.snapshot();

  await h.advance(FRAMES_PER_TICK - 1);

  expect(h.snapshot().ticks).toBe(opening.ticks);
});

it("delivers exactly one action edge per tap", async () => {
  // An edge arms on the `keydown` and the engine discards whatever no controller
  // consumed once the frame renders, so a tap that ran no frame would never
  // reach the game — the frame goes between the press and the release. One tap
  // is one steering request.
  const step = arrangeStep(h, { dir: "right", travel: false });
  expect(step.snapshot.turns).toEqual([]);

  await h.tap("ArrowUp");

  expect(h.snapshot().turns).toEqual(["up"]);
});

it("lets an observer read a press without taking it from the build", async () => {
  // The one thing about this engine a suite can get catastrophically wrong.
  // Edges are consumed PER CONTROLLER, so a check reading the build's own
  // controller would eat the press and the build would behave as though the key
  // was never struck. An observer holds a reader of its own, and the build still
  // steers on the frame that follows.
  arrangeStep(h, { dir: "right", travel: false });
  const observer = addObserver(h);

  h.hold("ArrowUp");
  const seen = observer.input.pressed("up");
  await h.advance(1);
  h.release("ArrowUp");

  expect(seen).toBe(true);
  expect(h.snapshot().turns).toEqual(["up"]);
});

it("adds an observer that acts on nothing it reads", async () => {
  // An observer built from the mode's own `playerControllerClass` would be a
  // second copy of the BUILD's controller, applying every action twice a frame.
  // The engine's bare `PlayerController` is what an observer is, so a turn
  // requested with one seated is still exactly one turn.
  const step = arrangeStep(h, { head: { col: 10, row: 8 }, dir: "right" });
  addObserver(h);

  await h.tap("ArrowUp");
  const after = await h.tick();

  expect(h.world.players().length).toBe(2);
  expect(after.dir).toBe("up");
  expect(after.snake[0]).toEqual(ahead(step.head, "up"));
});

/* -------------------------------------------------------------------------- */
/* Posing an isolated world                                                   */
/* -------------------------------------------------------------------------- */

it("poses a chain and nothing else on the board", () => {
  // The isolation rule: what the board holds is the chain the check is about.
  // The obstacle course is cleared whatever mode the build ships, so the same
  // scenario reads the same way under either variant.
  const step = arrangeStep(h, { head: { col: 12, row: 6 }, dir: "up" });

  expect(step.snapshot.screen).toBe("playing");
  expect(step.snapshot.snake).toEqual(chainFrom({ col: 12, row: 6 }, "up", 3));
  expect(step.snapshot.dir).toBe("up");
  expect(step.snapshot.turns).toEqual([]);
  expect(step.snapshot.pellet).toBeNull();
  expect(step.snapshot.obstacles).toEqual([]);
  expect(step.next).toEqual({ col: 12, row: 5 });
});

it("answers the obstacle operations by the mode the build ships", () => {
  // `specs/instrumentation.md` puts the two obstacle operations on the surface
  // of an obstacle-laying mode ALONE, so the harness decides their absence
  // against the mode the snapshot reports rather than letting a check die on a
  // `TypeError` several frames later. A scene that asks for the course gets
  // exactly the cells the mode lays, which is none of them under a mode that
  // lays none — and every other scene gets an interior clear of furniture, so
  // one check reads the same way under either variant.
  const { mode } = h.snapshot();
  expect(laysObstacles(h.snapshot())).toBe(mode === "maze");
  expect(obstacleSurface(h) === null).toBe(mode !== "maze");

  expect(poseScene(h, { obstacles: "course" }).obstacles).toEqual([
    ...OBSTACLE_CELLS[mode],
  ]);
  expect(poseScene(h, {}).obstacles).toEqual([]);
});

it("holds each faculty still on its own", async () => {
  // `travel` off leaves the chain exactly where it stands however long the
  // scenario runs, while step 6 keeps draining the combo window — which is the
  // whole point of the switches being three rather than one.
  const step = arrangeStep(h, { travel: false, comboWindow: COMBO_WINDOW });

  const after = await h.tick(6);

  expect(after.snake).toEqual(step.snapshot.snake);
  expect(after.comboWindow).toBeCloseTo(COMBO_WINDOW - 6 * TICK_SECONDS, 9);
});

it("poses a pellet the next tick eats", async () => {
  const scene = arrangeEat(h);
  expect(scene.pellet).toEqual(ahead(scene.head, scene.dir));

  const after = await h.tick();

  expect(after.snake[0]).toEqual(scene.pellet);
  expect(after.pellet).toBeNull();
});

it("names an empty interior cell of the posed board", () => {
  const step = arrangeStep(h, { head: { col: 4, row: 1 }, dir: "right" });
  const free = emptyInteriorCell(step.snapshot);

  expect(free.col).toBeGreaterThanOrEqual(1);
  expect(free.row).toBeGreaterThanOrEqual(1);
  expect(step.snapshot.snake).not.toContainEqual(free);
});

it("walks every interior cell in one adjacent chain", () => {
  const path = serpentine();

  expect(path.length).toBe(28 * 16);
  expect(new Set(path.map((cell) => `${cell.col},${cell.row}`)).size).toBe(
    path.length,
  );
  for (let i = 1; i < path.length; i += 1) {
    const step =
      Math.abs(path[i].col - path[i - 1].col) +
      Math.abs(path[i].row - path[i - 1].row);
    expect(step, `cells ${i - 1} and ${i}`).toBe(1);
  }
});

it("approaches a target cell so the next tick enters it", async () => {
  // The arrangement every collision point is built on: the head one cell short
  // of the fatal cell, facing it, with nothing else on the board.
  const step = arrangeApproach(h, WALL_CELL, { dir: "left" });
  expect(step.next).toEqual(WALL_CELL);

  expect((await h.tick()).screen).toBe("gameover");
});

it("fills the board one eat short of the cleared ending", () => {
  // A chain through every interior cell but one, which `setSnake` accepts only
  // because the path it is laid along is contiguous, with the pellet on the cell
  // it left free and directly ahead of the head.
  const scene = arrangeFullBoard(h);

  expect(scene.chain.length).toBe(28 * 16 - 1);
  expect(scene.snapshot.snake).toEqual(scene.chain);
  expect(scene.snapshot.pellet).toEqual(scene.pellet);
  expect(ahead(scene.chain[0], scene.snapshot.dir)).toEqual(scene.pellet);
});

it("starts a round from the title the way a player does", async () => {
  // The one compound sequence that presses keys rather than posing: it is what
  // the navigation points drive, and a point about anything else reaches its
  // screen through `setScreen` instead.
  expect((await startRoundWithKeys(h)).screen).toBe("playing");
});

/* -------------------------------------------------------------------------- */
/* The host: sprites, and cues                                                */
/* -------------------------------------------------------------------------- */

it("serves the produced sprites to the engine's loader", async () => {
  // Node has neither a page for a relative URL to resolve against nor an image
  // decoder, so without the host this harness stands up the build is asked to
  // draw from art nobody gave it — and every presentation point fails a build
  // that did exactly what it was asked.
  const step = arrangeStep(h, { head: { col: 12, row: 8 }, dir: "right" });
  const blits = await h.frameBlits();

  expect(h.assetFailures.map((failure) => failure.path)).not.toContain(
    SPRITE_PATHS.body,
  );
  expect(blits.length).toBeGreaterThan(0);
  expect(spriteOnCell(h, blits, step.head.col, step.head.row)).toBe(
    `assets/${SPRITE_PATHS.head[0]}`,
  );
  const tail = step.snapshot.snake[step.snapshot.snake.length - 1];
  expect(spriteOnCell(h, blits, tail.col, tail.row)).toBe(
    `assets/${SPRITE_PATHS.tail}`,
  );
});

it("watches only the cues that sounded during the drive", async () => {
  // A scene is posed with several calls and a build is free to sound whatever
  // its own opening sounds; what a check reads is the cues of the drive it is
  // about, so the watch opens after the arrangement.
  arrangeEat(h);
  const cues = watchCues(h);

  await h.tick();

  expect(cues.map((cue) => cue.name)).toContain("eat");
  expect(cues.every((cue) => cue.frame > 0)).toBe(true);
});

it("reads a bed as sounding only from the moment it starts", async () => {
  // The reading the audio points take from the bus, checked against the two
  // announcements it is kept from: nothing loops before a round is begun, and
  // the round's own bed does.
  expect(h.looping(CUES.music)).toBe(false);

  await startRoundWithKeys(h);

  expect(h.looping(CUES.music)).toBe(true);
});

/* -------------------------------------------------------------------------- */
/* Evidence capture                                                           */
/* -------------------------------------------------------------------------- */

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

it("writes a captured section as gzip, under the declared name", async () => {
  arrangeStep(h);
  await captureReplay(h, "step", () => h.tick());

  expect(written()).toEqual(["step.json.gz"]);
  const recording = readBack("step.json.gz");
  expect(recording.format).toBeGreaterThan(0);
  expect(recording.frames.length).toBe(FRAMES_PER_TICK);
});

it("keeps the frame on the canvas as a still", async () => {
  // The other output kind: one PICTURE rather than a stretch of motion, for a
  // point whose evidence is which screen the game opened on or what it drew a
  // pellet as. What is written is whatever the last frame that RAN left behind,
  // so the frame goes before the call.
  poseScene(h, { screen: "title" });
  await h.advance(1);
  captureStill(h, "opening");

  expect(written()).toEqual(["opening.png"]);
  const bytes = readFileSync(join(mediaDir, SUITE_DIR, "opening.png"));
  // The framing read off the bytes rather than off the name: a PNG opens with
  // the eight-byte signature (RFC 2083), so this is the canvas actually being
  // encoded rather than named as though it were.
  expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
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
  const scene = arrangeEat(h);
  const after = await captureReplay(h, "eat", () => h.tick());

  expect(after.snake[0]).toEqual(scene.pellet);
  expect(written()).toEqual(["eat.json.gz"]);
});

it("keeps the whole of an over-long section, at a lower frame rate", async () => {
  // Far more frames than a written recording holds. What comes back covers the
  // whole section — the last frame driven is in it — rather than its opening.
  poseScene(h, { travel: false });
  await captureReplay(h, "long", () => h.advance(1500));

  const recording = readBack("long.json.gz");
  expect(recording.frames.length).toBeGreaterThan(1);
  expect(recording.frames.length).toBeLessThanOrEqual(300);
  const counts = recording.frames.map((frame) => frame.count);
  expect([...counts].sort((a, b) => a - b)).toEqual(counts);
  // The deltas are restated against the frame kept before, so they still sum to
  // the section's elapsed time however many frames were dropped between them.
  const elapsed = recording.frames.reduce((sum, f) => sum + f.deltaMs, 0);
  expect(elapsed).toBeCloseTo(1500 * FRAME_MS, 3);
  // Dropping a frame drops the last reference to whatever only that frame drew
  // with, and the four tables in front of a recording are shared by every frame
  // in it. What is written names every entry of the tables it carries, so
  // nothing dropped is still being paid for.
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

it("spends the budget on the section, never one frame past it", async () => {
  // The stride rounds up, which puts the sharp edge of the cap at a section
  // whose length is an exact multiple of it: the strided frames come to exactly
  // the cap and stop one stride short of the end. Both rules still hold there.
  // Nothing over the cap, because the cap is what makes `captureReplay` safe to
  // wrap any section in; and the section's last frame written, because it is the
  // frame the check's sweep stopped at. So the last frame takes the place of the
  // frame the stride stopped on rather than being written beside it, and the
  // three lengths driven here are that multiple and one frame either side of it.
  poseScene(h, { travel: false });
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
    // as dropping one does: the frame that replaces it is measured from where
    // the frame before it was kept.
    const elapsed = frames.reduce((sum, frame) => sum + frame.deltaMs, 0);
    expect(elapsed, at).toBeCloseTo(length * FRAME_MS, 3);
  }
});

it("rewrites a field named __proto__ as a field", async () => {
  // The tables a recording carries are rebuilt out of the frames that survived
  // decimation, and every value inside one is rewritten as it is reached. A
  // field named `__proto__` written with an assignment reaches the prototype
  // setter instead of becoming a field, so the rewrite silently drops it and
  // replaces the object's prototype with whatever it held.
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

it("addresses a capture by the suite that made it", async () => {
  // A replay is collected under the STAGED path of the suite that produced it,
  // which is the only name the case's manifest and the runner both already agree
  // on. `tickFrames` is exercised here too: the section is a whole tick.
  arrangeStep(h);
  await captureReplay(h, "addressed", () => h.advance(tickFrames(1)));

  expect(readdirSync(join(mediaDir, "validation", "harness.test.ts"))).toEqual([
    "addressed.json.gz",
  ]);
});
