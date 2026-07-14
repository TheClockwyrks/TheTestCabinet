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
import type { World, SimAegis, SimUnit, BuildStructure } from "./sim/world";
import { World as SimWorld } from "./sim/world";
import { SingletonActor } from "./render/singletons";
import { EffectsManager } from "./render/effects";
import { OverlayManager } from "./render/overlays";
import type { World as RenderWorld } from "./render/world";
import {
  PLAYER_BASE, ENEMY_BASE, PLAYER_RELIQUARY, ENEMY_RELIQUARY, TEAM_COLORS,
} from "./constants";
import { facingYaw, advanceDir } from "./mathutil";
import { gridCellCenter } from "./render/terrain";
import { EnemyAI } from "./ai";
import { collectVision, pointVisible, type VisionSource } from "./vision";

/** How long a destroyed entity flashes; mirrors the sim's cull window. */
const DEATH_FLASH_MS = 450;
/** Gap (world units) between a model's top and the marker floating above it. */
const MARKER_GAP = 9;

/** The Aegis's three turrets → the rig barrel part each fires from (specs/waves.md). */
const AEGIS_TURRET_PART: Record<"main" | "left" | "right", string> = {
  main: "cannon_barrel", left: "sgun_l", right: "sgun_r",
};

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

  /**
   * The player's current vision discs (fog of war). The minimap reads these to fog-gate
   * enemy blips exactly as the 3D view fog-gates enemy models (specs/playfield.md).
   */
  get vision(): readonly VisionSource[] {
    return this.playerVision;
  }

  /** Provided muzzle-flash effects, played one-shot per shot (specs/assets.md). */
  private readonly effects: EffectsManager;
  /** Generated health bars + level pips billboarded over the field (specs/overview.md). */
  private readonly overlays: OverlayManager;
  /** Unsubscribe the effects layer from the F4 wireframe toggle on teardown. */
  private readonly wireframeUnsub: () => void;

  constructor(
    private readonly render: RenderWorld,
    private readonly assets: LoadedAssets,
  ) {
    this.effects = new EffectsManager(render.scene, assets.effects);
    this.overlays = new OverlayManager(render.scene);
    // F4 wireframe must also reach the generated muzzle-flash effects (specs/overview.md).
    this.wireframeUnsub = render.registry.onWireframe((on) => this.effects.setWireframe(on));
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
    this.wireframeUnsub();
    this.effects.clear();
    this.overlays.dispose();
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
    this.overlays.begin();
    this.syncUnits();
    this.syncStructures();
    this.syncAegis(dtSeconds);
    this.syncFixed(dtSeconds);
    this.spawnMuzzleFlashes();
    this.effects.update(dtSeconds);
    this.overlays.end(this.render.camera.camera);
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
      // Generated markers ride above each visible model: a health bar while damaged, and
      // level pips over a veteran (level > 1) unit so a rank-boosted army reads on the
      // field (specs/assets.md — carry the unit level marker onto emitted units).
      if (!u.dead) {
        const dims = this.assets.units.get(u.type)?.dimensions;
        if (dims) {
          const topY = u.altitude + dims[1] + MARKER_GAP;
          const width = Math.max(22, dims[0] * 0.9);
          if (u.hp < u.maxHp) this.overlays.healthBar(u.x, topY, u.z, u.hp / u.maxHp, width);
          if (u.level > 1) {
            this.overlays.pips(u.x, topY + 8, u.z, u.level, TEAM_COLORS[u.team].accent);
          }
        }
      }
    }
    this.render.syncUnits(entities, (e) => this.typeById.get(e.id)!);
  }

  /** Drain this step's shots and play one provided muzzle flash per shot (specs/assets.md). */
  private spawnMuzzleFlashes(): void {
    for (const shot of this.world.shots) {
      if (shot.turret) {
        const a = this.world.aegis.find((x) => x.id === shot.attackerId);
        if (a) this.flashAegisTurret(a, shot.turret);
      } else {
        const u = this.world.units.find((x) => x.id === shot.attackerId);
        if (u) this.flashUnitShot(u);
      }
    }
  }

  /** Play a firing unit's muzzle flash at its muzzle, on its firing cadence. */
  private flashUnitShot(u: SimUnit): void {
    // Fog: an enemy's flash only plays where the player can see the unit (no ghost cue).
    if (u.team === "enemy" && !pointVisible(this.playerVision, u.x, u.z)) return;
    const tpl = this.assets.units.get(u.type);
    const mount = tpl?.muzzleMounts[0];
    if (!tpl || !mount) return; // melee/support units carry no muzzle
    const clip = tpl.clips.get(u.role) ?? tpl.clips.get("idle");
    this.effects.flash(
      mount, tpl.rig, clip, undefined, u.animMs,
      { x: u.x, z: u.z, altitude: u.altitude, yaw: u.yaw }, tpl.bounds,
    );
  }

  /** Play the Aegis cannon flash at the specific turret that fired (specs/waves.md). */
  private flashAegisTurret(a: SimAegis, turret: "main" | "left" | "right"): void {
    if (a.team === "enemy" && !pointVisible(this.playerVision, a.x, a.z)) return;
    const tpl = this.assets.aegis;
    const part = AEGIS_TURRET_PART[turret];
    const mount = tpl.muzzleMounts.find((m) => m.part === part);
    if (!mount) return;
    const clip = tpl.clips.get("attack") ?? tpl.clips.get("move");
    this.effects.flash(
      mount, tpl.rig, clip, aegisCaller(a), a.animMs,
      { x: a.x, z: a.z, altitude: 0, yaw: a.yaw }, tpl.bounds,
    );
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
      // Carry the structure level onto the build-grid model as pips (specs/economy.md).
      const tpl = s.kind === "solar-extractor"
        ? this.assets.structures.get("solar-extractor")
        : this.assets.spawners.get(s.kind);
      if (tpl) {
        const c = gridCellCenter(s.team, s.col, s.row);
        this.overlays.pips(c.x, tpl.dimensions[1] + MARKER_GAP, c.z, s.level, TEAM_COLORS[s.team].accent);
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
      // Destruction cue: flash the whole hull white a few times as it dies (specs/assets.md).
      actor.setFlash(a.dead ? flashAmount(a.deathMs) : 0);
      // Fog: a player Aegis is always shown; an enemy Aegis only while in vision.
      const visible = a.team === "player" || pointVisible(this.playerVision, a.x, a.z);
      actor.rig.root.visible = visible;
      if (visible && !a.dead && a.hp < a.maxHp) {
        const dims = this.assets.aegis.dimensions;
        this.overlays.healthBar(a.x, dims[1] + MARKER_GAP, a.z, a.hp / a.maxHp, Math.max(60, dims[0] * 0.8));
      }
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
    const enemyBaseVisible = pointVisible(this.playerVision, ENEMY_BASE.x, ENEMY_BASE.z);
    this.enemyBaseActor.rig.root.visible = enemyBaseVisible;
    const enemyRel = this.world.reliquaries.enemy;
    const enemyRelVisible =
      !enemyRel.dead && enemyRel.hp > 0 && pointVisible(this.playerVision, ENEMY_RELIQUARY.x, ENEMY_RELIQUARY.z);
    this.enemyReliquaryActor.rig.root.visible = enemyRelVisible;

    // Health bars over damaged bases / Reliquaries (specs/overview.md), fog-gated like the
    // models: the player's always draw when hurt; the enemy's only while currently in vision.
    const baseDims = this.assets.structures.get("base")?.dimensions;
    const relDims = this.assets.structures.get("reliquary")?.dimensions;
    const pb = this.world.bases.player, eb = this.world.bases.enemy;
    const pr = this.world.reliquaries.player, er = this.world.reliquaries.enemy;
    if (baseDims) {
      const w = Math.max(70, baseDims[0] * 0.8), top = baseDims[1] + MARKER_GAP;
      if (pb.hp < pb.maxHp) this.overlays.healthBar(pb.x, top, pb.z, pb.hp / pb.maxHp, w);
      if (enemyBaseVisible && eb.hp < eb.maxHp) this.overlays.healthBar(eb.x, top, eb.z, eb.hp / eb.maxHp, w);
    }
    if (relDims) {
      const w = Math.max(60, relDims[0] * 0.8), top = relDims[1] + MARKER_GAP;
      if (!pr.dead && pr.hp < pr.maxHp) this.overlays.healthBar(pr.x, top, pr.z, pr.hp / pr.maxHp, w);
      if (enemyRelVisible && er.hp < er.maxHp) this.overlays.healthBar(er.x, top, er.z, er.hp / er.maxHp, w);
    }
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
