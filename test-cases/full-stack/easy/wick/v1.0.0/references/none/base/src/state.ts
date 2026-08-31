// Wick — the game's state (specs/state.md).
//
// One value holds everything the specification is written against: the
// screen and its menu highlight, the run, the seven driver switches, the
// tick accumulator, the simulation time, the mute mirror, and the seeded
// generator's state. The idle run is what `title` and `howto` hold; a fresh
// run is the idle run with Taper in the first weapon slot.

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
  /** A pulsing zone's seconds until its next pulse. */
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
];

export interface WickState {
  screen: Screen;
  menuIndex: number;
  run: RunState;
  switches: Switches;
  /** Frame time waiting for the next whole tick; `0` off `playing`. */
  accumulator: number;
  /** Seconds of delta time every frame has added, whatever the screen. */
  simTime: number;
  muted: boolean;
  rngState: number;
}

/** The idle run `title` and `howto` hold. */
export function idleRun(): RunState {
  return {
    tick: 0,
    level: 1,
    xp: 0,
    kills: 0,
    player: { x: 0, y: 0, facing: "right", hp: BASE_MAX_HP },
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
  };
}

/** The title-screen state a reset restores, over `rngState`. */
export function initialState(rngState: number): WickState {
  return {
    screen: "title",
    menuIndex: 0,
    run: idleRun(),
    switches: allSwitchesOn(),
    accumulator: 0,
    simTime: 0,
    muted: false,
    rngState,
  };
}
