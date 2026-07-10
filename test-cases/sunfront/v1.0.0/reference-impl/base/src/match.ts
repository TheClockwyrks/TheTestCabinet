/**
 * Sunfront — the match driver: the headless {@link World} wired to the 3D renderer.
 *
 * This is the seam between the simulation (`sim/world.ts`, no THREE) and the renderer
 * (`render/*`, no game rules). Each frame it steps the World with real `dt`, then hands
 * the renderer a flat {@link RenderEntity} list for the GPU-instanced roster and drives
 * a `VoxelRig` singleton for each base, Reliquary, build structure, and Aegis. The
 * renderer reads only this handoff; it never touches simulation state.
 *
 * Phase 4 has no player building UI (phase 6) and no AI opponent (phase 5) yet, so the
 * driver SEEDS both sides with a mirrored spawner loadout and fires an opening wave, so
 * units actually spawn, march, fight, and die on screen and the front line drifts. That
 * seed is TEMPORARY: phase 5 gives the enemy a real economy/AI and phase 6 gives the
 * player the build palette; both replace `seedDemoArmies` with live control of `World`.
 */

import type { LoadedAssets, RenderEntity, UnitType } from "./types";
import type { World, SimAegis, BuildStructure } from "./sim/world";
import { World as SimWorld } from "./sim/world";
import { SingletonActor } from "./render/singletons";
import type { World as RenderWorld } from "./render/world";
import {
  PLAYER_BASE, ENEMY_BASE, PLAYER_RELIQUARY, ENEMY_RELIQUARY, START_SOL,
} from "./constants";
import { facingYaw, advanceDir } from "./mathutil";
import { gridCellCenter } from "./render/terrain";

/** How long a destroyed entity flashes; mirrors the sim's cull window. */
const DEATH_FLASH_MS = 450;

/** A TEMPORARY mirrored loadout so both sides field an army in phase 4. */
const DEMO_LOADOUT: readonly UnitType[] = [
  "scarab", "trooper", "sentinel", "bulwark", "lancer", "flakhound", "sunhawk", "bombard",
];

export class Match {
  readonly world: World = new SimWorld();

  private readonly typeById = new Map<number, UnitType>();
  private readonly aegisActors = new Map<number, SingletonActor>();
  private readonly structureActors = new Map<number, SingletonActor>();
  private readonly fixedActors: SingletonActor[] = [];

  constructor(
    private readonly render: RenderWorld,
    private readonly assets: LoadedAssets,
  ) {
    this.placeFixed();
    this.seedDemoArmies();
  }

  /** Bases and Reliquaries — pre-placed, permanent singletons (specs/playfield.md). */
  private placeFixed(): void {
    const base = this.assets.structures.get("base")!;
    const reliquary = this.assets.structures.get("reliquary")!;
    const yawP = facingYaw(advanceDir("player"));
    const yawE = facingYaw(advanceDir("enemy"));
    this.fixedActors.push(
      new SingletonActor(this.render.scene, base, "player", this.render.registry)
        .place(PLAYER_BASE.x, PLAYER_BASE.z, yawP).setRole("idle"),
      new SingletonActor(this.render.scene, base, "enemy", this.render.registry)
        .place(ENEMY_BASE.x, ENEMY_BASE.z, yawE).setRole("idle"),
      new SingletonActor(this.render.scene, reliquary, "neutral", this.render.registry)
        .place(PLAYER_RELIQUARY.x, PLAYER_RELIQUARY.z, yawP).setRole("idle"),
      new SingletonActor(this.render.scene, reliquary, "neutral", this.render.registry)
        .place(ENEMY_RELIQUARY.x, ENEMY_RELIQUARY.z, yawE).setRole("idle"),
    );
  }

  /** TEMPORARY: give both sides a mirrored spawner set and fire an opening wave. */
  private seedDemoArmies(): void {
    const w = this.world;
    // Top up so the seed can place regardless of the 200-sol opening (phase-4 only).
    w.sol.player = 1e6;
    w.sol.enemy = 1e6;
    for (const team of ["player", "enemy"] as const) {
      DEMO_LOADOUT.forEach((type, i) => w.place(team, type, i, 0));
      w.place(team, "solar-extractor", 0, 1);
    }
    w.sol.player = START_SOL;
    w.sol.enemy = START_SOL;
    // Stamp an opening wave so the field is populated immediately, and quicken the
    // demo cadence a little so the fight is visible without a 20-second wait.
    w.fireWave();
    w.waveTimer = 12;
  }

  /** Step the sim and push this frame's render state to the world. */
  update(dtSeconds: number): void {
    this.world.step(dtSeconds);
    this.syncUnits();
    this.syncStructures();
    this.syncAegis(dtSeconds);
    for (const a of this.fixedActors) a.update(dtSeconds);
  }

  /** Build the instanced-unit render list from the live roster. */
  private syncUnits(): void {
    this.typeById.clear();
    const entities: RenderEntity[] = [];
    for (const u of this.world.units) {
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

  /** Create/place/remove a singleton per build-grid structure (spawner/extractor). */
  private syncStructures(): void {
    const live = new Set<number>();
    for (const s of this.world.structures) {
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
    }
    for (const [id, actor] of this.aegisActors) {
      if (!live.has(id)) {
        actor.dispose();
        this.aegisActors.delete(id);
      }
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
