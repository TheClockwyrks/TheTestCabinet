// harness — the self-test of the shared harness the suites in this directory
// are written on top of.
//
// The suites next door are validators: each decides one review point about the
// build. This file decides nothing about the build. It checks the HARNESS,
// which nothing else can, because every one of those suites reads the game
// through it: a harness that mis-mapped the polar fit onto the canvas, or
// attributed a cue to the wrong tick, or posed a world in the wrong order,
// would not fail — it would quietly decide every point against a build that
// was fine.
//
// WHAT IS CHECKED HERE, AND WHY EACH IS INVISIBLE FROM INSIDE A SUITE.
//
//   - THE PAGE AND THE SURFACE. That a harness opens on a build that installed
//     `window.__kessler`, that it takes the game off the wall clock before a
//     check touches anything, and that the boot state is the one `reset`
//     promises.
//   - THE CLOCK. That `tick(n)` resolves exactly `n` ticks — the unit every
//     suite counts in — and that a frozen screen still counts them.
//   - THE KEYBOARD. That a hold is a key a build can actually see for exactly
//     the ticks it spans, and that a tap lands its press edge on the build's
//     own loop AND on a driven tick, whichever of the two conformant designs
//     consumes it.
//   - THE POSED WORLD. That `isolate` leaves exactly the empty held field it
//     promises, that the polar spawn helpers put a body where they say, and
//     that a real destruction staged over an isolated field resolves without
//     the held consequences arriving on top of it.
//   - THE READINGS. That a pixel samples through the FIT rather than off the
//     raw canvas, that a blit is attributed to the object it landed on, and
//     that a cue is named from the file it played and stamped with the tick it
//     played on.
//   - THE EVIDENCE. That `captureReplay` writes the section rather than the
//     run, writes it even when the section threw, writes nothing for a section
//     that drew nothing, and costs nothing when no run is collecting.
//
// The draw-command recorder underneath `captureReplay` is a verbatim port of
// the one coil carries, whose own project drives every rule of the replay
// format against it. What is checked here is the harness's use of it.
//
// No review item names this file, so a run never loads it. It runs with the
// whole project, which is how a case author runs these suites while writing
// them:
//
//   npx vitest run --config validation/vitest.config.ts

import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  BALL_CAP,
  CONTAINMENT_RADIUS,
  DESTROY_POINTS,
  MUSIC_TITLE,
  PADDLE_SPAN_BASE,
  PADDLE_START_ANGLE,
  PLANET_RADIUS,
  POD_FALL_SPEED,
  RINGS,
  SERVE_RADIUS,
  START_LIVES,
  TICK_MS,
  TOTAL_SLOTS,
  ballSpeed,
  pointAt,
  slotArcCenterDeg,
} from "./constants";
import { REQUIRED_OPS } from "./surface";
import {
  MAX_REPLAY_FRAMES,
  advanceTicks,
  blitsNear,
  captureReplay,
  captureStill,
  colorDistance,
  cuesNamed,
  hold,
  isolate,
  onCue,
  openHarness,
  poseScene,
  sampleAt,
  spawnBallPolar,
  spawnPodPolar,
  spriteNear,
  startPlay,
  tap,
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
  mediaDir = mkdtempSync(join(tmpdir(), "kessler-harness-"));
  collecting = process.env[MEDIA_DIR_ENV];
  delete process.env[MEDIA_DIR_ENV];
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
  if (collecting === undefined) delete process.env[MEDIA_DIR_ENV];
  else process.env[MEDIA_DIR_ENV] = collecting;
  rmSync(mediaDir, { recursive: true, force: true });
});

/** Collect this section's media into the temporary directory. */
function collect(): void {
  process.env[MEDIA_DIR_ENV] = mediaDir;
}

/** The files this suite's outputs were written under, sorted. */
function written(): string[] {
  try {
    return readdirSync(join(mediaDir, SUITE_DIR)).sort();
  } catch {
    return [];
  }
}

/** One frame of a written recording, as far as this suite reads it. */
interface WrittenFrame {
  count: number;
  deltaMs: number;
}

/** The recording written for `outputId`, inflated. */
function recordingOf(outputId: string): { frames: WrittenFrame[] } {
  const file = join(mediaDir, SUITE_DIR, `${outputId}.json.gz`);
  return JSON.parse(gunzipSync(readFileSync(file)).toString("utf8")) as {
    frames: WrittenFrame[];
  };
}

/** Every live target across the snapshot's three rings. */
function targetCount(snapshot: { rings: { targets: unknown[] }[] }): number {
  return snapshot.rings.reduce((sum, ring) => sum + ring.targets.length, 0);
}

/* ---- The page and the surface --------------------------------------------- */

it("opens on a build carrying the whole surface", async () => {
  expect(h.surfaceFault).toBeNull();
  const ops = await h.probe(REQUIRED_OPS);
  expect(Object.entries(ops).filter(([, kind]) => kind !== "function")).toEqual(
    [],
  );
});

it("takes the game off the wall clock, on the boot state reset promises", async () => {
  const snapshot = await h.snapshot();
  expect(snapshot.autoStep).toBe(false);
  expect(snapshot.screen).toBe("title");
  expect(snapshot.menu.index).toBe(0);
  expect(snapshot.ticks).toBe(0);
  expect(snapshot.score).toBe(0);
  expect(snapshot.lives).toBe(START_LIVES);
  expect(snapshot.wave).toBe(1);
  expect(snapshot.paddle.angleDeg).toBe(PADDLE_START_ANGLE);
  expect(snapshot.paddle.spanDeg).toBe(PADDLE_SPAN_BASE);
  expect(snapshot.balls).toEqual([]);
  expect(snapshot.pods).toEqual([]);
  expect(snapshot.rings).toHaveLength(3);
  for (const [index, ring] of snapshot.rings.entries()) {
    expect(ring.angleDeg).toBe(0);
    expect(ring.targets).toHaveLength(RINGS[index].slots);
    for (const target of ring.targets) {
      expect(target.hp).toBe(RINGS[index].hp);
    }
    expect(ring.speedDegPerSec).toBeCloseTo(RINGS[index].speedAtWave(1), 9);
  }
  expect(snapshot.effects).toEqual({
    widenTicks: 0,
    narrowTicks: 0,
    pierceTicks: 0,
    shieldActive: false,
  });
  expect(snapshot.waveAdvance).toBe(true);
  expect(snapshot.podSpawn).toBe(true);
});

it("leaves the page free of errors while a scenario runs", async () => {
  await isolate(h);
  await spawnBallPolar(h, 250, 45, ballSpeed(1));
  await advanceTicks(h, 30);
  expect(h.pageErrors).toEqual([]);
});

/* ---- The clock ------------------------------------------------------------ */

it("resolves exactly the ticks it is asked for", async () => {
  await poseScene(h, "playing");
  const before = await h.snapshot();
  expect(before.ticks).toBe(0);

  const after = await advanceTicks(h, 1);
  expect(after.ticks).toBe(1);
  // Ring 2 orbits at its wave-1 speed, one tick's worth per tick.
  expect(after.rings[1].angleDeg).toBeCloseTo(RINGS[1].speedAtWave(1) / 60, 6);

  const later = await advanceTicks(h, 59);
  expect(later.ticks).toBe(60);
  expect(later.rings[1].angleDeg).toBeCloseTo(RINGS[1].speedAtWave(1), 6);
  expect(h.tickCount()).toBe(60);
  expect(h.timeMs()).toBeCloseTo(60 * TICK_MS, 6);
});

it("counts ticks on a frozen screen without advancing the field", async () => {
  const snapshot = await advanceTicks(h, 8);
  expect(snapshot.screen).toBe("title");
  expect(snapshot.ticks).toBe(8);
  expect(snapshot.rings[1].angleDeg).toBe(0);
});

it("sweeps a tick at a time and reports where it stopped", async () => {
  await isolate(h);
  // A ball falling straight in from just above the burn-up threshold: 120
  // units at 4 units per tick is 30 ticks to the planet. The burn-up removes
  // the last live ball INSIDE its tick, and the same tick's life-loss check
  // parks a fresh one (specs/field.md), so the sweep watches the life fall
  // rather than a ball count that is whole again by the time a tick ends.
  await spawnBallPolar(h, 198, 0, 240, 180);
  const swept = await h.until((s) => s.lives < START_LIVES, { maxTicks: 60 });
  expect(swept.hit).toBe(true);
  expect(swept.ticks).toBeGreaterThan(20);
  expect(swept.ticks).toBeLessThanOrEqual(31);
  expect(swept.snapshot.lives).toBe(START_LIVES - 1);
  // The repark is the game's own rule doing the arriving, not the sweep's.
  expect(swept.snapshot.balls).toHaveLength(1);
  expect(swept.snapshot.balls[0].parked).toBe(true);
});

it("gives up a sweep at its budget rather than running forever", async () => {
  await isolate(h);
  const swept = await h.until((s) => s.score > 0, { maxTicks: 3 });
  expect(swept.hit).toBe(false);
  expect(swept.ticks).toBe(3);
});

it("hands the game back to its own loop, and takes it back", async () => {
  await poseScene(h, "playing");
  await h.runFor(400);
  const running = await h.snapshot();
  expect(running.ticks).toBeGreaterThan(0);
  expect(running.autoStep).toBe(false);

  // And nothing moves again until this harness says so.
  const held = await h.snapshot();
  await h.page.waitForTimeout(150);
  expect((await h.snapshot()).ticks).toBe(held.ticks);
});

/* ---- The keyboard --------------------------------------------------------- */

it("holds a key the build can see for exactly the ticks it spans", async () => {
  await isolate(h);
  // 270 degrees per second is 4.5 per tick; 20 held ticks turn the deflector
  // 90 degrees. `right` rises the angle (specs/deflector-and-ball.md).
  const after = await hold(h, "ArrowRight", 20);
  expect(after.paddle.angleDeg).toBeCloseTo(PADDLE_START_ANGLE + 90, 6);
  // And the alternate binding does exactly what the arrow does, downward.
  const back = await hold(h, "KeyA", 20);
  expect(back.paddle.angleDeg).toBeCloseTo(PADDLE_START_ANGLE, 6);
});

it("delivers a tap's press edge to a menu, through the browser's own input", async () => {
  const before = await h.snapshot();
  expect(before.menu.index).toBe(0);
  await tap(h, "ArrowDown");
  expect((await h.snapshot()).menu.index).toBe(1);
  await tap(h, "ArrowUp");
  expect((await h.snapshot()).menu.index).toBe(0);
});

it("delivers a tap's press edge to the simulation", async () => {
  await isolate(h);
  await h.debug.parkBall();
  const parked = await h.snapshot();
  expect(parked.balls).toHaveLength(1);
  expect(parked.balls[0].parked).toBe(true);

  await tap(h, "Space");
  const launched = await h.snapshot();
  expect(launched.balls).toHaveLength(1);
  expect(launched.balls[0].parked).toBe(false);
  // Radially outward at the wave-1 speed, from the deflector's start angle at
  // the bottom of the stage (+y is +theta 90): the velocity points down.
  expect(launched.balls[0].vy).toBeGreaterThan(0);
  const speed = Math.hypot(launched.balls[0].vx, launched.balls[0].vy);
  expect(speed).toBeCloseTo(ballSpeed(1), 3);
});

/* ---- The posed world ------------------------------------------------------ */

it("isolates an empty playing field with both consequences held", async () => {
  const snapshot = await isolate(h);
  expect(snapshot.screen).toBe("playing");
  expect(snapshot.balls).toEqual([]);
  expect(snapshot.pods).toEqual([]);
  expect(targetCount(snapshot)).toBe(0);
  expect(snapshot.waveAdvance).toBe(false);
  expect(snapshot.podSpawn).toBe(false);
  expect(snapshot.score).toBe(0);
  expect(snapshot.lives).toBe(START_LIVES);
  expect(snapshot.wave).toBe(1);

  // The emptied field plays on: no clearing arrives over it.
  const later = await advanceTicks(h, 10);
  expect(later.screen).toBe("playing");
});

it("resets the world between scenes, so nothing carries", async () => {
  await isolate(h);
  await h.debug.setScore(500);
  await h.debug.setEffectTicks("pierce", 100);
  const fresh = await h.reset();
  expect(fresh.screen).toBe("title");
  expect(fresh.score).toBe(0);
  expect(fresh.effects.pierceTicks).toBe(0);
  expect(fresh.waveAdvance).toBe(true);
  expect(fresh.podSpawn).toBe(true);
  expect(fresh.ticks).toBe(0);
  // And the simulation stays off the wall clock across the reset.
  expect(fresh.autoStep).toBe(false);
});

it("spawns a ball where the polar helper says, moving as it says", async () => {
  await isolate(h);
  await spawnBallPolar(h, 400, 0, 100, 0);
  const snapshot = await h.snapshot();
  expect(snapshot.balls).toHaveLength(1);
  const ball = snapshot.balls[0];
  expect(ball.x).toBeCloseTo(900, 6);
  expect(ball.y).toBeCloseTo(500, 6);
  expect(ball.vx).toBeCloseTo(100, 6);
  expect(ball.vy).toBeCloseTo(0, 6);
  expect(ball.parked).toBe(false);
  expect(ball.piercing).toBe(false);
});

it("spawns a pod where the polar helper says, falling inward", async () => {
  await isolate(h);
  await spawnPodPolar(h, "shield", 300, 90);
  const posed = await h.snapshot();
  expect(posed.pods).toHaveLength(1);
  expect(posed.pods[0].kind).toBe("shield");
  expect(posed.pods[0].x).toBeCloseTo(500, 6);
  expect(posed.pods[0].y).toBeCloseTo(800, 6);

  // Ten ticks of the game's own fall, radially inward at the fixed speed.
  const later = await advanceTicks(h, 10);
  expect(later.pods[0].y).toBeCloseTo(800 - (POD_FALL_SPEED / 60) * 10, 4);
  expect(later.pods[0].x).toBeCloseTo(500, 4);
});

it("stages a destruction over the isolated field, with nothing arriving on top", async () => {
  await isolate(h);
  // One ring-1 target in slot 0, and a ball head-on at its arc center. Ring 1
  // is stationary, so the arc center stands where the geometry puts it.
  await h.debug.spawnTarget(1, 0, 1);
  const arcCenter = slotArcCenterDeg(1, 0, 0);
  await spawnBallPolar(h, 350, arcCenter, 240, 180);

  const swept = await h.until((s) => targetCount(s) === 0, { maxTicks: 30 });
  expect(swept.hit).toBe(true);
  // The destruction awarded its ring's destroy figure and nothing else...
  expect(swept.snapshot.score).toBe(DESTROY_POINTS[0]);
  // ...and the held consequences did not arrive: no clearing over the emptied
  // field, no pod from the destruction.
  expect(swept.snapshot.screen).toBe("playing");
  expect(swept.snapshot.pods).toEqual([]);
  // The ball reflected rather than piercing: it is still in play.
  expect(swept.snapshot.balls).toHaveLength(1);
});

it("starts a session from the title the way a player does", async () => {
  const started = await startPlay(h);
  expect(started.screen).toBe("playing");
  expect(started.score).toBe(0);
  expect(started.lives).toBe(START_LIVES);
  expect(started.wave).toBe(1);
  expect(targetCount(started)).toBe(TOTAL_SLOTS);
  expect(started.balls).toHaveLength(1);
  expect(started.balls[0].parked).toBe(true);
});

it("enters every screen the direct way", async () => {
  for (const screen of [
    "playing",
    "waveclear",
    "paused",
    "gameover",
    "title",
    "howto",
  ] as const) {
    const snapshot = await poseScene(h, screen);
    expect(snapshot.screen).toBe(screen);
    expect(snapshot.menu.index).toBe(0);
  }
});

it("respects the ball cap the way the surface states it", async () => {
  await isolate(h);
  for (let i = 0; i < BALL_CAP + 2; i += 1) {
    await spawnBallPolar(h, 250 + i * 10, 0, 100, 0);
  }
  expect((await h.snapshot()).balls).toHaveLength(BALL_CAP);
});

/* ---- Reading the render --------------------------------------------------- */

it("reports the operations one tick's render issued", async () => {
  await poseScene(h, "playing");
  await h.debug.setScore(240);
  const calls = await h.frameCalls();
  expect(calls.length).toBeGreaterThan(0);
  const text = calls.flatMap((call) =>
    call.kind === "call" &&
    (call.method === "fillText" || call.method === "strokeText") &&
    typeof call.args[0] === "string"
      ? [call.args[0]]
      : [],
  );
  expect(text.join(" ")).toContain("240");
});

it("attributes a blit to the object it landed on", async () => {
  await isolate(h);
  await spawnPodPolar(h, "shield", 300, 0);
  await h.debug.parkBall();
  const blits = await h.frameBlits();
  expect(blits.length).toBeGreaterThan(0);

  // The planet sprite is drawn centered on the stage center, the pod sprite on
  // its falling pod, and the ball sprite on the parked ball — three different
  // produced files, three different identities.
  const onPlanet = spriteNear(h, blits, 500, 500, PLANET_RADIUS);
  const pod = pointAt(300, 0);
  const onPod = spriteNear(h, blits, pod.x, pod.y, 12);
  const serve = pointAt(SERVE_RADIUS, PADDLE_START_ANGLE);
  const onBall = spriteNear(h, blits, serve.x, serve.y, 12);
  expect(onPlanet).not.toBeNull();
  expect(onPod).not.toBeNull();
  expect(onBall).not.toBeNull();
  expect(new Set([onPlanet, onPod, onBall]).size).toBe(3);

  // And an empty corner of the field carries no blit at all.
  expect(blitsNear(h, blits, 40, 40, 20)).toEqual([]);
});

it("samples a point through the fit rather than off the raw canvas", async () => {
  await poseScene(h, "playing");
  await advanceTicks(h, 1);
  const atStageSize = await sampleAt(h, 500, 500);

  // The same point, on a wide window where the stage is scaled and letterboxed
  // and the canvas is a different size entirely. A harness that sampled raw
  // canvas coordinates would read some other part of the field.
  const wide = await openHarness({ cssWidth: 1600, cssHeight: 900 });
  try {
    await poseScene(wide, "playing");
    await advanceTicks(wide, 1);
    const atOtherSize = await sampleAt(wide, 500, 500);
    expect(colorDistance(atStageSize, atOtherSize)).toBeLessThan(32);
  } finally {
    await wide.dispose();
  }
});

/* ---- Cues ----------------------------------------------------------------- */

it("names the cue a build played, and the tick it played it on", async () => {
  await h.armAudio();
  await isolate(h);
  // A ball crossing the deflector contact radius inward, inside the span: the
  // bounce and its cue land on the crossing tick, four ticks in (16 units at 4
  // units per tick).
  await spawnBallPolar(h, 210, PADDLE_START_ANGLE, 240, 180);
  const cues = onCue(h);
  const before = h.tickCount();
  await advanceTicks(h, 10);

  const bounces = cuesNamed(cues, "paddle-bounce");
  expect(bounces).toHaveLength(1);
  expect(bounces[0].tick).toBeGreaterThan(before);
  expect(bounces[0].tick).toBeLessThanOrEqual(before + 6);
  expect(bounces[0].loop).toBe(false);
  expect(cuesNamed(cues, "ball-lost")).toHaveLength(0);
});

it("hears the menu cue a tap causes, and the bed the title loops", async () => {
  await h.armAudio();
  const cues = onCue(h);
  await tap(h, "ArrowDown");
  expect(cuesNamed(cues, "menu-move").length).toBeGreaterThanOrEqual(1);
  expect(await h.looping(MUSIC_TITLE)).toBe(true);
});

it("hears nothing at all on ticks that resolve no event", async () => {
  await h.armAudio();
  await isolate(h);
  const cues = onCue(h);
  await advanceTicks(h, 10);
  expect(cues.filter((cue) => !(cue.name ?? "").startsWith("music"))).toEqual(
    [],
  );
});

/* ---- Evidence ------------------------------------------------------------- */

it("writes nothing at all when no run is collecting media", async () => {
  await poseScene(h, "playing");
  const seen = await captureReplay(h, "quiet", async () => {
    await advanceTicks(h, 2);
    return "value";
  });
  expect(seen).toBe("value");
  await captureStill(h, "quiet-still");
  expect(written()).toEqual([]);
});

it("writes the section a capture wrapped, and hands its value back", async () => {
  collect();
  await poseScene(h, "playing");
  const ticks = 12;
  const seen = await captureReplay(h, "section", async () => {
    await advanceTicks(h, ticks);
    return ticks;
  });
  expect(seen).toBe(ticks);
  expect(written()).toEqual(["section.json.gz"]);
  expect(recordingOf("section").frames).toHaveLength(ticks);
});

it("writes the evidence of a section that failed", async () => {
  collect();
  await poseScene(h, "playing");
  await expect(
    captureReplay(h, "failed", async () => {
      await advanceTicks(h, 1);
      throw new Error("the scenario failed");
    }),
  ).rejects.toThrow("the scenario failed");
  expect(written()).toEqual(["failed.json.gz"]);
  expect(recordingOf("failed").frames).toHaveLength(1);
});

it("writes no recording for a section that drove no tick", async () => {
  collect();
  await poseScene(h, "playing");
  await captureReplay(h, "empty", async () => undefined);
  expect(written()).toEqual([]);
});

it("keeps a long section whole, at fewer frames and the same length", async () => {
  collect();
  await isolate(h);
  // Past twice the cap, so the page's own decimation runs before the write's.
  const ticks = MAX_REPLAY_FRAMES * 2 + 100;
  await captureReplay(h, "long", () => advanceTicks(h, ticks));

  const frames = recordingOf("long").frames;
  expect(frames.length).toBeLessThanOrEqual(MAX_REPLAY_FRAMES);
  expect(frames.length).toBeGreaterThan(MAX_REPLAY_FRAMES / 2);
  // The last tick driven is always the one a reviewer lands on, and the kept
  // deltas still sum to the section's own elapsed time.
  expect(frames[frames.length - 1].count).toBe(ticks);
  const elapsed = frames.reduce((sum, frame) => sum + frame.deltaMs, 0);
  expect(elapsed).toBeCloseTo(ticks * TICK_MS, 3);
});

it("writes a still of the picture the last tick left", async () => {
  collect();
  await poseScene(h, "playing");
  await advanceTicks(h, 1);
  await captureStill(h, "scene");
  expect(written()).toEqual(["scene.png"]);
  expect(
    readFileSync(join(mediaDir, SUITE_DIR, "scene.png")).length,
  ).toBeGreaterThan(1000);
});

/* ---- A whole scenario, end to end ----------------------------------------- */

it("drives a bounce off the containment field the way a suite will", async () => {
  await isolate(h);
  // A ball heading straight out from just inside the containment contact
  // radius: it crosses 472 outward within a few ticks and reflects back in.
  await spawnBallPolar(h, 460, 45, 240, 0);
  const cues = onCue(h);
  const swept = await h.until(
    (s) => s.balls.length === 1 && s.balls[0].vx < 0,
    { maxTicks: 20 },
  );
  expect(swept.hit).toBe(true);
  const snapshot = swept.snapshot;
  const r = Math.hypot(snapshot.balls[0].x - 500, snapshot.balls[0].y - 500);
  expect(r).toBeLessThanOrEqual(CONTAINMENT_RADIUS);
  // The reflection preserved the arriving speed.
  const speed = Math.hypot(snapshot.balls[0].vx, snapshot.balls[0].vy);
  expect(speed).toBeCloseTo(240, 3);
  // No cue is asserted by name here without armed audio; the field-bounce cue
  // is only audible after a gesture, which this scenario deliberately skipped —
  // proving a suite can drive contacts without arming audio at all.
  expect(cues.every((cue) => cue.name !== "ball-lost")).toBe(true);
});
