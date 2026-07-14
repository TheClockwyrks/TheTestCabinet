/**
 * Sunfront — provided muzzle-flash effects (specs/assets.md "Provided muzzle-flash
 * effects").
 *
 * When a unit fires, it plays ONE fresh instance of its provided muzzle-flash particle
 * system (`assets/effects/*.json`), simulated live via `@test-cabinet/particle-runtime`'s
 * `/three` `ParticleSystemPlayer`, anchored to the firing part's muzzle tip, oriented
 * along the barrel (each effect is authored firing forward along `+z`), scaled to the
 * muzzle, and disposed once its one-shot decays. The build never hand-codes a particle
 * simulator: it plays the provided systems exactly as authored.
 *
 * These are one-shot systems, so the flash rate matches the fire rate — a fresh instance
 * per shot on the unit's cadence, not one instance held on. Players are pooled per family
 * so a heavy firefight does not thrash GPU allocation. Which family a unit plays comes
 * from its `MuzzleMount.kind` (read from `models.json`), never hard-coded here.
 *
 * The muzzle world transform is recomputed from the SAME posing math the instanced
 * renderer uses (`sampleAnimation` overlaid on any caller joints, then `poseRig`), so the
 * flash sits on the barrel the renderer actually drew — including the barrel's animated
 * elevation/recoil. The F4 wireframe toggle reaches these generated effects too (the
 * scene stays uniform under wireframe).
 */

import * as THREE from "three";
import { poseRig, sampleAnimation, ParticleSystemPlayer } from "../runtime";
import type { AnimationSpec, ModelSpec, ParticleSystem } from "../runtime";
import type { MuzzleKind, MuzzleMount, RigBounds } from "../types";
import { placeMatrix } from "./placement";

/**
 * How large the effect reads relative to the muzzle part's girth: the authored system's
 * field is fit to roughly this multiple of the barrel's model-unit size, then clamped so
 * a thin rifle still shows and a heavy cannon does not swamp the field.
 */
const MUZZLE_FIT = 2.0;
const MIN_EFFECT_WORLD = 7;
const MAX_EFFECT_WORLD = 64;

/** A ground-plane placement for the firing entity (the renderer's `M_place` inputs). */
export interface MuzzlePlacement {
  readonly x: number;
  readonly z: number;
  readonly altitude: number;
  readonly yaw: number;
}

/** One playing flash: its pooled player, elapsed clock, and the family it belongs to. */
interface ActiveFlash {
  readonly player: ParticleSystemPlayer;
  readonly kind: MuzzleKind;
  elapsedMs: number;
  readonly durationMs: number;
}

/** The largest field dimension of a system (the extent the world scale is fit against). */
function fieldExtent(system: ParticleSystem): number {
  return Math.max(system.field.width, system.field.height, system.field.depth ?? 0, 1);
}

export class EffectsManager {
  private readonly systems: ReadonlyMap<MuzzleKind, ParticleSystem>;
  /** Every player ever created (active or idle), so wireframe reaches them and clear() disposes them. */
  private readonly created = new Map<MuzzleKind, ParticleSystemPlayer[]>();
  private readonly free = new Map<MuzzleKind, ParticleSystemPlayer[]>();
  private readonly active: ActiveFlash[] = [];
  private wire = false;

  // Per-flash scratch (no per-shot allocation beyond the pooled player).
  private readonly place = new THREE.Matrix4();
  private readonly partWorld = new THREE.Matrix4();
  private readonly muzzle = new THREE.Matrix4();
  private readonly anchor = new THREE.Matrix4();
  private readonly scaleM = new THREE.Matrix4();
  private readonly recenter = new THREE.Matrix4();
  private readonly caller: Record<string, number> = {};

  constructor(
    private readonly scene: THREE.Scene,
    systems: ReadonlyMap<MuzzleKind, ParticleSystem>,
  ) {
    this.systems = systems;
  }

  /**
   * Fire one flash for a shot: pose {@link rig} at {@link animMs} with the active
   * {@link clip} (overlaid on {@link callerOverride}, the same compose the renderer uses),
   * find the muzzle part's world transform under the entity's ground placement, anchor
   * the effect to the barrel tip, orient it along the barrel, scale it to the muzzle, and
   * play one fresh instance. A no-op if the family/part cannot be resolved.
   */
  flash(
    mount: MuzzleMount,
    rig: ModelSpec,
    clip: AnimationSpec | undefined,
    callerOverride: Record<string, number> | undefined,
    animMs: number,
    place: MuzzlePlacement,
    bounds: RigBounds,
  ): void {
    const system = this.systems.get(mount.kind);
    if (!system) return;

    // Active animation overlaid on any caller-driven joints, then pose — identical to the
    // instanced renderer, so the flash tracks the barrel the renderer drew.
    for (const k of Object.keys(this.caller)) delete this.caller[k];
    if (callerOverride) Object.assign(this.caller, callerOverride);
    if (clip) Object.assign(this.caller, sampleAnimation(clip, animMs));
    const posed = poseRig(rig, { caller: this.caller, timeMs: animMs });
    const part = posed.find((p) => p.name === mount.part);
    if (!part) return;

    // M_muzzle = M_place · partWorld · T(barrelTip). Its rotation maps the effect's
    // authored forward (+z) onto the barrel's world facing.
    placeMatrix(this.place, place.x, place.altitude, place.z, place.yaw, bounds);
    this.partWorld.fromArray(part.worldMatrix);
    this.muzzle.multiplyMatrices(this.place, this.partWorld);
    this.anchor.makeTranslation(mount.local[0], mount.local[1], mount.local[2]);
    this.muzzle.multiply(this.anchor);

    // Fit the (small, authored) system to the muzzle: scale, then recentre the field's
    // XY origin and near face onto the muzzle so its forward spit fires down the barrel.
    const extent = fieldExtent(system);
    const world = THREE.MathUtils.clamp(mount.scale * MUZZLE_FIT, MIN_EFFECT_WORLD, MAX_EFFECT_WORLD);
    const s = world / extent;
    this.scaleM.makeScale(s, s, s);
    this.recenter.makeTranslation(-system.field.width / 2, -system.field.height / 2, 0);
    this.muzzle.multiply(this.scaleM).multiply(this.recenter);

    const player = this.acquire(mount.kind, system);
    player.reset();
    const points = player.points;
    points.matrixAutoUpdate = false;
    points.matrix.copy(this.muzzle);
    points.matrixWorldNeedsUpdate = true;
    (points.material as THREE.ShaderMaterial).wireframe = this.wire;
    this.scene.add(points);
    this.active.push({ player, kind: mount.kind, elapsedMs: 0, durationMs: system.durationMs });
  }

  /** Advance every live flash; recycle each one once its one-shot has fully decayed. */
  update(dtSeconds: number): void {
    const dtMs = dtSeconds * 1000;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const a = this.active[i];
      a.player.update(dtSeconds);
      a.elapsedMs += dtMs;
      // A one-shot is done once it has stopped emitting (past its duration) and its last
      // particle has died. Recycle to the pool for the next shot of this family.
      if (a.elapsedMs >= a.durationMs && a.player.simulator.liveCount === 0) {
        this.scene.remove(a.player.points);
        this.pool(a.kind).push(a.player);
        this.active.splice(i, 1);
      }
    }
  }

  /** Route the F4 wireframe state onto every generated effect's material. */
  setWireframe(on: boolean): void {
    this.wire = on;
    for (const players of this.created.values()) {
      for (const p of players) (p.points.material as THREE.ShaderMaterial).wireframe = on;
    }
  }

  /** Dispose every player (active and idle) and detach — call when the match tears down. */
  clear(): void {
    for (const a of this.active) this.scene.remove(a.player.points);
    for (const players of this.created.values()) {
      for (const p of players) p.dispose();
    }
    this.active.length = 0;
    this.created.clear();
    this.free.clear();
  }

  // --- Pooling -------------------------------------------------------------

  private pool(kind: MuzzleKind): ParticleSystemPlayer[] {
    let list = this.free.get(kind);
    if (!list) { list = []; this.free.set(kind, list); }
    return list;
  }

  private acquire(kind: MuzzleKind, system: ParticleSystem): ParticleSystemPlayer {
    const idle = this.pool(kind);
    const reused = idle.pop();
    if (reused) return reused;
    const player = new ParticleSystemPlayer(system);
    (player.points.material as THREE.ShaderMaterial).wireframe = this.wire;
    let created = this.created.get(kind);
    if (!created) { created = []; this.created.set(kind, created); }
    created.push(player);
    return player;
  }
}
