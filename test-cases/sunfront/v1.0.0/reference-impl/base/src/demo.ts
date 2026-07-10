/**
 * Sunfront — TEMPORARY Phase-3 proof scene.
 *
 * This is NOT the game (the simulation, waves, economy, fog, HUD, and AI arrive in
 * later phases). It exists only to exercise the renderer built in this phase: it
 * spreads a rank of several unit types across the corridor for both teams, places the
 * bases, Reliquaries, a few spawners and Solar Extractors, and a player Aegis, then
 * drives them through the low oblique command camera so we can confirm the models
 * render at correct RELATIVE scale (a Scarab is tiny, a Monolith towers, the Aegis
 * dwarfs everything), tint by team, animate, and toggle to wireframe. Later phases
 * replace this module with the real game loop.
 */

import type { LoadedAssets, RenderEntity, Team, UnitType } from "./types";
import type { World } from "./render/world";
import { SingletonActor } from "./render/singletons";
import {
  PLAYER_BASE, ENEMY_BASE, PLAYER_RELIQUARY, ENEMY_RELIQUARY,
} from "./constants";
import { fromDiagonal, facingYaw, advanceDir } from "./mathutil";
import { gridCellCenter } from "./render/terrain";

const YAW_PLAYER = facingYaw(advanceDir("player"));
const YAW_ENEMY = facingYaw(advanceDir("enemy"));

interface DemoUnit {
  id: number;
  type: UnitType;
  team: Team;
  x: number;
  z: number;
  altitude: number;
  yaw: number;
  role: string;
}

export class DemoScene {
  private readonly units: DemoUnit[] = [];
  private readonly typeById = new Map<number, UnitType>();
  private readonly singletons: SingletonActor[] = [];
  private clockMs = 0;
  private nextId = 1;

  constructor(
    private readonly world: World,
    assets: LoadedAssets,
  ) {
    this.spawnRoster(assets);
    this.placeStructures(assets);
  }

  /** A spread rank of one of every unit type per team, across the corridor width. */
  private spawnRoster(assets: LoadedAssets): void {
    const types = [...assets.units.keys()];
    const spread = (n: number, i: number) => (n === 1 ? 0 : (i / (n - 1) - 0.5) * 440);

    types.forEach((type, i) => {
      const off = spread(types.length, i);
      // Player rank, marching toward the enemy corner.
      this.addUnit(type, "player", 300, off, "move");
      // Enemy rank further down the lane, marching back.
      this.addUnit(type, "enemy", 560, off, "move");
    });

    // The Aegis — the comeback guardian — off to one flank to show it dwarfs the roster.
    this.singletons.push(
      new SingletonActor(this.world.scene, assets.aegis, "player", this.world.registry)
        .place(...ground(240, 250), YAW_PLAYER)
        .setRole("move"),
    );
  }

  private addUnit(type: UnitType, team: Team, along: number, off: number, role: string): void {
    const p = fromDiagonal(along, off);
    const id = this.nextId++;
    const altitude = type === "sunhawk" ? 55 : 0;
    const yaw = team === "player" ? YAW_PLAYER : YAW_ENEMY;
    this.units.push({ id, type, team, x: p.x, z: p.z, altitude, yaw, role });
    this.typeById.set(id, type);
  }

  /** Bases, Reliquaries, and a few build-grid structures (specs/playfield.md). */
  private placeStructures(assets: LoadedAssets): void {
    const base = assets.structures.get("base")!;
    const reliquary = assets.structures.get("reliquary")!;
    const extractor = assets.structures.get("solar-extractor")!;

    this.singletons.push(
      new SingletonActor(this.world.scene, base, "player", this.world.registry)
        .place(PLAYER_BASE.x, PLAYER_BASE.z, YAW_PLAYER).setRole("idle"),
      new SingletonActor(this.world.scene, base, "enemy", this.world.registry)
        .place(ENEMY_BASE.x, ENEMY_BASE.z, YAW_ENEMY).setRole("idle"),
      new SingletonActor(this.world.scene, reliquary, "neutral", this.world.registry)
        .place(PLAYER_RELIQUARY.x, PLAYER_RELIQUARY.z, YAW_PLAYER).setRole("idle"),
      new SingletonActor(this.world.scene, reliquary, "neutral", this.world.registry)
        .place(ENEMY_RELIQUARY.x, ENEMY_RELIQUARY.z, YAW_ENEMY).setRole("idle"),
    );

    // A few spawners + Solar Extractors on the player's build grid.
    const onGrid = (tpl: typeof extractor, col: number, row: number) => {
      const c = gridCellCenter("player", col, row);
      this.singletons.push(
        new SingletonActor(this.world.scene, tpl, "player", this.world.registry)
          .place(c.x, c.z, YAW_PLAYER).setRole("idle"),
      );
    };
    onGrid(extractor, 0, 0);
    onGrid(extractor, 1, 0);
    const spawnerFor = (t: UnitType) => assets.spawners.get(t)!;
    onGrid(spawnerFor("scarab"), 3, 0);
    onGrid(spawnerFor("sentinel"), 4, 0);
    onGrid(spawnerFor("monolith"), 6, 1);
    onGrid(spawnerFor("bombard"), 5, 2);
  }

  /** Advance animations and push this frame's render state to the world. */
  update(dtSeconds: number): void {
    this.clockMs += dtSeconds * 1000;
    const entities: RenderEntity[] = this.units.map((u) => ({
      id: u.id,
      team: u.team,
      x: u.x,
      z: u.z,
      altitude: u.altitude,
      yaw: u.yaw,
      animMs: this.clockMs,
      role: u.role,
    }));
    this.world.syncUnits(entities, (e) => this.typeById.get(e.id)!);
    for (const s of this.singletons) s.update(dtSeconds);
  }
}

/** Ground point from (along, off) as a tuple for `SingletonActor.place`. */
function ground(along: number, off: number): [number, number] {
  const p = fromDiagonal(along, off);
  return [p.x, p.z];
}
