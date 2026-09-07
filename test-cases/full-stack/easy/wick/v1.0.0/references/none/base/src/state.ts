// Wick — the game's state (specs/state.md).
//
// One value holds everything the specification is written against: the
// screen with its menu highlight and the almanac's two indices, the run, the
// nine driver switches, the tick accumulator, the simulation time, and the
// mute mirror. The idle run is what `title`, `howto`, and `almanac` hold; a
// fresh run is the idle run with Taper in the first weapon slot.

import {
  BASE_MAX_HP,
  type EnemyId,
  type Facing,
  type GemTier,
  type OfferId,
  type PassiveId,
  type PickupKind,
  type Screen,
  type WeaponId,
  type ZoneKind,
} from "./constants";

/** What `setNextDrop` poses for the next common kill's roll. */
export type NextDrop = "bread" | "draft" | "none";

export const NEXT_DROPS: readonly NextDrop[] = ["bread", "draft", "none"];

export interface HeldWeapon {
  id: WeaponId;
  level: number;
  /** Seconds until the weapon next fires. */
  cooldown: number;
  /** The value the timer was last set with, for the HUD's cooldown fill. */
  cooldownSet: number;
}

export interface HeldPassive {
  id: PassiveId;
  level: number;
}

export interface Player {
  x: number;
  y: number;
  facing: Facing;
  hp: number;
}

export interface Enemy {
  id: number;
  type: EnemyId;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  heading: { x: number; y: number };
  age: number;
  contactCooldown: number;
}

export interface HitEntry {
  enemy: number;
  cooldown: number;
}

export interface Projectile {
  id: number;
  weapon: WeaponId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  ax: number;
  ay: number;
  radius: number;
  damage: number;
  ttl: number;
  pierce: number;
  hits: HitEntry[];
  /** The tick it was created on, for the effect drawn over it. */
  bornTick: number;
}

export interface Zone {
  id: number;
  weapon: WeaponId;
  kind: ZoneKind;
  x: number;
  y: number;
  radius: number;
  width?: number;
  height?: number;
  damage: number;
  /** Seconds left, or `null` for a zone that never expires. */
  ttl: number | null;
  hits: HitEntry[];
  /** The tick it was created on, for the effect drawn over it. */
  bornTick: number;
  /** A lantern's angle on its orbit, in degrees. */
  angle?: number;
  /** A lantern's orbit radius about the lamplighter. */
  orbit?: number;
  /** A puddle's seconds until its next pulse. */
  pulse?: number;
}

export interface Gem {
  id: number;
  tier: GemTier;
  x: number;
  y: number;
  attracted: boolean;
  /** The tick it was dropped on; a drop rests for that tick. */
  bornTick: number;
}

export interface Pickup {
  id: number;
  kind: PickupKind;
  x: number;
  y: number;
}

export type ChestResult =
  | { kind: "evolve"; weapon: WeaponId }
  | { kind: "level"; item: WeaponId | PassiveId; level: number }
  | { kind: "heal" };

export interface Puff {
  x: number;
  y: number;
  /** The tick the enemy died on. */
  bornTick: number;
}

export interface RunState {
  tick: number;
  level: number;
  xp: number;
  kills: number;
  player: Player;
  /** Seconds left of the lamplighter's hurt flash. */
  hurtFlash: number;
  weapons: HeldWeapon[];
  passives: HeldPassive[];
  enemies: Enemy[];
  projectiles: Projectile[];
  zones: Zone[];
  gems: Gem[];
  pickups: Pickup[];
  offers: OfferId[];
  nextOffers: OfferId[] | null;
  pendingLevelUps: number;
  chestResult: ChestResult | null;
  spawnTimer: number;
  /** Run-clock seconds of the scripted events that have fired, ascending. */
  firedEvents: number[];
  nextId: number;
  /** The posed outcomes of specs/instrumentation.md, `null` while none is posed. */
  nextSpawnAngle: number | null;
  nextSwarmAngle: number | null;
  nextSpawnType: EnemyId | null;
  nextPuddleOffset: { x: number; y: number } | null;
  nextStrikeTarget: number | null;
  nextChestItem: WeaponId | PassiveId | null;
  nextDrop: NextDrop | null;
  /** Ticks on which the lamplighter moved, for the walk cycle. */
  movedTicks: number;
  /** Whether the lamplighter moved on the last tick. */
  moving: boolean;
  /** Death puffs still being drawn. */
  puffs: Puff[];
}

export interface Switches {
  spawning: boolean;
  events: boolean;
  despawning: boolean;
  enemyMotion: boolean;
  enemyContact: boolean;
  weaponFire: boolean;
  effectMotion: boolean;
  drops: boolean;
  progression: boolean;
}

export type SwitchName = keyof Switches;

export const SWITCH_NAMES: readonly SwitchName[] = [
  "spawning",
  "events",
  "despawning",
  "enemyMotion",
  "enemyContact",
  "weaponFire",
  "effectMotion",
  "drops",
  "progression",
];

export interface WickState {
  screen: Screen;
  menuIndex: number;
  /** The index into `ALMANAC_TABS` of the tab the almanac shows. */
  almanacTab: number;
  /** The index of the first entry row the almanac's list shows. */
  almanacScroll: number;
  run: RunState;
  switches: Switches;
  /** Frame time waiting for the next whole tick; `0` off `playing`. */
  accumulator: number;
  /** Seconds of delta time every frame has added, whatever the screen. */
  simTime: number;
  muted: boolean;
}

/** The idle run `title`, `howto`, and `almanac` hold. */
export function idleRun(): RunState {
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
    nextSpawnType: null,
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
export function freshRun(): RunState {
  const run = idleRun();
  run.weapons.push({ id: "taper", level: 1, cooldown: 0, cooldownSet: 0 });
  return run;
}

/** Every driver switch on, which is how the game is played. */
export function allSwitchesOn(): Switches {
  return {
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

/** The title-screen state a reset restores. */
export function initialState(): WickState {
  return {
    screen: "title",
    menuIndex: 0,
    almanacTab: 0,
    almanacScroll: 0,
    run: idleRun(),
    switches: allSwitchesOn(),
    accumulator: 0,
    simTime: 0,
    muted: false,
  };
}
