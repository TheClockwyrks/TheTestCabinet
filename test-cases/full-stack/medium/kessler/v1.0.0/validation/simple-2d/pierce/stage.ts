// pierce/stage — the shared poses and readings of the pierce-effect checks.
//
// Every figure here comes from specs/pods.md's pierce section ("While pierce
// is in force every ball pierces...") with the target geometry of
// specs/rings.md and specs/field.md. Each stage poses one piece of the world
// through the debug surface — the effect timer, one ring 2 target, one ball on
// a known straight line — so a validator ticks a fixed count and reads one
// contact.

import { fail } from "../assert";
import {
  ballSpeedAtWave,
  PIERCE_DURATION_TICKS,
  POD_DROP_CHANCE,
  POD_KIND_TABLE,
} from "../constants";
import {
  isolate,
  polarToXy,
  polarVelocity,
  targetArcCenterDeg,
  xyToPolar,
  type Harness,
  type KesslerSnapshot,
  type PodKind,
} from "../harness";

/** Degrees to radians, for this file's own cos/sin. */
const DEG = Math.PI / 180;

/** One ball of the snapshot's `balls`. */
export type Ball = KesslerSnapshot["balls"][number];

/** One target of a snapshot ring's `targets`. */
export type Target = KesslerSnapshot["rings"][number]["targets"][number];

/** The pierce duration of specs/pods.md, under one cross-engine name. */
export const PIERCE_DURATION = PIERCE_DURATION_TICKS;

/** The isolated field: playing, empty, both driver switches held off. */
export async function poseIsolated(
  h: Harness,
  seed?: number,
): Promise<KesslerSnapshot> {
  return isolate(h, seed);
}

/** A fresh read of the posed state, before any tick has run. */
export async function readState(h: Harness): Promise<KesslerSnapshot> {
  return h.snapshot();
}

/** Put pierce in force with its timer at `ticks`, as a catch would. */
export async function armPierce(h: Harness, ticks: number): Promise<void> {
  h.debug.setEffectTicks("pierce", ticks);
}

/**
 * One ring 2 target in `slot`, at `hp` hit points (full, 2, by default), and
 * the ring optionally frozen in place so the arc stands where it was posed.
 * Returns the arc's center angle under ring angle 0, where isolate left it.
 */
export async function poseRingTwoTarget(
  h: Harness,
  slot: number,
  options: { hp?: number; freeze?: boolean } = {},
): Promise<number> {
  h.debug.spawnTarget(2, slot, options.hp ?? 2);
  if (options.freeze === true) h.debug.setRingSpeed(2, 0);
  return targetArcCenterDeg(2, slot, 0);
}

/** One ball at `(r, thetaDeg)` heading straight outward; the posed velocity. */
export async function outboundBall(
  h: Harness,
  thetaDeg: number,
  r: number,
  speed = ballSpeedAtWave(1),
): Promise<{ vx: number; vy: number }> {
  const at = polarToXy(r, thetaDeg);
  const velocity = polarVelocity(thetaDeg, speed, 0);
  h.debug.spawnBall(at.x, at.y, velocity.vx, velocity.vy);
  return velocity;
}

/** One ball at `(r, thetaDeg)` heading straight inward; the posed velocity. */
export async function inboundBall(
  h: Harness,
  thetaDeg: number,
  r: number,
  speed = ballSpeedAtWave(1),
): Promise<{ vx: number; vy: number }> {
  const at = polarToXy(r, thetaDeg);
  const velocity = polarVelocity(thetaDeg, -speed, 0);
  h.debug.spawnBall(at.x, at.y, velocity.vx, velocity.vy);
  return velocity;
}

/** Ring 2's live target in `slot`, or undefined once it is gone. */
export function ringTwoTarget(
  snapshot: KesslerSnapshot,
  slot: number,
): Target | undefined {
  return snapshot.rings[1].targets.find((target) => target.slot === slot);
}

/** Raise the shield ring, exactly as catching a shield pod would. */
export async function raiseShield(h: Harness): Promise<void> {
  h.debug.setShield(true);
}

/** Turn the pod-draw consequence back on after `isolate` held it off. */
export async function enablePodSpawn(h: Harness): Promise<void> {
  h.debug.setPodSpawn(true);
}

/** Turn the clearing-event consequence back on after `isolate` held it off. */
export async function enableWaveAdvance(h: Harness): Promise<void> {
  h.debug.setWaveAdvance(true);
}

/**
 * The real serve-and-launch route: the deflector posed at `paddleDeg`, a ball
 * parked on it, and the launch fired — the ball now flying straight outward at
 * the wave's speed. Returns the state right after the launch.
 */
export async function parkAndLaunch(
  h: Harness,
  paddleDeg: number,
): Promise<KesslerSnapshot> {
  h.debug.setPaddleAngle(paddleDeg);
  h.debug.parkBall();
  h.debug.launchBall();
  return h.snapshot();
}

/** One pierce pod at `(r, thetaDeg)`, falling inward from the call onward. */
export async function spawnPiercePod(
  h: Harness,
  r: number,
  thetaDeg: number,
): Promise<void> {
  const at = polarToXy(r, thetaDeg);
  h.debug.spawnPod("pierce", at.x, at.y);
}

/**
 * The mulberry32 generator specs/pods.md fixes as the session's one random
 * stream: seeded once, each call the stream's next value in [0, 1). Stated
 * here so a check can PREDICT the seeded pod draw rather than read it off the
 * build under test.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The kind the draw's second value selects, per specs/pods.md's table. */
function podKindFor(u2: number): PodKind {
  for (const row of POD_KIND_TABLE) {
    if (u2 >= row.from && u2 < row.to) return row.kind;
  }
  return "narrow";
}

/**
 * The kind the seeded stream's FIRST draw sheds — the prediction of
 * specs/pods.md's mulberry32 draw, computed here rather than read off the
 * build. Fails if the chosen seed's first draw sheds nothing, which would be a
 * mis-designed scenario rather than a build defect.
 */
export function firstShedKind(seed: number): PodKind {
  const next = mulberry32(seed);
  const u1 = next();
  if (u1 >= POD_DROP_CHANCE) {
    fail("a scenario seed whose first destruction sheds a pod (u1 < 0.25)", u1);
  }
  return podKindFor(next());
}

/** The one posed ball, or the failure that says the world is not as posed. */
export function soleBall(snapshot: KesslerSnapshot): Ball {
  const ball = snapshot.balls[0];
  if (snapshot.balls.length !== 1 || ball === undefined) {
    fail("exactly the one posed ball in play", snapshot.balls);
  }
  return ball;
}

/** The ball's radial speed at its own center: outward positive. */
export function radialSpeedOf(ball: Ball): number {
  const rad = xyToPolar(ball.x, ball.y).deg * DEG;
  return ball.vx * Math.cos(rad) + ball.vy * Math.sin(rad);
}
