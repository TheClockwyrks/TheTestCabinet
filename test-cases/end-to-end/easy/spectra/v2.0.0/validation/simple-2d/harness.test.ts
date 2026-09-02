// harness — the parts of the harness that nothing else can catch.
//
// The suites next door are validators: each decides one review point against the
// build. This file decides nothing about the build. It checks the harness's own
// machinery, because several of its rules are invisible from inside a validator and
// wrong in ways nothing else notices. A recording written in the wrong framing
// reaches the console as something it cannot read; a recording written for a
// section that drew nothing is reported to the reviewer as evidence that exists; a
// `drawImage` mapped through the wrong transform attributes a sprite to the wrong
// body, and every presentation validator built on it then agrees with itself about
// the wrong answer; a scenario helper that leaves a faculty on lets the wave move
// under a validator that posed a prop.
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
  DIVE_FIRST_DELAY,
  ENTER_GROUP_GAP,
  FIELD_TOP,
  SHARD_HALF,
  SHIP_Y,
  START_LIVES,
  slotX,
  slotY,
} from "./constants";
import {
  LANE_CENTER,
  captureReplay,
  captureStill,
  clearColor,
  countMarks,
  createHarness,
  drawFrame,
  drawnImages,
  droneOf,
  fireAt,
  findDrone,
  identifySprite,
  imagesNear,
  playerBullets,
  poseDrone,
  poseFormation,
  readRegion,
  retable,
  seededBurstSystem,
  seededSprites,
  startPosed,
  startStage,
  ticksFor,
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
  mediaDir = mkdtempSync(join(tmpdir(), "spectra-media-"));
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

it("writes a captured section as gzip, under both extensions", async () => {
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
  // Capture sits beside a validator's assertions rather than in place of them, so
  // what the scenario computed has to survive being recorded.
  const frames = await captureReplay(h, "value", async () => {
    await h.advance(2);
    return 2;
  });

  expect(frames).toBe(2);
  expect(written()).toEqual(["value.json.gz"]);
});

it("writes what a section recorded even when the section threw", async () => {
  // A failing validator is the one whose replay a reviewer most wants, so the write
  // is in a `finally` and the failure travels on untouched.
  await expect(
    captureReplay(h, "thrown", async () => {
      await h.advance(3);
      throw new Error("the scenario's own failure");
    }),
  ).rejects.toThrow("the scenario's own failure");

  expect(written()).toEqual(["thrown.json.gz"]);
  expect(readBack("thrown.json.gz").frames.length).toBeGreaterThan(0);
});

it("keeps the whole of an over-long section, at a lower frame rate", async () => {
  // Far more frames than a written recording holds. What comes back covers the
  // whole section — the last frame driven is in it — rather than its opening.
  startPosed(h);
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
  // are not there: naming {0, 5} of a two-entry table names as many entries as it
  // has. Every index a frame carries has to address the table it was interned into.
  expect(inRange(recording)).toEqual([]);
});

it("spends the budget on the section, never one frame past it", async () => {
  // The stride rounds up, which puts the sharp edge of the cap at a section whose
  // length is an exact multiple of it: the strided frames come to exactly the cap
  // and stop one stride short of the end. Both rules still hold there. Nothing over
  // the cap, because the cap is what makes `captureReplay` safe to wrap any section
  // in; and the section's last frame written, because it is the frame the
  // validator's sweep stopped at. So the last frame takes the place of the frame the
  // stride stopped on rather than being written beside it, and the three lengths
  // driven here are that multiple and one frame either side of it.
  startPosed(h);
  for (const length of [599, 600, 601]) {
    const at = `edge-${length}`;
    await captureReplay(h, at, () => h.advance(length));
    const frames = readBack(`${at}.json.gz`).frames;

    expect(frames.length, at).toBeLessThanOrEqual(300);
    // The first frame of a section is always kept — the stride opens on it — so the
    // span between the first count and the last is the whole section exactly when
    // the frame it ended on is the frame written last.
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

it("rewrites a field named __proto__ as a field", async () => {
  // The tables a recording carries are rebuilt out of the frames that survived
  // decimation, and every value inside one is rewritten as it is reached. A field
  // named `__proto__` written with an assignment reaches the prototype setter
  // instead of becoming a field, so the rewrite silently drops it and replaces the
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
  startPosed(h);
  await h.advance(1);
  captureStill(h, "field");

  expect(written()).toEqual(["field.png"]);
  const bytes = readFileSync(join(mediaDir, SUITE_DIR, "field.png"));
  // A PNG opens with the eight-byte signature (RFC 2083), so this is the canvas
  // actually being encoded rather than named as though it were.
  expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
});

it("serves the seeded art to the engine's loader, and puts the host back", async () => {
  // specs/assets.md has the build load its four sprites and its drone-burst through
  // the engine, which fetches a path relative to the page. There is no page here, so
  // the harness stands `fetch` and `createImageBitmap` up over the workspace's own
  // `assets/` tree while it is alive; without it every scenario would draw a field
  // the build was never given the art for.
  const served = await fetch("assets/shard.png");
  expect(served.ok).toBe(true);
  expect((await served.arrayBuffer()).byteLength).toBeGreaterThan(0);
  expect(h.assetFailures).toEqual([]);

  // And nothing it did outlives it: a suite that disposed its harness leaves the
  // process's own `fetch` exactly as it found it.
  const ours = globalThis.fetch;
  h.dispose();
  expect(globalThis.fetch).not.toBe(ours);
});

it("reads the seeded drone-burst system off the same tree", () => {
  // `bursts.from-provided-system` holds a live particle count against this file's
  // own emitters, so what it reads has to be the file the case seeded.
  const system = seededBurstSystem();

  expect(system.durationMs).toBeGreaterThan(0);
  expect(system.emitters.length).toBeGreaterThan(0);
  for (const emitter of system.emitters) {
    expect(typeof emitter.name).toBe("string");
    expect(emitter.emission.count).toBeGreaterThan(0);
  }
});

it("places a drawn sprite on the point it was drawn for", async () => {
  // A build draws a sprite by translating to the entity's centre and drawing the
  // frame about the origin, so the call's own arguments say nothing about where it
  // landed: `drawnImages` is what maps the destination box back through the
  // transform the context held and the engine's fit. Every presentation validator
  // that attributes a draw to a body rests on that mapping, and it agrees with
  // itself whether it is right or wrong — so it is read here against a drone posed
  // at a point of the harness's own choosing.
  startPosed(h);
  poseDrone(h, "shard", slotX(4), slotY(1));
  const calls = await drawFrame(h);

  const sprites = await seededSprites();
  expect(sprites.length).toBe(4);

  const onPoint = imagesNear(
    drawnImages(h, calls),
    slotX(4),
    slotY(1),
    SHARD_HALF,
  );
  expect(onPoint.length).toBeGreaterThan(0);
  expect(await identifySprite(onPoint[0].source, sprites)).toMatchObject({
    name: "shard",
  });
});

it("opens an empty, quiet field at stage 1 with the run at its opening figures", async () => {
  // Both halves of `startPosed` are load-bearing, and both are invisible from inside
  // a validator that merely passes. Empty and quiet: nothing arrives over an entry
  // gap, nothing launches over the first dive delay, and the ship is parked at the
  // centre of its lane with the run's figures where a run opens them.
  startPosed(h);

  const posed = h.snapshot();
  expect(posed.screen).toBe("inWave");
  expect(posed.phase).toBe("live");
  expect(posed.stage).toBe(1);
  expect(posed.drones).toEqual([]);
  expect(posed.bullets).toEqual([]);
  expect(posed.bursts).toEqual([]);
  expect(posed.waveEntry).toBe(false);
  expect(posed.diveLaunching).toBe(false);
  expect(posed.ship.contact).toBe(false);
  expect(posed.ship.x).toBe(LANE_CENTER);
  expect(posed.ship.band).toBe("cyan");
  expect(posed.lives).toBe(START_LIVES);
  expect(posed.score).toBe(0);
  expect(posed.resonance).toBe(0);
  expect(posed.inversion).toBe(0);
  expect(posed.diveClock).toBe(0);

  // A whole first-dive delay is longer than any entry gap, so one sweep decides
  // both gates at once: nothing may arrive and nothing may launch.
  await h.advance(ticksFor(DIVE_FIRST_DELAY + ENTER_GROUP_GAP));
  expect(h.snapshot().drones).toEqual([]);
});

it("poses a drone as a prop, with every faculty off", async () => {
  // `addDrone` opens all three faculties ON, so a helper that left them alone would
  // hand a validator a prop that flies away, oscillates, and shoots at the ship.
  // Defaulting them off is what lets an item name the one faculty it is about.
  startPosed(h);
  const prop = poseDrone(h, "flux", 400, 300, { band: "magenta" });

  const posed = droneOf(h.snapshot(), prop);
  expect(posed.travel).toBe(false);
  expect(posed.oscillation).toBe(false);
  expect(posed.fire).toBe(false);
  expect(posed.band).toBe("magenta");
  expect(posed.phase).toBe("formation");

  // Two whole stage-1 Flux windows: a Flux with its oscillation running would have
  // been through both bands by now, and one with its travel running would have
  // ridden the sway off its slot.
  await h.advance(ticksFor(4));
  const held = droneOf(h.snapshot(), prop);
  expect(held.x).toBeCloseTo(400, 6);
  expect(held.y).toBeCloseTo(300, 6);
  expect(held.band).toBe("magenta");
  expect(held.bandClock).toBe(0);
});

it("poses a formation onto the slots of the grid", () => {
  // The one geometry `poseFormation` fixes: a drone rests at the centre of the slot
  // its column and row name, and that same point is its resting slot, so the sway
  // carries the block from there.
  startPosed(h);
  const ids = poseFormation(h, [
    { kind: "shard", col: 3, row: 1, band: "cyan" },
    { kind: "prism", col: 5, row: 2, band: "magenta" },
  ]);

  const posed = h.snapshot();
  expect(ids.length).toBe(2);
  const first = droneOf(posed, ids[0]);
  expect(first.x).toBeCloseTo(slotX(3), 6);
  expect(first.y).toBeCloseTo(slotY(1), 6);
  expect(first.slotX).toBeCloseTo(slotX(3), 6);
  expect(first.slotY).toBeCloseTo(slotY(1), 6);
  const second = droneOf(posed, ids[1]);
  expect(second.kind).toBe("prism");
  expect(second.band).toBe("magenta");
  expect(second.x).toBeCloseTo(slotX(5), 6);
});

it("carries a shot from where it was placed to what it was aimed at", async () => {
  // `fireAt` fixes only geometry — how far below the target the shot starts — and
  // derives its flight from `PLAYER_BULLET_SPEED`. Nothing about the outcome is
  // posed: the game's own contact rules are what resolve the shot, so a matching
  // band destroys the drone and the opposite one leaves it standing.
  startPosed(h);
  const target = poseDrone(h, "shard", 500, 300, { band: "cyan" });
  await fireAt(h, 500, 300, "magenta");
  expect(findDrone(h.snapshot(), target)).not.toBeNull();

  await fireAt(h, 500, 300, "cyan");
  expect(findDrone(h.snapshot(), target)).toBeNull();
});

it("lets the game build and enter a stage's own wave", async () => {
  // `startStage` poses the intro and runs the one frame that gives way to it, so
  // the roster, the layout and the bands are all the build's. With the entry gate
  // opened the wave then releases its groups on its own schedule.
  startPosed(h);
  await startStage(h, 1);

  const opened = h.snapshot();
  expect(opened.screen).toBe("inWave");
  expect(opened.drones.length).toBeGreaterThan(0);
  // Every drone of a wave just built is still above the play field, waiting on its
  // entry group (specs/swarm.md).
  for (const drone of opened.drones) expect(drone.y).toBeLessThan(FIELD_TOP);

  h.debug.setWaveEntry(true);
  const swept = await h.until(
    (s) => s.drones.some((drone) => drone.y > FIELD_TOP),
    { maxFrames: ticksFor(4 * ENTER_GROUP_GAP) },
  );
  expect(swept.hit).toBe(true);
});

it("drives a held key into the game the way a player does", async () => {
  // Nothing here poses the ship: the key goes to the engine's own input and the
  // game's own movement is what answers it. Every controls item rests on that.
  startPosed(h);
  h.debug.setShipX(400);
  h.hold("ArrowRight");
  await h.advance(ticksFor(0.5));
  h.release("ArrowRight");

  expect(h.snapshot().ship.x).toBeGreaterThan(400);
  expect(h.snapshot().ship.alive).toBe(true);
});

it("counts marks over a region rather than lit pixels", async () => {
  // `field.starfield` asks for a number of MARKS, and one mark is several pixels, so
  // a count of lit pixels would answer a different question. The reading is checked
  // against something posed rather than against the build's starfield: two bullets,
  // far apart, over the field the build cleared.
  startPosed(h);
  h.debug.addPlayerBullet(300, 300, "cyan");
  h.debug.addPlayerBullet(900, 300, "magenta");
  await h.advance(1);

  const region = readRegion(h, { x: 200, y: 250, w: 800, h: 100 });
  expect(countMarks(region, clearColor(), 40)).toBeGreaterThanOrEqual(2);
});

it("reads the player's bullets out of the one roster", async () => {
  // One roster holds both kinds and `friendly` is what tells them apart, so a
  // validator that filtered by anything else would count an enemy shot as its own.
  startPosed(h);
  h.debug.addPlayerBullet(LANE_CENTER, SHIP_Y - 100, "cyan");
  h.debug.addEnemyBullet(LANE_CENTER, 200, "magenta");

  const posed = h.snapshot();
  expect(posed.bullets.length).toBe(2);
  expect(playerBullets(posed).length).toBe(1);
  expect(playerBullets(posed)[0].vy).toBeLessThan(0);
});
