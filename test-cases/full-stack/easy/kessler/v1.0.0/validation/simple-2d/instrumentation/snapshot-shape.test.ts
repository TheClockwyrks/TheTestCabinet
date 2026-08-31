// instrumentation/snapshot-shape — on a posed session holding balls, targets on
// every ring, a falling pod, a running effect timer, and the shield, snapshot
// returns every documented field with its documented type, and the values match
// what was posed.
//
// specs/instrumentation.md, "Snapshot shape": "The shape is fixed and every
// field is present on every screen. `balls` lists every live ball, the parked
// ball included, in spawn order. `rings` always holds three entries, ring 1
// first, and each ring's `targets` lists its live targets by `slot` with the
// hit points each has left ... Every field is read straight off the game's
// state, so what the snapshot reports is what the game holds."
//
// THE WORLD IS POSED, NOT PLAYED. Every entity the reading is about arrives
// through one atomic pose, so a snapshot that reports zeroes, or reports a
// shape with holes, fails against exactly the values that were put there. The
// pierce timer runs, so the balls' `piercing` flag reads specs/pods.md's rule
// that "while `pierce` is in force every ball pierces".

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual, assertLength } from "../assert";
import { captureStill, isolate, openHarness, type Harness } from "../harness";
import { polarPose, toXy } from "./helpers";

/** The two posed balls, distinct in every figure. */
const BALL_A = polarPose(240, 200, 60, 80);
const BALL_B = polarPose(260, 320, -80, 60);
/** Where the posed pod falls. */
const POD_AT = toXy(300, 250);

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports every documented field, with the posed values", async () => {
  isolate(h);
  h.debug.setScore(555);
  h.debug.setLives(2);
  h.debug.spawnTarget(1, 2, 1);
  h.debug.spawnTarget(2, 3, 2);
  h.debug.spawnTarget(3, 4, 1);
  h.debug.spawnBall(BALL_A.x, BALL_A.y, BALL_A.vx, BALL_A.vy);
  h.debug.spawnBall(BALL_B.x, BALL_B.y, BALL_B.vx, BALL_B.vy);
  h.debug.spawnPod("widen", POD_AT.x, POD_AT.y);
  h.debug.setEffectTicks("pierce", 240);
  h.debug.setShield(true);

  const s = h.snapshot();
  await h.tick(1);
  captureStill(h, "posed");

  // The scalar fields, each present with its documented type and posed value.
  assertEqual(s.screen, "playing", "screen");
  assertEqual(typeof s.ticks, "number", "ticks");
  assertEqual(s.wave, 1, "wave");
  assertEqual(s.score, 555, "score");
  assertEqual(s.lives, 2, "lives");
  assertEqual(s.waveAdvance, false, "waveAdvance, as the isolation posed it");
  assertEqual(s.podSpawn, false, "podSpawn, as the isolation posed it");

  // The nested paddle and menu objects.
  assertEqual(typeof s.paddle.angleDeg, "number", "paddle.angleDeg");
  assertEqual(typeof s.paddle.spanDeg, "number", "paddle.spanDeg");
  assertEqual(typeof s.menu.index, "number", "menu.index");

  // The balls, in spawn order, every documented field carrying its pose.
  assertLength(s.balls, 2, "balls");
  for (const [i, posed] of [BALL_A, BALL_B].entries()) {
    const ball = s.balls[i];
    assertCloseTo(ball.x, posed.x, 6, `balls[${i}].x`);
    assertCloseTo(ball.y, posed.y, 6, `balls[${i}].y`);
    assertCloseTo(ball.vx, posed.vx, 6, `balls[${i}].vx`);
    assertCloseTo(ball.vy, posed.vy, 6, `balls[${i}].vy`);
    assertEqual(ball.parked, false, `balls[${i}].parked`);
    assertEqual(
      ball.piercing,
      true,
      `balls[${i}].piercing while pierce is in force (specs/pods.md)`,
    );
  }

  // The rings: always three entries, ring 1 first, targets listed by slot with
  // the hit points each has left.
  assertLength(s.rings, 3, "rings");
  const posedTargets = [
    { slot: 2, hp: 1 },
    { slot: 3, hp: 2 },
    { slot: 4, hp: 1 },
  ];
  for (const [i, expected] of posedTargets.entries()) {
    const ring = s.rings[i];
    assertEqual(typeof ring.angleDeg, "number", `rings[${i}].angleDeg`);
    assertEqual(
      typeof ring.speedDegPerSec,
      "number",
      `rings[${i}].speedDegPerSec`,
    );
    assertLength(ring.targets, 1, `rings[${i}].targets`);
    assertEqual(ring.targets[0].slot, expected.slot, `rings[${i}]'s slot`);
    assertEqual(ring.targets[0].hp, expected.hp, `rings[${i}]'s hit points`);
  }

  // The falling pod.
  assertLength(s.pods, 1, "pods");
  assertEqual(s.pods[0].kind, "widen", "pods[0].kind");
  assertCloseTo(s.pods[0].x, POD_AT.x, 6, "pods[0].x");
  assertCloseTo(s.pods[0].y, POD_AT.y, 6, "pods[0].y");

  // The effects: the running timer at its posed figure, the others at rest,
  // and the shield up.
  assertEqual(s.effects.widenTicks, 0, "effects.widenTicks");
  assertEqual(s.effects.narrowTicks, 0, "effects.narrowTicks");
  assertEqual(s.effects.pierceTicks, 240, "effects.pierceTicks");
  assertEqual(s.effects.shieldActive, true, "effects.shieldActive");
});
