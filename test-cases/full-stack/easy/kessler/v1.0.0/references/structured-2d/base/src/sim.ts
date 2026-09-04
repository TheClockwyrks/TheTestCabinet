// Kessler — one tick of the playing screen (specs/field.md).
//
// `tickPlaying` resolves the six steps in the order `specs/field.md` fixes:
// held input moves the deflector, the rings advance, the effect timers fall,
// the pods advance and resolve, the balls advance and resolve their contacts
// in spawn order, and the life-loss check runs. Every contact is a crossing
// event, decided from the position a body held before its advance this tick
// and the position the advance gave it, and every reflection changes velocity
// alone. A destruction runs its salvage pod draw at once, so draws land in
// resolution order (`specs/pods.md`), and a ball-caused destruction that
// leaves zero live targets is the clearing event (`specs/rings.md`).
//
// The module is the simulation's own polar crossing math over the live game
// state — no collider components and no engine collision events decide a
// contact. It reads nothing from the renderer or the clock; the cues and
// particle spawns a tick raises go out through the `TickIo` hooks, which the
// game mode binds to the world's cue bus and the effects layer.

import {
  BALL_CAP,
  BURNUP_RADIUS,
  CUES,
  DEFLECTOR_BALL_CONTACT_RADIUS,
  DEFLECTOR_POD_CATCH_RADIUS,
  DEFLECTOR_TURN_DEG_PER_SEC,
  FIELD_CONTACT_RADIUS,
  HIT_SCORE,
  MULTIBALL_LAUNCH_COUNT,
  MULTIBALL_OFFSET_DEG,
  PIERCE_DURATION_TICKS,
  POD_CATCH_SCORE,
  POD_DROP_CHANCE,
  POD_FALL_SPEED,
  RINGS,
  SHIELD_CONTACT_RADIUS,
  TICK_DT,
  WAVE_CLEAR_BONUS_PER_WAVE,
  WIDEN_DURATION_TICKS,
  NARROW_DURATION_TICKS,
  type CueName,
  type PodKind,
} from "./constants";
import { ballSpeedForWave, podKindForRoll } from "./figures";
import {
  angularOffsetDeg,
  dot,
  normalizeDeg,
  pointAt,
  polarOf,
  radialAt,
  rotateDeg,
  tangentialOf,
  withinArcDeg,
  type Polar,
  type Vec,
} from "./polar";
import {
  orbitalDecay,
  paddleBounce,
  reflectFace,
  surfaceReflect,
} from "./reflect";
import {
  arcCenterDeg,
  liveTargetAtRel,
  liveTargetCount,
  withinArcRel,
} from "./rings";
import {
  clearVolatiles,
  followPaddle,
  parkFreshBall,
  piercingNow,
  spanOf,
  type Ball,
  type Session,
} from "./session";

/** The three produced particle systems, by the name each spawns under. */
export type ParticleSystemName = "burst" | "spark" | "burnup";

/** What one tick reads and raises: input, the pod stream, and the hooks. */
export interface TickIo {
  /** The rotation actions' held values this tick. */
  held: { left: boolean; right: boolean };
  /** The session's seeded stream; pod draws alone consume it. */
  rng(): number;
  /** The `podSpawn` driver switch (specs/instrumentation.md). */
  podSpawn: boolean;
  /** The `waveAdvance` driver switch (specs/instrumentation.md). */
  waveAdvance: boolean;
  /** The simulation tick being resolved, stamped on anything spawned in it. */
  tickIndex: number;
  /** Play a cue now. */
  cue(cue: CueName): void;
  /** Spawn a particle system at a stage point now. */
  particle(system: ParticleSystemName, x: number, y: number): void;
}

/** How a tick ended the screen it ran on, if it did. */
export interface TickOutcome {
  /** The life loss that spent the last life ends the session. */
  gameOver: boolean;
  /** The wave the clearing event just cleared, or `null`. */
  clearedWave: number | null;
}

const RUNS_ON: TickOutcome = { gameOver: false, clearedWave: null };

/** Resolves one tick of the `playing` screen, in the fixed step order. */
export function tickPlaying(session: Session, io: TickIo): TickOutcome {
  stepPaddle(session, io);
  const prevRingAngles = stepRings(session);
  stepEffectTimers(session);
  stepPods(session, io);
  const ballOutcome = stepBalls(session, io, prevRingAngles);
  if (ballOutcome.clearedWave !== null) {
    return { gameOver: false, clearedWave: ballOutcome.clearedWave };
  }
  return checkLifeLoss(session, io, ballOutcome.burned);
}

/** Step 1: held input moves the deflector, and the parked ball follows. */
function stepPaddle(session: Session, io: TickIo): void {
  const direction = (io.held.right ? 1 : 0) - (io.held.left ? 1 : 0);
  if (direction !== 0) {
    session.paddleAngleDeg = normalizeDeg(
      session.paddleAngleDeg + direction * DEFLECTOR_TURN_DEG_PER_SEC * TICK_DT,
    );
    followPaddle(session);
  }
}

/** Step 2: each ring's angle advances by its orbit speed, wrapping mod 360. */
function stepRings(session: Session): number[] {
  const previous = session.rings.map((ring) => ring.angleDeg);
  for (const ring of session.rings) {
    ring.angleDeg = normalizeDeg(ring.angleDeg + ring.speedDegPerSec * TICK_DT);
  }
  return previous;
}

/** Step 3: every running effect timer falls by one tick. */
function stepEffectTimers(session: Session): void {
  const effects = session.effects;
  if (effects.widenTicks > 0) effects.widenTicks -= 1;
  if (effects.narrowTicks > 0) effects.narrowTicks -= 1;
  if (effects.pierceTicks > 0) effects.pierceTicks -= 1;
}

/** Step 4: pods advance inward; catches and burn-ups resolve in spawn order. */
function stepPods(session: Session, io: TickIo): void {
  const halfSpan = spanOf(session) / 2;
  const kept = [];
  for (const pod of session.pods) {
    const prevR = pod.r;
    pod.r -= POD_FALL_SPEED * TICK_DT;
    const caught =
      prevR > DEFLECTOR_POD_CATCH_RADIUS &&
      pod.r <= DEFLECTOR_POD_CATCH_RADIUS &&
      withinArcDeg(pod.angleDeg, session.paddleAngleDeg, halfSpan);
    if (caught) {
      session.score += POD_CATCH_SCORE;
      io.cue(pod.kind === "narrow" ? CUES.podCatchNarrow : CUES.podCatch);
      applyCatch(session, pod.kind, io);
      continue;
    }
    if (pod.r <= BURNUP_RADIUS) {
      const at = pointAt(pod.r, pod.angleDeg);
      io.particle("burnup", at.x, at.y);
      io.cue(CUES.podBurn);
      continue;
    }
    kept.push(pod);
  }
  session.pods = kept;
}

/** A caught pod's effect (specs/pods.md). The catch score is the caller's. */
export function applyCatch(session: Session, kind: PodKind, io: TickIo): void {
  const effects = session.effects;
  switch (kind) {
    case "widen":
      effects.widenTicks = WIDEN_DURATION_TICKS;
      effects.narrowTicks = 0;
      break;
    case "narrow":
      effects.narrowTicks = NARROW_DURATION_TICKS;
      effects.widenTicks = 0;
      break;
    case "pierce":
      effects.pierceTicks = PIERCE_DURATION_TICKS;
      break;
    case "shield":
      effects.shieldActive = true;
      break;
    case "multiball":
      launchMultiball(session, io.tickIndex);
      break;
  }
}

/**
 * The `multiball` launch: up to two balls from radius `194` at the
 * deflector's center angle, `20` degrees to each side of the outward radial,
 * the `+theta` ball first, as many as the six-ball cap admits. A parked ball
 * stays parked.
 */
function launchMultiball(session: Session, tickIndex: number): void {
  const speed = ballSpeedForWave(session.wave);
  const at = pointAt(DEFLECTOR_BALL_CONTACT_RADIUS, session.paddleAngleDeg);
  const outward = radialAt(session.paddleAngleDeg);
  for (let launch = 0; launch < MULTIBALL_LAUNCH_COUNT; launch += 1) {
    if (session.balls.length >= BALL_CAP) return;
    const split = launch === 0 ? MULTIBALL_OFFSET_DEG : -MULTIBALL_OFFSET_DEG;
    const heading = rotateDeg(outward, split);
    session.nextId += 1;
    session.balls.push({
      id: session.nextId,
      x: at.x,
      y: at.y,
      vx: heading.x * speed,
      vy: heading.y * speed,
      parked: false,
      spawnTick: tickIndex,
    });
  }
}

/**
 * Launches the parked ball radially outward at the current wave's ball
 * speed, as `Space` does. With no parked ball it changes nothing.
 */
export function launchParkedBall(session: Session): void {
  const parked = session.balls.find((ball) => ball.parked);
  if (!parked) return;
  const speed = ballSpeedForWave(session.wave);
  const outward = radialAt(session.paddleAngleDeg);
  parked.parked = false;
  parked.vx = outward.x * speed;
  parked.vy = outward.y * speed;
}

interface BallsOutcome {
  burned: boolean;
  clearedWave: number | null;
}

/** Step 5: balls advance and resolve their contacts, in spawn order. */
function stepBalls(
  session: Session,
  io: TickIo,
  prevRingAngles: readonly number[],
): BallsOutcome {
  const toResolve = [...session.balls];
  const dead = new Set<Ball>();
  let burned = false;
  for (const ball of toResolve) {
    if (ball.parked) continue;
    const prev = polarOf(ball.x, ball.y);
    ball.x += ball.vx * TICK_DT;
    ball.y += ball.vy * TICK_DT;
    const cur = polarOf(ball.x, ball.y);

    if (cur.r <= BURNUP_RADIUS) {
      dead.add(ball);
      burned = true;
      io.particle("burnup", ball.x, ball.y);
      io.cue(CUES.ballLost);
      continue;
    }

    if (resolveShield(session, io, ball, prev, cur)) continue;
    if (resolvePaddle(session, io, ball, prev, cur)) continue;

    const ringContact = resolveRings(
      session,
      io,
      ball,
      prev,
      cur,
      prevRingAngles,
    );
    if (ringContact === "cleared") {
      return { burned, clearedWave: session.wave };
    }
    if (ringContact === "none") {
      resolveContainment(io, ball, prev, cur);
    }
  }
  session.balls = session.balls.filter((ball) => !dead.has(ball));
  return { burned, clearedWave: null };
}

/**
 * The shield contact: while a shield is active, the first ball in spawn
 * order whose center radius crosses `100` inward reflects off it — the
 * specular radial reflection and the orbital decay, at the ball's incoming
 * speed — and the shield disappears on it (specs/pods.md).
 */
function resolveShield(
  session: Session,
  io: TickIo,
  ball: Ball,
  prev: Polar,
  cur: Polar,
): boolean {
  if (!session.effects.shieldActive) return false;
  if (!(prev.r > SHIELD_CONTACT_RADIUS && cur.r <= SHIELD_CONTACT_RADIUS)) {
    return false;
  }
  const n = radialAt(cur.angleDeg);
  const reflected = orbitalDecay(reflectFace({ x: ball.vx, y: ball.vy }, n), n);
  ball.vx = reflected.x;
  ball.vy = reflected.y;
  session.effects.shieldActive = false;
  io.cue(CUES.shieldReflect);
  io.particle("spark", ball.x, ball.y);
  return true;
}

/**
 * The deflector bounce: a crossing of radius `194` inward, with inward
 * radial velocity, within the span (specs/deflector-and-ball.md).
 */
function resolvePaddle(
  session: Session,
  io: TickIo,
  ball: Ball,
  prev: Polar,
  cur: Polar,
): boolean {
  if (!(
    prev.r > DEFLECTOR_BALL_CONTACT_RADIUS &&
    cur.r <= DEFLECTOR_BALL_CONTACT_RADIUS
  )) {
    return false;
  }
  const n = radialAt(cur.angleDeg);
  const velocity = { x: ball.vx, y: ball.vy };
  if (dot(velocity, n) >= 0) return false;
  if (
    !withinArcDeg(cur.angleDeg, session.paddleAngleDeg, spanOf(session) / 2)
  ) {
    return false;
  }
  const offset = angularOffsetDeg(cur.angleDeg, session.paddleAngleDeg);
  const out = paddleBounce(velocity, n, offset, ballSpeedForWave(session.wave));
  ball.vx = out.x;
  ball.vy = out.y;
  io.cue(CUES.paddleBounce);
  io.particle("spark", ball.x, ball.y);
  return true;
}

/**
 * The containment reflection: a crossing of radius `472` outward with
 * outward radial velocity, resolved as a face contact (specs/field.md).
 */
function resolveContainment(
  io: TickIo,
  ball: Ball,
  prev: Polar,
  cur: Polar,
): void {
  if (!(prev.r < FIELD_CONTACT_RADIUS && cur.r >= FIELD_CONTACT_RADIUS)) {
    return;
  }
  const n = radialAt(cur.angleDeg);
  const velocity = { x: ball.vx, y: ball.vy };
  if (dot(velocity, n) <= 0) return;
  const out = surfaceReflect(velocity, "face", n, null);
  ball.vx = out.x;
  ball.vy = out.y;
  io.cue(CUES.fieldBounce);
  io.particle("spark", ball.x, ball.y);
}

/** What a ball's pass over the rings resolved. */
type RingContact = "none" | "hit" | "cleared";

/**
 * The ball's target contacts against every ring, as this tick's ring advance
 * posed the arcs.
 */
function resolveRings(
  session: Session,
  io: TickIo,
  ball: Ball,
  prev: Polar,
  cur: Polar,
  prevRingAngles: readonly number[],
): RingContact {
  for (let index = 0; index < RINGS.length; index += 1) {
    const spec = RINGS[index];
    const ring = session.rings[index];
    const curRel = cur.angleDeg - ring.angleDeg;

    // A face crossing: the center radius crosses a contact radius toward the
    // ring — inward over the outer contact, or outward over the inner one.
    const crossedOuter =
      prev.r > spec.outerContactRadius && cur.r <= spec.outerContactRadius;
    const crossedInner =
      prev.r < spec.innerContactRadius && cur.r >= spec.innerContactRadius;
    if (crossedOuter || crossedInner) {
      const slot = liveTargetAtRel(spec, ring, curRel);
      if (slot !== null) {
        return resolveTargetHit(session, io, index, slot, "face", ball, cur);
      }
      continue;
    }

    // An edge crossing: within the band, the center angle crosses into a
    // live target's arc — from the ball's motion, the ring's rotation, or
    // both, so the comparison is relative to the ring.
    if (cur.r >= spec.innerContactRadius && cur.r <= spec.outerContactRadius) {
      const prevRel = prev.angleDeg - prevRingAngles[index];
      for (let slot = 0; slot < spec.slots; slot += 1) {
        if (ring.targets[slot] === null) continue;
        if (
          withinArcRel(spec, curRel, slot) &&
          !withinArcRel(spec, prevRel, slot)
        ) {
          return resolveTargetHit(session, io, index, slot, "edge", ball, cur);
        }
      }
    }
  }
  return "none";
}

/**
 * One hit on a live target: the damage, the score, the cue, the reflection
 * or the pierce-through, the destruction with its pod draw, and the clearing
 * event where the destruction leaves zero live targets.
 */
function resolveTargetHit(
  session: Session,
  io: TickIo,
  ringIndex: number,
  slot: number,
  contact: "face" | "edge",
  ball: Ball,
  cur: Polar,
): RingContact {
  const spec = RINGS[ringIndex];
  const ring = session.rings[ringIndex];
  const piercing = piercingNow(session);

  let destroyed: boolean;
  if (piercing) {
    // A piercing ball's contact destroys outright and leaves the ball's
    // velocity unchanged: no reflection, no ring kick, no orbital decay.
    destroyed = true;
  } else {
    const remaining = (ring.targets[slot] ?? 0) - 1;
    destroyed = remaining <= 0;
    if (!destroyed) {
      ring.targets[slot] = remaining;
      session.score += HIT_SCORE;
      io.cue(CUES.targetHit);
    }
    reflectOffTarget(ring.speedDegPerSec, contact, ball, cur);
  }

  if (!destroyed) return "hit";

  ring.targets[slot] = null;
  const burstAt = pointAt(
    spec.midRadius,
    arcCenterDeg(spec, slot, ring.angleDeg),
  );
  io.particle("burst", burstAt.x, burstAt.y);
  io.cue(CUES.targetBreak);
  session.score += spec.destroyScore;
  if (io.podSpawn) {
    drawPod(session, io, ringIndex, slot);
  }

  if (io.waveAdvance && liveTargetCount(session.rings) === 0) {
    session.score += WAVE_CLEAR_BONUS_PER_WAVE * session.wave;
    io.cue(CUES.waveClear);
    session.balls = [];
    clearVolatiles(session);
    return "cleared";
  }
  return "hit";
}

/** The reflection a non-piercing hit gives the ball, kick included. */
function reflectOffTarget(
  ringSpeedDegPerSec: number,
  contact: "face" | "edge",
  ball: Ball,
  cur: Polar,
): void {
  const n = radialAt(cur.angleDeg);
  let surfaceVelocity: Vec | null = null;
  if (ringSpeedDegPerSec !== 0) {
    const omega = (ringSpeedDegPerSec * Math.PI) / 180;
    const t = tangentialOf(n);
    surfaceVelocity = { x: omega * cur.r * t.x, y: omega * cur.r * t.y };
  }
  const out = surfaceReflect(
    { x: ball.vx, y: ball.vy },
    contact,
    n,
    surfaceVelocity,
  );
  ball.vx = out.x;
  ball.vy = out.y;
}

/**
 * The salvage pod draw a destruction runs (specs/pods.md): `u1` decides
 * whether a pod sheds, and only a shedding draw takes `u2` for the kind. The
 * pod spawns at the ring's mid radius, at the destroyed target's arc-center
 * angle as the ring stands posed this tick.
 */
function drawPod(
  session: Session,
  io: TickIo,
  ringIndex: number,
  slot: number,
): void {
  const u1 = io.rng();
  if (u1 >= POD_DROP_CHANCE) return;
  const u2 = io.rng();
  const spec = RINGS[ringIndex];
  const ring = session.rings[ringIndex];
  session.nextId += 1;
  session.pods.push({
    id: session.nextId,
    kind: podKindForRoll(u2),
    r: spec.midRadius,
    angleDeg: normalizeDeg(arcCenterDeg(spec, slot, ring.angleDeg)),
  });
}

/**
 * Step 6: if this tick's burn-ups removed the last live ball, one life is
 * lost — the effects, the shield, and the pods clear, and a fresh ball parks
 * while lives remain (specs/field.md).
 */
function checkLifeLoss(
  session: Session,
  io: TickIo,
  burned: boolean,
): TickOutcome {
  if (!burned || session.balls.length > 0) return RUNS_ON;
  session.lives -= 1;
  clearVolatiles(session);
  if (session.lives > 0) {
    parkFreshBall(session, io.tickIndex);
    return RUNS_ON;
  }
  return { gameOver: true, clearedWave: null };
}
