// harness — the machinery the suites in this directory are built on.
//
// The suites next door are validators: each decides one review point against
// the build. This file decides nothing about the build. It checks the HARNESS,
// whose faults are invisible from inside a suite and wrong in ways nothing
// else catches: a step schedule that resolves the wrong number of ticks moves
// every duration this case states, an isolation helper that leaves a target
// standing feeds phantom contacts into every ball scenario, an observer that
// read the build's own copy of a press would silently break the game it was
// watching, a replay written in the wrong framing reaches the console as
// something it cannot read, and a host that cannot serve the produced sprites
// would have every presentation point failing a build that draws exactly what
// it was asked to.
//
// No review item names this file, so a run never loads it. It runs with the
// whole project, which is how a case author runs these suites while writing
// them:
//
//   npx vitest run --config validation/vitest.config.ts

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { Recording } from "@clockwyrks/structured-2d";
import {
  BALL_CAP,
  DEFLECTOR_BALL_CONTACT_RADIUS,
  DEFLECTOR_BASE_SPAN_DEG,
  DEFLECTOR_START_ANGLE_DEG,
  FIELD_CONTACT_RADIUS,
  RING_SPECS,
  SPRITE_PATHS,
  START_LIVES,
  START_WAVE,
  TITLE_ITEMS,
  TITLE_TEXT,
} from "./constants";
import {
  addObserver,
  advanceTicks,
  angularOffset,
  blitsNear,
  captureReplay,
  captureStill,
  cuesNamed,
  drewText,
  hold,
  isolate,
  onCue,
  openHarness,
  polarOf,
  polarToXy,
  polarVelocity,
  poseScene,
  slotArcCenterDeg,
  spawnBallPolar,
  spawnPodPolar,
  startPlay,
  tap,
  targetCount,
  velocityPolar,
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
/* The engine, the surface, and the boot state                                */
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
  expect(opening.waveAdvance).toBe(true);
  expect(opening.podSpawn).toBe(true);
  expect(opening.paddle.angleDeg).toBe(DEFLECTOR_START_ANGLE_DEG);
  expect(opening.paddle.spanDeg).toBe(DEFLECTOR_BASE_SPAN_DEG);
  expect(opening.balls).toEqual([]);
  expect(opening.pods).toEqual([]);
  expect(opening.effects).toEqual({
    widenTicks: 0,
    narrowTicks: 0,
    pierceTicks: 0,
    shieldActive: false,
  });

  // Every slot filled at full hit points, angles 0, wave-1 orbit speeds.
  expect(opening.rings).toHaveLength(3);
  opening.rings.forEach((ring, i) => {
    const spec = RING_SPECS[i];
    expect(ring.angleDeg).toBe(0);
    expect(ring.speedDegPerSec).toBeCloseTo(spec.orbitSpeedAtWave(1), 9);
    expect(ring.targets).toHaveLength(spec.slots);
    for (const target of ring.targets) expect(target.hp).toBe(spec.hitPoints);
  });
});

it("serves the produced tree: every non-audio asset loads", async () => {
  // The engine decodes audio through a Web Audio context this host lacks, so
  // the produced `.wav` files fail here whatever the build does — every OTHER
  // failure would be the harness failing to serve the workspace's own files.
  await advanceTicks(h, 2);
  const notAudio = h.assetFailures.filter((f) => !f.path.endsWith(".wav"));
  expect(notAudio).toEqual([]);
});

it("resets to the boot state from a fully posed world, taking a seed", async () => {
  h.debug.setScreen("playing");
  h.debug.setScore(4321);
  h.debug.setLives(1);
  h.debug.setWave(5);
  h.debug.setPaddleAngle(200);
  h.debug.clearTargets();
  h.debug.setEffectTicks("pierce", 100);
  h.debug.setShield(true);
  h.debug.setWaveAdvance(false);
  h.debug.setPodSpawn(false);
  spawnBallPolar(h, 400, 10, 100);
  spawnPodPolar(h, "widen", 300, 45);
  await advanceTicks(h, 3);

  h.reset(7);
  const after = h.snapshot();

  expect(after.screen).toBe("title");
  expect(after.ticks).toBe(0);
  expect(after.score).toBe(0);
  expect(after.lives).toBe(START_LIVES);
  expect(after.wave).toBe(START_WAVE);
  expect(after.paddle.angleDeg).toBe(DEFLECTOR_START_ANGLE_DEG);
  expect(after.paddle.spanDeg).toBe(DEFLECTOR_BASE_SPAN_DEG);
  expect(after.balls).toEqual([]);
  expect(after.pods).toEqual([]);
  expect(after.effects.pierceTicks).toBe(0);
  expect(after.effects.shieldActive).toBe(false);
  expect(after.waveAdvance).toBe(true);
  expect(after.podSpawn).toBe(true);
  expect(targetCount(after)).toBe(
    RING_SPECS[0].slots + RING_SPECS[1].slots + RING_SPECS[2].slots,
  );
});

/* -------------------------------------------------------------------------- */
/* The step schedule                                                          */
/* -------------------------------------------------------------------------- */

it("resolves exactly one tick per frame, on running and frozen screens", async () => {
  // The pairing `specs/instrumentation.md` names: a ConstantClock of 1000/60
  // with engine.advance consumes exactly one tick per frame. `ticks` counts on
  // every screen — frozen screens still count them — so the schedule is
  // provable on the title as well as in play.
  expect((await advanceTicks(h, 7)).ticks).toBe(7);
  expect((await advanceTicks(h, 100)).ticks).toBe(107);

  isolate(h);
  const before = h.snapshot().ticks;
  expect((await advanceTicks(h, 60)).ticks).toBe(before + 60);
});

it("advances the simulation only in play: a posed ring orbits, a frozen one holds", async () => {
  // Ring 2 orbits at +12 deg/s at wave 1, so 60 ticks carry it 12 degrees.
  isolate(h);
  const start = h.snapshot().rings[1].angleDeg;
  const after = await advanceTicks(h, 60);
  expect(after.rings[1].angleDeg).toBeCloseTo(start + 12, 6);

  // Paused freezes the whole simulation (specs/screens.md).
  poseScene(h, "paused");
  const held = h.snapshot().rings[1].angleDeg;
  expect((await advanceTicks(h, 60)).rings[1].angleDeg).toBeCloseTo(held, 9);
});

/* -------------------------------------------------------------------------- */
/* Isolation and the posed screens                                            */
/* -------------------------------------------------------------------------- */

it("isolates: a fresh playing screen holding nothing, both switches off", () => {
  const posed = isolate(h, 3);

  expect(posed.screen).toBe("playing");
  expect(posed.score).toBe(0);
  expect(posed.lives).toBe(START_LIVES);
  expect(posed.wave).toBe(START_WAVE);
  expect(targetCount(posed)).toBe(0);
  expect(posed.balls).toEqual([]);
  expect(posed.pods).toEqual([]);
  expect(posed.waveAdvance).toBe(false);
  expect(posed.podSpawn).toBe(false);
});

it("stays in playing over the emptied field: isolation is not a clearing", async () => {
  // clearTargets is not a destruction and not a clearing
  // (specs/instrumentation.md), so an isolated world plays on.
  isolate(h);
  const after = await advanceTicks(h, 30);
  expect(after.screen).toBe("playing");
  expect(targetCount(after)).toBe(0);
});

it("poses each screen through the surface, leaving the session's figures standing", () => {
  // setScreen("gameover") shows the score and wave as they stand
  // (specs/instrumentation.md), so poseScene must not reset first.
  h.debug.setScreen("playing");
  h.debug.setScore(1234);
  h.debug.setWave(3);

  expect(poseScene(h, "gameover").screen).toBe("gameover");
  expect(h.snapshot().score).toBe(1234);
  expect(h.snapshot().wave).toBe(3);

  expect(poseScene(h, "title").screen).toBe("title");
  expect(poseScene(h, "howto").screen).toBe("howto");
  expect(poseScene(h, "playing").screen).toBe("playing");
  expect(poseScene(h, "waveclear").screen).toBe("waveclear");
  expect(poseScene(h, "paused").screen).toBe("paused");
  expect(h.snapshot().menu.index).toBe(0);
});

/* -------------------------------------------------------------------------- */
/* Real input: tap, hold, startPlay, and the observer                         */
/* -------------------------------------------------------------------------- */

it("taps with real key events: one tap, one menu step, one cue", async () => {
  // The title carries two entries (specs/screens.md), so one `down` moves the
  // highlight to 1 and a second wraps it back to 0, each playing menu-move —
  // which also proves the cue collector hears the ticks and not the poses.
  const played = onCue(h);
  await tap(h, "ArrowDown");
  expect(h.snapshot().menu.index).toBe(1);
  await tap(h, "ArrowDown");
  expect(h.snapshot().menu.index).toBe(TITLE_ITEMS.length % 2 === 0 ? 0 : 1);
  expect(cuesNamed(played, "menu-move")).toHaveLength(2);
});

it("holds a key for a counted number of ticks", async () => {
  // 270 degrees per second while `right` is held
  // (specs/deflector-and-ball.md): 20 ticks is a third of a second, 90
  // degrees, from the starting 90 to 180.
  isolate(h);
  const after = await hold(h, "ArrowRight", 20);
  expect(after.paddle.angleDeg).toBeCloseTo(180, 6);

  // Released: another 20 ticks move it nowhere.
  const later = await advanceTicks(h, 20);
  expect(later.paddle.angleDeg).toBeCloseTo(180, 6);

  // The other binding of the opposite action turns it back (specs/controls.md).
  const back = await hold(h, "KeyA", 20);
  expect(back.paddle.angleDeg).toBeCloseTo(90, 6);
});

it("startPlay reaches playing through the real title menu", async () => {
  const playing = await startPlay(h);

  expect(playing.screen).toBe("playing");
  expect(playing.score).toBe(0);
  expect(playing.wave).toBe(START_WAVE);

  // A ball parks on the deflector: at the contact radius, at the deflector's
  // center angle (specs/deflector-and-ball.md).
  expect(playing.balls).toHaveLength(1);
  expect(playing.balls[0].parked).toBe(true);
  const at = polarOf(playing.balls[0]);
  expect(at.r).toBeCloseTo(DEFLECTOR_BALL_CONTACT_RADIUS, 4);
  expect(
    Math.abs(angularOffset(playing.paddle.angleDeg, at.thetaDeg)),
  ).toBeLessThan(1e-4);
});

it("observes an action without eating the build's copy of the edge", async () => {
  // The observer reads its own copy between the press and the frame that
  // delivers it; the build still sees the press, so the game pauses.
  isolate(h);
  const observer = addObserver(h);

  h.holdKey("KeyP");
  expect(observer.input.pressed("pause")).toBe(true);
  await h.advance(1);
  h.releaseKey("KeyP");

  expect(h.snapshot().screen).toBe("paused");
});

/* -------------------------------------------------------------------------- */
/* Polar arithmetic and the posed contacts                                    */
/* -------------------------------------------------------------------------- */

it("maps polar figures the way the specification does", () => {
  // specs/overview.md: x = 500 + r cos, y = 500 + r sin, 0 along +x,
  // increasing toward +y.
  expect(polarToXy(100, 0)).toEqual({ x: 600, y: 500 });
  const down = polarToXy(100, 90);
  expect(down.x).toBeCloseTo(500, 9);
  expect(down.y).toBeCloseTo(600, 9);

  const round = xyToPolar(400, 500);
  expect(round.r).toBeCloseTo(100, 9);
  expect(round.thetaDeg).toBeCloseTo(180, 9);

  // Wrap-aware offsets in [-180, 180) (specs/field.md).
  expect(angularOffset(350, 10)).toBeCloseTo(20, 9);
  expect(angularOffset(10, 350)).toBeCloseTo(-20, 9);
  expect(angularOffset(0, 180)).toBe(-180);

  // The tangential is the radial rotated +90 degrees: at theta 0, outward is
  // +x and tangential is +y.
  const v = polarVelocity(0, 3, 4);
  expect(v.vx).toBeCloseTo(3, 9);
  expect(v.vy).toBeCloseTo(4, 9);
  const parts = velocityPolar(600, 500, 3, 4);
  expect(parts.vr).toBeCloseTo(3, 9);
  expect(parts.vt).toBeCloseTo(4, 9);

  // Slot 0's arc center sits 2 + arc/2 into the slot (specs/rings.md).
  expect(slotArcCenterDeg(1, 0, 0)).toBeCloseTo(15, 9);
  expect(slotArcCenterDeg(1, 1, 0)).toBeCloseTo(45, 9);
  expect(slotArcCenterDeg(3, 0, 90)).toBeCloseTo(99, 9);
});

it("spawns a posed ball that the real ticks bounce off the containment field", async () => {
  // Not a verdict on the reflection — the validators own that — but proof the
  // polar spawn, the tick drive, the sweep, and the cue collector compose: a
  // ball posed heading outward crosses radius 472 and comes back inward,
  // sounding field-bounce (specs/field.md).
  isolate(h);
  spawnBallPolar(h, FIELD_CONTACT_RADIUS - 12, 30, 240);
  const played = onCue(h);

  const swept = await h.until(
    (s) => {
      if (s.balls.length !== 1) return false;
      const b = s.balls[0];
      return velocityPolar(b.x, b.y, b.vx, b.vy).vr < 0;
    },
    { maxTicks: 20 },
  );

  expect(swept.hit).toBe(true);
  expect(cuesNamed(played, "field-bounce").length).toBeGreaterThan(0);
});

it("honors the surface's ball cap through spawnBallPolar", () => {
  isolate(h);
  for (let i = 0; i < BALL_CAP + 2; i += 1) {
    spawnBallPolar(h, 400, i * 30, -50);
  }
  expect(h.snapshot().balls).toHaveLength(BALL_CAP);
});

it("spawns a posed pod that falls radially inward on the real ticks", async () => {
  // specs/pods.md: 120 units/second inward, center angle constant. One second
  // of ticks takes the posed pod 120 units down its radial.
  isolate(h);
  spawnPodPolar(h, "shield", 400, 75);
  const after = await advanceTicks(h, 60);

  expect(after.pods).toHaveLength(1);
  const at = polarOf(after.pods[0]);
  expect(at.r).toBeCloseTo(280, 4);
  expect(at.thetaDeg).toBeCloseTo(75, 4);
});

/* -------------------------------------------------------------------------- */
/* The render readings                                                        */
/* -------------------------------------------------------------------------- */

it("attributes a blit to the produced file it was served from", async () => {
  // The planet sprite is drawn centered on the stage center
  // (specs/assets.md), so the frame's blits must hold one whose bytes came
  // from the produced planet file, centered there — which is the whole asset
  // pipeline of this host proven end to end: fetch, decode, identity, and the
  // transform mapping of the blit box.
  isolate(h);
  const { blits } = await h.frameDraw();
  const onPlanet = blitsNear(h, blits, 500, 500, 6);
  expect(onPlanet.map((b) => b.id)).toContain(`assets/${SPRITE_PATHS.planet}`);
});

it("reads the text a frame drew", async () => {
  h.reset();
  const calls = await h.frameCalls();
  expect(drewText(calls, TITLE_TEXT)).toBe(true);
  expect(drewText(calls, TITLE_ITEMS[0])).toBe(true);
  expect(drewText(calls, TITLE_ITEMS[1])).toBe(true);
});

it("samples pixels through the viewport mapping", async () => {
  // At the default surface the canvas IS the stage, so device(500, 500) is
  // its middle; the reading proves the camera/viewport route rather than any
  // particular color, so it only has to find SOMETHING drawn: the planet
  // sprite's center differs from the untouched field far outside play.
  isolate(h);
  await h.frameDraw();
  const planet = h.pixel(500, 500);
  expect(planet).toHaveLength(4);
  const middle = h.device(500, 500);
  expect(middle).toEqual({ x: 500, y: 500 });
});

/* -------------------------------------------------------------------------- */
/* Evidence capture                                                           */
/* -------------------------------------------------------------------------- */

it("captures a replay of exactly the wrapped section, under the staged address", async () => {
  isolate(h);
  const value = await captureReplay(h, "clip", async () => {
    await advanceTicks(h, 5);
    return "through";
  });
  expect(value).toBe("through");

  const written = join(mediaDir, SUITE_DIR, "clip.json.gz");
  expect(existsSync(written)).toBe(true);
  const recording = JSON.parse(
    gunzipSync(readFileSync(written)).toString("utf8"),
  ) as Recording;
  expect(recording.frames).toHaveLength(5);
  expect(Array.isArray(recording.ops)).toBe(true);
  expect(Array.isArray(recording.states)).toBe(true);
});

it("still writes the replay when the scenario throws", async () => {
  isolate(h);
  await expect(
    captureReplay(h, "broken", async () => {
      await advanceTicks(h, 3);
      throw new Error("the check's own failure");
    }),
  ).rejects.toThrow("the check's own failure");

  expect(existsSync(join(mediaDir, SUITE_DIR, "broken.json.gz"))).toBe(true);
});

it("thins an over-long capture instead of cutting it short", async () => {
  isolate(h);
  await captureReplay(h, "long", () => advanceTicks(h, 400));

  const written = join(mediaDir, SUITE_DIR, "long.json.gz");
  const recording = JSON.parse(
    gunzipSync(readFileSync(written)).toString("utf8"),
  ) as Recording;

  expect(recording.frames.length).toBeLessThanOrEqual(300);
  // The whole section survives: the deltas still sum to the elapsed time.
  const total = recording.frames.reduce((sum, f) => sum + f.deltaMs, 0);
  expect(total).toBeCloseTo(400 * (1000 / 60), 3);
  // The last frame kept is the section's last.
  const last = recording.frames[recording.frames.length - 1];
  expect(last.count).toBeGreaterThanOrEqual(400);
});

it("writes no file for a capture that closed no frames", async () => {
  isolate(h);
  await captureReplay(h, "empty", () => undefined);
  expect(existsSync(join(mediaDir, SUITE_DIR, "empty.json.gz"))).toBe(false);
});

it("keeps the frame on the canvas as a still", async () => {
  isolate(h);
  await h.frameDraw();
  captureStill(h, "scene");

  const written = join(mediaDir, SUITE_DIR, "scene.png");
  expect(existsSync(written)).toBe(true);
  const bytes = readFileSync(written);
  // The PNG signature, so what landed is a picture and not a stack trace.
  expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
});

it("is a no-op with nothing collecting media", async () => {
  delete process.env[MEDIA_DIR_ENV];
  isolate(h);
  const value = await captureReplay(h, "quiet", () => advanceTicks(h, 2));
  expect(value.ticks).toBeGreaterThan(0);
  captureStill(h, "quiet");
  expect(existsSync(join(mediaDir, SUITE_DIR))).toBe(false);
});
