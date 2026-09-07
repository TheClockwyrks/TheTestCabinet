// Arc Foundry — the debugging and automation surface (specs/instrumentation.md).
//
// The game instance's `initialize` returns this object, and the engine hands that same
// object back from `engine.debug`. That is the one way a caller reaches it: nothing is
// installed on the page, and the surface holds no state of its own.
//
// EVERY OPERATION ACTS ON THE LIVE WORLD at the moment it is called, reaching it through
// the accessor the instance supplies — `engine.world` at the call — and takes only the
// parameters its own entry names. A POSE arranges the running game through the systems
// play itself uses and returns nothing; a READING returns plain data built at the call
// and changes nothing.
//
// EVERY OPERATION IS ATOMIC: it sets one field, reads one value, or commits one control,
// and leaves the rest of the game as it stands. A pose establishes a precondition and
// never an outcome, so what happens next comes from advancing the real simulation.
//
// TWO RULES COVER EVERY OPERATION. An argument outside the domain its operation states is
// invalid and the call fails loudly rather than guessing what was meant, and so is a call
// whose subject is not in the condition the operation states. And an operation is
// UNCONDITIONAL: it carries out its effect every time it is called, on the world as it
// stands. Which screen is up, which phase is running, which panel is drawn, and where the
// pointer is are the route a PLAYER takes to a control and are not an operation's
// conditions, so every control operation here commits through its transaction —
// `perform…` — rather than through the `try…` a click runs. The transaction's OWN rules
// stay: an unaffordable purchase still buys nothing, a track already at its top gains
// none, an illegal footprint stands nothing up, and a spent allowance drops no rock. What
// never happens is a quiet refusal that leaves the world as it was with nothing said.
//
// The surface is inert during normal play: nothing here runs until something calls it.

import {
  COMBO_IDS,
  COMBO_MAX_LEVEL,
  COMPONENT_TYPES,
  DEFAULT_SEED,
  DIFFICULTY_IDS,
  FOUNDRY_DEBUG_VERSION,
  LOAD_TYPES,
  MAP_IDS,
  MAX_QUALITY,
  OVERLOAD_TYPE,
  PHASES,
  REFINEMENT_MAX,
  REFINEMENT_ODDS,
  SCREENS,
  SPEEDS,
  STAMPS_PER_LEVEL,
  TARGETING_PRIORITIES,
  type ComboId,
  type ComponentType,
  type DifficultyId,
  type LoadType,
  type MapId,
  type PhaseName,
  type ScreenName,
  type Speed,
  type StructureKind,
  type TargetingPriority,
} from "./constants";
import {
  MAX_ANCHOR_COL,
  MAX_ANCHOR_ROW,
  baseStats,
  footprintCenter,
} from "./tables";
import {
  addToCombineSet,
  applyBurn,
  applySlow,
  armNextRoll,
  baseStructureById,
  board,
  canPlaceAt,
  clearCombineSet,
  clearHeld,
  clearNextRoll,
  clearProjectiles,
  clearStructures,
  clearUnits,
  combineFrom,
  combineSet,
  comboById,
  difficulty,
  candidateById,
  performDowngrade,
  reconcile,
  firingStructureById,
  performKeep,
  liveUnitById,
  liveWaveCount,
  placeBlocker,
  placeCombo,
  placeComponent,
  performPlaceStamp,
  performRemoveStructure,
  reportedPhase,
  resetWorld,
  select,
  setCharge,
  setComboLevel,
  setDifficulty,
  setIntegrity,
  setMap,
  setMenuIndex,
  setOverlay,
  setPaused,
  setRefinement,
  setRunPhase,
  setScreen,
  setSpeed,
  setStamps,
  setTargetingById,
  setUnitFrozen,
  setUnitHp,
  setUnitPosition,
  setUnitWaypoint,
  setWave,
  setWaveHold,
  spawnUnit,
  stampsLeft,
  startRun,
  statsOf,
  structureById,
  unbuffedStats,
  performUpgradeCombo,
  performUpgradeQuality,
} from "./sim";
import {
  barState,
  menuControls,
  panelButtonControls,
  pressPanelControls,
  statusBarControls,
  statusReadouts,
} from "./layout";
import type { ReadoutName } from "./layout";
import { abilityTags } from "./tables";
import { foundryState, type FoundryState } from "./state";
import type { RecipeCell, Unit } from "./types";
import type { World } from "@clockwyrks/structured-2d";

// ---- The shapes the readings return (specs/instrumentation.md) -----------

/** One control the panel or a menu draws, with the region a press activates it in. */
export interface ButtonSnapshot {
  action: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  disabled: boolean;
}

/** One status-bar control, reporting the value it reads rather than its availability. */
export interface StatusSnapshot {
  action: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  state: boolean | number;
}

/** One status-bar read, reporting the text it draws and the rectangle it drew it at. */
export interface ReadoutSnapshot {
  readout: ReadoutName;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One ingredient cell of one recipe, as the recipe book drew it. */
export type RecipeEntrySnapshot = RecipeCell;

/** One live unit, as the snapshot reports it. */
export interface UnitSnapshot {
  id: number;
  type: LoadType | "overload";
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  /** Its current speed, after any slow. */
  speed: number;
  /** The roster speed. */
  baseSpeed: number;
  flying: boolean;
  frozen: boolean;
  /** The checkpoint it is heading for, `1` through `7`. */
  waypointIndex: number;
  /** The remaining route to that checkpoint, in tiles. */
  progress: number;
  slowFactor: number;
  slowUntil: number;
  burnDps: number;
  burnUntil: number;
  invincible: boolean;
}

/** One structure on the yard, as the snapshot reports it. */
export interface StructureSnapshot {
  id: number;
  kind: StructureKind;
  /** A component type or a combination tower identifier; `null` for a blocker. */
  type: string | null;
  quality: number | null;
  level: number | null;
  col: number;
  row: number;
  cx: number;
  cy: number;
  range: number;
  /** The effective per-shot damage, including any aura on it, unrounded. */
  damage: number;
  fireRate: number;
  targeting: TargetingPriority | null;
  /** The firing head's rotation, in radians. */
  heading: number;
  firing: boolean;
  kills: number;
  damageDealt: number;
  /** The aura this structure itself projects. */
  auraRadius: number;
  auraBonus: number;
  abilities: string[];
}

/** One shot in flight, as the snapshot reports it. */
export interface ProjectileSnapshot {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  type: string;
  heading: number;
  damage: number;
  targetId: number | null;
}

/** The plain, serializable read of the whole observable state. */
export interface FoundrySnapshot {
  version: number;
  screen: ScreenName;
  phase: PhaseName | null;
  menuIndex: number;
  paused: boolean;
  map: MapId;
  difficulty: DifficultyId;
  wave: number;
  totalWaves: number;
  waveActive: boolean;
  /** The wave's clear-and-pay resolution is held by `setWaveHold`. */
  waveHeld: boolean;
  charge: number;
  integrity: number;
  refinement: number;
  qualityOdds: number[];
  nextRoll: { type: string; quality: number } | null;
  stampsLeft: number;
  speed: Speed;
  muted: boolean;
  overlays: { combos: boolean; damage: boolean };
  mazeLength: number;
  mazeRating: number;
  selected: number | null;
  combineSet: number[];
  pointer: { x: number; y: number };
  held: { active: boolean; col: number; row: number; legal: boolean };
  entry: { col: number; row: number };
  collector: { col: number; row: number };
  waypoints: { index: number; col: number; row: number }[];
  units: UnitSnapshot[];
  structures: StructureSnapshot[];
  projectiles: ProjectileSnapshot[];
  simTime: number;
}

// ---- The surface ---------------------------------------------------------

/**
 * The surface `specs/instrumentation.md` specifies.
 *
 * Every member acts on the live world at the moment it is called and takes only the
 * parameters its own entry names. A pose returns nothing; a reading returns what it
 * read and changes nothing.
 */
export interface FoundryDebugApi {
  version: number;

  // Readings.
  snapshot(): FoundrySnapshot;

  /** Bring every reported reading into agreement with the yard as it stands. */
  reconcile(): void;
  panelButtons(): ButtonSnapshot[];
  pressControls(): ButtonSnapshot[];
  menuButtons(): ButtonSnapshot[];
  statusControls(): StatusSnapshot[];
  statusReadouts(): ReadoutSnapshot[];
  recipeEntries(): RecipeEntrySnapshot[];
  waveCount(type: string): number;

  // The run.
  reset(options?: { seed?: number }): void;
  setMap(map: string): void;
  setDifficulty(difficulty: string): void;
  startRun(): void;
  setScreen(screen: string): void;
  setMenuIndex(index: number): void;
  setPhase(phase: string): void;
  setWaveHold(held: boolean): void;
  setPaused(paused: boolean): void;
  setSpeed(multiplier: number): void;
  setOverlay(overlay: string, open: boolean): void;

  // Resources and progress.
  setCharge(amount: number): void;
  setIntegrity(amount: number): void;
  setRefinement(level: number): void;
  setWave(n: number): void;
  setStamps(n: number): void;

  // Structures.
  clearStructures(): void;
  setNextRoll(type: string, quality: number): void;
  clearNextRoll(): void;
  clearHeld(): void;
  placeRock(col: number, row: number): void;
  placeComponent(type: string, quality: number, col: number, row: number): void;
  placeCombo(combo: string, col: number, row: number): void;
  placeBlocker(col: number, row: number): void;
  select(id: number): void;
  clearSelection(): void;
  addToCombineSet(id: number): void;
  clearCombineSet(): void;
  keep(id: number): void;
  downgrade(id: number): void;
  combine(id: number): void;
  dismantle(id: number): void;
  setTargeting(id: number, priority: string): void;
  setComboLevel(id: number, level: number): void;
  upgradeQuality(): void;
  upgradeCombo(id: number): void;

  // The Load.
  clearUnits(): void;
  clearProjectiles(): void;
  spawnUnit(type: string): void;
  setUnitPosition(id: number, x: number, y: number): void;
  setUnitWaypoint(id: number, index: number): void;
  setUnitHp(id: number, hp: number): void;
  setUnitSlow(id: number, amount: number, seconds: number): void;
  setUnitBurn(id: number, dps: number, seconds: number): void;
  setUnitFrozen(id: number, frozen: boolean): void;
}

// ---- Argument validation -------------------------------------------------
//
// An argument outside its stated domain fails loudly rather than being clamped, because
// a clamped argument turns a caller's mistake into a scenario that quietly measures
// something else. The message names the operation, the domain, and what arrived.

function invalid(op: string, expected: string, got: unknown): never {
  throw new Error(
    `Arc Foundry debug.${op}: expected ${expected}, received ${JSON.stringify(got) ?? String(got)}`,
  );
}

function num(op: string, name: string, v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    invalid(op, `${name} to be a finite number`, v);
  }
  return v;
}

function int(
  op: string,
  name: string,
  v: unknown,
  min: number,
  max: number,
): number {
  const n = num(op, name, v);
  if (!Number.isInteger(n) || n < min || n > max) {
    invalid(op, `${name} to be a whole number in ${min}..${max}`, v);
  }
  return n;
}

function bool(op: string, name: string, v: unknown): boolean {
  if (typeof v !== "boolean") invalid(op, `${name} to be a boolean`, v);
  return v;
}

function oneOf<T extends string>(
  op: string,
  name: string,
  v: unknown,
  allowed: readonly T[],
): T {
  if (typeof v !== "string" || !(allowed as readonly string[]).includes(v)) {
    invalid(op, `${name} to be one of ${allowed.join(", ")}`, v);
  }
  return v as T;
}

const OVERLAYS = ["combos", "damage"] as const;
const SPAWNABLE: readonly string[] = [...LOAD_TYPES, OVERLOAD_TYPE];

/** An anchor tile of a footprint. */
function anchor(
  op: string,
  col: unknown,
  row: unknown,
): { col: number; row: number } {
  return {
    col: int(op, "col", col, 0, MAX_ANCHOR_COL),
    row: int(op, "row", row, 0, MAX_ANCHOR_ROW),
  };
}

/** A structure the yard currently carries, or a loud failure. */
function structure(op: string, state: FoundryState, id: unknown): number {
  const n = num(op, "id", id);
  if (!structureById(state, n))
    invalid(op, "an id a live structure carries", id);
  return n;
}

/**
 * A candidate the yard currently carries, or a loud failure. `keep` and `downgrade`
 * harvest a CANDIDATE, so a standing component, a combination tower and a blocker each
 * name a subject the operation has nothing to do with.
 */
function candidate(op: string, state: FoundryState, id: unknown): number {
  const n = num(op, "id", id);
  if (!candidateById(state, n)) invalid(op, "an id a candidate carries", id);
  return n;
}

/** The live unit an id names, or a loud failure. */
function unit(op: string, state: FoundryState, id: unknown): Unit {
  const u = liveUnitById(state, num(op, "id", id));
  if (!u) invalid(op, "an id a live unit carries", id);
  return u;
}

// ---- The readings --------------------------------------------------------

/** A pure read of the whole observable state. */
export function snapshot(state: FoundryState): FoundrySnapshot {
  const chain = board(state).chain;
  const entry = chain[0]!;
  const collector = chain[chain.length - 1]!;
  const held = state.holding
    ? board(state).pixelToAnchor(state.pointerX, state.pointerY)
    : null;
  return {
    version: FOUNDRY_DEBUG_VERSION,
    screen: state.screen,
    phase: reportedPhase(state),
    menuIndex: state.menuIndex,
    paused: state.paused,
    map: state.mapId,
    difficulty: state.difficultyId,
    wave: state.wave,
    totalWaves: difficulty(state).waves,
    waveActive: state.activeWave !== null || state.units.some((u) => !u.dead),
    waveHeld: state.waveHeld,
    charge: state.charge,
    integrity: state.integrity,
    refinement: state.refinement,
    qualityOdds: [...REFINEMENT_ODDS[state.refinement]!],
    nextRoll: state.armedRoll
      ? { type: state.armedRoll.type, quality: state.armedRoll.quality }
      : null,
    stampsLeft: stampsLeft(state),
    speed: state.speed,
    muted: state.muted,
    overlays: { combos: state.showCombos, damage: state.showDamage },
    mazeLength: state.mazeLength,
    mazeRating: state.mazeRating,
    selected: state.selectedId,
    combineSet: combineSet(state),
    pointer: { x: state.pointerX, y: state.pointerY },
    held: {
      active: held !== null,
      col: held?.col ?? 0,
      row: held?.row ?? 0,
      legal: held ? canPlaceAt(state, held.col, held.row) : false,
    },
    entry: { col: entry.col, row: entry.row },
    collector: { col: collector.col, row: collector.row },
    waypoints: board(state).map.waypoints.map((wp, i) => ({
      index: i + 1,
      col: wp.col,
      row: wp.row,
    })),
    units: state.units
      .filter((u) => !u.dead)
      .map((u) => ({
        id: u.id,
        type: (u.invincible ? OVERLOAD_TYPE : u.type) as LoadType | "overload",
        x: u.x,
        y: u.y,
        hp: u.hp,
        maxHp: u.maxHp,
        speed: u.speed * u.slowFactor,
        baseSpeed: u.speed,
        flying: u.flies,
        frozen: u.frozen,
        waypointIndex: u.wpIndex,
        progress: u.progress,
        slowFactor: u.slowFactor,
        slowUntil: u.slowUntil,
        burnDps: u.burnDps,
        burnUntil: u.burnUntil,
        invincible: u.invincible,
      })),
    structures: state.structures.map((s) => {
      const at = footprintCenter(s.col, s.row);
      const inert = {
        id: s.id,
        col: s.col,
        row: s.row,
        cx: at.x,
        cy: at.y,
        heading: 0,
        firing: false,
        kills: 0,
        damageDealt: 0,
      };
      if (s.kind === "blocker") {
        return {
          ...inert,
          kind: "blocker" as StructureKind,
          type: null,
          quality: null,
          level: null,
          range: 0,
          damage: 0,
          fireRate: 0,
          targeting: null,
          auraRadius: 0,
          auraBonus: 0,
          abilities: [],
        };
      }
      if (s.kind === "candidate") {
        const st = baseStats(s.type, s.quality);
        return {
          ...inert,
          kind: "candidate" as StructureKind,
          type: s.type as string,
          quality: s.quality,
          level: null,
          range: st.range,
          damage: st.dmg,
          fireRate: st.fireRate,
          targeting: null,
          auraRadius: st.auraRadius,
          auraBonus: st.auraBonus,
          abilities: abilityTags(st),
        };
      }
      const isCombo = Boolean(s.combo);
      const own = unbuffedStats(s);
      const live = statsOf(s);
      return {
        id: s.id,
        col: s.col,
        row: s.row,
        cx: at.x,
        cy: at.y,
        kind: (isCombo ? "combo" : "component") as StructureKind,
        type: (isCombo ? s.combo! : s.type) as string,
        quality: isCombo ? null : s.quality,
        level: isCombo ? s.comboLevel : null,
        range: live.range,
        damage: live.dmg,
        fireRate: live.fireRate,
        targeting: live.fires ? s.targeting : null,
        heading: s.aimAngle,
        firing: s.fireAnim < 0.1,
        kills: s.kills,
        damageDealt: s.damageDealt,
        auraRadius: own.auraRadius,
        auraBonus: own.auraBonus,
        abilities: abilityTags(live),
      };
    }),
    projectiles: state.projectiles
      .filter((p) => !p.dead)
      .map((p) => ({
        id: p.id,
        x: p.x,
        y: p.y,
        vx: Math.cos(p.angle) * p.speed,
        vy: Math.sin(p.angle) * p.speed,
        type: (p.combo ?? p.type) as string,
        heading: p.angle,
        damage: p.dmg,
        targetId: p.targetId,
      })),
    simTime: state.simTime,
  };
}

// ---- Building the surface ------------------------------------------------

/**
 * Build the surface over an accessor for the open world.
 *
 * It holds nothing: every operation reads the world at the moment it is called and acts
 * on the state that world carries, so the surface follows the live game for the life of
 * the engine and a `reset` never leaves it pointing at a stale object.
 */
export function createDebugApi(world: () => World): FoundryDebugApi {
  const live = (): FoundryState => foundryState(world());

  return {
    version: FOUNDRY_DEBUG_VERSION,

    // ---- Readings ---------------------------------------------------------

    snapshot: () => snapshot(live()),

    /**
     * Bring every reported reading into agreement with the yard as it stands, without
     * advancing anything: the cached occupancy and the maze readout from the structures,
     * each tower's aura bonus from the sources near it, and each unit's route and
     * `progress` from where it is and the checkpoint it heads for. A build that works all
     * of those out at the read has nothing to do here.
     */
    reconcile() {
      reconcile(live());
    },

    panelButtons: () =>
      panelButtonControls(live()).map((c) => ({
        action: c.action,
        label: c.label,
        x: c.x,
        y: c.y,
        w: c.w,
        h: c.h,
        disabled: c.disabled,
      })),

    pressControls: () =>
      pressPanelControls(live()).map((c) => ({
        action: c.action,
        label: c.label,
        x: c.x,
        y: c.y,
        w: c.w,
        h: c.h,
        disabled: c.disabled,
      })),

    menuButtons: () =>
      menuControls(live()).map((c) => ({
        action: c.action,
        label: c.label,
        x: c.x,
        y: c.y,
        w: c.w,
        h: c.h,
        disabled: c.disabled,
      })),

    statusControls: () => {
      const state = live();
      return statusBarControls(state).map((c) => ({
        action: c.action,
        label: c.label,
        x: c.x,
        y: c.y,
        w: c.w,
        h: c.h,
        state: barState(state, c.action as never),
      }));
    },

    statusReadouts: () => statusReadouts(live()).map((r) => ({ ...r })),

    // The cells of the frame that last drew the book, and nothing while it is closed
    // (specs/instrumentation.md).
    recipeEntries: () => {
      const state = live();
      return state.showCombos ? state.bookCells.map((c) => ({ ...c })) : [];
    },

    // The live wave's own schedule, filtered — the array the spawner is working
    // through, so the count and what arrives are one thing (specs/instrumentation.md).
    waveCount: (type) =>
      liveWaveCount(
        live(),
        oneOf("waveCount", "type", type, SPAWNABLE) as LoadType | "overload",
      ),

    // ---- The run ----------------------------------------------------------

    reset(options) {
      resetWorld(
        live(),
        options?.seed === undefined
          ? DEFAULT_SEED
          : num("reset", "options.seed", options.seed),
      );
    },

    setMap(map) {
      setMap(live(), oneOf("setMap", "map", map, MAP_IDS) as MapId);
    },

    setDifficulty(id) {
      setDifficulty(
        live(),
        oneOf(
          "setDifficulty",
          "difficulty",
          id,
          DIFFICULTY_IDS,
        ) as DifficultyId,
      );
    },

    startRun() {
      startRun(live());
    },

    setScreen(screen) {
      setScreen(
        live(),
        oneOf("setScreen", "screen", screen, SCREENS) as ScreenName,
      );
    },

    setMenuIndex(index) {
      setMenuIndex(live(), int("setMenuIndex", "index", index, 0, 64));
    },

    // A phase pose, releasing no unit and composing no wave. It is invalid off a run,
    // where `phase` reads `null` (specs/instrumentation.md).
    setPhase(phase) {
      const state = live();
      if (reportedPhase(state) === null) {
        invalid("setPhase", "the run to be on the yard", phase);
      }
      setRunPhase(
        state,
        oneOf("setPhase", "phase", phase, PHASES) as PhaseName,
      );
    },

    setWaveHold(held) {
      setWaveHold(live(), bool("setWaveHold", "held", held));
    },

    setPaused(paused) {
      setPaused(live(), bool("setPaused", "paused", paused));
    },

    setSpeed(multiplier) {
      const m = num("setSpeed", "multiplier", multiplier);
      if (!(SPEEDS as readonly number[]).includes(m)) {
        invalid(
          "setSpeed",
          `multiplier to be one of ${SPEEDS.join(", ")}`,
          multiplier,
        );
      }
      setSpeed(live(), m as Speed);
    },

    setOverlay(overlay, open) {
      setOverlay(
        live(),
        oneOf("setOverlay", "overlay", overlay, OVERLAYS),
        bool("setOverlay", "open", open),
      );
    },

    // ---- Resources and progress -------------------------------------------

    setCharge(amount) {
      const a = num("setCharge", "amount", amount);
      if (a < 0) invalid("setCharge", "amount to be at least 0", amount);
      setCharge(live(), a);
    },

    setIntegrity(amount) {
      setIntegrity(live(), num("setIntegrity", "amount", amount));
    },

    setRefinement(level) {
      setRefinement(
        live(),
        int("setRefinement", "level", level, 0, REFINEMENT_MAX),
      );
    },

    setWave(n) {
      const value = num("setWave", "n", n);
      if (!Number.isInteger(value) || value < 0) {
        invalid("setWave", "n to be a whole number of at least 0", n);
      }
      setWave(live(), value);
    },

    setStamps(n) {
      setStamps(live(), int("setStamps", "n", n, 0, STAMPS_PER_LEVEL));
    },

    // ---- Structures -------------------------------------------------------

    clearStructures() {
      clearStructures(live());
    },

    setNextRoll(type, quality) {
      armNextRoll(
        live(),
        oneOf("setNextRoll", "type", type, COMPONENT_TYPES) as ComponentType,
        int("setNextRoll", "quality", quality, 1, MAX_QUALITY),
      );
    },

    clearNextRoll() {
      clearNextRoll(live());
    },

    clearHeld() {
      clearHeld(live());
    },

    // The rock enters through the real placement path, so it is refused exactly as a
    // pointer press would be when the footprint is illegal or the allowance is spent.
    placeRock(col, row) {
      const at = anchor("placeRock", col, row);
      performPlaceStamp(live(), at.col, at.row);
    },

    placeComponent(type, quality, col, row) {
      const t = oneOf(
        "placeComponent",
        "type",
        type,
        COMPONENT_TYPES,
      ) as ComponentType;
      const q = int("placeComponent", "quality", quality, 1, MAX_QUALITY);
      const at = anchor("placeComponent", col, row);
      placeComponent(live(), t, q, at.col, at.row);
    },

    placeCombo(combo, col, row) {
      const id = oneOf("placeCombo", "combo", combo, COMBO_IDS) as ComboId;
      const at = anchor("placeCombo", col, row);
      placeCombo(live(), id, at.col, at.row);
    },

    placeBlocker(col, row) {
      const at = anchor("placeBlocker", col, row);
      placeBlocker(live(), at.col, at.row);
    },

    select(id) {
      const state = live();
      select(state, structure("select", state, id));
    },

    clearSelection() {
      select(live(), null);
    },

    addToCombineSet(id) {
      const state = live();
      const n = num("addToCombineSet", "id", id);
      if (!baseStructureById(state, n)) {
        invalid("addToCombineSet", "an id a base structure carries", id);
      }
      addToCombineSet(state, n);
    },

    clearCombineSet() {
      clearCombineSet(live());
    },

    keep(id) {
      const state = live();
      performKeep(state, candidate("keep", state, id));
    },

    downgrade(id) {
      const state = live();
      const n = candidate("downgrade", state, id);
      // There is no rung below Scrap, so a Scrap candidate names a state the
      // specification does not define rather than a transaction that comes out negative.
      if ((candidateById(state, n)?.quality ?? 0) <= 1) {
        invalid("downgrade", "an id a candidate above Scrap carries", id);
      }
      performDowngrade(state, n);
    },

    combine(id) {
      const state = live();
      combineFrom(state, structure("combine", state, id));
    },

    dismantle(id) {
      const state = live();
      performRemoveStructure(state, structure("dismantle", state, id));
    },

    setTargeting(id, priority) {
      const state = live();
      const n = num("setTargeting", "id", id);
      if (!firingStructureById(state, n)) {
        invalid("setTargeting", "an id a firing structure carries", id);
      }
      setTargetingById(
        state,
        n,
        oneOf(
          "setTargeting",
          "priority",
          priority,
          TARGETING_PRIORITIES,
        ) as TargetingPriority,
      );
    },

    setComboLevel(id, level) {
      const state = live();
      const n = num("setComboLevel", "id", id);
      if (!comboById(state, n)) {
        invalid("setComboLevel", "an id a combination tower carries", id);
      }
      setComboLevel(
        state,
        n,
        int("setComboLevel", "level", level, 0, COMBO_MAX_LEVEL),
      );
    },

    upgradeQuality() {
      performUpgradeQuality(live());
    },

    upgradeCombo(id) {
      const state = live();
      const n = num("upgradeCombo", "id", id);
      if (!comboById(state, n)) {
        invalid("upgradeCombo", "an id a combination tower carries", id);
      }
      performUpgradeCombo(state, n);
    },

    // ---- The Load ---------------------------------------------------------

    clearUnits() {
      clearUnits(live());
    },

    clearProjectiles() {
      clearProjectiles(live());
    },

    spawnUnit(type) {
      spawnUnit(
        live(),
        oneOf("spawnUnit", "type", type, SPAWNABLE) as LoadType | "overload",
      );
    },

    setUnitPosition(id, x, y) {
      const state = live();
      const u = unit("setUnitPosition", state, id);
      setUnitPosition(
        state,
        u,
        num("setUnitPosition", "x", x),
        num("setUnitPosition", "y", y),
      );
    },

    setUnitWaypoint(id, index) {
      const state = live();
      const u = unit("setUnitWaypoint", state, id);
      setUnitWaypoint(state, u, int("setUnitWaypoint", "index", index, 1, 7));
    },

    setUnitHp(id, hp) {
      const state = live();
      const u = unit("setUnitHp", state, id);
      // The Overload Dynamo carries no depleting health, so it takes no health change.
      if (u.invincible) {
        invalid("setUnitHp", "an id a unit with depleting health carries", id);
      }
      const value = num("setUnitHp", "hp", hp);
      if (value < 1 || value > u.maxHp) {
        invalid("setUnitHp", `hp to be in 1..${u.maxHp}`, hp);
      }
      setUnitHp(u, value);
    },

    setUnitSlow(id, amount, seconds) {
      const state = live();
      const u = unit("setUnitSlow", state, id);
      const a = num("setUnitSlow", "amount", amount);
      if (a < 0 || a > 1)
        invalid("setUnitSlow", "amount to be in 0..1", amount);
      const s = num("setUnitSlow", "seconds", seconds);
      if (s < 0) invalid("setUnitSlow", "seconds to be at least 0", seconds);
      applySlow(state, u, a, s);
    },

    setUnitBurn(id, dps, seconds) {
      const state = live();
      const u = unit("setUnitBurn", state, id);
      const d = num("setUnitBurn", "dps", dps);
      if (d < 0) invalid("setUnitBurn", "dps to be at least 0", dps);
      const s = num("setUnitBurn", "seconds", seconds);
      if (s < 0) invalid("setUnitBurn", "seconds to be at least 0", seconds);
      // A posed burn is credited to no structure.
      applyBurn(state, u, d, s, 0);
    },

    setUnitFrozen(id, frozen) {
      const state = live();
      const u = unit("setUnitFrozen", state, id);
      setUnitFrozen(u, bool("setUnitFrozen", "frozen", frozen));
    },
  };
}
