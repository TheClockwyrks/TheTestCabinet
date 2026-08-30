// harness — the shared skeleton's own self-test.
//
// The suites next door are validators: each decides one review point against the
// build. This file decides nothing about the build. It checks the HARNESS, whose
// rules are invisible from inside a suite and wrong in ways nothing else catches.
//
// Two families of them, and each earns its place:
//
// EVIDENCE CAPTURE. A recording written in the wrong framing reaches the console
// as something it cannot read, and a recording written for a section that drew
// nothing is reported to the reviewer as evidence that exists.
//
// THE SCENARIO HELPERS. `shootFieldDown` and `aimedRound` carry a repair the
// previous version of this case needed — a wave is reached by SHOOTING the field
// down and never by `clearRocks`, because `clearRocks` destroys nothing — and a
// helper that quietly stopped landing its rounds would take every check that
// stands on it down with it, each failing for a reason that has nothing to do
// with the build. They are exercised here against the reference implementation
// the project is staged into, so a break in the machinery is caught where it is
// a broken harness rather than where it looks like a broken game.
//
// No review item names this file, so a RUN never loads it. It runs with the whole
// project, which is how a case author runs these suites while writing them:
//
//   npx vitest run --config validation/vitest.config.ts

import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { Recording } from "@test-cabinet/structured-2d";
import { MUZZLE_SPEED, ROCK_RADIUS, TICK_DT } from "../src/constants";
import {
  aimedRound,
  captureReplay,
  captureStill,
  createHarness,
  poseRock,
  retable,
  seconds,
  resetTo,
  shootFieldDown,
  startPlaying,
  tapAction,
  ticksFor,
  type Harness,
} from "./harness";
import { QUIET_CORNER, SAUCER_SWEEP } from "./fixtures";
import {
  closestApproachToStar,
  distanceToSegment,
  gravityAt,
  pullAt,
  shortestSeparation,
  STAR,
  sweptContact,
  wrapCoordinate,
  wrappedDistance,
} from "./geometry";

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
  mediaDir = mkdtempSync(join(tmpdir(), "shatter-media-"));
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
/* The clock                                                                  */
/* -------------------------------------------------------------------------- */

it("advances exactly one simulation tick per frame", async () => {
  // Everything a check measures in frames rests on this. The engine mandates no
  // timestep and hands the game the frame's delta in seconds; the game
  // accumulates that into whole ticks of TICK_DT. One tick per frame is what
  // leaves no remainder in the accumulator, so `advance(n)` is n ticks exactly
  // and never n-1 with a fraction carried.
  startPlaying(h);
  const before = h.snapshot().simTime;
  await h.advance(600);
  const after = h.snapshot().simTime;

  expect(after - before).toBeCloseTo(600 * TICK_DT, 9);
  expect(seconds(600)).toBeCloseTo(5, 12);
  expect(ticksFor(5)).toBe(600);
});

it("holds a tapped key down for the frame the press is worth", async () => {
  // A deliberate divergence from the naive press-and-release-between-frames tap,
  // and one a later reader must not quietly undo. specs/controls.md has Shatter
  // read its inputs two ways — the menus and the pause as PRESS EDGES, turning,
  // thrusting and firing as HOLDS — and a build is free to read each the way its
  // specification states. A tap that released before the frame arms the edge and
  // presents no value: it drives a menu perfectly and fires nothing, so every
  // check written with it would grade how the build reads its keyboard rather
  // than what the ship does.
  //
  // Both readings have to see one press, and the two assertions below are the
  // two readings: the title menu moves on an EDGE, and the gun fires on a HELD
  // value.
  resetTo(h);
  await tapAction(h, "down");
  expect(h.snapshot().menuIndex).toBe(1);

  startPlaying(h);
  await tapAction(h, "a");
  expect(h.snapshot().bullets.length).toBe(1);

  // And the key is up again afterwards, so the press is worth exactly one frame:
  // a second frame adds no second shot.
  await h.advance(1);
  expect(h.snapshot().bullets.length).toBe(1);
});

/* -------------------------------------------------------------------------- */
/* The spec-derived oracle                                                    */
/* -------------------------------------------------------------------------- */

it("wraps, separates and pulls the way the specification states", () => {
  // The oracle is arithmetic, so it is checked against the figures the specs
  // print rather than against anything the build produced.
  expect(wrapCoordinate(-10, 1280)).toBe(1270);
  expect(wrapCoordinate(1290, 1280)).toBe(10);

  // specs/field.md: the separation is the shortest one across the seams.
  expect(shortestSeparation({ x: 1270, y: 10 }, { x: 10, y: 700 })).toEqual({
    x: 20,
    y: -30,
  });
  expect(wrappedDistance({ x: 1270, y: 360 }, { x: 10, y: 360 })).toBeCloseTo(
    20,
    9,
  );

  // specs/gravity.md's own table: 112.5 at d = 200, and the softening cap.
  expect(pullAt({ x: STAR.x + 200, y: STAR.y })).toBeCloseTo(112.5, 6);
  expect(pullAt({ x: STAR.x + 150, y: STAR.y })).toBeCloseTo(200, 6);
  expect(pullAt({ x: STAR.x + 120, y: STAR.y })).toBeCloseTo(312.5, 6);
  expect(pullAt({ x: STAR.x + 40, y: STAR.y })).toBeCloseTo(
    pullAt({ x: STAR.x + 90, y: STAR.y }),
    9,
  );
  // Directed toward the star: a body to its right is pulled left.
  const a = gravityAt({ x: STAR.x + 200, y: STAR.y });
  expect(a.x).toBeCloseTo(-112.5, 6);
  expect(a.y).toBeCloseTo(0, 9);
});

it("finds a contact inside a tick that no pair of endpoints shows", () => {
  // specs/collision.md mandates a swept test, and the reason is arithmetic: a
  // bullet of radius 3 closing at 1200 units/s covers 10 units in a tick, so a
  // discrete pass reading only the endpoints misses the pass entirely.
  const closing = sweptContact(
    { x: 10, y: 0 },
    { vx: -1200, vy: 0 },
    3 + 14,
    TICK_DT,
  );
  expect(closing).toBe(0); // already inside 17 units: contact has happened

  const passingThrough = sweptContact(
    { x: 8, y: 0 },
    { vx: -1200, vy: 0 },
    3,
    TICK_DT,
  );
  expect(passingThrough).not.toBeNull();
  expect(passingThrough as number).toBeGreaterThan(0);
  expect(passingThrough as number).toBeLessThan(TICK_DT);

  // And a pair that never closes reports nothing rather than a spurious root.
  expect(sweptContact({ x: 500, y: 0 }, { vx: -10, vy: 0 }, 3, TICK_DT)).toBe(
    null,
  );
});

it("measures a path by its lines, not by its samples", () => {
  // Fold-in fix B. A body sampled every few ticks passes closest to the star
  // BETWEEN two samples far more often than on one, and reading the samples
  // alone reports it further out than it got — the wrong direction for a check
  // hunting a build that came too close.
  const before = { x: STAR.x - 200, y: STAR.y - 40 };
  const after = { x: STAR.x + 200, y: STAR.y - 40 };

  const bySample = Math.min(
    Math.hypot(before.x - STAR.x, before.y - STAR.y),
    Math.hypot(after.x - STAR.x, after.y - STAR.y),
  );
  expect(bySample).toBeCloseTo(Math.hypot(200, 40), 9);
  expect(distanceToSegment(STAR, before, after)).toBeCloseTo(40, 9);
  expect(closestApproachToStar([before, after])).toBeCloseTo(40, 9);

  // A seam crossing is not a line the body travelled, so it is not measured as
  // one: the pair below would otherwise report a dead-on pass through the star.
  const leaving = { x: 1279, y: STAR.y };
  const returning = { x: 1, y: STAR.y };
  expect(closestApproachToStar([leaving, returning])).toBeCloseTo(639, 6);
});

it("lays out 54 crossings of the field, from both edges, over three seeds", () => {
  // The sweep is 54 because avoidance is often one-sided and a weave reroll can
  // discard it intermittently. Its shape is a fixture so no later reader can
  // trim it to one dead-on approach without noticing what they are removing.
  expect(SAUCER_SWEEP).toHaveLength(54);
  expect(new Set(SAUCER_SWEEP.map((c) => c.y)).size).toBe(9);
  expect(new Set(SAUCER_SWEEP.map((c) => c.seed)).size).toBe(3);
  expect(
    SAUCER_SWEEP.every((c) => (c.edge === "left" ? c.vx > 0 : c.vx < 0)),
  ).toBe(true);
  expect(SAUCER_SWEEP.every((c) => c.vy === 0)).toBe(true);
});

/* -------------------------------------------------------------------------- */
/* The scenario helpers                                                       */
/* -------------------------------------------------------------------------- */

it("places a round on the side of its target facing away from the star", () => {
  // The placement is what stops the core from eating a round that missed: the
  // round starts outside the target and travels INWARD, so it is moving away
  // from the core for the whole of its flight.
  const target = {
    x: QUIET_CORNER.x,
    y: QUIET_CORNER.y,
    vx: -60,
    vy: -60,
    radius: ROCK_RADIUS.large,
  };
  const round = aimedRound(target, MUZZLE_SPEED);

  // Further from the star than the rock it is aimed at, by the standoff and the
  // rock's own radius.
  expect(wrappedDistance(round, STAR)).toBeGreaterThan(
    wrappedDistance(target, STAR) + ROCK_RADIUS.large,
  );
  // And carrying the target's own velocity, so the closing speed is the round's
  // alone whatever the rock was doing.
  expect(Math.hypot(round.vx - target.vx, round.vy - target.vy)).toBeCloseTo(
    MUZZLE_SPEED,
    6,
  );
});

it("shoots a posed field down to Smalls with real rounds", async () => {
  // The whole of fold-in fix A, exercised end to end. Every round goes in
  // through `addBullet` and is resolved by the build's own collision, split and
  // scoring code — so this passing means a wave can be reached by shooting,
  // which is the only way a check in this case is allowed to reach one.
  startPlaying(h);
  poseRock(h, "large", QUIET_CORNER.x, QUIET_CORNER.y, -60, -60);

  const rounds = await shootFieldDown(h, { leave: 1 });
  const after = h.snapshot();

  // A Large is three destructions deep: itself, two Mediums, four Smalls. The
  // sweep leaves one Small standing, so it spends six rounds getting there.
  expect(rounds).toBeGreaterThanOrEqual(6);
  expect(after.rocks).toHaveLength(1);
  expect(after.rocks[0].size).toBe("small");
  // Destroying rocks scored, which is what tells a real shooting-down from an
  // emptied field: `clearRocks` awards nothing.
  expect(after.score).toBeGreaterThan(0);
});

it("takes the field to nothing when asked for nothing", async () => {
  startPlaying(h);
  poseRock(h, "medium", QUIET_CORNER.x, QUIET_CORNER.y);

  await shootFieldDown(h, { leave: 0 });

  expect(h.snapshot().rocks).toHaveLength(0);
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
});

it("writes a still as a png of the frame on the canvas", async () => {
  startPlaying(h);
  await h.advance(1);
  captureStill(h, "field");

  expect(written()).toEqual(["field.png"]);
  const bytes = readFileSync(join(mediaDir, SUITE_DIR, "field.png"));
  // The framing read off the bytes rather than off the name: a PNG opens with
  // the eight-byte signature.
  expect([...bytes.subarray(0, 8)]).toEqual([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
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

it("leaves the evidence behind when the scenario throws", async () => {
  // A failing check is the one whose replay a reviewer most wants, so the
  // failure travels on and the frames recorded before it are still written.
  await expect(
    captureReplay(h, "failed", async () => {
      await h.advance(3);
      throw new Error("the check failed");
    }),
  ).rejects.toThrow("the check failed");

  expect(written()).toEqual(["failed.json.gz"]);
  expect(readBack("failed.json.gz").frames.length).toBeGreaterThan(0);
});

it("costs nothing when nobody is collecting", async () => {
  // Outside a run the media directory is unset and capture is a no-op that still
  // runs the scenario, so a check cannot pass in one place and fail in the other.
  delete process.env[MEDIA_DIR_ENV];
  const value = await captureReplay(h, "unset", async () => {
    await h.advance(2);
    return "ran";
  });
  captureStill(h, "unset");

  expect(value).toBe("ran");
  expect(written()).toEqual([]);
  expect(h.engine.recording()).toBe(false);
});

it("keeps the whole of an over-long section, at a lower frame rate", async () => {
  // Far more frames than a written recording holds. What comes back covers the
  // whole section — the last frame driven is in it — rather than its opening.
  startPlaying(h);
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
  // with, and the four tables in front of a recording are shared by every frame
  // in it. What is written names every entry of the tables it carries, so nothing
  // dropped is still being paid for.
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
  // The stride rounds up, which puts the sharp edge of the cap at a section whose
  // length is an exact multiple of it: the strided frames come to exactly the cap
  // and stop one stride short of the end. Both rules still hold there. Nothing
  // over the cap, because the cap is what makes `captureReplay` safe to wrap any
  // section in; and the section's last frame written, because it is the frame the
  // check's sweep stopped at. So the last frame takes the place of the frame the
  // stride stopped on rather than being written beside it, and the three lengths
  // driven here are that multiple and one frame either side of it.
  startPlaying(h);
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
