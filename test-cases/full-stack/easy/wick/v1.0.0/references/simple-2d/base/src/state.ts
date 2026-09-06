// Wick — the state as a value, and the draft a transition works over
// (specs/state.md).
//
// The engine holds `WickState` read-only and replaces it with what each
// transition returns. A transition, `update` or a pose of the debug surface,
// clones the current state into a mutable `Draft`, runs the game over it,
// and returns it; the view it was handed is never written. The idle run is
// what `title`, `howto`, and `almanac` hold, and a fresh run is the idle run
// with Taper in the first weapon slot.

import type { DeepReadonly, DeepWritable } from "ts-essentials";
import { BASE_MAX_HP } from "./constants";
import type {
  EnemyState,
  EnemyHit,
  GemState,
  PassiveSlot,
  PickupState,
  PlayerState,
  ProjectileState,
  Puff,
  RunState,
  WeaponSlot,
  WickState,
  ZoneState,
} from "./game";

/** The whole state, writable: what a transition builds and returns. */
export type Draft = DeepWritable<WickState>;
export type DraftRun = DeepWritable<RunState>;
export type Player = DeepWritable<PlayerState>;
export type HeldWeapon = DeepWritable<WeaponSlot>;
export type HeldPassive = DeepWritable<PassiveSlot>;
export type Enemy = DeepWritable<EnemyState>;
export type HitEntry = DeepWritable<EnemyHit>;
export type Projectile = DeepWritable<ProjectileState>;
export type Zone = DeepWritable<ZoneState>;
export type Gem = DeepWritable<GemState>;
export type Pickup = DeepWritable<PickupState>;

/** The nine driver switches, by the field each lives under. */
export const SWITCH_NAMES = [
  "spawning",
  "events",
  "despawning",
  "enemyMotion",
  "enemyContact",
  "weaponFire",
  "effectMotion",
  "drops",
  "progression",
] as const;

export type SwitchName = (typeof SWITCH_NAMES)[number];

/** The idle run `title`, `howto`, and `almanac` hold. */
export function idleRun(): DraftRun {
  return {
    tick: 0,
    level: 1,
    xp: 0,
    kills: 0,
    player: { x: 0, y: 0, facing: "right", hp: BASE_MAX_HP },
    hurtFlash: 0,
    weapons: [],
    passives: [],
    enemies: [],
    projectiles: [],
    zones: [],
    gems: [],
    pickups: [],
    offers: [],
    nextOffers: null,
    pendingLevelUps: 0,
    chestResult: null,
    spawnTimer: 0,
    firedEvents: [],
    nextId: 0,
    nextSpawnAngle: null,
    nextSwarmAngle: null,
    nextPuddleOffset: null,
    nextStrikeTarget: null,
    nextChestItem: null,
    nextDrop: null,
    movedTicks: 0,
    moving: false,
    puffs: [],
  };
}

/** A fresh run: the idle run with Taper at level `1`, ready to fire. */
export function freshRun(): DraftRun {
  const run = idleRun();
  run.weapons.push({ id: "taper", level: 1, cooldown: 0, cooldownSet: 0 });
  return run;
}

/**
 * The title-screen state: the idle run, the highlight, the almanac's tab and
 * its window, the accumulator, and `simTime` all at `0`, every driver switch
 * on, and unmuted.
 */
export function initialState(): Draft {
  return {
    screen: "title",
    menuIndex: 0,
    almanacTab: 0,
    almanacScroll: 0,
    run: idleRun(),
    accumulator: 0,
    simTime: 0,
    muted: false,
    spawning: true,
    events: true,
    despawning: true,
    enemyMotion: true,
    enemyContact: true,
    weaponFire: true,
    effectMotion: true,
    drops: true,
    progression: true,
  };
}

function cloneHits(hits: readonly EnemyHit[]): HitEntry[] {
  return hits.map((hit) => ({ enemy: hit.enemy, cooldown: hit.cooldown }));
}

function cloneZone(zone: DeepReadonly<ZoneState>): Zone {
  const copy: Zone = {
    id: zone.id,
    weapon: zone.weapon,
    kind: zone.kind,
    x: zone.x,
    y: zone.y,
    radius: zone.radius,
    damage: zone.damage,
    ttl: zone.ttl,
    hits: cloneHits(zone.hits),
    bornTick: zone.bornTick,
  };
  if (zone.width !== undefined) copy.width = zone.width;
  if (zone.height !== undefined) copy.height = zone.height;
  if (zone.angle !== undefined) copy.angle = zone.angle;
  if (zone.orbit !== undefined) copy.orbit = zone.orbit;
  if (zone.pulse !== undefined) copy.pulse = zone.pulse;
  return copy;
}

function cloneRun(run: DeepReadonly<RunState>): DraftRun {
  return {
    tick: run.tick,
    level: run.level,
    xp: run.xp,
    kills: run.kills,
    player: { ...run.player },
    hurtFlash: run.hurtFlash,
    weapons: run.weapons.map((weapon) => ({ ...weapon })),
    passives: run.passives.map((passive) => ({ ...passive })),
    enemies: run.enemies.map((enemy) => ({
      ...enemy,
      heading: { x: enemy.heading.x, y: enemy.heading.y },
    })),
    projectiles: run.projectiles.map((projectile) => ({
      ...projectile,
      hits: cloneHits(projectile.hits),
    })),
    zones: run.zones.map(cloneZone),
    gems: run.gems.map((gem) => ({ ...gem })),
    pickups: run.pickups.map((pickup) => ({ ...pickup })),
    offers: [...run.offers],
    nextOffers: run.nextOffers === null ? null : [...run.nextOffers],
    pendingLevelUps: run.pendingLevelUps,
    chestResult: run.chestResult === null ? null : { ...run.chestResult },
    spawnTimer: run.spawnTimer,
    firedEvents: [...run.firedEvents],
    nextId: run.nextId,
    nextSpawnAngle: run.nextSpawnAngle,
    nextSwarmAngle: run.nextSwarmAngle,
    nextPuddleOffset:
      run.nextPuddleOffset === null ? null : { ...run.nextPuddleOffset },
    nextStrikeTarget: run.nextStrikeTarget,
    nextChestItem: run.nextChestItem,
    nextDrop: run.nextDrop,
    movedTicks: run.movedTicks,
    moving: run.moving,
    puffs: run.puffs.map((puff: DeepReadonly<Puff>) => ({ ...puff })),
  };
}

/** A writable copy of `view`, sharing nothing with it. */
export function cloneState(view: DeepReadonly<WickState>): Draft {
  return {
    screen: view.screen,
    menuIndex: view.menuIndex,
    almanacTab: view.almanacTab,
    almanacScroll: view.almanacScroll,
    run: cloneRun(view.run),
    accumulator: view.accumulator,
    simTime: view.simTime,
    muted: view.muted,
    spawning: view.spawning,
    events: view.events,
    despawning: view.despawning,
    enemyMotion: view.enemyMotion,
    enemyContact: view.enemyContact,
    weaponFire: view.weaponFire,
    effectMotion: view.effectMotion,
    drops: view.drops,
    progression: view.progression,
  };
}
