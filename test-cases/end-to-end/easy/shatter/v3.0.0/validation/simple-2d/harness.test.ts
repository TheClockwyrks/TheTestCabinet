// harness — the skeleton the validators in this directory are written against.
//
// The suites next door are validators: each decides one review item against the
// build. THIS FILE DECIDES NOTHING ABOUT THE BUILD. It checks the harness's own
// machinery, because the parts of it that are wrong in ways nothing else catches
// are invisible from inside a suite:
//
//   * `captureReplay`'s framing and its two silences. A recording written in the
//     wrong framing reaches the console as something it cannot read, and one
//     written for a section that drew nothing is reported to the reviewer as
//     evidence that exists.
//   * `aimedRound`'s two properties. A round placed on the wrong side of a rock
//     is absorbed by the core on its way in, and one that does not carry the
//     target's velocity misses a drifting Small — and either failure would show
//     up as "this build's wave loop never turns over", which is fold-in fix A
//     inverted.
//   * `geometry.ts`'s reading of how near something came. Measuring to the
//     SAMPLES rather than to the line between them reports a body further out
//     than it got, which is fold-in fix B.
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
import type { Recording } from "@test-cabinet/simple-2d";
import { BINDINGS, CORE_R, ROCK_RADIUS, STAR_X, STAR_Y } from "./constants";
import {
  aimedRound,
  captureReplay,
  createHarness,
  keyFor,
  retable,
  startPlaying,
  type Harness,
} from "./harness";
import {
  closestApproachTo,
  distance,
  distanceToSegment,
  gravityAt,
  separation,
  STAR,
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
  mediaDir = mkdtempSync(join(tmpdir(), "shatter-replay-"));
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

/* ---- The recorder --------------------------------------------------------- */

it("writes a captured section as gzip, under both extensions", async () => {
  await captureReplay(h, "flight", () => h.advance(4));

  expect(written()).toEqual(["flight.json.gz"]);
  const recording = readBack("flight.json.gz");
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
  // Capture sits beside a check's assertions rather than in place of them, so
  // what the scenario computed has to survive being recorded.
  const frames = await captureReplay(h, "value", async () => {
    await h.advance(2);
    return 2;
  });

  expect(frames).toBe(2);
  expect(written()).toEqual(["value.json.gz"]);
});

it("leaves the evidence of a section that threw", async () => {
  // The replay a reviewer most wants is the failing one, so the recording is
  // written from a `finally` and the failure travels on untouched.
  await expect(
    captureReplay(h, "thrown", async () => {
      await h.advance(4);
      throw new Error("the scenario's own failure");
    }),
  ).rejects.toThrow("the scenario's own failure");

  expect(written()).toEqual(["thrown.json.gz"]);
  expect(readBack("thrown.json.gz").frames.length).toBeGreaterThan(0);
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
  // that are not there. Every index a frame carries has to address the table it
  // was interned into.
  expect(inRange(recording)).toEqual([]);
});

it("spends the budget on the section, never one frame past it", async () => {
  // The stride rounds up, which puts the sharp edge of the cap at a section
  // whose length is an exact multiple of it: the strided frames come to exactly
  // the cap and stop one stride short of the end. Both rules still hold there.
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
    // as dropping one does: the frame that replaces it is measured from where
    // the frame before it was kept.
    const elapsed = frames.reduce((sum, frame) => sum + frame.deltaMs, 0);
    expect(elapsed, at).toBeCloseTo((length * 1000) / 120, 3);
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
  const written = (rewritten.ops[0] as { value: object }).value;
  expect(Object.prototype.hasOwnProperty.call(written, "__proto__")).toBe(true);
  expect(Object.getPrototypeOf(written)).toBe(Object.prototype);
  const properties = rewritten.states[0].properties;
  expect(Object.prototype.hasOwnProperty.call(properties, "__proto__")).toBe(
    true,
  );
  expect(Object.getPrototypeOf(properties)).toBe(Object.prototype);
});

/* ---- The aimed round (fold-in fix A) -------------------------------------- */

it("places a round on the side of the rock facing away from the star", () => {
  // The whole flight is the standoff, on the FAR side of the target from the
  // core, so nothing between the muzzle and the rock can absorb the round. A
  // round placed on the near side would be swallowed by the core on rocks
  // anywhere along the line through it, and the sweep that fired it would stall
  // with the field still full.
  for (const at of [
    { x: 240, y: 360 },
    { x: 1040, y: 360 },
    { x: 640, y: 120 },
    { x: 400, y: 600 },
  ]) {
    const target = { ...at, vx: 0, vy: 0, radius: ROCK_RADIUS.large };
    const round = aimedRound(target);
    const label = `${at.x},${at.y}`;

    // It starts outside the rock, further from the star than the rock itself.
    expect(distance(round, target), label).toBeGreaterThan(target.radius);
    expect(distance(round, STAR), label).toBeGreaterThan(
      distance(target, STAR),
    );
    // And it travels inward: toward the rock, not away from it.
    const closing = distance(
      { x: round.x + round.vx * 0.01, y: round.y + round.vy * 0.01 },
      target,
    );
    expect(closing, label).toBeLessThan(distance(round, target));
    // Nothing of the core stands between the muzzle and the target: the segment
    // from one to the other is outside the core for its whole length.
    expect(distanceToSegment(STAR, round, target), label).toBeGreaterThan(
      CORE_R,
    );
  }
});

it("carries the target's own velocity as well as the muzzle speed", () => {
  // A Small drifts at up to 210 units/s. A round aimed at where it was, with no
  // share of where it is going, arrives at empty space.
  const target = {
    x: 320,
    y: 620,
    vx: -180,
    vy: 60,
    radius: ROCK_RADIUS.small,
  };
  const round = aimedRound(target);

  // The round's velocity minus the target's is the muzzle velocity alone, and it
  // points from the round straight at the rock.
  const muzzle = { vx: round.vx - target.vx, vy: round.vy - target.vy };
  const toward = separation(round, target);
  const cross = muzzle.vx * toward.y - muzzle.vy * toward.x;
  expect(Math.hypot(muzzle.vx, muzzle.vy)).toBeCloseTo(520, 6);
  expect(cross / Math.hypot(muzzle.vx, muzzle.vy)).toBeCloseTo(0, 6);

  // And the gap closes at the muzzle speed, however the rock is drifting: after
  // one tick of both moving, the round has covered exactly its own step.
  const dt = 1 / 120;
  const gap = distance(round, target);
  const after = distance(
    { x: round.x + round.vx * dt, y: round.y + round.vy * dt },
    { x: target.x + target.vx * dt, y: target.y + target.vy * dt },
  );
  expect(gap - after).toBeCloseTo(520 * dt, 6);
});

/* ---- The oracle ----------------------------------------------------------- */

it("measures how near a body came to the line, not to the samples", () => {
  // Fold-in fix B. A body passing straight over a point, sampled either side of
  // the pass, is never sampled at its closest — so the samples alone report it
  // further out than it got, which is the wrong direction for a check hunting a
  // build that came too close.
  const point = { x: 640, y: 360 };
  const path = [
    { x: 540, y: 300 },
    { x: 740, y: 300 },
  ];

  const sampled = Math.min(...path.map((p) => distance(point, p)));
  const measured = closestApproachTo(point, path).distance;

  expect(measured).toBeCloseTo(60, 6);
  expect(sampled).toBeGreaterThan(measured);
});

it("folds a separation across the seam and leaves the well unwrapped", () => {
  // The one asymmetry in this case's geometry, and the one a validator author is
  // most likely to get backwards. Distance between BODIES is the shortest
  // wrapped separation (specs/field.md); the star's PULL is on the DIRECT vector
  // (specs/gravity.md), so a body near a corner falls across the field rather
  // than toward the nearer seam.
  const nearRight = { x: 1270, y: 360 };
  const nearLeft = { x: 10, y: 360 };
  expect(separation(nearRight, nearLeft).x).toBeCloseTo(20, 9);
  expect(distance(nearRight, nearLeft)).toBeCloseTo(20, 9);

  const corner = { x: 20, y: 20 };
  const pull = gravityAt(corner);
  // Toward the centre, which is down and to the right of the corner.
  expect(pull.ax).toBeGreaterThan(0);
  expect(pull.ay).toBeGreaterThan(0);
  expect(Math.atan2(pull.ay, pull.ax)).toBeCloseTo(
    Math.atan2(STAR_Y - corner.y, STAR_X - corner.x),
    9,
  );
});

/* ---- The keyboard --------------------------------------------------------- */

it("names a key the game is actually bound to", () => {
  // `keyFor` is what lets a scenario confirm a menu or hold thrust without
  // naming a key, and it must keep working under `warhead`, where the second
  // button is `KeyF` rather than `Space`.
  for (const action of ["up", "left", "a", "b", "confirm", "pause"] as const) {
    expect(BINDINGS[action].keys).toContain(keyFor(action));
  }
});
