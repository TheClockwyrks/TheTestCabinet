// Wick — the game's state (specs/state.md), and the accessor every module
// reaches it through.
//
// `WickState` is the world's game state: the game mode names it as
// `gameStateClass`, the engine constructs it with no arguments when the world
// is built, and the one instance lives for the whole session. The framework's
// states are live objects, so every field is a plain mutable value and a tick
// writes the fields it advances in place. Each initializer is the field's
// title-screen value, the same value `reset` restores.
//
// The declared fields are the whole of the authoritative state. The few
// fields beyond the declaration carry presentation alone: the tick a shape or
// a puff appeared on, a lantern's angle and orbit, a puddle's pulse timer, the
// value a cooldown timer was last set with, and the lamplighter's walk count.
// Each is rebuilt from the declared fields by the tick that reads it, and a
// reset clears them with the rest.
//
// The class lives here, at a leaf of the module graph, so the actors, the
// controller, the audio, and the debug surface reach it without importing
// `src/game.ts`, which imports all of them. `src/game.ts` re-exports every
// declared name as the module contract asks.

import { GameState } from "@clockwyrks/structured-2d";
import type { World } from "@clockwyrks/structured-2d";
import type {
  EnemyId,
  GemTier,
  OfferId,
  PassiveId,
  PickupKind,
  WeaponId,
} from "./constants";
import { BASE_MAX_HP } from "./constants";

export type { EnemyId, GemTier, OfferId, PassiveId, PickupKind, WeaponId };

export type Screen =
  | "title"
  | "howto"
  | "almanac"
  | "playing"
  | "levelup"
  | "chest"
  | "paused"
  | "fallen"
  | "dawn";

export type Facing = "left" | "right";

export type ZoneKind =
  "puddle" | "lantern" | "aura" | "slash" | "strike" | "burst";

/** What `setNextDrop` poses for the next common kill's roll. */
export type NextDrop = "bread" | "draft" | "none";

export const NEXT_DROPS: readonly NextDrop[] = ["bread", "draft", "none"];

export type ChestResult =
  | { kind: "evolve"; weapon: WeaponId }
  | { kind: "level"; item: WeaponId | PassiveId; level: number }
  | { kind: "heal" };

export interface PlayerState {
  x: number;
  y: number;
  facing: Facing;
  hp: number;
}

export interface WeaponSlot {
  id: WeaponId;
  level: number;
  /** The weapon's cooldown timer: the seconds until it next fires. */
  cooldown: number;
  /** The value the timer was last set with, for the HUD's cooldown fill. */
  cooldownSet: number;
}

export interface PassiveSlot {
  id: PassiveId;
  level: number;
}

export interface EnemyState {
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

export interface EnemyHit {
  enemy: number;
  cooldown: number;
}

export interface ProjectileState {
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
  hits: EnemyHit[];
  /** The tick it was created on, for the effect drawn over it. */
  bornTick: number;
}

export interface ZoneState {
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
  hits: EnemyHit[];
  /** The tick it was created on, for the effect drawn over it. */
  bornTick: number;
  /** A lantern's angle on its orbit, in degrees. */
  angle?: number;
  /** A lantern's orbit radius about the lamplighter. */
  orbit?: number;
  /** A puddle's seconds until its next pulse. */
  pulse?: number;
}

export interface GemState {
  id: number;
  tier: GemTier;
  x: number;
  y: number;
  attracted: boolean;
  /** The tick it was dropped on; a drop rests for that tick. */
  bornTick: number;
}

export interface PickupState {
  id: number;
  kind: PickupKind;
  x: number;
  y: number;
}

/** A death puff still being drawn: a picture, damaging nothing. */
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
  player: PlayerState;
  /** Seconds left of the lamplighter's hurt flash. */
  hurtFlash: number;
  weapons: WeaponSlot[];
  passives: PassiveSlot[];
  enemies: EnemyState[];
  projectiles: ProjectileState[];
  zones: ZoneState[];
  gems: GemState[];
  pickups: PickupState[];
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

/** The four movement actions as held values, `1` while down. */
export interface Held {
  up: number;
  down: number;
  left: number;
  right: number;
}

export const NOTHING_HELD: Readonly<Held> = {
  up: 0,
  down: 0,
  left: 0,
  right: 0,
};

/** The seven driver switches, by the name the snapshot reports each under. */
export type SwitchName =
  | "spawning"
  | "events"
  | "despawning"
  | "enemyMotion"
  | "enemyContact"
  | "weaponFire"
  | "effectMotion"
  | "drops"
  | "progression";

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

export class WickState extends GameState {
  screen: Screen = "title";
  menuIndex = 0;
  /** The index into `ALMANAC_TABS` of the tab the almanac is showing. */
  almanacTab = 0;
  /** The index of the first entry row the almanac's list shows. */
  almanacScroll = 0;
  run: RunState = idleRun();
  /** Frame time waiting for the next whole tick; `0` off `playing`. */
  accumulator = 0;
  /** Seconds of delta time every frame has added, whatever the screen. */
  simTime = 0;
  /** The game's readable copy of the engine's mute bit. */
  muted = false;
  spawning = true;
  events = true;
  despawning = true;
  enemyMotion = true;
  enemyContact = true;
  weaponFire = true;
  effectMotion = true;
  drops = true;
  progression = true;
  /**
   * The movement actions as the current frame read them, written by the
   * player controller and read by every tick the frame runs. Rebuilt every
   * frame, so it is nothing a reset has to keep.
   */
  held: Held = { ...NOTHING_HELD };
}

/**
 * Restore every declared field to its title-screen value. `muted` stays as it
 * is, since the engine owns it.
 */
export function resetState(state: WickState): void {
  state.screen = "title";
  state.menuIndex = 0;
  state.almanacTab = 0;
  state.almanacScroll = 0;
  state.run = idleRun();
  state.accumulator = 0;
  state.simTime = 0;
  for (const name of SWITCH_NAMES) state[name] = true;
  state.held = { ...NOTHING_HELD };
}

/** A state at its title-screen values, for code with no world. */
export function initialState(): WickState {
  const state = new WickState();
  resetState(state);
  return state;
}

/**
 * The open world's state, as the state it is: the mode names `WickState` as
 * its `gameStateClass`, so this holds of the one world the game opens, and
 * the check turns a wrong wiring into a named error rather than a silent
 * cast.
 */
export function wickState(world: World): WickState {
  const state = world.state;
  if (!(state instanceof WickState)) {
    throw new Error("Wick: the open world does not hold a WickState");
  }
  return state;
}
