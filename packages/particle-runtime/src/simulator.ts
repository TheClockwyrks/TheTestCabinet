/**
 * The stochastic particle simulator — the browser port of `particle-core`'s `sim.rs`,
 * and the pure heart of the runtime. It plays an authored {@link ParticleSystem}
 * *live*, one playback tick at a time: it steps every emitter (spawning by rate or
 * burst), integrates the forces (gravity, drag, radial, vortex, curl-noise turbulence,
 * wind) into each particle's motion, evaluates the per-particle curves on capture, and
 * fires sub-emitters on a particle's death or along its path.
 *
 * Unlike the Rust `simulate`, which bakes a fixed frame list over one duration, this
 * engine steps incrementally so the viewer can drive it off a wall clock — and it owns
 * the {@link ParticleSystem.loop} timeline: a one-shot effect emits once and decays to
 * empty (replay via {@link ParticleSimulator.reset}); a looping effect re-fires its
 * bursts and keeps its rate emitters running each cycle, settling into a steady state.
 * Seeding is only for reproducibility; an unseeded play varies, which is correct for
 * VFX.
 */

import type {
  Emitter,
  Forces,
  ParticleSystem,
  RenderParticle,
  Vec3,
} from "./contract";
import { colorAt, opacityAt, sizeAt } from "./curves";
import { CurlNoise } from "./noise";
import { asU64, Rng, splitmix64 } from "./rng";

/**
 * A hard cap on the live particle count. It mirrors `particle-core`'s
 * `budget::MAX_LIVE_PARTICLES`, which the binaries enforce at authoring time by
 * rejecting an operation whose system would exceed it — so a system authored through
 * the tool never reaches this cap. It stands for the ones that can: a `system.json`
 * recorded before the budget existed, or hand-written. Stepping every live particle
 * (and its curl-noise turbulence) is pure main-thread work in the viewer, so an
 * unbounded count is a frozen tab, not just a slow one.
 */
const MAX_PARTICLES = 10_000;

/** The deepest sub-emitter generation that still triggers further sub-emitters. */
const MAX_GENERATION = 4;

/** The fixed preview seed the Rust `render` uses when no emitter pins its own. */
const DEFAULT_SEED = 0x00c0ffee;

/** Options for {@link ParticleSimulator}. */
export interface ParticleSimulatorOptions {
  /**
   * The base seed folded into every emitter's random draws. Pass a fixed value to make
   * the play reproducible (as the binary's preview does); omit for a fresh, varying
   * play each construction.
   */
  seed?: number;
  /**
   * Cap on live particles (defaults to {@link MAX_PARTICLES}) — lower it to bound the
   * cost of a heavy effect on a constrained client.
   */
  maxParticles?: number;
}

/** A live particle carried between frames (its appearance is derived on capture). */
interface Particle {
  emitter: number;
  generation: number;
  pos: Vec3;
  vel: Vec3;
  age: number;
  lifetime: number;
}

export class ParticleSimulator {
  readonly system: ParticleSystem;
  private readonly twoD: boolean;
  private readonly durationMs: number;
  private readonly baseSeed: number;
  private readonly maxParticles: number;
  /** Emitter indices that are the child of some sub-emitter (spawned only on a trigger). */
  private readonly childEmitters: Set<number>;
  /** Effective forces per emitter: the global set overlaid with the emitter's own. */
  private readonly effForces: Forces[];
  /**
   * The turbulence field, held for the simulator's whole life so its lattice memo is
   * shared by every particle across every frame — the field is the same for all of
   * them and never changes over time.
   */
  private readonly turbulence = new CurlNoise();

  private particles: Particle[] = [];
  private spawners: Rng[] = [];
  private rateAccum: number[] = [];
  /** The position within the current loop cycle, in ms (`0..durationMs`). */
  private cycleClock = 0;
  /** The absolute play clock, in ms (monotonic across loops). */
  private clock = 0;

  constructor(system: ParticleSystem, opts: ParticleSimulatorOptions = {}) {
    this.system = system;
    this.twoD = system.dimensions <= 2;
    this.durationMs = Math.max(system.durationMs, 1);
    this.baseSeed = opts.seed ?? DEFAULT_SEED;
    this.maxParticles = opts.maxParticles ?? MAX_PARTICLES;

    const childNames = new Set((system.subEmitters ?? []).map((s) => s.emitter));
    this.childEmitters = new Set(
      system.emitters.flatMap((e, i) => (childNames.has(e.name) ? [i] : [])),
    );
    this.effForces = system.emitters.map((e) =>
      mergeForces(system.forces ?? {}, e.forces ?? {}, this.twoD),
    );

    this.reset();
  }

  /** The absolute play clock, in ms (advances monotonically across loop cycles). */
  get clockMs(): number {
    return this.clock;
  }

  /** The number of live particles right now. */
  get liveCount(): number {
    return this.particles.length;
  }

  /** Whether the system declares at least one emitter that actually emits particles. */
  get isNonEmpty(): boolean {
    return this.system.emitters.some((e) =>
      e.emission.mode === "rate" ? e.emission.rate > 0 : e.emission.count > 0,
    );
  }

  /**
   * Restart the play: clear every particle, rewind both clocks, re-seed the PRNGs
   * (so a seeded play replays identically), and fire any zero-time bursts so frame 0
   * already carries them.
   */
  reset(): void {
    this.particles = [];
    this.cycleClock = 0;
    this.clock = 0;
    this.rateAccum = this.system.emitters.map(() => 0);
    this.spawners = this.system.emitters.map(
      (e, i) =>
        new Rng(
          (asU64(this.baseSeed) ^ asU64(e.seed ?? 0) ^ splitmix64(asU64(i + 1))) &
            ((1n << 64n) - 1n),
        ),
    );
    this.fireZeroBursts();
  }

  /**
   * Advance the simulation by `dtMs`: integrate and age every live particle (firing
   * sub-emitters and removing the dead), then emit over the elapsed window.
   */
  step(dtMs: number): void {
    if (dtMs <= 0) return;
    this.integrate(dtMs);
    this.emitElapsed(dtMs);
    this.clock += dtMs;
  }

  /**
   * Capture the live particles, evaluating each one's appearance at its current
   * normalized life — the render-ready snapshot both bindings draw.
   */
  capture(): RenderParticle[] {
    const out: RenderParticle[] = new Array(this.particles.length);
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i]!;
      const ap = this.system.emitters[p.emitter]!.particle ?? {};
      const life = clamp(p.age / p.lifetime, 0, 1);
      out[i] = {
        position: [p.pos[0], p.pos[1], p.pos[2]],
        size: sizeAt(ap.sizeCurve, life),
        color: colorAt(ap.colorGradient, life),
        opacity: opacityAt(ap.opacityCurve, life),
        velocity: [p.vel[0], p.vel[1], p.vel[2]],
        stretch: Math.max(ap.stretch ?? 1, 0),
      };
    }
    return out;
  }

  // --- emission ---------------------------------------------------------------

  /** Fire every top-level burst whose `atMs <= 0` at the current cycle start. */
  private fireZeroBursts(): void {
    this.system.emitters.forEach((emitter, i) => {
      if (this.childEmitters.has(i)) return;
      if (emitter.emission.mode === "burst" && emitter.emission.atMs <= 0) {
        this.spawn(i, emitter.emission.count, null, 0, this.spawners[i]!);
      }
    });
  }

  /**
   * Emit over an elapsed span of `dtMs`, honouring the loop timeline: the span is
   * clipped at the cycle's end, and a looping system wraps (re-firing zero-time bursts)
   * to spend any remainder in the next cycle, while a one-shot parks at the duration and
   * emits nothing further.
   */
  private emitElapsed(dtMs: number): void {
    let rem = dtMs;
    while (rem > 1e-9) {
      const from = this.cycleClock;
      const room = this.durationMs - from;
      const seg = Math.min(rem, room);
      const to = from + seg;
      this.emitWindow(from, to);
      this.cycleClock = to;
      rem -= seg;
      if (to >= this.durationMs - 1e-9) {
        if (this.system.loop) {
          this.cycleClock = 0;
          this.fireZeroBursts();
        } else {
          this.cycleClock = this.durationMs;
          return;
        }
      }
    }
  }

  /** Emit over a within-cycle window `(from, to]`: rate accumulation and timed bursts. */
  private emitWindow(from: number, to: number): void {
    const dtS = (to - from) / 1000;
    this.system.emitters.forEach((emitter, i) => {
      if (this.childEmitters.has(i)) return;
      const em = emitter.emission;
      if (em.mode === "rate") {
        if (em.rate <= 0) return;
        this.rateAccum[i]! += em.rate * dtS;
        const n = Math.floor(this.rateAccum[i]!);
        if (n >= 1) {
          this.rateAccum[i]! -= n;
          this.spawn(i, n, null, 0, this.spawners[i]!);
        }
      } else if (em.atMs > from && em.atMs <= to) {
        this.spawn(i, em.count, null, 0, this.spawners[i]!);
      }
    });
  }

  // --- integration ------------------------------------------------------------

  /** Advance every particle one tick, firing sub-emitters and removing the dead. */
  private integrate(dtMs: number): void {
    const dtS = dtMs / 1000;
    const spawned: Particle[] = [];
    let i = 0;
    while (i < this.particles.length) {
      const p = this.particles[i]!;
      const emitter = this.system.emitters[p.emitter]!;
      const forces = this.effForces[p.emitter]!;

      const accel: Vec3 = [0, 0, 0];
      applyForces(accel, p, emitter, forces, this.turbulence);

      // Semi-implicit Euler with drag damping.
      p.vel = add(p.vel, scale(accel, dtS));
      if (forces.drag !== undefined) {
        const damp = 1 / (1 + Math.max(forces.drag, 0) * dtS);
        p.vel = scale(p.vel, damp);
      }
      p.pos = add(p.pos, scale(p.vel, dtS));
      if (this.twoD) {
        p.pos[2] = 0;
        p.vel[2] = 0;
      }
      p.age += dtMs;

      if (p.generation < MAX_GENERATION) {
        this.fireStepSubemitters(p, dtMs, spawned);
      }

      if (p.age >= p.lifetime) {
        if (p.generation < MAX_GENERATION) {
          this.fireDeathSubemitters(p, spawned);
        }
        // swap_remove: move the last into `i` and shrink; do not advance `i`.
        const last = this.particles.pop()!;
        if (i < this.particles.length) this.particles[i] = last;
      } else {
        i++;
      }
    }
    for (const np of spawned) {
      if (this.particles.length >= this.maxParticles) break;
      this.particles.push(np);
    }
  }

  // --- sub-emitters -----------------------------------------------------------

  private fireStepSubemitters(p: Particle, dtMs: number, spawned: Particle[]): void {
    const parentName = this.system.emitters[p.emitter]!.name;
    for (const sub of this.system.subEmitters ?? []) {
      if (sub.on !== "step" || sub.parent !== parentName) continue;
      const child = this.system.emitters.findIndex((e) => e.name === sub.emitter);
      if (child < 0) continue;
      const perSecond = childTrailRate(this.system.emitters[child]!);
      if (perSecond <= 0) continue;
      const interval = 1000 / perSecond;
      const count = Math.floor(dtMs / interval);
      for (let k = 0; k < count; k++) {
        const np = this.spawnChild(child, p);
        if (np) spawned.push(np);
      }
    }
  }

  private fireDeathSubemitters(p: Particle, spawned: Particle[]): void {
    const parentName = this.system.emitters[p.emitter]!.name;
    for (const sub of this.system.subEmitters ?? []) {
      if (sub.on !== "death" || sub.parent !== parentName) continue;
      const child = this.system.emitters.findIndex((e) => e.name === sub.emitter);
      if (child < 0) continue;
      const count = childBurstCount(this.system.emitters[child]!);
      for (let k = 0; k < count; k++) {
        const np = this.spawnChild(child, p);
        if (np) spawned.push(np);
      }
    }
  }

  private spawnChild(child: number, parent: Particle): Particle | null {
    const before = this.scratch.length;
    this.spawn(child, 1, parent.pos, parent.generation + 1, this.spawners[child]!);
    if (this.scratch.length > before) {
      return this.scratch.pop() ?? null;
    }
    return null;
  }

  /** Scratch buffer child spawns are drawn into before being handed to `spawned`. */
  private scratch: Particle[] = [];

  // --- spawning ---------------------------------------------------------------

  /**
   * Spawn `count` particles for emitter `index`, at an explicit `origin` (a sub-emitter
   * trigger site) or sampled from the emitter's shape, drawing the lifetime/speed/
   * direction spreads from `rng`.
   */
  private spawn(
    index: number,
    count: number,
    origin: Vec3 | null,
    generation: number,
    rng: Rng,
  ): void {
    // Child spawns route through the scratch buffer; top-level spawns land live.
    const sink = generation > 0 ? this.scratch : this.particles;
    const emitter = this.system.emitters[index]!;
    for (let k = 0; k < count; k++) {
      if (this.particles.length + this.scratch.length >= this.maxParticles) break;
      const pos = origin ? [origin[0], origin[1], origin[2]] as Vec3 : sampleShape(emitter, this.twoD, rng);
      const dir = sampleDirection(emitter, this.twoD, rng);
      const speed = jitter(emitter.speed, emitter.speedSpread ?? 0, rng);
      const lifetime = Math.max(jitter(emitter.lifetimeMs, emitter.lifetimeSpread ?? 0, rng), 1);
      const vel = scale(dir, speed);
      if (this.twoD) {
        vel[2] = 0;
        pos[2] = 0;
      }
      sink.push({ emitter: index, generation, pos, vel, age: 0, lifetime });
    }
  }
}

// --- forces -----------------------------------------------------------------

/** Overlay `override`'s set components onto a clone of `base`, projected to `twoD`. */
function mergeForces(base: Forces, override: Forces, twoD: boolean): Forces {
  const f: Forces = { ...base };
  if (override.gravity !== undefined) f.gravity = override.gravity;
  if (override.gravityDir !== undefined) f.gravityDir = override.gravityDir;
  if (override.drag !== undefined) f.drag = override.drag;
  if (override.radial !== undefined) f.radial = override.radial;
  if (override.vortex !== undefined) f.vortex = override.vortex;
  if (override.turbulence !== undefined) f.turbulence = override.turbulence;
  if (override.wind !== undefined) f.wind = override.wind;
  if (twoD) {
    if (f.gravityDir) f.gravityDir = [f.gravityDir[0], f.gravityDir[1], 0];
    if (f.wind) f.wind = [f.wind[0], f.wind[1], 0];
  }
  return f;
}

/** Accumulate the enabled forces at a particle into `accel`. */
function applyForces(
  accel: Vec3,
  p: Particle,
  emitter: Emitter,
  forces: Forces,
  turbulence: CurlNoise,
): void {
  if (forces.gravity !== undefined) {
    const dir = normalizeOr(forces.gravityDir ?? [0, -1, 0], [0, -1, 0]);
    addInto(accel, scale(dir, forces.gravity));
  }
  const radialOut = normalizeOr(sub(p.pos, emitter.position), [0, 1, 0]);
  if (forces.radial !== undefined) {
    addInto(accel, scale(radialOut, forces.radial));
  }
  if (forces.vortex !== undefined) {
    const tangent = normalizeOr(cross([0, 1, 0], radialOut), [1, 0, 0]);
    addInto(accel, scale(tangent, forces.vortex));
  }
  if (forces.turbulence !== undefined) {
    const curl = turbulence.sample(p.pos, Math.max(forces.turbulence.scale, 1e-4));
    addInto(accel, scale(curl, forces.turbulence.amplitude));
  }
  if (forces.wind !== undefined) {
    addInto(accel, forces.wind);
  }
}

// --- spawn sampling ---------------------------------------------------------

/** How many particles a child emitter releases per parent death. */
function childBurstCount(child: Emitter): number {
  return child.emission.mode === "burst"
    ? child.emission.count
    : Math.max(Math.round(child.emission.rate * 0.1), 1);
}

/** The per-second trail rate a `step` child emits at. */
function childTrailRate(child: Emitter): number {
  return child.emission.mode === "rate" ? child.emission.rate : child.emission.count;
}

/** Sample a birth position on the emitter's shape. */
function sampleShape(emitter: Emitter, twoD: boolean, rng: Rng): Vec3 {
  const c = emitter.position;
  const r = emitter.extent.radius;
  const s = emitter.extent.size;
  switch (emitter.shape) {
    case "point":
    case "cone":
      return [c[0], c[1], c[2]];
    case "sphere": {
      const b = rng.inBall(r, twoD);
      return [c[0] + b[0], c[1] + b[1], c[2] + b[2]];
    }
    case "disc": {
      const d = rng.inDisc(r);
      // Planar disc in `xy` for 2D; a horizontal ground disc in `xz` for 3D.
      return twoD ? [c[0] + d[0], c[1] + d[1], 0] : [c[0] + d[0], c[1], c[2] + d[1]];
    }
    case "box":
      return [
        c[0] + rng.symmetric() * s[0] * 0.5,
        c[1] + rng.symmetric() * s[1] * 0.5,
        twoD ? 0 : c[2] + rng.symmetric() * s[2] * 0.5,
      ];
    case "edge":
      return [c[0] + rng.symmetric() * s[0] * 0.5, c[1], twoD ? 0 : c[2]];
    default:
      return [c[0], c[1], c[2]];
  }
}

/** Sample a launch direction: the emitter direction, spread within its cone. */
function sampleDirection(emitter: Emitter, twoD: boolean, rng: Rng): Vec3 {
  const base = normalizeOr(emitter.direction, [0, 1, 0]);
  const half = ((emitter.coneAngle ?? 0) * 0.5 * Math.PI) / 180;
  if (half <= 0) return base;
  if (twoD) {
    const a = rng.symmetric() * half;
    const sin = Math.sin(a);
    const cos = Math.cos(a);
    return [base[0] * cos - base[1] * sin, base[0] * sin + base[1] * cos, 0];
  }
  const cosMin = Math.cos(half);
  const cosTheta = 1 - rng.unit() * (1 - cosMin);
  const sinTheta = Math.sqrt(Math.max(1 - cosTheta * cosTheta, 0));
  const phi = rng.unit() * Math.PI * 2;
  const local: Vec3 = [sinTheta * Math.cos(phi), sinTheta * Math.sin(phi), cosTheta];
  const [right, up] = basis(base);
  return add(add(scale(right, local[0]), scale(up, local[1])), scale(base, local[2]));
}

/** A jittered value: `base ± spread`, uniform. */
function jitter(base: number, spread: number, rng: Rng): number {
  return base + rng.symmetric() * spread;
}

// --- vector helpers ---------------------------------------------------------

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function addInto(a: Vec3, b: Vec3): void {
  a[0] += b[0];
  a[1] += b[1];
  a[2] += b[2];
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function length(a: Vec3): number {
  return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
}

/** Normalize `v`, falling back to `def` when `v` is (near) zero. */
function normalizeOr(v: Vec3, def: Vec3): Vec3 {
  const len = length(v);
  return len > 1e-6 ? scale(v, 1 / len) : [def[0], def[1], def[2]];
}

/** An orthonormal `(right, up)` basis perpendicular to a unit `forward`. */
function basis(forward: Vec3): [Vec3, Vec3] {
  const upRef: Vec3 = Math.abs(forward[1]) > 0.99 ? [1, 0, 0] : [0, 1, 0];
  const right = normalizeOr(cross(upRef, forward), [1, 0, 0]);
  const up = cross(forward, right);
  return [right, up];
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
