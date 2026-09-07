// Wick — the game: the state contract, the debug surface's type, and the
// three functions the engine drives.
//
// `WickState` is written exactly as `specs/state.md` declares it, and
// `WickDebugApi` exactly as `specs/instrumentation.md` fixes it. The engine
// holds the state by value and replaces it with what each `update` returns,
// so every field is `readonly`: a frame clones the current state into a
// mutable draft (`src/state.ts`), runs the simulation over the draft, and
// returns it. The simulation is `src/sim/`, the screens and the accumulator
// are `src/flow.ts`, the surface is `src/debug.ts`, and the drawing is
// `src/render/`; this file is where the engine meets them.

import type {
  Game,
  InitApi,
  RenderApi,
  UpdateApi,
} from "@clockwyrks/simple-2d";
import type { DeepReadonly } from "ts-essentials";
import type {
  EnemyId,
  GemTier,
  OfferId,
  PassiveId,
  PickupKind,
  WeaponId,
} from "./constants";
import { loadSprites } from "./assets";
import { defineCues, syncLoops } from "./audio";
import { createDebugApi } from "./debug";
import { registerDiagnostics } from "./diagnostics";
import { resetGesture, runFrame } from "./flow";
import {
  pressedActions,
  readHeld,
  readPointer,
  registerActions,
  resetPointer,
} from "./input";
import { renderGame } from "./render/render";
import { COLORS } from "./render/theme";
import { initialState } from "./state";

export type { EnemyId, GemTier, OfferId, PassiveId, PickupKind, WeaponId };

// ---- The state, as specs/state.md declares it ---------------------------

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
  | "puddle"
  | "lantern"
  | "aura"
  | "slash"
  | "strike"
  | "burst";

export type ChestResult =
  | { readonly kind: "evolve"; readonly weapon: WeaponId }
  | {
      readonly kind: "level";
      readonly item: WeaponId | PassiveId;
      readonly level: number;
    }
  | { readonly kind: "heal" };

export interface PlayerState {
  readonly x: number;
  readonly y: number;
  readonly facing: Facing;
  readonly hp: number;
}

export interface WeaponSlot {
  readonly id: WeaponId;
  readonly level: number;
  readonly cooldown: number;
  /**
   * Presentation, added by this build: the value the timer was last set
   * with, so the HUD can draw the cooldown as a fraction. Rebuilt on every
   * firing and cleared by a reset.
   */
  readonly cooldownSet: number;
}

export interface PassiveSlot {
  readonly id: PassiveId;
  readonly level: number;
}

export interface EnemyState {
  readonly id: number;
  readonly type: EnemyId;
  readonly x: number;
  readonly y: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly heading: { readonly x: number; readonly y: number };
  readonly age: number;
  readonly contactCooldown: number;
}

export interface EnemyHit {
  readonly enemy: number;
  readonly cooldown: number;
}

export interface ProjectileState {
  readonly id: number;
  readonly weapon: WeaponId;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly ax: number;
  readonly ay: number;
  readonly radius: number;
  readonly damage: number;
  readonly ttl: number;
  readonly pierce: number;
  readonly hits: readonly EnemyHit[];
  /** Added by this build: the tick it was created on, for its effect's frame. */
  readonly bornTick: number;
}

export interface ZoneState {
  readonly id: number;
  readonly weapon: WeaponId;
  readonly kind: ZoneKind;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly width?: number;
  readonly height?: number;
  readonly damage: number;
  readonly ttl: number | null;
  readonly hits: readonly EnemyHit[];
  /** Added by this build: the tick it was created on, for its effect's frame. */
  readonly bornTick: number;
  /** Added by this build: a lantern's angle on its orbit, in degrees. */
  readonly angle?: number;
  /** Added by this build: a lantern's orbit radius about the lamplighter. */
  readonly orbit?: number;
  /** Added by this build: a puddle's seconds until its next pulse. */
  readonly pulse?: number;
}

export interface GemState {
  readonly id: number;
  readonly tier: GemTier;
  readonly x: number;
  readonly y: number;
  readonly attracted: boolean;
  /** Added by this build: the tick it dropped on; a drop rests for that tick. */
  readonly bornTick: number;
}

export interface PickupState {
  readonly id: number;
  readonly kind: PickupKind;
  readonly x: number;
  readonly y: number;
}

/** Presentation, added by this build: a death puff still being drawn. */
export interface Puff {
  readonly x: number;
  readonly y: number;
  /** The tick the enemy died on. */
  readonly bornTick: number;
}

export interface RunState {
  readonly tick: number;
  readonly level: number;
  readonly xp: number;
  readonly kills: number;
  readonly player: PlayerState;
  readonly hurtFlash: number;
  readonly weapons: readonly WeaponSlot[];
  readonly passives: readonly PassiveSlot[];
  readonly enemies: readonly EnemyState[];
  readonly projectiles: readonly ProjectileState[];
  readonly zones: readonly ZoneState[];
  readonly gems: readonly GemState[];
  readonly pickups: readonly PickupState[];
  readonly offers: readonly OfferId[];
  readonly nextOffers: readonly OfferId[] | null;
  readonly pendingLevelUps: number;
  readonly chestResult: ChestResult | null;
  readonly spawnTimer: number;
  readonly firedEvents: readonly number[];
  readonly nextId: number;
  /** The posed outcomes of specs/instrumentation.md, `null` while none is posed. */
  readonly nextSpawnAngle: number | null;
  readonly nextSwarmAngle: number | null;
  readonly nextSpawnType: EnemyId | null;
  readonly nextPuddleOffset: { readonly x: number; readonly y: number } | null;
  readonly nextStrikeTarget: number | null;
  readonly nextChestItem: WeaponId | PassiveId | null;
  readonly nextDrop: NextDrop | null;
  /** Added by this build: ticks on which the lamplighter moved, for the walk. */
  readonly movedTicks: number;
  /** Added by this build: whether the lamplighter moved on the last tick. */
  readonly moving: boolean;
  /** Added by this build: the death puffs still being drawn. */
  readonly puffs: readonly Puff[];
}

export interface WickState {
  readonly screen: Screen;
  readonly menuIndex: number;
  readonly almanacTab: number;
  readonly almanacScroll: number;
  readonly run: RunState;
  readonly accumulator: number;
  readonly simTime: number;
  readonly muted: boolean;
  readonly spawning: boolean;
  readonly events: boolean;
  readonly despawning: boolean;
  readonly enemyMotion: boolean;
  readonly enemyContact: boolean;
  readonly weaponFire: boolean;
  readonly effectMotion: boolean;
  readonly drops: boolean;
  readonly progression: boolean;
}

// ---- The debug surface, as specs/instrumentation.md fixes it -------------

/** What `snapshot` returns, field for field the shape the specification gives. */
export interface WickSnapshot {
  version: number;
  screen: Screen;
  menuIndex: number;
  almanacTab: number;
  almanacScroll: number;
  spawning: boolean;
  events: boolean;
  despawning: boolean;
  enemyMotion: boolean;
  enemyContact: boolean;
  weaponFire: boolean;
  effectMotion: boolean;
  drops: boolean;
  progression: boolean;
  run: {
    tick: number;
    time: number;
    level: number;
    xp: number;
    xpToNext: number;
    kills: number;
    player: { x: number; y: number; facing: Facing; hp: number };
    hurtFlash: number;
    maxHp: number;
    armor: number;
    moveSpeed: number;
    pickupRadius: number;
    weapons: { id: string; level: number; cooldown: number }[];
    passives: { id: string; level: number }[];
    enemies: {
      id: number;
      type: string;
      x: number;
      y: number;
      hp: number;
      maxHp: number;
      heading: { x: number; y: number };
      age: number;
      contactCooldown: number;
    }[];
    projectiles: {
      id: number;
      weapon: string;
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
      hits: { enemy: number; cooldown: number }[];
    }[];
    zones: {
      id: number;
      weapon: string;
      kind: string;
      x: number;
      y: number;
      radius: number;
      width?: number;
      height?: number;
      damage: number;
      ttl: number | null;
      hits: { enemy: number; cooldown: number }[];
    }[];
    gems: {
      id: number;
      tier: string;
      x: number;
      y: number;
      attracted: boolean;
    }[];
    pickups: { id: number; kind: string; x: number; y: number }[];
    offers: string[];
    pool: string[];
    nextOffers: string[] | null;
    pendingLevelUps: number;
    chestResult:
      | { kind: "evolve"; weapon: string }
      | { kind: "level"; item: string; level: number }
      | { kind: "heal" }
      | null;
    spawnTimer: number;
    spawnWindow: number;
    firedEvents: number[];
    aliveCommons: number;
    nextId: number;
    nextSpawnAngle: number | null;
    nextSwarmAngle: number | null;
    nextSpawnType: string | null;
    nextPuddleOffset: { x: number; y: number } | null;
    nextStrikeTarget: number | null;
    nextChestItem: string | null;
    nextDrop: NextDrop | null;
  };
  muted: boolean;
  accumulator: number;
  simTime: number;
}

/** What `setNextDrop` poses for the next common kill's roll. */
export type NextDrop = "bread" | "draft" | "none";

/** A rectangle on the stage, as `menuRects` and `tabRects` report one. */
export interface WickRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface WickDebugApi {
  readonly version: number;
  reset(state: DeepReadonly<WickState>): WickState;
  snapshot(state: DeepReadonly<WickState>): WickSnapshot;
  menuRects(state: DeepReadonly<WickState>): readonly WickRect[];
  tabRects(state: DeepReadonly<WickState>): readonly WickRect[];
  setScreen(state: DeepReadonly<WickState>, name: Screen): WickState;
  choose(state: DeepReadonly<WickState>, index: number): WickState;
  setSpawning(state: DeepReadonly<WickState>, on: boolean): WickState;
  setEvents(state: DeepReadonly<WickState>, on: boolean): WickState;
  setDespawning(state: DeepReadonly<WickState>, on: boolean): WickState;
  setEnemyMotion(state: DeepReadonly<WickState>, on: boolean): WickState;
  setEnemyContact(state: DeepReadonly<WickState>, on: boolean): WickState;
  setWeaponFire(state: DeepReadonly<WickState>, on: boolean): WickState;
  setEffectMotion(state: DeepReadonly<WickState>, on: boolean): WickState;
  setDrops(state: DeepReadonly<WickState>, on: boolean): WickState;
  setProgression(state: DeepReadonly<WickState>, on: boolean): WickState;
  setTick(state: DeepReadonly<WickState>, tick: number): WickState;
  setSpawnTimer(state: DeepReadonly<WickState>, seconds: number): WickState;
  setNextSpawnAngle(state: DeepReadonly<WickState>, degrees: number): WickState;
  setNextSwarmAngle(state: DeepReadonly<WickState>, degrees: number): WickState;
  setNextSpawnType(state: DeepReadonly<WickState>, id: EnemyId): WickState;
  setNextPuddleOffset(
    state: DeepReadonly<WickState>,
    dx: number,
    dy: number,
  ): WickState;
  setNextStrikeTarget(state: DeepReadonly<WickState>, id: number): WickState;
  setNextChestItem(
    state: DeepReadonly<WickState>,
    id: WeaponId | PassiveId,
  ): WickState;
  setNextDrop(state: DeepReadonly<WickState>, kind: NextDrop): WickState;
  rollDrop(state: DeepReadonly<WickState>): NextDrop;
  setPlayerPosition(
    state: DeepReadonly<WickState>,
    x: number,
    y: number,
  ): WickState;
  setFacing(state: DeepReadonly<WickState>, facing: Facing): WickState;
  setHp(state: DeepReadonly<WickState>, hp: number): WickState;
  setLevel(state: DeepReadonly<WickState>, level: number): WickState;
  setXp(state: DeepReadonly<WickState>, xp: number): WickState;
  setKills(state: DeepReadonly<WickState>, kills: number): WickState;
  setPendingLevelUps(state: DeepReadonly<WickState>, count: number): WickState;
  setNextOffers(
    state: DeepReadonly<WickState>,
    ids: readonly OfferId[],
  ): WickState;
  setWeapon(
    state: DeepReadonly<WickState>,
    slot: number,
    id: WeaponId,
    level: number,
  ): WickState;
  setWeaponCooldown(
    state: DeepReadonly<WickState>,
    slot: number,
    seconds: number,
  ): WickState;
  removeWeapon(state: DeepReadonly<WickState>, slot: number): WickState;
  setPassive(
    state: DeepReadonly<WickState>,
    slot: number,
    id: PassiveId,
    level: number,
  ): WickState;
  removePassive(state: DeepReadonly<WickState>, slot: number): WickState;
  spawnEnemy(
    state: DeepReadonly<WickState>,
    type: EnemyId,
    x: number,
    y: number,
  ): WickState;
  setEnemyPosition(
    state: DeepReadonly<WickState>,
    id: number,
    x: number,
    y: number,
  ): WickState;
  setEnemyHp(state: DeepReadonly<WickState>, id: number, hp: number): WickState;
  setEnemyHeading(
    state: DeepReadonly<WickState>,
    id: number,
    hx: number,
    hy: number,
  ): WickState;
  setEnemyAge(
    state: DeepReadonly<WickState>,
    id: number,
    seconds: number,
  ): WickState;
  setEnemyContactCooldown(
    state: DeepReadonly<WickState>,
    id: number,
    seconds: number,
  ): WickState;
  removeEnemy(state: DeepReadonly<WickState>, id: number): WickState;
  clearEnemies(state: DeepReadonly<WickState>): WickState;
  spawnProjectile(
    state: DeepReadonly<WickState>,
    weapon: "ember" | "pin" | "shard" | "sconce" | "beacon" | "hail",
    x: number,
    y: number,
    vx: number,
    vy: number,
    pierce: number,
  ): WickState;
  clearProjectiles(state: DeepReadonly<WickState>): WickState;
  spawnPuddle(
    state: DeepReadonly<WickState>,
    weapon: "oil-splash" | "blaze",
    x: number,
    y: number,
  ): WickState;
  clearZones(state: DeepReadonly<WickState>): WickState;
  spawnGem(
    state: DeepReadonly<WickState>,
    tier: GemTier,
    x: number,
    y: number,
  ): WickState;
  setGemAttracted(
    state: DeepReadonly<WickState>,
    id: number,
    attracted: boolean,
  ): WickState;
  clearGems(state: DeepReadonly<WickState>): WickState;
  spawnPickup(
    state: DeepReadonly<WickState>,
    kind: PickupKind,
    x: number,
    y: number,
  ): WickState;
  clearPickups(state: DeepReadonly<WickState>): WickState;
}

// ---- The game ------------------------------------------------------------

/**
 * The stage background, a CSS color string. `src/main.ts` hands it to the
 * engine as the color the canvas is cleared to each frame, so the letterbox
 * bars around the stage match the night.
 */
export const BACKGROUND: string = COLORS.stage;

export const game: Game<WickState, WickDebugApi> = {
  /**
   * Runs once, before any frame: the actions, the diagnostic sources, the
   * produced sprites and cues, and the title screen over the idle run. The
   * surface holds no state of its own; every operation takes the state it
   * poses and returns the next one.
   */
  async initialize(
    api: InitApi<WickState>,
  ): Promise<[WickState, WickDebugApi]> {
    registerActions(api);
    registerDiagnostics(api);
    // The pointing device's contact and any armed gesture belong to the device
    // rather than to the state, so a fresh game starts them fresh here.
    resetPointer();
    resetGesture();
    await Promise.all([loadSprites(api), defineCues(api)]);
    return [initialState(), createDebugApi()];
  },

  /**
   * Runs once per frame, before `render`: the next state, from the current
   * one. The press edges are read once and routed against the screen the
   * frame began on, the held movement is sampled once for every tick the
   * frame consumes, the frame's seconds join the accumulator on `playing`,
   * the two loops are reconciled from the state the frame leaves, the mute
   * bit is mirrored, and the cues the frame raised are played.
   */
  update(
    state: DeepReadonly<WickState>,
    api: UpdateApi,
    dt: number,
  ): WickState {
    const { draft, cues } = runFrame(state, {
      dt,
      pressed: pressedActions(api),
      held: readHeld(api),
      pointer: readPointer(api),
      toggleMute: () => api.audio.setMuted(!api.audio.muted()),
    });
    syncLoops(api, draft);
    draft.muted = api.audio.muted();
    for (const cue of cues) api.audio.play(cue);
    return draft;
  },

  /**
   * Runs once per frame, after `update`, with the state `update` returned.
   * The context arrives cleared and carrying the logical transform, so
   * everything draws in 1280x720 coordinates under the camera on the
   * lamplighter; the read-only view is what guarantees drawing changes
   * nothing.
   */
  render(state: DeepReadonly<WickState>, api: RenderApi): void {
    renderGame(api.ctx, state);
  },
};
