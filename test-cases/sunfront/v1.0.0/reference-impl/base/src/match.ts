/**
 * Sunfront — the match driver: the headless {@link World} wired to the 3D renderer.
 *
 * This is the seam between the simulation (`sim/world.ts`, no THREE) and the renderer
 * (`render/*`, no game rules). Each frame it steps the World with real `dt`, then hands
 * the renderer a flat {@link RenderEntity} list for the GPU-instanced roster and drives
 * a `VoxelRig` singleton for each base, Reliquary, build structure, and Aegis. The
 * renderer reads only this handoff; it never touches simulation state.
 *
 * The **enemy side is driven by the reactive {@link EnemyAI}** (specs/flow.md): it runs
 * the same economy on its own hidden grid with no cheating. The **player** side is
 * commanded live through the HUD build palette and structure panel (`Game`), which call
 * the same `World` economy API the AI uses. Fog of war (specs/playfield.md) is applied
 * here on the render handoff: enemy units, base, and Reliquary are drawn ONLY while
 * inside the player's current vision, and the ground fog overlay is refreshed each frame
 * from the player's vision discs.
 *
 * A `Match` owns the scene subtrees it adds (the fixed base/Reliquary singletons and the
 * per-structure / Aegis actors); {@link dispose} tears them all down and clears the
 * renderer so `Game` can start a fresh match (Restart / Play Again).
 */

import type { LoadedAssets, RenderEntity, UnitType } from "./types";
import type { World, SimAegis, BuildStructure } from "./sim/world";
import { World as SimWorld } from "./sim/world";
import { SingletonActor } from "./render/singletons";
import type { World as RenderWorld } from "./render/world";
import {
  PLAYER_BASE, ENEMY_BASE, PLAYER_RELIQUARY, ENEMY_RELIQUARY,
} from "./constants";
import { facingYaw, advanceDir } from "./mathutil";
import { gridCellCenter } from "./render/terrain";
import { EnemyAI } from "./ai";
import { collectVision, pointVisible, type VisionSource } from "./vision";

/** How long a destroyed entity flashes; mirrors the sim's cull window. */
const DEATH_FLASH_MS = 450;

export class Match {
  readonly world: World = new SimWorld();
  /** The reactive enemy opponent — runs the enemy economy on its own hidden grid. */
  private readonly ai = new EnemyAI(this.world, "enemy");

  private readonly typeById = new Map<number, UnitType>();
  private readonly aegisActors = new Map<number, SingletonActor>();
  private readonly structureActors = new Map<number, SingletonActor>();
  /** The four fixed singletons, kept individually so enemy ones can be fog-gated. */
  private playerBaseActor!: SingletonActor;
  private enemyBaseActor!: SingletonActor;
  private playerReliquaryActor!: SingletonActor;
  private enemyReliquaryActor!: SingletonActor;

  /** The player's current vision discs, recomputed each frame (fog of war). */
  private playerVision: VisionSource[] = [];

  constructor(
    private readonly render: RenderWorld,
    private readonly assets: LoadedAssets,
  ) {
    this.placeFixed();
  }

  /** Tear down every scene subtree this match added and clear the renderer. */
  dispose(): void {
    for (const a of [
      this.playerBaseActor, this.enemyBaseActor,
      this.playerReliquaryActor, this.enemyReliquaryActor,
    ]) {
      a.dispose();
    }
    for (const a of this.structureActors.values()) a.dispose();
    for (const a of this.aegisActors.values()) a.dispose();
    this.structureActors.clear();
    this.aegisActors.clear();
    this.render.reset();
  }

  /** Bases and Reliquaries — pre-placed, permanent singletons (specs/playfield.md). */
  private placeFixed(): void {
    const base = this.assets.structures.get("base")!;
    const reliquary = this.assets.structures.get("reliquary")!;
    const yawP = facingYaw(advanceDir("player"));
    const yawE = facingYaw(advanceDir("enemy"));
    this.playerBaseActor = new SingletonActor(this.render.scene, base, "player", this.render.registry)
      .place(PLAYER_BASE.x, PLAYER_BASE.z, yawP).setRole("idle");
    this.enemyBaseActor = new SingletonActor(this.render.scene, base, "enemy", this.render.registry)
      .place(ENEMY_BASE.x, ENEMY_BASE.z, yawE).setRole("idle");
    this.playerReliquaryActor = new SingletonActor(this.render.scene, reliquary, "neutral", this.render.registry)
      .place(PLAYER_RELIQUARY.x, PLAYER_RELIQUARY.z, yawP).setRole("idle");
    this.enemyReliquaryActor = new SingletonActor(this.render.scene, reliquary, "neutral", this.render.registry)
      .place(ENEMY_RELIQUARY.x, ENEMY_RELIQUARY.z, yawE).setRole("idle");
  }

  /** Step the AI + sim and push this frame's fog-gated render state to the world. */
  update(dtSeconds: number): void {
    this.ai.step(dtSeconds);
    this.world.step(dtSeconds);
    this.playerVision = collectVision(this.world, "player");
    this.render.updateFog(this.playerVision);
    this.syncUnits();
    this.syncStructures();
    this.syncAegis(dtSeconds);
    this.syncFixed(dtSeconds);
  }

  /**
   * Build the instanced-unit render list from the live roster, applying fog: player
   * units always draw; enemy units draw only while inside the player's current vision.
   */
  private syncUnits(): void {
    this.typeById.clear();
    const entities: RenderEntity[] = [];
    for (const u of this.world.units) {
      if (u.team === "enemy" && !pointVisible(this.playerVision, u.x, u.z)) continue;
      this.typeById.set(u.id, u.type);
      entities.push({
        id: u.id,
        team: u.team,
        x: u.x,
        z: u.z,
        altitude: u.altitude,
        yaw: u.yaw,
        animMs: u.animMs,
        role: u.role,
        flash: u.dead ? flashAmount(u.deathMs) : 0,
        accent: u.level > 1,
      });
    }
    this.render.syncUnits(entities, (e) => this.typeById.get(e.id)!);
  }

  /**
   * Create/place/remove a singleton per PLAYER build-grid structure. The enemy's
   * structures sit in its fogged staging yard and are never drawn (specs/playfield.md).
   */
  private syncStructures(): void {
    const live = new Set<number>();
    for (const s of this.world.structures) {
      if (s.team !== "player") continue;
      live.add(s.id);
      let actor = this.structureActors.get(s.id);
      if (!actor) {
        actor = this.makeStructureActor(s);
        this.structureActors.set(s.id, actor);
      }
    }
    for (const [id, actor] of this.structureActors) {
      if (!live.has(id)) {
        actor.dispose();
        this.structureActors.delete(id);
      }
    }
  }

  private makeStructureActor(s: BuildStructure): SingletonActor {
    const tpl = s.kind === "solar-extractor"
      ? this.assets.structures.get("solar-extractor")!
      : this.assets.spawners.get(s.kind)!;
    const yaw = facingYaw(advanceDir(s.team));
    const c = gridCellCenter(s.team, s.col, s.row);
    return new SingletonActor(this.render.scene, tpl, s.team, this.render.registry)
      .place(c.x, c.z, yaw).setRole("idle");
  }

  /** Create/place/drive/remove a `VoxelRig` singleton for each live Aegis. */
  private syncAegis(dt: number): void {
    const live = new Set<number>();
    for (const a of this.world.aegis) {
      live.add(a.id);
      let actor = this.aegisActors.get(a.id);
      if (!actor) {
        actor = new SingletonActor(this.render.scene, this.assets.aegis, a.team, this.render.registry);
        this.aegisActors.set(a.id, actor);
      }
      actor.place(a.x, a.z, a.yaw);
      actor.setRole(a.firing ? "attack" : "move");
      actor.poseCaller(aegisCaller(a));
      actor.update(dt);
      // Fog: a player Aegis is always shown; an enemy Aegis only while in vision.
      actor.rig.root.visible = a.team === "player" || pointVisible(this.playerVision, a.x, a.z);
    }
    for (const [id, actor] of this.aegisActors) {
      if (!live.has(id)) {
        actor.dispose();
        this.aegisActors.delete(id);
      }
    }
  }

  /**
   * Animate the fixed singletons and fog-gate the enemy ones: the player's base and
   * Reliquary always draw; the enemy's base and Reliquary draw only while a player disc
   * currently sees them (never as stale ghosts), and a razed Reliquary is hidden.
   */
  private syncFixed(dt: number): void {
    for (const a of [this.playerBaseActor, this.enemyBaseActor, this.playerReliquaryActor, this.enemyReliquaryActor]) {
      a.update(dt);
    }
    this.enemyBaseActor.rig.root.visible = pointVisible(this.playerVision, ENEMY_BASE.x, ENEMY_BASE.z);
    const enemyRel = this.world.reliquaries.enemy;
    this.enemyReliquaryActor.rig.root.visible =
      !enemyRel.dead && enemyRel.hp > 0 && pointVisible(this.playerVision, ENEMY_RELIQUARY.x, ENEMY_RELIQUARY.z);
  }
}

/** Team-relative caller joints that aim the Aegis turrets (specs/waves.md). */
function aegisCaller(a: SimAegis): Record<string, number> {
  return {
    main_yaw: a.main.yaw,
    sgun_l_yaw: a.left.yaw,
    sgun_r_yaw: a.right.yaw,
  };
}

/** Destruction white-flash 0..1 from milliseconds since death (a few quick flashes). */
function flashAmount(deathMs: number): number {
  const t = Math.min(1, deathMs / DEATH_FLASH_MS);
  return 0.5 + 0.5 * Math.cos(t * Math.PI * 6);
}
