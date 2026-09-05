// harness — the machinery the suites in this directory are built on.
//
// The suites next door are validators: each decides one review point against
// the build. This file decides nothing about the build. It checks the HARNESS,
// whose faults are invisible from inside a suite and wrong in ways nothing else
// catches: a replay written in the wrong framing reaches the console as
// something it cannot read, a step schedule that resolves the wrong number of
// ticks moves every duration this case states, and a host that cannot serve
// the produced sprites or decode the produced cues would have every
// presentation point failing a build that did exactly what it was asked.
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
import type { Recording } from "@clockwyrks/simple-2d";
import {
  BED_TITLE,
  DEFLECTOR_BALL_CONTACT_RADIUS,
  DEFLECTOR_BASE_SPAN_DEG,
  DEFLECTOR_START_ANGLE_DEG,
  FIELD_CONTACT_RADIUS,
  PLANET_SPRITE,
  RINGS,
  START_LIVES,
  START_WAVE,
  TICK_HZ,
  WIDEN_SPAN_DEG,
  ballSpeedAtWave,
  ringSpeedAtWave,
} from "./constants";
import {
  TICK_MS,
  advanceTicks,
  angularOffset,
  blitsNear,
  captureReplay,
  captureStill,
  cuesNamed,
  hold,
  isolate,
  onCue,
  openHarness,
  polarToXy,
  poseScene,
  retable,
  spawnBallPolar,
  spawnPodPolar,
  startPlay,
  tap,
  targetArcCenterDeg,
  xyToPolar,
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
  mediaDir = mkdtempSync(join(tmpdir(), "kessler-replay-"));
  process.env[MEDIA_DIR_ENV] = mediaDir;
  h = await openHarness();
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
  // whole suite. What is read back is the boot state `reset` restores
  // (specs/instrumentation.md).
  const opening = h.snapshot();

  expect(opening.screen).toBe("title");
  expect(opening.ticks).toBe(0);
  expect(opening.score).toBe(0);
  expect(opening.lives).toBe(START_LIVES);
  expect(opening.wave).toBe(START_WAVE);
  expect(opening.menu.index).toBe(0);
  expect(opening.paddle.angleDeg).toBe(DEFLECTOR_START_ANGLE_DEG);
  expect(opening.paddle.spanDeg).toBe(DEFLECTOR_BASE_SPAN_DEG);
  expect(opening.balls).toEqual([]);
  expect(opening.pods).toEqual([]);
  expect(opening.waveAdvance).toBe(true);
  expect(opening.podSpawn).toBe(true);
  expect(opening.effects).toEqual({
    widenTicks: 0,
    narrowTicks: 0,
    pierceTicks: 0,
    shieldActive: false,
  });
  expect(opening.rings).toHaveLength(3);
  for (const [i, ring] of opening.rings.entries()) {
    expect(ring.angleDeg, `ring ${i + 1} angle`).toBe(0);
    expect(ring.speedDegPerSec, `ring ${i + 1} speed`).toBeCloseTo(
      ringSpeedAtWave(i + 1, 1),
      9,
    );
    expect(ring.targets, `ring ${i + 1} targets`).toHaveLength(RINGS[i].slots);
    for (const target of ring.targets) {
      expect(target.hp).toBe(RINGS[i].hitPoints);
    }
  }
});

it("resolves exactly one tick per frame", async () => {
  // The pairing the spec itself prescribes: a ConstantClock of 1000 / 60
  // milliseconds with engine.advance, one frame per tick. `ticks` counts on
  // every screen, frozen screens included, so the title serves as the quietest
  // place to read the schedule.
  expect(TICK_MS * TICK_HZ).toBeCloseTo(1000, 9);
  const opening = h.snapshot();

  await advanceTicks(h, 7);

  expect(h.snapshot().ticks - opening.ticks).toBe(7);
  expect(h.frame()).toBe(7);
});

/* -------------------------------------------------------------------------- */
/* Posing an isolated world                                                   */
/* -------------------------------------------------------------------------- */

it("isolates an empty playing field with both switches off", () => {
  const posed = isolate(h);

  expect(posed.screen).toBe("playing");
  expect(posed.balls).toEqual([]);
  expect(posed.pods).toEqual([]);
  expect(posed.waveAdvance).toBe(false);
  expect(posed.podSpawn).toBe(false);
  for (const ring of posed.rings) expect(ring.targets).toEqual([]);
});

it("reseeds through reset so the pod stream is the caller's", async () => {
  // `reset(seed)` is the one lever over the draw stream; two resets with the
  // same seed leave indistinguishable sessions (specs/instrumentation.md) —
  // the boot state again, ticks at 0, under the caller's seed.
  h.reset(42);
  const first = h.snapshot();
  await h.tick(3);
  h.reset(42);

  expect(h.snapshot()).toEqual(first);
  expect(first.screen).toBe("title");
  expect(first.ticks).toBe(0);
});

it("reaches every screen through poseScene", () => {
  for (const screen of [
    "playing",
    "waveclear",
    "paused",
    "gameover",
    "howto",
    "title",
  ] as const) {
    expect(poseScene(h, screen).screen, screen).toBe(screen);
  }
});

it("starts a session the way a player does", async () => {
  // The real path: reset to the title, `confirm` on START. What a fresh
  // session holds is the wave-1 layout with a ball parked on the deflector
  // (specs/screens.md, specs/deflector-and-ball.md).
  const opening = await startPlay(h);

  expect(opening.screen).toBe("playing");
  expect(opening.score).toBe(0);
  expect(opening.balls).toHaveLength(1);
  expect(opening.balls[0].parked).toBe(true);
  const at = xyToPolar(opening.balls[0].x, opening.balls[0].y);
  expect(at.r).toBeCloseTo(DEFLECTOR_BALL_CONTACT_RADIUS, 6);
  expect(angularOffset(at.deg, opening.paddle.angleDeg)).toBeCloseTo(0, 6);
});

/* -------------------------------------------------------------------------- */
/* Input, as a player's keys deliver it                                       */
/* -------------------------------------------------------------------------- */

it("delivers exactly one action edge per tap", async () => {
  // On the title, one `down` press moves the highlight one entry
  // (specs/controls.md, specs/screens.md) — so one tap is one move.
  h.reset();
  expect(h.snapshot().menu.index).toBe(0);

  await tap(h, "ArrowDown");

  expect(h.snapshot().menu.index).toBe(1);
});

it("launches the parked ball off a real Space press", async () => {
  const opening = await startPlay(h);
  const paddleDeg = opening.paddle.angleDeg;

  await tap(h, "Space");

  const [ball] = h.snapshot().balls;
  expect(ball.parked).toBe(false);
  // Radially outward at the wave-1 ball speed: the velocity points along the
  // deflector's angle at 240 units per second.
  const speed = Math.hypot(ball.vx, ball.vy);
  expect(speed).toBeCloseTo(ballSpeedAtWave(1), 3);
  const heading = xyToPolar(ball.x + ball.vx, ball.y + ball.vy);
  expect(angularOffset(heading.deg, paddleDeg)).toBeCloseTo(0, 3);
});

it("holds a rotation key for a counted number of ticks", async () => {
  // 270 degrees per second held for 30 ticks (half a second) carries the
  // deflector 135 degrees toward +theta (specs/deflector-and-ball.md).
  isolate(h);

  await hold(h, "ArrowRight", 30);

  expect(h.snapshot().paddle.angleDeg).toBeCloseTo(
    DEFLECTOR_START_ANGLE_DEG + 135,
    3,
  );
});

/* -------------------------------------------------------------------------- */
/* The ticks run the real systems                                             */
/* -------------------------------------------------------------------------- */

it("advances a posed ball with the real simulation", async () => {
  // A ball travels in a straight line between contacts
  // (specs/deflector-and-ball.md): 120 units per second outward for half a
  // second is 60 units of radius.
  isolate(h);
  spawnBallPolar(h, 400, 0, 120);

  const after = await h.tick(30);

  expect(after.balls).toHaveLength(1);
  const at = xyToPolar(after.balls[0].x, after.balls[0].y);
  expect(at.r).toBeCloseTo(460, 3);
  expect(at.deg).toBeCloseTo(0, 3);
});

it("resolves a real contact, with its cue, from the ticks alone", async () => {
  // The same ball carried on crosses the containment field's contact radius
  // (472, crossed outward) and reflects, playing `field-bounce`
  // (specs/field.md). Nothing poses the outcome: the ticks decide it.
  isolate(h);
  spawnBallPolar(h, 400, 0, 120);
  const cues = onCue(h);

  const result = await h.until((s) => {
    const [ball] = s.balls;
    if (ball === undefined) return false;
    const { x, y } = polarToXy(0, 0);
    const vr =
      ((ball.x - x) * ball.vx + (ball.y - y) * ball.vy) /
      Math.max(1e-9, Math.hypot(ball.x - x, ball.y - y));
    return vr < 0;
  });

  expect(result.hit).toBe(true);
  expect(cuesNamed(cues, "field-bounce").length).toBeGreaterThan(0);
  const at = xyToPolar(result.snapshot.balls[0].x, result.snapshot.balls[0].y);
  expect(at.r).toBeLessThanOrEqual(FIELD_CONTACT_RADIUS + 1);
});

it("poses one thing per operation and reads each back", () => {
  // The atomic poses the scenarios are assembled from, each verified by
  // setting a value and reading it off the snapshot — the round trip the
  // authoring guide requires the surface to support.
  isolate(h);

  h.debug.setPaddleAngle(30);
  expect(h.snapshot().paddle.angleDeg).toBeCloseTo(30, 9);

  h.debug.spawnTarget(2, 3, 2);
  expect(h.snapshot().rings[1].targets).toEqual([{ slot: 3, hp: 2 }]);

  h.debug.setRingAngle(2, 45);
  expect(h.snapshot().rings[1].angleDeg).toBeCloseTo(45, 9);

  spawnPodPolar(h, "shield", RINGS[0].podSpawnRadius, 90);
  const [pod] = h.snapshot().pods;
  expect(pod.kind).toBe("shield");
  expect(xyToPolar(pod.x, pod.y).r).toBeCloseTo(RINGS[0].podSpawnRadius, 6);

  h.debug.setEffectTicks("widen", 120);
  const effects = h.snapshot();
  expect(effects.effects.widenTicks).toBe(120);
  expect(effects.paddle.spanDeg).toBe(WIDEN_SPAN_DEG);

  h.debug.setShield(true);
  expect(h.snapshot().effects.shieldActive).toBe(true);
});

it("aims a posed ball at a slot's arc center", async () => {
  // targetArcCenterDeg is the aim every ring-contact scenario stages with: a
  // ball dropped inward onto that angle meets the target it names. Ring 1 is
  // stationary, so the aim holds while the ball flies.
  isolate(h);
  const aim = targetArcCenterDeg(1, 4);
  h.debug.spawnTarget(1, 4, 1);
  spawnBallPolar(h, 360, aim, -180);
  const cues = onCue(h);

  const result = await h.until((s) => s.rings[0].targets.length === 0, {
    maxTicks: 120,
  });

  expect(result.hit).toBe(true);
  expect(cuesNamed(cues, "target-break").length).toBe(1);
  // waveAdvance is off, so the emptied field plays on in `playing` — the
  // isolation the driver switch exists for.
  expect(result.snapshot.screen).toBe("playing");
});

/* -------------------------------------------------------------------------- */
/* The host: sprites, and cues                                                */
/* -------------------------------------------------------------------------- */

it("serves the produced sprites and sounds to the engine's loader", async () => {
  // Node has neither a page for a relative URL to resolve against, an image
  // decoder, nor an AudioContext — so without the host this harness stands up,
  // the build is asked to draw art and bind cues nobody gave it, and every
  // presentation point fails a build that did exactly what it was asked.
  expect(h.assetFailures).toEqual([]);

  isolate(h);
  const blits = await h.frameBlits();
  const onPlanet = blitsNear(h, blits, 500, 500, 40);

  expect(blits.length).toBeGreaterThan(0);
  expect(onPlanet.length).toBeGreaterThan(0);
  expect(
    onPlanet.some((blit) => blit.id.endsWith(PLANET_SPRITE)),
    `a blit of ${PLANET_SPRITE} on the planet; saw ${JSON.stringify(
      onPlanet.map((blit) => blit.id),
    )}`,
  ).toBe(true);
});

it("watches only the cues that sounded during the drive", async () => {
  // A scene is posed with several calls and a build is free to sound whatever
  // its own opening sounds; what a check reads is the cues of the drive it is
  // about, so the watch opens after the arrangement.
  h.reset();
  await h.tick();
  const cues = onCue(h);
  expect(cues).toEqual([]);

  await tap(h, "ArrowDown");

  expect(cues.map((cue) => cue.name)).toContain("menu-move");
});

it("reads a bed as sounding only while it loops", async () => {
  // The title bed loops on `title` (specs/assets.md); the reading comes off
  // the engine's cue bus, kept between its looped and stopped announcements.
  h.reset();
  await h.tick();

  expect(h.looping(BED_TITLE)).toBe(true);
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

/** A recording read back off disk, in the shape the assertions below read. */
interface WrittenRecording {
  format: number;
  ops: unknown[];
  states: unknown[];
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
  // The framing read off the bytes rather than off the name: a gzip member
  // opens `0x1f 0x8b` (RFC 1952), so this is the capture actually being
  // compressed rather than named as though it were.
  expect([bytes[0], bytes[1]]).toEqual([0x1f, 0x8b]);
  return JSON.parse(gunzipSync(bytes).toString("utf8")) as WrittenRecording;
}

it("writes a captured section as gzip, under the declared name", async () => {
  isolate(h);
  await captureReplay(h, "section", () => h.tick(10));

  expect(written()).toEqual(["section.json.gz"]);
  const recording = readBack("section.json.gz");
  expect(recording.format).toBeGreaterThan(0);
  expect(recording.frames.length).toBe(10);
});

it("writes nothing at all for a section that drew no frames", async () => {
  // A scenario that runs no frame closes no frame, so there is no picture to
  // write: leaving the file unwritten reports the output absent, which is the
  // truthful answer.
  await captureReplay(h, "nothing", () => undefined);

  expect(written()).toEqual([]);
});

it("hands the scenario's own value back", async () => {
  isolate(h);
  spawnBallPolar(h, 400, 0, 120);
  const after = await captureReplay(h, "flight", () => h.tick(30));

  expect(xyToPolar(after.balls[0].x, after.balls[0].y).r).toBeCloseTo(460, 3);
  expect(written()).toEqual(["flight.json.gz"]);
});

it("keeps the whole of an over-long section, at a lower frame rate", async () => {
  // Far more frames than a written recording holds. What comes back covers the
  // whole section — the last frame driven is in it — rather than its opening,
  // and every index a kept frame carries addresses the rebuilt tables.
  isolate(h);
  await captureReplay(h, "long", () => h.advance(1000));

  const recording = readBack("long.json.gz");
  expect(recording.frames.length).toBeGreaterThan(1);
  expect(recording.frames.length).toBeLessThanOrEqual(300);
  const counts = recording.frames.map((frame) => frame.count);
  expect([...counts].sort((a, b) => a - b)).toEqual(counts);
  expect(counts[counts.length - 1] - counts[0]).toBe(999);
  // The deltas are restated against the frame kept before, so they still sum
  // to the section's elapsed time however many frames were dropped between.
  const elapsed = recording.frames.reduce((sum, f) => sum + f.deltaMs, 0);
  expect(elapsed).toBeCloseTo(1000 * TICK_MS, 3);
  // Dropping a frame drops the last reference to whatever only that frame drew
  // with; what is written names every entry of the tables it carries, and
  // every index addresses the table it was interned into.
  const named = new Set(recording.frames.flatMap((frame) => frame.ops));
  expect(named.size).toBe(recording.ops.length);
  for (const frame of recording.frames) {
    expect(frame.state).toBeGreaterThanOrEqual(0);
    expect(frame.state).toBeLessThan(recording.states.length);
    for (const op of frame.ops) {
      expect(op).toBeGreaterThanOrEqual(0);
      expect(op).toBeLessThan(recording.ops.length);
    }
  }
});

it("rewrites a field named __proto__ as a field", () => {
  // The tables a recording carries are rebuilt out of the frames that survived
  // thinning, and a field named `__proto__` written with an assignment reaches
  // the prototype setter instead of becoming a field — so the rewrite defines
  // it. The engine's recorder writes such a field for a build that passes one.
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

it("keeps a still of the frame on the canvas, as a PNG", async () => {
  poseScene(h, "playing");
  await h.tick();
  captureStill(h, "field");

  expect(written()).toEqual(["field.png"]);
  const bytes = readFileSync(join(mediaDir, SUITE_DIR, "field.png"));
  // The PNG signature, read off the bytes rather than the name.
  expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
});

it("addresses a capture by the suite that made it", async () => {
  // A replay is collected under the STAGED path of the suite that produced it,
  // which is the only name the case's manifest and the runner both agree on.
  isolate(h);
  await captureReplay(h, "addressed", () => h.advance(5));

  expect(readdirSync(join(mediaDir, "validation", "harness.test.ts"))).toEqual([
    "addressed.json.gz",
  ]);
});
