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
import type { ParticleSystem, RenderParticle } from "./contract";
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
export declare class ParticleSimulator {
    readonly system: ParticleSystem;
    private readonly twoD;
    private readonly durationMs;
    private readonly baseSeed;
    private readonly maxParticles;
    /** Emitter indices that are the child of some sub-emitter (spawned only on a trigger). */
    private readonly childEmitters;
    /** Effective forces per emitter: the global set overlaid with the emitter's own. */
    private readonly effForces;
    private particles;
    private spawners;
    private rateAccum;
    /** The position within the current loop cycle, in ms (`0..durationMs`). */
    private cycleClock;
    /** The absolute play clock, in ms (monotonic across loops). */
    private clock;
    constructor(system: ParticleSystem, opts?: ParticleSimulatorOptions);
    /** The absolute play clock, in ms (advances monotonically across loop cycles). */
    get clockMs(): number;
    /** The number of live particles right now. */
    get liveCount(): number;
    /** Whether the system declares at least one emitter that actually emits particles. */
    get isNonEmpty(): boolean;
    /**
     * Restart the play: clear every particle, rewind both clocks, re-seed the PRNGs
     * (so a seeded play replays identically), and fire any zero-time bursts so frame 0
     * already carries them.
     */
    reset(): void;
    /**
     * Advance the simulation by `dtMs`: integrate and age every live particle (firing
     * sub-emitters and removing the dead), then emit over the elapsed window.
     */
    step(dtMs: number): void;
    /**
     * Capture the live particles, evaluating each one's appearance at its current
     * normalized life — the render-ready snapshot both bindings draw.
     */
    capture(): RenderParticle[];
    /** Fire every top-level burst whose `atMs <= 0` at the current cycle start. */
    private fireZeroBursts;
    /**
     * Emit over an elapsed span of `dtMs`, honouring the loop timeline: the span is
     * clipped at the cycle's end, and a looping system wraps (re-firing zero-time bursts)
     * to spend any remainder in the next cycle, while a one-shot parks at the duration and
     * emits nothing further.
     */
    private emitElapsed;
    /** Emit over a within-cycle window `(from, to]`: rate accumulation and timed bursts. */
    private emitWindow;
    /** Advance every particle one tick, firing sub-emitters and removing the dead. */
    private integrate;
    private fireStepSubemitters;
    private fireDeathSubemitters;
    private spawnChild;
    /** Scratch buffer child spawns are drawn into before being handed to `spawned`. */
    private scratch;
    /**
     * Spawn `count` particles for emitter `index`, at an explicit `origin` (a sub-emitter
     * trigger site) or sampled from the emitter's shape, drawing the lifetime/speed/
     * direction spreads from `rng`.
     */
    private spawn;
}
//# sourceMappingURL=simulator.d.ts.map