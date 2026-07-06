/**
 * The contract types the particle runtime operates on — the `system.json` shape the
 * `particle-2d` / `particle-3d` binaries emit.
 *
 * The run-record's generated `AssetKind` union and any generated `system.json` type
 * are produced from Rust via contract-codegen; at the time of writing that codegen has
 * not yet emitted a particle-system type, so the system shapes below are declared
 * locally, matching the documented `system.json` contract (see
 * `apps/docs/.../testing/asset-generation/particle-binaries.md`). The one shared enum
 * that already exists in the generated package — {@link InterpSpec}, the F-curve
 * interpolation — is re-exported from there so there is a single source of truth for
 * it, exactly as `@test-cabinet/voxel-runtime`'s contract re-exports the rig types.
 */

import type { InterpSpec } from "@test-cabinet/run-record";

export type { InterpSpec } from "@test-cabinet/run-record";

/** A real 3-vector `[x, y, z]`. In a 2D system every `z` is `0`. */
export type Vec3 = [number, number, number];

/** The emission-source shape a particle is born on. */
export type EmitterShape = "point" | "disc" | "sphere" | "cone" | "box" | "edge";

/**
 * The size of an emitter's {@link EmitterShape}: `radius` for the round shapes,
 * `size` for the box/edge extents. Both travel so a consumer need not know which the
 * shape reads.
 */
export interface Extent {
  /** Radius, for `disc` / `sphere` / `cone`. */
  radius: number;
  /** Full extents `[x, y, z]`, for `box` / `edge`. */
  size: Vec3;
}

/**
 * How an emitter releases particles: continuously at a `rate` (particles/second) or
 * all at once as a timed `burst` (`count` particles at `atMs`).
 */
export type Emission =
  | { mode: "rate"; rate: number }
  | { mode: "burst"; count: number; atMs: number };

/** Curl-noise turbulence: a swirling force of `amplitude` at spatial frequency `scale`. */
export interface Turbulence {
  amplitude: number;
  scale: number;
}

/**
 * The forces integrated into a particle's motion each step. Every field is optional so
 * a per-emitter override overlays only the components it names onto the global set. In
 * a 2D system every direction is planar (`z` zeroed).
 */
export interface Forces {
  /** Gravitational acceleration along {@link gravityDir} (default straight down). */
  gravity?: number;
  /** The direction gravity pulls, when not straight down `(0, -1, 0)`. */
  gravityDir?: Vec3;
  /** Linear drag: velocity is damped by this coefficient each second. */
  drag?: number;
  /** A radial push out from the emitter center — an explosion's outward shove. */
  radial?: number;
  /** A vortex swirl about the emitter's vertical (`y`) axis. */
  vortex?: number;
  /** Curl-noise turbulence. */
  turbulence?: Turbulence;
  /** A steady wind acceleration `[x, y, z]`. */
  wind?: Vec3;
}

/** A keyed color stop (`#rrggbb`) over a particle's normalized life `[0, 1]`. */
export interface ColorStop {
  /** The stop color, opaque `#rrggbb`. */
  color: string;
  /** The normalized life position `[0, 1]` the stop sits at. */
  at: number;
}

/**
 * An F-curve over a particle's normalized life `[0, 1]`, evaluated `from → to` with
 * one of the {@link InterpSpec} interpolations. A particle's size and opacity are each
 * shaped by one of these.
 */
export interface Curve {
  interp: InterpSpec;
  from: number;
  to: number;
}

/** The per-particle appearance over a particle's normalized life, scoped to an emitter. */
export interface ParticleAppearance {
  /** How a particle's size scales over its life. */
  sizeCurve?: Curve;
  /** How a particle's opacity fades over its life. */
  opacityCurve?: Curve;
  /** Keyed color stops over life (ordered by {@link ColorStop.at}). */
  colorGradient?: ColorStop[];
  /** Spin rate, in degrees per second. */
  rotation?: number;
  /** Velocity-stretch factor (a particle elongates along its motion). */
  stretch?: number;
  /** An optional cross-asset sprite/atlas reference the particles are textured with. */
  sprite?: string;
}

/** One emitter of the system: where and how it emits, and its particles' look/forces. */
export interface Emitter {
  /** The stable name a `set-forces` / `set-particle` / `add-subemitter` op targets. */
  name: string;
  /** The emission-source shape. */
  shape: EmitterShape;
  /** The emitter position in world coordinates. */
  position: Vec3;
  /** The shape's extent. */
  extent: Extent;
  /** How the emitter releases particles. */
  emission: Emission;
  /** Each particle's lifetime, in milliseconds. */
  lifetimeMs: number;
  /** The `±` spread applied to each particle's lifetime. */
  lifetimeSpread?: number;
  /** Each particle's launch speed, in world units per second. */
  speed: number;
  /** The `±` spread applied to each particle's speed. */
  speedSpread?: number;
  /** The launch direction (normalized on use). */
  direction: Vec3;
  /** The cone half-spread about {@link direction}, in degrees (`0` beam, `360` sphere). */
  coneAngle?: number;
  /** A seed pinning this emitter's random draws; absent lets each play vary. */
  seed?: number;
  /** Per-emitter force overrides layered over the global forces. */
  forces?: Forces;
  /** The particle appearance. */
  particle?: ParticleAppearance;
}

/** When a sub-emitter's child fires: on a parent particle's death, or along its path. */
export type SubTrigger = "death" | "step";

/** A secondary system spawned from a parent emitter's particles. */
export interface SubEmitter {
  /** The parent emitter whose particles trigger the child. */
  parent: string;
  /** When the child fires. */
  on: SubTrigger;
  /** The child emitter (a declared {@link Emitter.name}). */
  emitter: string;
}

/** The bounding field the effect plays in. `depth` is present only for a 3D effect. */
export interface ParticleField {
  width: number;
  height: number;
  depth?: number;
}

/** A whole authored particle system — the emitted `system.json`. */
export interface ParticleSystem {
  /** `2` for a planar effect, `3` for a volumetric one. */
  dimensions: number;
  /** The field the effect plays in. */
  field: ParticleField;
  /** The effect's length in milliseconds. */
  durationMs: number;
  /** The preview/playback frame rate. */
  fps: number;
  /** Whether the effect loops (fire, smoke) or is a one-shot (an explosion). */
  loop: boolean;
  /** The emitters, in declared order. */
  emitters: Emitter[];
  /** The global forces (a per-emitter override layers over these). */
  forces?: Forces;
  /** The sub-emitter links. */
  subEmitters?: SubEmitter[];
}

/**
 * A live particle at a captured instant, with its appearance already evaluated — the
 * unit both bindings render (a billboard in three, a disc in canvas).
 */
export interface RenderParticle {
  /** World position `[x, y, z]` (`z` is `0` in a 2D system). */
  position: Vec3;
  /** The size factor (a curve value; the render path scales it to world/pixel size). */
  size: number;
  /** Linear `0..1` RGB color. */
  color: Vec3;
  /** Opacity `[0, 1]`. */
  opacity: number;
  /** The particle's velocity (for velocity-stretch). */
  velocity: Vec3;
  /** The velocity-stretch factor (`1` = round). */
  stretch: number;
}
