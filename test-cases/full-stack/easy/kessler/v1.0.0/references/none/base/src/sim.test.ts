// The tick pipeline of specs/field.md over the session: crossing-event
// contacts in both directions, the deflector bounce, the reflections, the
// pods and their effects, the seeded draw order, lives, and the clearing
// event.

import { describe, expect, it } from "vitest";
import { type Cue, type ParticleSystem } from "./constants";
import {
  dot,
  pointAt,
  polarOf,
  radialAt,
  signedAngleDeg,
  tangentialOf,
} from "./polar";
import { mulberry32 } from "./rng";
import { launchParkedBall, tickPlaying, type TickIo } from "./sim";
import { bootSession, parkFreshBall, spanOf, type Session } from "./state";

interface Recorded extends TickIo {
  cues: Cue[];
  particles: { system: ParticleSystem; x: number; y: number }[];
}

/** A recording io; pod draws are off unless a test turns them on. */
function makeIo(overrides: Partial<TickIo> = {}): Recorded {
  const cues: Cue[] = [];
  const particles: { system: ParticleSystem; x: number; y: number }[] = [];
  return {
    held: { left: false, right: false },
    rng: mulberry32(1),
    podSpawn: false,
    waveAdvance: true,
    tickIndex: 0,
    cue: (cue) => cues.push(cue),
    particle: (system, x, y) => particles.push({ system, x, y }),
    cues,
    particles,
    ...overrides,
  };
}

/** Adds an unparked ball at polar (r, angle) with radial/tangential speed. */
function addBall(
  session: Session,
  r: number,
  angleDeg: number,
  radialSpeed: number,
  tangentialSpeed = 0,
) {
  const at = pointAt(r, angleDeg);
  const n = radialAt(angleDeg);
  const t = tangentialOf(n);
  const ball = {
    x: at.x,
    y: at.y,
    vx: radialSpeed * n.x + tangentialSpeed * t.x,
    vy: radialSpeed * n.y + tangentialSpeed * t.y,
    parked: false,
    spawnTick: 0,
  };
  session.balls.push(ball);
  return ball;
}

/** Stops every ring so a test controls the poses it needs. */
function stillRings(session: Session): void {
  for (const ring of session.rings) ring.speedDegPerSec = 0;
}

/** Empties every slot of every ring. */
function emptyRings(session: Session): void {
  for (const ring of session.rings) {
    ring.targets = ring.targets.map(() => null);
  }
}

function ticks(session: Session, io: TickIo, count: number) {
  let last = { gameOver: false, clearedWave: null as number | null };
  for (let i = 0; i < count; i += 1) {
    last = tickPlaying(session, io);
  }
  return last;
}

describe("the deflector", () => {
  it("turns 270 degrees per second while a rotation action is held", () => {
    const session = bootSession();
    const io = makeIo({ held: { left: false, right: true } });
    tickPlaying(session, io);
    expect(session.paddleAngleDeg).toBeCloseTo(94.5, 9);
    io.held.right = false;
    io.held.left = true;
    ticks(session, io, 2);
    expect(session.paddleAngleDeg).toBeCloseTo(85.5, 9);
  });

  it("wraps modulo 360 in either direction", () => {
    const session = bootSession();
    session.paddleAngleDeg = 358;
    const io = makeIo({ held: { left: false, right: true } });
    tickPlaying(session, io);
    expect(session.paddleAngleDeg).toBeCloseTo(2.5, 9);
  });

  it("holds still while both rotation actions are held", () => {
    const session = bootSession();
    const io = makeIo({ held: { left: true, right: true } });
    tickPlaying(session, io);
    expect(session.paddleAngleDeg).toBe(90);
  });

  it("carries the parked ball with it", () => {
    const session = bootSession();
    parkFreshBall(session, 0);
    const io = makeIo({ held: { left: false, right: true } });
    tickPlaying(session, io);
    const at = polarOf(session.balls[0].x, session.balls[0].y);
    expect(at.r).toBeCloseTo(194, 9);
    expect(at.angleDeg).toBeCloseTo(94.5, 9);
  });
});

describe("serving", () => {
  it("launches the parked ball radially outward at the wave speed", () => {
    const session = bootSession();
    parkFreshBall(session, 0);
    launchParkedBall(session);
    const ball = session.balls[0];
    expect(ball.parked).toBe(false);
    expect(ball.vx).toBeCloseTo(0, 6);
    expect(ball.vy).toBeCloseTo(240, 6);
  });

  it("serves at the current wave's ball speed", () => {
    const session = bootSession();
    session.wave = 9;
    parkFreshBall(session, 0);
    launchParkedBall(session);
    expect(Math.hypot(session.balls[0].vx, session.balls[0].vy)).toBeCloseTo(
      480,
      6,
    );
  });

  it("changes nothing without a parked ball", () => {
    const session = bootSession();
    addBall(session, 250, 90, 100);
    const before = { ...session.balls[0] };
    launchParkedBall(session);
    expect(session.balls[0]).toEqual(before);
  });
});

describe("the deflector bounce", () => {
  it("bounces a ball crossing 194 inward within the span", () => {
    const session = bootSession();
    const io = makeIo();
    addBall(session, 200, 90, -240);
    ticks(session, io, 2);
    const ball = session.balls[0];
    expect(io.cues).toEqual(["paddle-bounce"]);
    expect(io.particles.map((p) => p.system)).toEqual(["spark"]);
    // Head-on at the center: straight back out at the wave speed.
    expect(ball.vx).toBeCloseTo(0, 6);
    expect(ball.vy).toBeCloseTo(240, 6);
    // Reflect in place: the crossing tick's position is kept.
    expect(polarOf(ball.x, ball.y).r).toBeCloseTo(192, 9);
  });

  it("applies english from the offset within the span", () => {
    const session = bootSession();
    const io = makeIo();
    addBall(session, 200, 100, -240);
    ticks(session, io, 2);
    const ball = session.balls[0];
    const n = radialAt(polarOf(ball.x, ball.y).angleDeg);
    expect(signedAngleDeg(n, { x: ball.vx, y: ball.vy })).toBeCloseTo(12, 6);
  });

  it("lets a ball outside the span pass and burn", () => {
    const session = bootSession();
    const io = makeIo();
    // 30 degrees off the deflector's center: outside the 24-degree half span.
    addBall(session, 200, 120, -240);
    ticks(session, io, 40);
    expect(io.cues).not.toContain("paddle-bounce");
    expect(io.cues).toContain("ball-lost");
  });

  it("never saves a ball already inside the contact radius", () => {
    const session = bootSession();
    const io = makeIo();
    addBall(session, 190, 90, -240);
    ticks(session, io, 40);
    expect(io.cues).not.toContain("paddle-bounce");
    expect(io.cues).toContain("ball-lost");
  });
});

describe("the containment field", () => {
  it("reflects a ball crossing 472 outward", () => {
    const session = bootSession();
    emptyRings(session);
    const io = makeIo();
    const ball = addBall(session, 466, 0, 240);
    ticks(session, io, 2);
    expect(io.cues).toEqual(["field-bounce"]);
    expect(io.particles.map((p) => p.system)).toEqual(["spark"]);
    const n = radialAt(polarOf(ball.x, ball.y).angleDeg);
    expect(dot({ x: ball.vx, y: ball.vy }, n)).toBeLessThan(0);
    expect(Math.hypot(ball.vx, ball.vy)).toBeCloseTo(240, 6);
  });
});

describe("burn-ups and the life-loss check", () => {
  it("burns a ball reaching radius 78 and loses the last-ball life", () => {
    const session = bootSession();
    session.effects.widenTicks = 50;
    session.effects.shieldActive = true;
    session.pods.push({ kind: "widen", r: 300, angleDeg: 0, spawnTick: 0 });
    const io = makeIo();
    addBall(session, 90, 90, -240);
    const outcome = ticks(session, io, 3);
    expect(io.cues).toContain("ball-lost");
    expect(io.particles.map((p) => p.system)).toContain("burnup");
    expect(outcome.gameOver).toBe(false);
    expect(session.lives).toBe(2);
    // The loss clears every effect, the shield, and every pod...
    expect(session.effects.widenTicks).toBe(0);
    expect(session.effects.shieldActive).toBe(false);
    expect(session.pods).toEqual([]);
    // ...and a fresh ball parks while lives remain.
    expect(session.balls).toHaveLength(1);
    expect(session.balls[0].parked).toBe(true);
  });

  it("loses no life while another ball is live", () => {
    const session = bootSession();
    const io = makeIo();
    addBall(session, 90, 90, -240);
    addBall(session, 250, 0, 0);
    ticks(session, io, 3);
    expect(session.lives).toBe(3);
    expect(session.balls).toHaveLength(1);
  });

  it("ends the session when the last life is spent", () => {
    const session = bootSession();
    session.lives = 1;
    const io = makeIo();
    addBall(session, 90, 90, -240);
    const outcome = ticks(session, io, 3);
    expect(outcome.gameOver).toBe(true);
    expect(session.lives).toBe(0);
    expect(session.balls).toEqual([]);
  });
});

describe("target contacts", () => {
  it("face hit crossing the outer contact inward destroys a ring 1 target", () => {
    const session = bootSession();
    const io = makeIo();
    const ball = addBall(session, 332, 15, -240);
    ticks(session, io, 3);
    expect(io.cues).toEqual(["target-break"]);
    expect(session.score).toBe(100);
    expect(session.rings[0].targets[0]).toBeNull();
    // The burst spawns at the destroyed target's arc center.
    const burst = io.particles.find((p) => p.system === "burst");
    const expected = pointAt(302, 15);
    expect(burst?.x).toBeCloseTo(expected.x, 6);
    expect(burst?.y).toBeCloseTo(expected.y, 6);
    // Face reflection off a stationary ring: straight back out.
    const n = radialAt(polarOf(ball.x, ball.y).angleDeg);
    expect(dot({ x: ball.vx, y: ball.vy }, n)).toBeGreaterThan(0);
    expect(Math.hypot(ball.vx, ball.vy)).toBeCloseTo(240, 6);
  });

  it("face hit crossing the inner contact outward lands too", () => {
    const session = bootSession();
    const io = makeIo();
    addBall(session, 275, 15, 240);
    ticks(session, io, 2);
    expect(io.cues).toEqual(["target-break"]);
    expect(session.rings[0].targets[0]).toBeNull();
  });

  it("a hit that leaves the target alive scores 50 and keeps the ball's speed", () => {
    const session = bootSession();
    stillRings(session);
    const io = makeIo();
    addBall(session, 396, 11.25, -300);
    tickPlaying(session, io);
    expect(io.cues).toEqual(["target-hit"]);
    expect(session.score).toBe(50);
    expect(session.rings[1].targets[0]).toBe(1);
  });

  it("passes a ball through a structural gap untouched", () => {
    const session = bootSession();
    stillRings(session);
    const io = makeIo();
    // Relative angle 0.5 sits in the gap of every ring 1 slot.
    addBall(session, 330, 0.5, -240);
    ticks(session, io, 15);
    expect(io.cues).toEqual([]);
    expect(session.score).toBe(0);
  });

  it("edge hit from the ring's own rotation sweeping an arc onto the ball", () => {
    const session = bootSession();
    stillRings(session);
    session.rings[0].speedDegPerSec = 60;
    const io = makeIo();
    // At rest inside the band, in a gap; the ring rotates the slot-11 arc
    // boundary onto it after one tick.
    addBall(session, 302, 359, 0);
    tickPlaying(session, io);
    expect(io.cues).toEqual(["target-break"]);
    expect(session.rings[0].targets[11]).toBeNull();
    expect(session.score).toBe(100);
  });

  it("edge hit from the ball's own motion reverses its tangential component", () => {
    const session = bootSession();
    stillRings(session);
    const io = makeIo();
    const ball = addBall(session, 302, 30.5, 0, 120);
    ticks(session, io, 5);
    expect(io.cues).toEqual(["target-break"]);
    expect(session.rings[0].targets[1]).toBeNull();
    const t = tangentialOf(radialAt(polarOf(ball.x, ball.y).angleDeg));
    expect(dot({ x: ball.vx, y: ball.vy }, t)).toBeLessThan(0);
  });

  it("a face and an edge crossing on the same target resolve as the face hit", () => {
    const session = bootSession();
    stillRings(session);
    const io = makeIo();
    // Crosses ring 2's outer contact inward while its angle crosses into
    // slot 0's arc, in the same tick.
    const ball = addBall(session, 396, 1, -300, 480);
    tickPlaying(session, io);
    const at = polarOf(ball.x, ball.y);
    // The setup really did produce both crossings.
    expect(at.r).toBeLessThanOrEqual(392);
    expect(at.angleDeg).toBeGreaterThanOrEqual(2);
    expect(io.cues).toEqual(["target-hit"]);
    expect(session.score).toBe(50);
    // A face reflection: the radial component flips, the tangential holds.
    const n = radialAt(at.angleDeg);
    expect(dot({ x: ball.vx, y: ball.vy }, n)).toBeGreaterThan(0);
    expect(dot({ x: ball.vx, y: ball.vy }, tangentialOf(n))).toBeGreaterThan(0);
  });

  it("repeats no contact without a fresh crossing", () => {
    const session = bootSession();
    stillRings(session);
    const io = makeIo();
    addBall(session, 302, 15, 0);
    ticks(session, io, 5);
    expect(io.cues).toEqual([]);
    expect(session.score).toBe(0);
  });
});

describe("pierce", () => {
  it("destroys outright, awards the destroy score alone, and leaves velocity unchanged", () => {
    const session = bootSession();
    stillRings(session);
    session.effects.pierceTicks = 100;
    const io = makeIo();
    const ball = addBall(session, 396, 11.25, -300);
    const before = { vx: ball.vx, vy: ball.vy };
    tickPlaying(session, io);
    expect(io.cues).toEqual(["target-break"]);
    expect(session.score).toBe(200);
    expect(session.rings[1].targets[0]).toBeNull();
    expect(ball.vx).toBe(before.vx);
    expect(ball.vy).toBe(before.vy);
    // The timer fell by this tick's step 3.
    expect(session.effects.pierceTicks).toBe(99);
  });
});

describe("salvage pods", () => {
  it("falls radially inward at 120 units per second, angle constant", () => {
    const session = bootSession();
    session.pods.push({ kind: "widen", r: 300, angleDeg: 33, spawnTick: 0 });
    const io = makeIo();
    ticks(session, io, 10);
    expect(session.pods[0].r).toBeCloseTo(280, 9);
    expect(session.pods[0].angleDeg).toBe(33);
  });

  it("is caught crossing 196 within the span, scoring 25 and applying its effect", () => {
    const session = bootSession();
    session.pods.push({ kind: "widen", r: 200, angleDeg: 90, spawnTick: 0 });
    const io = makeIo();
    ticks(session, io, 2);
    expect(session.pods).toEqual([]);
    expect(session.score).toBe(25);
    expect(io.cues).toEqual(["pod-catch"]);
    expect(session.effects.widenTicks).toBe(600);
    expect(spanOf(session)).toBe(72);
  });

  it("plays pod-catch-narrow for a narrow pod", () => {
    const session = bootSession();
    session.pods.push({ kind: "narrow", r: 200, angleDeg: 90, spawnTick: 0 });
    const io = makeIo();
    ticks(session, io, 2);
    expect(io.cues).toEqual(["pod-catch-narrow"]);
    expect(spanOf(session)).toBe(30);
  });

  it("includes the span boundary in the catch", () => {
    const session = bootSession();
    session.pods.push({ kind: "widen", r: 200, angleDeg: 114, spawnTick: 0 });
    const io = makeIo();
    ticks(session, io, 2);
    expect(session.pods).toEqual([]);
    expect(session.score).toBe(25);
  });

  it("misses outside the span and burns up at 78 with no effect", () => {
    const session = bootSession();
    session.pods.push({ kind: "widen", r: 200, angleDeg: 120, spawnTick: 0 });
    const io = makeIo();
    ticks(session, io, 61);
    expect(session.pods).toEqual([]);
    expect(session.score).toBe(0);
    expect(io.cues).toEqual(["pod-burn"]);
    expect(io.particles.map((p) => p.system)).toEqual(["burnup"]);
    expect(session.effects.widenTicks).toBe(0);
  });

  it("widen and narrow replace each other", () => {
    const session = bootSession();
    session.effects.widenTicks = 600;
    session.pods.push({ kind: "narrow", r: 200, angleDeg: 90, spawnTick: 0 });
    const io = makeIo();
    ticks(session, io, 2);
    expect(session.effects.narrowTicks).toBe(600);
    expect(session.effects.widenTicks).toBe(0);
    expect(spanOf(session)).toBe(30);
  });

  it("expires a span effect in step 3, before this tick's catch test", () => {
    const session = bootSession();
    // 30 degrees off center: inside the widened half span of 36, outside
    // the baseline 24. The widen timer lapses on the catch-crossing tick,
    // so the catch tests the baseline span and misses.
    session.effects.widenTicks = 2;
    session.pods.push({ kind: "pierce", r: 200, angleDeg: 120, spawnTick: 0 });
    const io = makeIo();
    ticks(session, io, 2);
    expect(session.effects.widenTicks).toBe(0);
    expect(session.pods).toHaveLength(1);
    expect(session.score).toBe(0);
  });

  it("a shield catch while a shield is active scores and changes nothing else", () => {
    const session = bootSession();
    session.effects.shieldActive = true;
    session.pods.push({ kind: "shield", r: 200, angleDeg: 90, spawnTick: 0 });
    const io = makeIo();
    ticks(session, io, 2);
    expect(session.score).toBe(25);
    expect(session.effects.shieldActive).toBe(true);
  });
});

describe("multiball", () => {
  it("launches two balls 20 degrees to each side, the +theta ball first", () => {
    const session = bootSession();
    parkFreshBall(session, 0);
    session.pods.push({
      kind: "multiball",
      r: 200,
      angleDeg: 90,
      spawnTick: 0,
    });
    const io = makeIo();
    ticks(session, io, 2);
    expect(session.balls).toHaveLength(3);
    expect(session.balls[0].parked).toBe(true);
    const outward = radialAt(session.paddleAngleDeg);
    const first = session.balls[1];
    const second = session.balls[2];
    expect(signedAngleDeg(outward, { x: first.vx, y: first.vy })).toBeCloseTo(
      20,
      6,
    );
    expect(signedAngleDeg(outward, { x: second.vx, y: second.vy })).toBeCloseTo(
      -20,
      6,
    );
    expect(Math.hypot(first.vx, first.vy)).toBeCloseTo(240, 6);
  });

  it("launches only what the six-ball cap admits, and still scores at the cap", () => {
    const session = bootSession();
    for (let i = 0; i < 5; i += 1) addBall(session, 250 + 10 * i, 200, 0);
    session.pods.push({
      kind: "multiball",
      r: 200,
      angleDeg: 90,
      spawnTick: 0,
    });
    const io = makeIo();
    ticks(session, io, 2);
    expect(session.balls).toHaveLength(6);
    expect(session.score).toBe(25);

    session.pods.push({
      kind: "multiball",
      r: 200,
      angleDeg: 90,
      spawnTick: 0,
    });
    ticks(session, io, 2);
    expect(session.balls).toHaveLength(6);
    expect(session.score).toBe(50);
  });
});

describe("the shield", () => {
  it("reflects the first ball in spawn order crossing 100 inward, then disappears", () => {
    const session = bootSession();
    session.effects.shieldActive = true;
    const io = makeIo();
    const first = addBall(session, 110, 90, -240);
    const second = addBall(session, 110, 90, -240);
    ticks(session, io, 3);
    expect(io.cues).toEqual(["shield-reflect"]);
    expect(io.particles.map((p) => p.system)).toEqual(["spark"]);
    expect(session.effects.shieldActive).toBe(false);
    // The first ball heads back out at its incoming speed...
    expect(first.vy).toBeCloseTo(240, 6);
    // ...and the second passed the consumed shield untouched.
    expect(second.vy).toBeCloseTo(-240, 6);
  });
});

describe("the seeded pod draw", () => {
  it("draws once per destruction, in resolution order, on the pinned stream", () => {
    const session = bootSession();
    const io = makeIo({ podSpawn: true, rng: mulberry32(1) });
    // Two destructions resolve in spawn order on the same tick. Seed 1
    // draws u1 = 0.627 (no pod), then u1 = 0.0027 and u2 = 0.527 (shield).
    addBall(session, 332, 15, -240);
    addBall(session, 332, 45, -240);
    ticks(session, io, 3);
    expect(session.rings[0].targets[0]).toBeNull();
    expect(session.rings[0].targets[1]).toBeNull();
    expect(session.pods).toHaveLength(1);
    expect(session.pods[0].kind).toBe("shield");
    expect(session.pods[0].r).toBe(302);
    expect(session.pods[0].angleDeg).toBeCloseTo(45, 6);
  });

  it("consumes nothing while podSpawn is off", () => {
    const session = bootSession();
    const io = makeIo({ podSpawn: false, rng: mulberry32(1) });
    addBall(session, 332, 15, -240);
    ticks(session, io, 3);
    expect(session.rings[0].targets[0]).toBeNull();
    expect(session.pods).toEqual([]);

    // Back on: the next destruction takes the stream's first value.
    io.podSpawn = true;
    addBall(session, 332, 45, -240);
    ticks(session, io, 3);
    expect(session.pods).toEqual([]);
    addBall(session, 332, 75, -240);
    ticks(session, io, 3);
    expect(session.pods).toHaveLength(1);
    expect(session.pods[0].kind).toBe("shield");
  });
});

describe("the clearing event", () => {
  it("fires the instant a hit leaves zero live targets", () => {
    const session = bootSession();
    session.wave = 2;
    emptyRings(session);
    session.rings[0].targets[0] = 1;
    session.effects.widenTicks = 100;
    session.pods.push({ kind: "widen", r: 400, angleDeg: 200, spawnTick: 0 });
    const io = makeIo();
    addBall(session, 332, 15, -240);
    addBall(session, 250, 200, 0);
    const outcome = ticks(session, io, 3);
    expect(outcome.clearedWave).toBe(2);
    // The destroy figure and the bonus land on the same tick.
    expect(session.score).toBe(100 + 500 * 2);
    expect(io.cues).toEqual(["target-break", "wave-clear"]);
    // At that instant every ball, pod, effect, and shield is removed.
    expect(session.balls).toEqual([]);
    expect(session.pods).toEqual([]);
    expect(session.effects.widenTicks).toBe(0);
    expect(session.lives).toBe(3);
  });

  it("does not fire while waveAdvance is off", () => {
    const session = bootSession();
    emptyRings(session);
    session.rings[0].targets[0] = 1;
    const io = makeIo({ waveAdvance: false });
    addBall(session, 332, 15, -240);
    const outcome = ticks(session, io, 3);
    expect(outcome.clearedWave).toBeNull();
    expect(outcome.gameOver).toBe(false);
    expect(session.score).toBe(100);
    expect(io.cues).toEqual(["target-break"]);
    expect(session.balls).toHaveLength(1);
  });

  it("still runs the destruction's pod draw before clearing the field", () => {
    const session = bootSession();
    emptyRings(session);
    session.rings[0].targets[0] = 1;
    // A stream whose first destruction sheds: seed 7 opens under 0.25.
    expect(mulberry32(7)()).toBeLessThan(0.25);
    const io = makeIo({ podSpawn: true, rng: mulberry32(7) });
    addBall(session, 332, 15, -240);
    ticks(session, io, 3);
    // The draw ran (the shed pod was then removed with the field), so the
    // stream stands two values in.
    expect(session.pods).toEqual([]);
    expect(io.rng()).toBe(mulberry32AtOffset(7, 2));
  });
});

/** The stream's value at `offset` draws in, for asserting consumption. */
function mulberry32AtOffset(seed: number, offset: number): number {
  const rng = mulberry32(seed);
  for (let i = 0; i < offset; i += 1) rng();
  return rng();
}
