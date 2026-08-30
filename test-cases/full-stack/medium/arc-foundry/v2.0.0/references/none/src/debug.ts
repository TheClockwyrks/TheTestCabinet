// Arc Foundry — the debugging and automation surface installed on `window.__foundry`, and
// the read-only diagnostics overlay (specs/instrumentation.md).
//
// Every operation here is atomic: it sets one field, reads one value, moves the clock, or
// commits one control. A caller that wants several things arranged makes several calls, in
// the order it wants them, and nothing it did not ask for happens. A pose arranges the yard
// through the same systems play uses — a placed rock rolls through the real press, a
// harvested candidate becomes a component through the real harvest, a released unit walks
// the real pathfinder — so it establishes a precondition and never an outcome. What happens
// next comes from advancing the real simulation.
//
// Two rules cover every operation. An argument outside the domain its operation states is
// invalid and the call THROWS rather than guessing what was meant, and so is a call whose
// subject is not in the condition the operation states. An operation that stands for a
// control a player operates commits through that same control, so it is REFUSED wherever
// the control is refused and does nothing when it is.
//
// The surface is inert during normal play: nothing here runs until something calls it.

import {
  COMBOS,
  MAX_COMBO_LEVEL,
  COMPONENT_ORDER,
  DEFAULT_SEED,
  DIFFICULTY,
  FONT,
  FOUNDRY_DEBUG_VERSION,
  MAPS,
  BUILDS_PER_LEVEL,
  MAX_REFINEMENT,
  TARGETING_ORDER,
  mapById,
} from "./constants";
import type { Game, FoundrySnapshot } from "./sim";
import type {
  ComboType,
  ComponentType,
  Difficulty,
  GameState,
  LoadType,
  Refinement,
  TargetingMode,
  Tier,
} from "./types";

// The bootstrap wiring the surface routes through: the live game, the manual clock it owns,
// the frame the clock drives, the input path a player's device feeds, and the control
// geometry the last rendered frame produced. Everything the surface needs that lives in the
// runtime layer rather than on the game.
export interface DebugContext {
  game: Game;
  clock: { autoStep: boolean };
  /** Run one whole frame of `seconds` elapsed time: the same update the loop runs, then a render. */
  runFrame(seconds: number): void;
  /** Lay the frame out again, so a reading reports the controls the game as it stands draws. */
  refreshControls(): void;
  pointerMove(x: number, y: number): void;
  pointerDown(x: number, y: number): void;
  pointerUp(): void;
  keyDown(code: string): void;
  keyUp(code: string): void;
  panelButtons(): PanelButton[];
  menuButtons(): PanelButton[];
  statusControls(): StatusControl[];
}

/** One control as it was last drawn: where it sits, what it reads, and whether it is inert. */
export interface PanelButton {
  action: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  disabled: boolean;
}

/** A status-bar control, reporting the value it currently reads rather than its availability. */
export interface StatusControl {
  action: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  state: boolean | number;
}

export interface FoundryDebugApi {
  version: number;

  // The clock.
  setAutoStep(enabled: boolean): void;
  advance(seconds: number, frames?: number): void;

  // Readings.
  snapshot(): FoundrySnapshot;
  panelButtons(): PanelButton[];
  menuButtons(): PanelButton[];
  statusControls(): StatusControl[];

  // The run.
  reset(options?: { seed?: number }): void;
  setMap(map: string): void;
  setDifficulty(difficulty: string): void;
  startRun(): void;
  setScreen(screen: string): void;
  setMenuIndex(index: number): void;
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

  // Input.
  pointerMove(x: number, y: number): void;
  pointerDown(x: number, y: number): void;
  pointerUp(): void;
  keyDown(code: string): void;
  keyUp(code: string): void;
}

// ---- Argument validation ------------------------------------------------------
// An argument outside its stated domain fails loudly rather than being clamped, because a
// clamped argument turns a caller's mistake into a scenario that quietly measures something
// else. The message names the operation, the domain, and what arrived.

function invalid(op: string, expected: string, got: unknown): never {
  throw new Error(
    `__foundry.${op}: expected ${expected}, received ${JSON.stringify(got) ?? String(got)}`,
  );
}

function num(op: string, name: string, v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v))
    invalid(op, `${name} to be a finite number`, v);
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
  if (!Number.isInteger(n) || n < min || n > max)
    invalid(op, `${name} to be a whole number in ${min}..${max}`, v);
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

const SCREENS: readonly GameState[] = [
  "title",
  "mapselect",
  "difficultyselect",
  "howto",
  "playing",
  "paused",
  "victory",
  "overload",
];
const MAP_IDS: readonly string[] = MAPS.map((m) => m.id);
const DIFFICULTIES: readonly Difficulty[] = ["easy", "medium", "hard"];
const SPEEDS: readonly number[] = [1, 2, 4, 8];
const OVERLAYS = ["combos", "damage"] as const;
const LOAD_TYPES: readonly string[] = [
  "mote",
  "spark",
  "slug",
  "cluster",
  "filament",
  "dynamo",
  "overload",
];
const COMBO_IDS: readonly string[] = Object.keys(COMBOS);

export function installDebugApi(ctx: DebugContext): void {
  const { game, clock } = ctx;

  // An anchor tile of a 2 by 2 footprint (specs/yard.md): col 0..48, row 0..31.
  const anchor = (
    op: string,
    col: unknown,
    row: unknown,
  ): { col: number; row: number } => ({
    col: int(op, "col", col, 0, 48),
    row: int(op, "row", row, 0, 31),
  });

  // A structure id the yard currently carries, or a loud failure.
  const structure = (op: string, id: unknown): number => {
    const n = num(op, "id", id);
    if (!game.structureById(n))
      invalid(op, "an id a live structure carries", id);
    return n;
  };

  // A live unit, or a loud failure.
  const unit = (op: string, id: unknown) => {
    const n = num(op, "id", id);
    const u = game.liveUnitById(n);
    if (!u) invalid(op, "an id a live unit carries", id);
    return u;
  };

  const api: FoundryDebugApi = {
    version: FOUNDRY_DEBUG_VERSION,

    // ---- The clock -------------------------------------------------------------

    // Take the game off real time and give it back. Drawing is unaffected either way.
    setAutoStep(enabled) {
      clock.autoStep = bool("setAutoStep", "enabled", enabled);
    },

    // Run `frames` whole frames covering `seconds` of elapsed time, each worth
    // `seconds / frames`, immediately and in order. Each is a real frame — the same update
    // the loop runs followed by a render — so the game's own systems produce the result and
    // the canvas reflects it.
    advance(seconds, frames = 1) {
      const s = num("advance", "seconds", seconds);
      if (s < 0) invalid("advance", "seconds to be at least 0", seconds);
      const n = int("advance", "frames", frames, 1, 100_000);
      const per = s / n;
      for (let i = 0; i < n; i++) ctx.runFrame(per);
    },

    // ---- Readings --------------------------------------------------------------

    snapshot() {
      return game.debugSnapshot();
    },
    panelButtons() {
      ctx.refreshControls();
      return ctx.panelButtons();
    },
    menuButtons() {
      ctx.refreshControls();
      return ctx.menuButtons();
    },
    statusControls() {
      ctx.refreshControls();
      return ctx.statusControls();
    },

    // ---- The run ---------------------------------------------------------------

    reset(options) {
      const seed =
        options?.seed === undefined
          ? DEFAULT_SEED
          : num("reset", "options.seed", options.seed);
      game.debugReset(seed);
    },
    setMap(map) {
      game.setMap(mapById(oneOf("setMap", "map", map, MAP_IDS)));
    },
    setDifficulty(difficulty) {
      game.setDifficulty(
        DIFFICULTY[
          oneOf("setDifficulty", "difficulty", difficulty, DIFFICULTIES)
        ],
      );
    },
    startRun() {
      game.startRun();
    },
    setScreen(screen) {
      game.setScreen(oneOf("setScreen", "screen", screen, SCREENS));
    },
    setMenuIndex(index) {
      game.setMenuIndex(int("setMenuIndex", "index", index, 0, 64));
    },
    setPaused(paused) {
      game.setPaused(bool("setPaused", "paused", paused));
    },
    setSpeed(multiplier) {
      const m = num("setSpeed", "multiplier", multiplier);
      if (!SPEEDS.includes(m))
        invalid("setSpeed", "multiplier to be one of 1, 2, 4, 8", multiplier);
      game.setSpeed(m as 1 | 2 | 4 | 8);
    },
    setOverlay(overlay, open) {
      game.setOverlay(
        oneOf("setOverlay", "overlay", overlay, OVERLAYS),
        bool("setOverlay", "open", open),
      );
    },

    // ---- Resources and progress ------------------------------------------------

    setCharge(amount) {
      const a = num("setCharge", "amount", amount);
      if (a < 0) invalid("setCharge", "amount to be at least 0", amount);
      game.setCharge(a);
    },
    setIntegrity(amount) {
      game.setIntegrity(num("setIntegrity", "amount", amount));
    },
    setRefinement(level) {
      game.setRefinement(
        int("setRefinement", "level", level, 0, MAX_REFINEMENT) as Refinement,
      );
    },
    setWave(n) {
      const w = num("setWave", "n", n);
      if (!Number.isInteger(w) || w < 0)
        invalid("setWave", "n to be a whole number of at least 0", n);
      game.setWave(w);
    },
    setStamps(n) {
      game.setStamps(int("setStamps", "n", n, 0, BUILDS_PER_LEVEL));
    },

    // ---- Structures ------------------------------------------------------------

    clearStructures() {
      game.clearStructures();
    },
    setNextRoll(type, quality) {
      game.armNextRoll(
        oneOf("setNextRoll", "type", type, COMPONENT_ORDER) as ComponentType,
        int("setNextRoll", "quality", quality, 1, 5) as Tier,
      );
    },
    clearNextRoll() {
      game.clearNextRoll();
    },
    // The rock enters through the real placement path, so it is refused exactly as a pointer
    // press would be when the footprint is illegal or the allowance is spent.
    placeRock(col, row) {
      const a = anchor("placeRock", col, row);
      game.placeStamp(a.col, a.row);
    },
    placeComponent(type, quality, col, row) {
      const t = oneOf(
        "placeComponent",
        "type",
        type,
        COMPONENT_ORDER,
      ) as ComponentType;
      const q = int("placeComponent", "quality", quality, 1, 5) as Tier;
      const a = anchor("placeComponent", col, row);
      game.placeComponent(t, q, a.col, a.row);
    },
    placeCombo(combo, col, row) {
      const c = oneOf("placeCombo", "combo", combo, COMBO_IDS) as ComboType;
      const a = anchor("placeCombo", col, row);
      game.placeCombo(c, a.col, a.row);
    },
    placeBlocker(col, row) {
      const a = anchor("placeBlocker", col, row);
      game.placeBlocker(a.col, a.row);
    },
    select(id) {
      game.select(structure("select", id));
    },
    clearSelection() {
      game.select(null);
    },
    addToCombineSet(id) {
      const n = num("addToCombineSet", "id", id);
      if (!game.baseStructureById(n))
        invalid("addToCombineSet", "an id a base structure carries", id);
      game.addToCombineSet(n);
    },
    clearCombineSet() {
      game.clearCombineSet();
    },
    keep(id) {
      game.keep(structure("keep", id));
    },
    downgrade(id) {
      game.downgrade(structure("downgrade", id));
    },
    combine(id) {
      game.debugCombine(structure("combine", id));
    },
    dismantle(id) {
      game.removeStructure(structure("dismantle", id));
    },
    setTargeting(id, priority) {
      const n = num("setTargeting", "id", id);
      if (!game.firingStructureById(n))
        invalid("setTargeting", "an id a firing structure carries", id);
      game.debugSetTargeting(
        n,
        oneOf(
          "setTargeting",
          "priority",
          priority,
          TARGETING_ORDER,
        ) as TargetingMode,
      );
    },
    setComboLevel(id, level) {
      const n = num("setComboLevel", "id", id);
      if (!game.comboById(n))
        invalid("setComboLevel", "an id a combination tower carries", id);
      game.setComboLevel(
        n,
        int("setComboLevel", "level", level, 0, MAX_COMBO_LEVEL),
      );
    },
    upgradeQuality() {
      game.upgradeQuality();
    },
    upgradeCombo(id) {
      const n = num("upgradeCombo", "id", id);
      if (!game.comboById(n))
        invalid("upgradeCombo", "an id a combination tower carries", id);
      game.upgradeCombo(n);
    },

    // ---- The Load --------------------------------------------------------------

    clearUnits() {
      game.clearUnits();
    },
    clearProjectiles() {
      game.clearProjectiles();
    },
    spawnUnit(type) {
      game.debugSpawn(
        oneOf("spawnUnit", "type", type, LOAD_TYPES) as LoadType | "overload",
      );
    },
    setUnitPosition(id, x, y) {
      const u = unit("setUnitPosition", id);
      game.setUnitPosition(
        u,
        num("setUnitPosition", "x", x),
        num("setUnitPosition", "y", y),
      );
    },
    setUnitWaypoint(id, index) {
      const u = unit("setUnitWaypoint", id);
      game.setUnitWaypoint(u, int("setUnitWaypoint", "index", index, 1, 7));
    },
    setUnitHp(id, hp) {
      const u = unit("setUnitHp", id);
      // The Overload Dynamo carries no depleting health, so it takes no health change.
      if (u.invincible)
        invalid("setUnitHp", "an id a unit with depleting health carries", id);
      const h = num("setUnitHp", "hp", hp);
      if (h < 1 || h > u.maxHp)
        invalid("setUnitHp", `hp to be in 1..${u.maxHp}`, hp);
      game.setUnitHp(u, h);
    },
    setUnitSlow(id, amount, seconds) {
      const u = unit("setUnitSlow", id);
      const a = num("setUnitSlow", "amount", amount);
      if (a < 0 || a > 1)
        invalid("setUnitSlow", "amount to be in 0..1", amount);
      const s = num("setUnitSlow", "seconds", seconds);
      if (s < 0) invalid("setUnitSlow", "seconds to be at least 0", seconds);
      game.setUnitSlow(u, a, s);
    },
    setUnitBurn(id, dps, seconds) {
      const u = unit("setUnitBurn", id);
      const d = num("setUnitBurn", "dps", dps);
      if (d < 0) invalid("setUnitBurn", "dps to be at least 0", dps);
      const s = num("setUnitBurn", "seconds", seconds);
      if (s < 0) invalid("setUnitBurn", "seconds to be at least 0", seconds);
      game.setUnitBurn(u, d, s);
    },
    setUnitFrozen(id, frozen) {
      game.setUnitFrozen(
        unit("setUnitFrozen", id),
        bool("setUnitFrozen", "frozen", frozen),
      );
    },

    // ---- Input -----------------------------------------------------------------
    // These feed the same input path the runtime layer feeds, so a posed press and a
    // player's press are the same event to the game. Each takes effect immediately.

    pointerMove(x, y) {
      ctx.pointerMove(num("pointerMove", "x", x), num("pointerMove", "y", y));
    },
    pointerDown(x, y) {
      ctx.pointerDown(num("pointerDown", "x", x), num("pointerDown", "y", y));
    },
    pointerUp() {
      ctx.pointerUp();
    },
    keyDown(code) {
      if (typeof code !== "string" || code.length === 0)
        invalid("keyDown", "code to be a KeyboardEvent.code", code);
      ctx.keyDown(code);
    },
    keyUp(code) {
      if (typeof code !== "string" || code.length === 0)
        invalid("keyUp", "code to be a KeyboardEvent.code", code);
      ctx.keyUp(code);
    },
  };

  (window as unknown as { __foundry?: FoundryDebugApi }).__foundry = api;
}

// ---- The diagnostics overlay (specs/instrumentation.md) ------------------------
// A read-only layer drawn over the finished frame, toggled by the backtick key. It draws the
// sources the game registers with it and reads the game without changing it, so watching the
// overlay leaves the game as it is. Kept visually plain and clearly separate from the HUD.

/** One line of the overlay: a short label and a pure read of the game. */
export interface DiagnosticSource {
  label: string;
  read(s: FoundrySnapshot): string;
}

export const DIAGNOSTICS: readonly DiagnosticSource[] = [
  {
    label: "screen",
    read: (s) =>
      `${s.screen}${s.phase ? ` / ${s.phase}` : ""}${s.paused ? " (paused)" : ""}`,
  },
  { label: "wave", read: (s) => `${s.wave} / ${s.totalWaves}` },
  { label: "charge", read: (s) => String(s.charge) },
  { label: "integrity", read: (s) => String(s.integrity) },
  { label: "refinement", read: (s) => `R${s.refinement}` },
  { label: "stamps", read: (s) => String(s.stampsLeft) },
  { label: "speed", read: (s) => `${s.speed}x` },
  { label: "maze", read: (s) => `${s.mazeLength.toFixed(1)} tiles` },
  { label: "units", read: (s) => String(s.units.length) },
  { label: "structures", read: (s) => String(s.structures.length) },
  {
    label: "selected",
    read: (s) => {
      if (s.selected === null) return "none";
      const sel = s.structures.find((t) => t.id === s.selected);
      if (!sel) return "none";
      return `#${sel.id}  dmg ${Math.round(sel.damage)}  rng ${Math.round(sel.range)}`;
    },
  },
];

export function drawDebugOverlay(
  ctx: CanvasRenderingContext2D,
  game: Game,
): void {
  const s = game.debugSnapshot();
  const lines = DIAGNOSTICS.map((d) => `${d.label.padEnd(11)} ${d.read(s)}`);

  ctx.save();
  ctx.textBaseline = "top";
  ctx.font = `500 13px ${FONT}`;
  const pad = 9;
  const lh = 17;
  const x0 = 8;
  const y0 = 62;
  let w = 0;
  for (const ln of lines) w = Math.max(w, ctx.measureText(ln).width);
  const boxW = Math.ceil(w) + pad * 2;
  const boxH = pad * 2 + lh * lines.length;
  ctx.fillStyle = "rgba(3,6,10,0.84)";
  ctx.fillRect(x0, y0, boxW, boxH);
  ctx.strokeStyle = "rgba(143,220,255,0.55)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x0 + 0.5, y0 + 0.5, boxW, boxH);
  ctx.fillStyle = "#9fe8ff";
  for (let i = 0; i < lines.length; i++)
    ctx.fillText(lines[i]!, x0 + pad, y0 + pad + i * lh);
  ctx.restore();
}
