// Arc Foundry — the debugging and automation surface (specs/instrumentation.md).
//
// `initialize` returns this object beside the state it built, as `[state, debug]`, and
// the engine hands that same object back from `engine.debug`. That is the one way a
// caller reaches it: nothing is installed on the page, and the surface holds no state of
// its own.
//
// EVERY OPERATION IS WRITTEN IN THE SHAPE OF `update`. A POSE takes the current state, as
// the read-only view the engine hands out, and returns the next state, built from a
// world of its own; a READING takes the current state and returns what it read. A caller
// drives a pose through `engine.apply((s) => debug.setCharge(s, 500))` and a reading
// against `engine.state`. Nothing here mutates the state it was handed.
//
// EVERY OPERATION IS ATOMIC: it sets one field, reads one value, or commits one control,
// and leaves the rest of the game as it stands. A pose arranges the yard through the
// systems play itself uses, so it establishes a precondition and never an outcome, and
// what happens next comes from advancing the real simulation.
//
// TWO RULES COVER EVERY OPERATION. An argument outside the domain its operation states is
// invalid and the call fails loudly rather than guessing what was meant, and so is a call
// whose subject is not in the condition the operation states. An operation standing for a
// control a player operates commits through that same control, so it is refused wherever
// the control is refused and does nothing when it is.
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
  clearNextRoll,
  clearProjectiles,
  clearStructures,
  clearUnits,
  combineFrom,
  combineSet,
  comboById,
  difficulty,
  downgrade,
  firingStructureById,
  keep,
  liveUnitById,
  ownUnit,
  placeBlocker,
  placeCombo,
  placeComponent,
  placeStamp,
  removeStructure,
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
  setScreen,
  setSpeed,
  setStamps,
  setTargetingById,
  setUnitFrozen,
  setUnitHp,
  setUnitPosition,
  setUnitWaypoint,
  setWave,
  spawnUnit,
  stampsLeft,
  startRun,
  statsOf,
  structureById,
  unbuffedStats,
  upgradeCombo,
  upgradeQuality,
} from "./sim";
import {
  barState,
  menuControls,
  panelButtonControls,
  statusBarControls,
} from "./layout";
import { abilityTags } from "./tables";
import { thaw, type FoundryView } from "./world";
import type { FoundryWorld } from "./types";

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

/** The state as the surface names it: the read-only view the engine hands out. */
export type FoundryStateView = FoundryView;

/**
 * The surface `specs/instrumentation.md` specifies.
 *
 * Every member takes the current state first. A pose returns the next state; a reading
 * returns what it read.
 */
export interface FoundryDebugApi {
  version: number;

  // Readings.
  snapshot(state: FoundryView): FoundrySnapshot;
  panelButtons(state: FoundryView): ButtonSnapshot[];
  menuButtons(state: FoundryView): ButtonSnapshot[];
  statusControls(state: FoundryView): StatusSnapshot[];

  // The run.
  reset(state: FoundryView, options?: { seed?: number }): FoundryWorld;
  setMap(state: FoundryView, map: string): FoundryWorld;
  setDifficulty(state: FoundryView, difficulty: string): FoundryWorld;
  startRun(state: FoundryView): FoundryWorld;
  setScreen(state: FoundryView, screen: string): FoundryWorld;
  setMenuIndex(state: FoundryView, index: number): FoundryWorld;
  setPaused(state: FoundryView, paused: boolean): FoundryWorld;
  setSpeed(state: FoundryView, multiplier: number): FoundryWorld;
  setOverlay(state: FoundryView, overlay: string, open: boolean): FoundryWorld;

  // Resources and progress.
  setCharge(state: FoundryView, amount: number): FoundryWorld;
  setIntegrity(state: FoundryView, amount: number): FoundryWorld;
  setRefinement(state: FoundryView, level: number): FoundryWorld;
  setWave(state: FoundryView, n: number): FoundryWorld;
  setStamps(state: FoundryView, n: number): FoundryWorld;

  // Structures.
  clearStructures(state: FoundryView): FoundryWorld;
  setNextRoll(state: FoundryView, type: string, quality: number): FoundryWorld;
  clearNextRoll(state: FoundryView): FoundryWorld;
  placeRock(state: FoundryView, col: number, row: number): FoundryWorld;
  placeComponent(
    state: FoundryView,
    type: string,
    quality: number,
    col: number,
    row: number,
  ): FoundryWorld;
  placeCombo(
    state: FoundryView,
    combo: string,
    col: number,
    row: number,
  ): FoundryWorld;
  placeBlocker(state: FoundryView, col: number, row: number): FoundryWorld;
  select(state: FoundryView, id: number): FoundryWorld;
  clearSelection(state: FoundryView): FoundryWorld;
  addToCombineSet(state: FoundryView, id: number): FoundryWorld;
  clearCombineSet(state: FoundryView): FoundryWorld;
  keep(state: FoundryView, id: number): FoundryWorld;
  downgrade(state: FoundryView, id: number): FoundryWorld;
  combine(state: FoundryView, id: number): FoundryWorld;
  dismantle(state: FoundryView, id: number): FoundryWorld;
  setTargeting(state: FoundryView, id: number, priority: string): FoundryWorld;
  setComboLevel(state: FoundryView, id: number, level: number): FoundryWorld;
  upgradeQuality(state: FoundryView): FoundryWorld;
  upgradeCombo(state: FoundryView, id: number): FoundryWorld;

  // The Load.
  clearUnits(state: FoundryView): FoundryWorld;
  clearProjectiles(state: FoundryView): FoundryWorld;
  spawnUnit(state: FoundryView, type: string): FoundryWorld;
  setUnitPosition(
    state: FoundryView,
    id: number,
    x: number,
    y: number,
  ): FoundryWorld;
  setUnitWaypoint(state: FoundryView, id: number, index: number): FoundryWorld;
  setUnitHp(state: FoundryView, id: number, hp: number): FoundryWorld;
  setUnitSlow(
    state: FoundryView,
    id: number,
    amount: number,
    seconds: number,
  ): FoundryWorld;
  setUnitBurn(
    state: FoundryView,
    id: number,
    dps: number,
    seconds: number,
  ): FoundryWorld;
  setUnitFrozen(state: FoundryView, id: number, frozen: boolean): FoundryWorld;
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
function structure(op: string, state: FoundryView, id: unknown): number {
  const n = num(op, "id", id);
  if (!structureById(state, n))
    invalid(op, "an id a live structure carries", id);
  return n;
}

/** A live unit's identity, or a loud failure. */
function unit(op: string, state: FoundryView, id: unknown): number {
  const n = num(op, "id", id);
  if (!liveUnitById(state, n)) invalid(op, "an id a live unit carries", id);
  return n;
}

// ---- The readings --------------------------------------------------------

/** A pure read of the whole observable state. */
export function snapshot(state: FoundryView): FoundrySnapshot {
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
 * Build the surface. It holds nothing: every operation is handed the state it acts on,
 * and a pose builds the next state from a world of its own.
 */
export function createDebugApi(): FoundryDebugApi {
  /** Run a change against a world of the caller's own, and hand back the result. */
  const pose = (
    state: FoundryView,
    change: (w: FoundryWorld) => void,
  ): FoundryWorld => {
    const w = thaw(state);
    change(w);
    return w;
  };

  return {
    version: FOUNDRY_DEBUG_VERSION,

    // ---- Readings ---------------------------------------------------------

    snapshot,

    panelButtons: (state) =>
      panelButtonControls(state).map((c) => ({
        action: c.action,
        label: c.label,
        x: c.x,
        y: c.y,
        w: c.w,
        h: c.h,
        disabled: c.disabled,
      })),

    menuButtons: (state) =>
      menuControls(state).map((c) => ({
        action: c.action,
        label: c.label,
        x: c.x,
        y: c.y,
        w: c.w,
        h: c.h,
        disabled: c.disabled,
      })),

    statusControls: (state) =>
      statusBarControls(state).map((c) => ({
        action: c.action,
        label: c.label,
        x: c.x,
        y: c.y,
        w: c.w,
        h: c.h,
        state: barState(state, c.action as never),
      })),

    // ---- The run ----------------------------------------------------------

    reset: (state, options) =>
      pose(state, (w) =>
        resetWorld(
          w,
          options?.seed === undefined
            ? DEFAULT_SEED
            : num("reset", "options.seed", options.seed),
        ),
      ),

    setMap: (state, map) =>
      pose(state, (w) =>
        setMap(w, oneOf("setMap", "map", map, MAP_IDS) as MapId),
      ),

    setDifficulty: (state, id) =>
      pose(state, (w) =>
        setDifficulty(
          w,
          oneOf(
            "setDifficulty",
            "difficulty",
            id,
            DIFFICULTY_IDS,
          ) as DifficultyId,
        ),
      ),

    startRun: (state) => pose(state, (w) => startRun(w)),

    setScreen: (state, screen) =>
      pose(state, (w) =>
        setScreen(
          w,
          oneOf("setScreen", "screen", screen, SCREENS) as ScreenName,
        ),
      ),

    setMenuIndex: (state, index) =>
      pose(state, (w) =>
        setMenuIndex(w, int("setMenuIndex", "index", index, 0, 64)),
      ),

    setPaused: (state, paused) =>
      pose(state, (w) => setPaused(w, bool("setPaused", "paused", paused))),

    setSpeed: (state, multiplier) =>
      pose(state, (w) => {
        const m = num("setSpeed", "multiplier", multiplier);
        if (!(SPEEDS as readonly number[]).includes(m)) {
          invalid(
            "setSpeed",
            `multiplier to be one of ${SPEEDS.join(", ")}`,
            multiplier,
          );
        }
        setSpeed(w, m as Speed);
      }),

    setOverlay: (state, overlay, open) =>
      pose(state, (w) =>
        setOverlay(
          w,
          oneOf("setOverlay", "overlay", overlay, OVERLAYS),
          bool("setOverlay", "open", open),
        ),
      ),

    // ---- Resources and progress -------------------------------------------

    setCharge: (state, amount) =>
      pose(state, (w) => {
        const a = num("setCharge", "amount", amount);
        if (a < 0) invalid("setCharge", "amount to be at least 0", amount);
        setCharge(w, a);
      }),

    setIntegrity: (state, amount) =>
      pose(state, (w) =>
        setIntegrity(w, num("setIntegrity", "amount", amount)),
      ),

    setRefinement: (state, level) =>
      pose(state, (w) =>
        setRefinement(
          w,
          int("setRefinement", "level", level, 0, REFINEMENT_MAX),
        ),
      ),

    setWave: (state, n) =>
      pose(state, (w) => {
        const value = num("setWave", "n", n);
        if (!Number.isInteger(value) || value < 0) {
          invalid("setWave", "n to be a whole number of at least 0", n);
        }
        setWave(w, value);
      }),

    setStamps: (state, n) =>
      pose(state, (w) =>
        setStamps(w, int("setStamps", "n", n, 0, STAMPS_PER_LEVEL)),
      ),

    // ---- Structures -------------------------------------------------------

    clearStructures: (state) => pose(state, (w) => clearStructures(w)),

    setNextRoll: (state, type, quality) =>
      pose(state, (w) =>
        armNextRoll(
          w,
          oneOf("setNextRoll", "type", type, COMPONENT_TYPES) as ComponentType,
          int("setNextRoll", "quality", quality, 1, MAX_QUALITY),
        ),
      ),

    clearNextRoll: (state) => pose(state, (w) => clearNextRoll(w)),

    // The rock enters through the real placement path, so it is refused exactly as a
    // pointer press would be when the footprint is illegal or the allowance is spent.
    placeRock: (state, col, row) =>
      pose(state, (w) => {
        const at = anchor("placeRock", col, row);
        placeStamp(w, at.col, at.row);
      }),

    placeComponent: (state, type, quality, col, row) =>
      pose(state, (w) => {
        const t = oneOf(
          "placeComponent",
          "type",
          type,
          COMPONENT_TYPES,
        ) as ComponentType;
        const q = int("placeComponent", "quality", quality, 1, MAX_QUALITY);
        const at = anchor("placeComponent", col, row);
        placeComponent(w, t, q, at.col, at.row);
      }),

    placeCombo: (state, combo, col, row) =>
      pose(state, (w) => {
        const id = oneOf("placeCombo", "combo", combo, COMBO_IDS) as ComboId;
        const at = anchor("placeCombo", col, row);
        placeCombo(w, id, at.col, at.row);
      }),

    placeBlocker: (state, col, row) =>
      pose(state, (w) => {
        const at = anchor("placeBlocker", col, row);
        placeBlocker(w, at.col, at.row);
      }),

    select: (state, id) => {
      const n = structure("select", state, id);
      return pose(state, (w) => select(w, n));
    },

    clearSelection: (state) => pose(state, (w) => select(w, null)),

    addToCombineSet: (state, id) => {
      const n = num("addToCombineSet", "id", id);
      if (!baseStructureById(state, n)) {
        invalid("addToCombineSet", "an id a base structure carries", id);
      }
      return pose(state, (w) => addToCombineSet(w, n));
    },

    clearCombineSet: (state) => pose(state, (w) => clearCombineSet(w)),

    keep: (state, id) => {
      const n = structure("keep", state, id);
      return pose(state, (w) => {
        keep(w, n);
      });
    },

    downgrade: (state, id) => {
      const n = structure("downgrade", state, id);
      return pose(state, (w) => {
        downgrade(w, n);
      });
    },

    combine: (state, id) => {
      const n = structure("combine", state, id);
      return pose(state, (w) => {
        combineFrom(w, n);
      });
    },

    dismantle: (state, id) => {
      const n = structure("dismantle", state, id);
      return pose(state, (w) => {
        removeStructure(w, n);
      });
    },

    setTargeting: (state, id, priority) => {
      const n = num("setTargeting", "id", id);
      if (!firingStructureById(state, n)) {
        invalid("setTargeting", "an id a firing structure carries", id);
      }
      const p = oneOf(
        "setTargeting",
        "priority",
        priority,
        TARGETING_PRIORITIES,
      ) as TargetingPriority;
      return pose(state, (w) => setTargetingById(w, n, p));
    },

    setComboLevel: (state, id, level) => {
      const n = num("setComboLevel", "id", id);
      if (!comboById(state, n)) {
        invalid("setComboLevel", "an id a combination tower carries", id);
      }
      const lvl = int("setComboLevel", "level", level, 0, COMBO_MAX_LEVEL);
      return pose(state, (w) => setComboLevel(w, n, lvl));
    },

    upgradeQuality: (state) =>
      pose(state, (w) => {
        upgradeQuality(w);
      }),

    upgradeCombo: (state, id) => {
      const n = num("upgradeCombo", "id", id);
      if (!comboById(state, n)) {
        invalid("upgradeCombo", "an id a combination tower carries", id);
      }
      return pose(state, (w) => {
        upgradeCombo(w, n);
      });
    },

    // ---- The Load ---------------------------------------------------------

    clearUnits: (state) => pose(state, (w) => clearUnits(w)),

    clearProjectiles: (state) => pose(state, (w) => clearProjectiles(w)),

    spawnUnit: (state, type) =>
      pose(state, (w) => {
        spawnUnit(
          w,
          oneOf("spawnUnit", "type", type, SPAWNABLE) as LoadType | "overload",
        );
      }),

    setUnitPosition: (state, id, x, y) => {
      const n = unit("setUnitPosition", state, id);
      const px = num("setUnitPosition", "x", x);
      const py = num("setUnitPosition", "y", y);
      return pose(state, (w) => {
        const u = ownUnit(w, n);
        if (u) setUnitPosition(w, u, px, py);
      });
    },

    setUnitWaypoint: (state, id, index) => {
      const n = unit("setUnitWaypoint", state, id);
      const at = int("setUnitWaypoint", "index", index, 1, 7);
      return pose(state, (w) => {
        const u = ownUnit(w, n);
        if (u) setUnitWaypoint(w, u, at);
      });
    },

    setUnitHp: (state, id, hp) => {
      const n = unit("setUnitHp", state, id);
      const u = liveUnitById(state, n)!;
      // The Overload Dynamo carries no depleting health, so it takes no health change.
      if (u.invincible) {
        invalid("setUnitHp", "an id a unit with depleting health carries", id);
      }
      const value = num("setUnitHp", "hp", hp);
      if (value < 1 || value > u.maxHp) {
        invalid("setUnitHp", `hp to be in 1..${u.maxHp}`, hp);
      }
      return pose(state, (w) => {
        const live = ownUnit(w, n);
        if (live) setUnitHp(live, value);
      });
    },

    setUnitSlow: (state, id, amount, seconds) => {
      const n = unit("setUnitSlow", state, id);
      const a = num("setUnitSlow", "amount", amount);
      if (a < 0 || a > 1)
        invalid("setUnitSlow", "amount to be in 0..1", amount);
      const s = num("setUnitSlow", "seconds", seconds);
      if (s < 0) invalid("setUnitSlow", "seconds to be at least 0", seconds);
      return pose(state, (w) => {
        const u = ownUnit(w, n);
        if (u) applySlow(w, u, a, s);
      });
    },

    setUnitBurn: (state, id, dps, seconds) => {
      const n = unit("setUnitBurn", state, id);
      const d = num("setUnitBurn", "dps", dps);
      if (d < 0) invalid("setUnitBurn", "dps to be at least 0", dps);
      const s = num("setUnitBurn", "seconds", seconds);
      if (s < 0) invalid("setUnitBurn", "seconds to be at least 0", seconds);
      // A posed burn is credited to no structure.
      return pose(state, (w) => {
        const u = ownUnit(w, n);
        if (u) applyBurn(w, u, d, s, 0);
      });
    },

    setUnitFrozen: (state, id, frozen) => {
      const n = unit("setUnitFrozen", state, id);
      const value = bool("setUnitFrozen", "frozen", frozen);
      return pose(state, (w) => {
        const u = ownUnit(w, n);
        if (u) setUnitFrozen(u, value);
      });
    },
  };
}
