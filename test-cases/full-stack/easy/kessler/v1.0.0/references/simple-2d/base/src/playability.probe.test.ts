// Kessler — the playability probe (uncommitted design gate; not a spec test).
//
// A tracking player plays the real simulation headlessly: each tick it rotates
// the deflector toward the ball's projected paddle-crossing angle at the held
// rate the spec fixes, and serves the parked ball as soon as one parks. Waves
// 1 to 3 each run standalone with three lives for up to 120 seconds of game
// time, over several pod-stream seeds (with a seed-varied pre-serve rotation
// so the opening trajectories differ). The probe measures, per wave: the mean
// rally length (deflector bounces per life), lives lost per simulated minute,
// the fraction of paddle-crossing returns that were geometrically unreachable
// (the angular gap beyond the span edge exceeded what the turn rate could
// traverse in the flight time), and the time to clear or targets destroyed.
//
// Run just this file: npx vitest run src/playability.probe.test.ts

import { describe, expect, it } from "vitest";
import {
  PADDLE_CONTACT_RADIUS,
  PADDLE_TURN_RATE,
  RINGS,
  START_LIVES,
  TICK_DT,
  TICK_HZ,
} from "./figures";
import { angularOffsetDeg, polarOf, radialAt, dot } from "./polar";
import { mulberry32 } from "./rng";
import { launchParkedBall, tickPlaying, type TickIo } from "./sim";
import {
  bootSession,
  layOutWave,
  parkFreshBall,
  spanOf,
  type Ball,
  type Session,
} from "./state";
import { liveTargetCount } from "./rings";

/** The per-wave cap on one probe run, in ticks (120 seconds). */
const RUN_CAP_TICKS = 120 * TICK_HZ;
/** The deadband that stops the tracker oscillating, half a tick's turn. */
const TRACK_DEADBAND_DEG = (PADDLE_TURN_RATE * TICK_DT) / 2;
/** The pod-stream seeds each wave runs under. */
const SEEDS = [1, 2, 3, 4, 5];

/** One inward ball's projected crossing of the deflector contact radius. */
interface Crossing {
  /** Seconds of straight flight until the center crosses radius 194. */
  t: number;
  /** The stage angle of the crossing point, in degrees. */
  angleDeg: number;
}

/**
 * Where and when a straight flight from `(x, y)` at `(vx, vy)` next crosses
 * radius 194 moving inward, or `null` when the path misses it.
 */
function paddleCrossing(
  x: number,
  y: number,
  vx: number,
  vy: number,
): Crossing | null {
  const px = x - 500;
  const py = y - 500;
  const a = vx * vx + vy * vy;
  if (a === 0) return null;
  const b = 2 * (px * vx + py * vy);
  const c = px * px + py * py - PADDLE_CONTACT_RADIUS * PADDLE_CONTACT_RADIUS;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  if (t <= 0) return null;
  const cx = px + vx * t;
  const cy = py + vy * t;
  return { t, angleDeg: polarOf(cx + 500, cy + 500).angleDeg };
}

/** One return event: a ball committed to an inward leg over the deflector. */
interface ReturnEvent {
  /** The traverse the span edge needed beyond where the deflector stood. */
  neededDeg: number;
  /** The flight seconds the deflector had to make that traverse. */
  flightSec: number;
  reachable: boolean;
}

/** What one wave's probe run measured. */
interface RunResult {
  seed: number;
  ticks: number;
  paddleBounces: number;
  livesLost: number;
  /** Deflector bounces in each life segment, the final partial included. */
  rallies: number[];
  returns: ReturnEvent[];
  cleared: boolean;
  clearSec: number | null;
  targetsDestroyed: number;
  /** Seconds survived before the run ended (cap, clear, or game over). */
  survivedSec: number;
  gameOver: boolean;
}

/** Total target destructions a fresh wave offers (hit points aside). */
function initialTargetCount(): number {
  return RINGS.reduce((sum, spec) => sum + spec.slots, 0);
}

/**
 * Runs one wave standalone: fresh rings for `wave`, three lives, a parked
 * ball served after `preServeTicks` of rightward rotation, the tracking
 * player at the stick, up to the 120-second cap.
 */
function runWave(wave: number, seed: number, preServeTicks: number): RunResult {
  const session: Session = bootSession();
  layOutWave(session, wave);
  session.lives = START_LIVES;
  parkFreshBall(session, 0);

  const rng = mulberry32(seed);
  const held = { left: false, right: false };
  const io: TickIo = {
    held,
    rng,
    podSpawn: true,
    waveAdvance: true,
    tickIndex: 0,
    cue: (cue) => {
      if (cue === "paddle-bounce") {
        result.paddleBounces += 1;
        rallyBounces += 1;
      }
    },
    particle: () => undefined,
  };

  const result: RunResult = {
    seed,
    ticks: 0,
    paddleBounces: 0,
    livesLost: 0,
    rallies: [],
    returns: [],
    cleared: false,
    clearSec: null,
    targetsDestroyed: 0,
    survivedSec: 0,
    gameOver: false,
  };
  let rallyBounces = 0;
  /** Balls whose center has been above ring 1's inner contact radius. */
  const aboveRings = new WeakSet<Ball>();
  const ring1Inner = RINGS[0].innerContactRadius;

  for (let tick = 0; tick < RUN_CAP_TICKS; tick += 1) {
    io.tickIndex = tick;

    // Serve: launch whatever ball sits parked, once pre-serve spin is done.
    if (tick >= preServeTicks && session.balls.some((b) => b.parked)) {
      launchParkedBall(session);
    }

    // Track: steer toward the soonest projected paddle crossing, or toward
    // the innermost ball while every ball is outbound.
    let target: number | null = null;
    let soonest = Infinity;
    let nearestR = Infinity;
    let nearestAngle: number | null = null;
    for (const ball of session.balls) {
      if (ball.parked) continue;
      const cur = polarOf(ball.x, ball.y);
      if (cur.r < nearestR) {
        nearestR = cur.r;
        nearestAngle = cur.angleDeg;
      }
      if (cur.r <= PADDLE_CONTACT_RADIUS) continue;
      const inward = dot({ x: ball.vx, y: ball.vy }, radialAt(cur.angleDeg));
      if (inward >= 0) continue;
      const crossing = paddleCrossing(ball.x, ball.y, ball.vx, ball.vy);
      if (crossing && crossing.t < soonest) {
        soonest = crossing.t;
        target = crossing.angleDeg;
      }
    }
    if (target === null) target = nearestAngle;
    if (target !== null) {
      const offset = angularOffsetDeg(target, session.paddleAngleDeg);
      held.right = offset > TRACK_DEADBAND_DEG;
      held.left = offset < -TRACK_DEADBAND_DEG;
    } else {
      held.right = false;
      held.left = false;
    }

    // Remember which balls sit above the rings before the advance.
    for (const ball of session.balls) {
      if (!ball.parked && polarOf(ball.x, ball.y).r > ring1Inner) {
        aboveRings.add(ball);
      }
    }

    const livesBefore = session.lives;
    const outcome = tickPlaying(session, io);
    result.ticks = tick + 1;

    // A ball that just dropped below the rings, inbound, is a return: from
    // here to radius 194 is free flight, so the catch is now geometry.
    for (const ball of session.balls) {
      if (ball.parked || !aboveRings.has(ball)) continue;
      const cur = polarOf(ball.x, ball.y);
      if (cur.r > ring1Inner) continue;
      aboveRings.delete(ball);
      const inward = dot({ x: ball.vx, y: ball.vy }, radialAt(cur.angleDeg));
      if (inward >= 0) continue;
      const crossing = paddleCrossing(ball.x, ball.y, ball.vx, ball.vy);
      if (!crossing) continue;
      const gap = Math.abs(
        angularOffsetDeg(crossing.angleDeg, session.paddleAngleDeg),
      );
      const neededDeg = Math.max(0, gap - spanOf(session) / 2);
      const reachable = neededDeg <= PADDLE_TURN_RATE * crossing.t + 1e-9;
      result.returns.push({
        neededDeg,
        flightSec: crossing.t,
        reachable,
      });
    }

    if (session.lives < livesBefore) {
      result.livesLost += livesBefore - session.lives;
      result.rallies.push(rallyBounces);
      rallyBounces = 0;
    }
    if (outcome.clearedWave !== null) {
      result.cleared = true;
      result.clearSec = result.ticks / TICK_HZ;
      break;
    }
    if (outcome.gameOver) {
      result.gameOver = true;
      break;
    }
  }

  result.rallies.push(rallyBounces);
  result.survivedSec = result.ticks / TICK_HZ;
  result.targetsDestroyed = result.cleared
    ? initialTargetCount()
    : initialTargetCount() - liveTargetCount(session.rings);
  return result;
}

/** The aggregate one wave's runs report. */
interface WaveReport {
  wave: number;
  runs: RunResult[];
  meanRally: number;
  livesLostPerMinute: number;
  unreachableFraction: number;
  returnsMeasured: number;
}

function probeWave(wave: number): WaveReport {
  const runs = SEEDS.map((seed, index) => runWave(wave, seed, index * 4));
  const totalBounces = runs.reduce((sum, run) => sum + run.paddleBounces, 0);
  const lifeSegments = runs.reduce((sum, run) => sum + run.rallies.length, 0);
  const totalLivesLost = runs.reduce((sum, run) => sum + run.livesLost, 0);
  const totalMinutes =
    runs.reduce((sum, run) => sum + run.ticks, 0) / (TICK_HZ * 60);
  const returns = runs.flatMap((run) => run.returns);
  const unreachable = returns.filter((event) => !event.reachable).length;
  return {
    wave,
    runs,
    meanRally: totalBounces / Math.max(1, lifeSegments),
    livesLostPerMinute: totalLivesLost / Math.max(1e-9, totalMinutes),
    unreachableFraction:
      returns.length === 0 ? 0 : unreachable / returns.length,
    returnsMeasured: returns.length,
  };
}

function printReport(report: WaveReport): void {
  const lines = [
    `wave ${report.wave}:`,
    `  mean rally (paddle bounces per life segment): ${report.meanRally.toFixed(2)}`,
    `  lives lost per simulated minute: ${report.livesLostPerMinute.toFixed(3)}`,
    `  unreachable returns: ${(report.unreachableFraction * 100).toFixed(1)}% of ${report.returnsMeasured}`,
  ];
  for (const run of report.runs) {
    const end = run.cleared
      ? `cleared in ${run.clearSec?.toFixed(1)}s`
      : run.gameOver
        ? `game over at ${run.survivedSec.toFixed(1)}s`
        : `capped at ${run.survivedSec.toFixed(1)}s`;
    lines.push(
      `  seed ${run.seed}: ${end}, ${run.targetsDestroyed}/48 targets, ` +
        `${run.livesLost} lives lost, ${run.paddleBounces} paddle bounces, ` +
        `rallies [${run.rallies.join(", ")}]`,
    );
  }
  console.log(lines.join("\n"));
}

describe("playability probe (design gate, tracking player)", () => {
  const reports = [1, 2, 3].map(probeWave);
  for (const report of reports) printReport(report);

  it("a tracking player survives 60s of wave 1 on 3 lives, every seed", () => {
    for (const run of reports[0].runs) {
      expect(
        run.gameOver && run.survivedSec < 60,
        `seed ${run.seed} exhausted 3 lives at ${run.survivedSec.toFixed(1)}s`,
      ).toBe(false);
    }
  });

  it("well under half of wave-1 returns are geometrically unreachable", () => {
    expect(reports[0].unreachableFraction).toBeLessThan(0.35);
  });
});
