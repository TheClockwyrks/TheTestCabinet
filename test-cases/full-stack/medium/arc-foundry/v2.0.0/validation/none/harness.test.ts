// harness — the self-test of the machinery every validator in this project
// stands on.
//
// The suites next door are validators: each decides one review point against the
// build. This file decides nothing about the build. It checks the HARNESS, on the
// two counts a suite can never check for itself.
//
// THE COMPOUND SEQUENCES. The debug surface is atomic by design, so opening a run
// on an empty yard, standing one structure up, releasing one held unit and
// pressing one named control are each several operations in a fixed order, and
// every one of them lives in `harness.ts`. A hundred suites are about to be
// written on top of those sequences, so each one is driven here against a build
// and read back: `standComponent` really does hand back the structure it stood
// up, `parkUnit` really does hold travel and nothing else, `holdWaveOpen` really
// does keep a wave from clearing under a check that is reading Charge. A sequence
// that quietly arranges something other than what its name says would not fail
// here or there — it would make a hundred suites measure the wrong thing and pass.
//
// THE EVIDENCE CAPTURE. Two of `captureReplay`'s rules are invisible from inside
// a suite and wrong in ways nothing else catches: a recording written in the
// wrong framing reaches the console as something it cannot read, and a recording
// written for a section that drew nothing is reported to the reviewer as evidence
// that exists. It also checks the two things that are the browser's rather than
// the format's: that a frame the recorder keeps is one frame the GAME ran, and
// that the frames are the ones the check's own section drove rather than whatever
// the page's own animation loop painted while nobody was looking.
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
import {
  comboDamage,
  comboRange,
  componentDamage,
  componentRange,
  difficultyById,
  loadDef,
  REFINEMENT_ODDS,
  scaledHp,
  STAGE_H,
  STAGE_W,
  STAMPS_PER_LEVEL,
  START_CHARGE,
  START_INTEGRITY,
  structureCenter,
  tileCenter,
} from "./constants";
import { FOUNDRY_DEBUG_VERSION, REQUIRED_OPS } from "./surface";
import {
  captureReplay,
  clearHand,
  clickStructure,
  createHarness,
  holdWaveOpen,
  menuControl,
  openYard,
  panelControl,
  parkUnit,
  pressAction,
  pressMenu,
  pressStatus,
  releaseUnit,
  REPLAY_BACKGROUND,
  standBlocker,
  standCandidate,
  standCombo,
  standComponent,
  startWave,
  statusControl,
  structureById,
  thinReplay,
  TICK_MS,
  unitById,
  withModify,
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

/** One operation, as the recorder writes it. */
type RecordedOp =
  | { op: "call"; method: string; args: unknown[] }
  | { op: "set"; property: string; value: unknown };

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
    transform: number[] | null;
    lineDash: number[] | null;
    clip: { transform: number[] | null; ops: RecordedOp[] }[];
    path: { transform: number[] | null; ops: RecordedOp[] }[];
  }[];
  frames: {
    count: number;
    deltaMs: number;
    state: number;
    stack: number[];
    ops: number[];
    truncated?: boolean;
  }[];
}

let mediaDir: string;
let collecting: string | undefined;
let h: Harness;

beforeEach(async () => {
  collecting = process.env[MEDIA_DIR_ENV];
  mediaDir = mkdtempSync(join(tmpdir(), "foundry-replay-"));
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

/* -------------------------------------------------------------------------- */
/* The page and the surface                                                   */
/* -------------------------------------------------------------------------- */

it("reaches a surface carrying every operation the specification requires", async () => {
  expect(h.surfaceFault).toBeNull();
  const probe = await h.probe(REQUIRED_OPS);
  const absent = Object.entries(probe.ops)
    .filter(([, kind]) => kind !== "function")
    .map(([name]) => name);
  expect(absent).toEqual([]);
  expect(probe.version).toBe(FOUNDRY_DEBUG_VERSION);
  expect(h.pageErrors).toEqual([]);
});

it("opens on a game at its title, off its own clock, at the reset values", async () => {
  // Every harness opens with `setAutoStep(false)` and `reset()`, so a check
  // starts from the state `specs/instrumentation.md` fixes for a reset rather
  // than from wherever the page's own loop had got to while it was loading.
  const s = await h.snapshot();
  expect(s.version).toBe(FOUNDRY_DEBUG_VERSION);
  expect(s.screen).toBe("title");
  expect(s.phase).toBeNull();
  expect(s.menuIndex).toBe(0);
  expect(s.map).toBe("substation");
  expect(s.difficulty).toBe("medium");
  expect(s.wave).toBe(0);
  expect(s.charge).toBe(START_CHARGE);
  expect(s.integrity).toBe(START_INTEGRITY);
  expect(s.refinement).toBe(0);
  expect(s.qualityOdds).toEqual(REFINEMENT_ODDS[0]);
  expect(s.stampsLeft).toBe(STAMPS_PER_LEVEL);
  expect(s.speed).toBe(1);
  expect(s.overlays).toEqual({ combos: false, damage: false });
  expect(s.paused).toBe(false);
  expect(s.selected).toBeNull();
  expect(s.nextRoll).toBeNull();
  expect(s.combineSet).toEqual([]);
  expect(s.units).toEqual([]);
  expect(s.structures).toEqual([]);
  expect(s.projectiles).toEqual([]);
  expect(s.held.active).toBe(false);
  expect(s.simTime).toBe(0);

  // And the clock is genuinely the harness's: a second of frames on a menu screen
  // moves the simulation not at all (`specs/controls.md`).
  await h.advance(120);
  expect((await h.snapshot()).simTime).toBe(0);
  expect(h.frame()).toBe(120);
  expect(h.timeMs()).toBeCloseTo(1000, 6);
});

it("drives exactly the frames a check asks for", async () => {
  await openYard(h);
  await h.advanceSeconds(1);
  const s = await h.snapshot();
  expect(h.frame()).toBe(120);
  expect(s.simTime).toBeCloseTo(1, 6);
});

/* -------------------------------------------------------------------------- */
/* The compound sequences                                                     */
/* -------------------------------------------------------------------------- */

it("opens a run on an empty yard, posed to what the scenario asked for", async () => {
  await openYard(h, {
    map: "switchyard",
    difficulty: "hard",
    wave: 7,
    charge: 500,
    integrity: 12,
    refinement: 4,
    stamps: 2,
    speed: 2,
  });

  const s = await h.snapshot();
  expect(s.screen).toBe("playing");
  expect(s.phase).toBe("build");
  expect(s.map).toBe("switchyard");
  expect(s.difficulty).toBe("hard");
  expect(s.totalWaves).toBe(difficultyById("hard").waves);
  expect(s.wave).toBe(7);
  expect(s.charge).toBe(500);
  expect(s.integrity).toBe(12);
  expect(s.refinement).toBe(4);
  expect(s.qualityOdds).toEqual(REFINEMENT_ODDS[4]);
  expect(s.stampsLeft).toBe(2);
  expect(s.speed).toBe(2);
  expect(s.structures).toEqual([]);
  expect(s.units).toEqual([]);
  expect(s.projectiles).toEqual([]);
});

it("stands one component up and hands back the structure it stood", async () => {
  await openYard(h);
  const id = await standComponent(h, "capacitor", 3, 10, 10);

  const structure = structureById(await h.snapshot(), id);
  expect(structure.kind).toBe("component");
  expect(structure.type).toBe("capacitor");
  expect(structure.quality).toBe(3);
  expect(structure.level).toBeNull();
  expect(structure.col).toBe(10);
  expect(structure.row).toBe(10);
  expect(structure.cx).toBe(structureCenter(10, 10).x);
  expect(structure.cy).toBe(structureCenter(10, 10).y);
  expect(structure.damage).toBeCloseTo(componentDamage("capacitor", 3), 9);
  expect(structure.range).toBeCloseTo(componentRange("capacitor", 3), 9);
  expect(structure.targeting).toBe("first");
});

it("stands a blocker and a combination tower up at the level asked for", async () => {
  await openYard(h);
  const blocker = await standBlocker(h, 10, 10);
  const tower = await standCombo(h, "nullcore", 14, 10, 2);

  const s = await h.snapshot();
  const inert = structureById(s, blocker);
  expect(inert.kind).toBe("blocker");
  expect(inert.type).toBeNull();
  expect(inert.quality).toBeNull();
  expect(inert.damage).toBe(0);
  expect(inert.range).toBe(0);
  expect(inert.targeting).toBeNull();

  const combo = structureById(s, tower);
  expect(combo.kind).toBe("combo");
  expect(combo.type).toBe("nullcore");
  expect(combo.quality).toBeNull();
  expect(combo.level).toBe(2);
  expect(combo.damage).toBeCloseTo(comboDamage("nullcore", 2), 9);
  expect(combo.range).toBeCloseTo(comboRange("nullcore", 2), 9);
});

it("rolls a candidate through the press and leaves nothing on the cursor", async () => {
  // `placeRock` goes through the real continuous-placement path, so it spends a
  // stamp and re-arms the press the moment it lands; `standCandidate` clears the
  // hand, because a held rock is what the panel shows instead of the inspector.
  await openYard(h);
  const id = await standCandidate(h, "discharge", 4, 10, 10);

  const s = await h.snapshot();
  const candidate = structureById(s, id);
  expect(candidate.kind).toBe("candidate");
  expect(candidate.type).toBe("discharge");
  expect(candidate.quality).toBe(4);
  expect(s.stampsLeft).toBe(STAMPS_PER_LEVEL - 1);
  expect(s.held.active).toBe(false);
  expect(s.nextRoll).toBeNull();
});

it("puts a held rock away without spending the stamp it was armed with", async () => {
  await openYard(h);
  await pressAction(h, "stamp");
  expect((await h.snapshot()).held.active).toBe(true);

  await clearHand(h);
  const s = await h.snapshot();
  expect(s.held.active).toBe(false);
  // Cancelling is free: the roll happens only on a successful drop.
  expect(s.stampsLeft).toBe(STAMPS_PER_LEVEL);
});

it("parks a unit so that travel is held and every other faculty is not", async () => {
  // The isolation the validator guide asks for, reaching inside the entity: a
  // held unit keeps its health, its statuses and its targetability, and only its
  // body stops moving.
  await openYard(h, { wave: 1 });
  const at = tileCenter(20, 20);
  const id = await parkUnit(h, "mote", at, { burn: { dps: 2, seconds: 5 } });

  const posed = unitById(await h.snapshot(), id);
  expect(posed.frozen).toBe(true);
  expect(posed.x).toBe(at.x);
  expect(posed.y).toBe(at.y);
  expect(posed.maxHp).toBe(
    scaledHp(loadDef("mote").baseHp, 1, difficultyById("medium")),
  );
  expect(posed.baseSpeed).toBe(loadDef("mote").speed);

  await h.advanceSeconds(1);
  const after = unitById(await h.snapshot(), id);
  // The body held exactly where it was posed, however long the scenario ran.
  expect(after.x).toBe(at.x);
  expect(after.y).toBe(at.y);
  // And the burn ran anyway: one second of 2 per second.
  expect(after.hp).toBeCloseTo(posed.hp - 2, 3);
});

it("releases a unit heading for the checkpoint the pose named", async () => {
  await openYard(h, { wave: 1 });
  const id = await releaseUnit(h, "spark", { waypoint: 4, frozen: true });

  const unit = unitById(await h.snapshot(), id);
  expect(unit.type).toBe("spark");
  expect(unit.waypointIndex).toBe(4);
  expect(unit.frozen).toBe(true);
});

it("holds a wave open, so nothing clears under a check that is reading", async () => {
  // A wave with nothing left to release and nothing on the yard clears the moment
  // it is advanced — paying the wave-clear bonus into the Charge a check may be
  // in the middle of measuring, and opening the next build phase under it. The
  // sequence poses the phase and holds the resolution, so an EMPTY yard stays
  // mid-wave: no bystander is parked to keep it there.
  await openYard(h, { wave: 1, charge: 100 });
  await holdWaveOpen(h);
  await h.advanceSeconds(2);

  const s = await h.snapshot();
  expect(s.phase).toBe("wave");
  expect(s.waveHeld).toBe(true);
  expect(s.units).toHaveLength(0);
  expect(s.charge).toBe(100);
});

it("commits the level's harvest, which is what starts the wave", async () => {
  await openYard(h);
  const before = await h.snapshot();
  expect(before.phase).toBe("build");
  expect(before.wave).toBe(0);

  await startWave(h, "capacitor", 1, 10, 10);

  const after = await h.snapshot();
  expect(after.phase).toBe("wave");
  expect(after.wave).toBe(1);
});

it("finds a menu choice by its action, and pressing it takes that choice", async () => {
  const salvage = await menuControl(h, "salvage");
  expect(salvage.disabled).toBe(false);
  expect(salvage.w).toBeGreaterThan(0);
  expect(salvage.h).toBeGreaterThan(0);

  await pressMenu(h, "salvage");
  expect((await h.snapshot()).screen).toBe("mapselect");
});

it("finds a status control by its action, and reads the value it is on", async () => {
  await openYard(h);
  expect((await statusControl(h, "mute")).state).toBe(false);
  expect((await statusControl(h, "speed")).state).toBe(1);

  await pressStatus(h, "mute");
  expect((await statusControl(h, "mute")).state).toBe(true);
  expect((await h.snapshot()).muted).toBe(true);
});

it("finds the inspector's control for the structure that is selected", async () => {
  await openYard(h);
  const candidate = await standCandidate(h, "coil", 2, 10, 10);
  await h.debug.select(candidate);

  const keep = await panelControl(h, "keep");
  expect(keep.disabled).toBe(false);
  // A candidate at Tuned or above is downgradeable, and a candidate never fires,
  // so it carries no targeting control at all (`specs/hud.md`).
  expect((await panelControl(h, "downgrade")).disabled).toBe(false);
  const drawn = await h.debug.panelButtons();
  expect(drawn.map((b) => b.action)).not.toContain("targeting");
});

it("fires one action from the key the specification binds it to", async () => {
  await openYard(h);
  await pressAction(h, "combos");
  expect((await h.snapshot()).overlays.combos).toBe(true);

  await pressAction(h, "damage");
  const s = await h.snapshot();
  expect(s.overlays.combos).toBe(true);
  expect(s.overlays.damage).toBe(true);
});

it("holds the modify action across a press, and releases it after", async () => {
  await openYard(h);
  const first = await standComponent(h, "capacitor", 1, 10, 10);
  const second = await standComponent(h, "capacitor", 1, 14, 10);
  await h.debug.select(first);

  await withModify(h, () => clickStructure(h, 14, 10));
  const set = (await h.snapshot()).combineSet;
  expect(set).toContain(first);
  expect(set).toContain(second);

  // The key is released again, so a plain press after it clears the set back to
  // a single selection rather than adding to it.
  await clickStructure(h, 10, 10);
  expect((await h.snapshot()).combineSet).toEqual([first]);
});

/* -------------------------------------------------------------------------- */
/* Evidence capture                                                           */
/* -------------------------------------------------------------------------- */

it("writes a captured section as gzip, under both extensions", async () => {
  await captureReplay(h, "flight", () => h.advance(4));

  expect(written()).toEqual(["flight.json.gz"]);
  const recording = readBack("flight.json.gz");
  expect(recording.format).toBeGreaterThan(0);
  expect(recording.frames.length).toBeGreaterThan(0);
  // The design size and background the console's player opens the canvas at.
  expect(recording.width).toBe(STAGE_W);
  expect(recording.height).toBe(STAGE_H);
  expect(recording.background).toBe(REPLAY_BACKGROUND);
});

it("keeps one recorded frame per frame the game ran", async () => {
  // The page keeps rendering while the game is off the wall clock, so a recorder
  // bracketing on the animation frame would keep frames nobody drove and lose the
  // ones a driven `advance` produced. Every frame here is bracketed around one
  // `advance`, inside one crossing into the page, so the two counts agree exactly.
  await openYard(h);
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
  await openYard(h);
  await captureReplay(h, "long", () => h.advance(1500));

  const recording = readBack("long.json.gz");
  expect(recording.frames.length).toBeGreaterThan(1);
  expect(recording.frames.length).toBeLessThanOrEqual(300);
  const counts = recording.frames.map((frame) => frame.count);
  expect([...counts].sort((a, b) => a - b)).toEqual(counts);
  // The deltas are restated against the frame kept before, so they still sum to
  // the section's elapsed time however many frames were dropped between them.
  const elapsed = recording.frames.reduce((sum, f) => sum + f.deltaMs, 0);
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
  // Minimal is only half of it. A table rebuilt against the wrong indices is the
  // same size as one rebuilt against the right ones, and it addresses entries
  // that are not there. Every index a frame carries has to address the table it
  // was interned into.
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
    expect(frames[frames.length - 1]!.count - frames[0]!.count, at).toBe(
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
 * A recording of `length` frames, one operation apiece, at the rate the suite
 * drives at.
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
        properties: { fillStyle: "#9fe8ff" },
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
