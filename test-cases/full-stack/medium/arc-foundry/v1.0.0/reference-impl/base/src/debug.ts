// Arc Foundry — the debugging and automation API installed on window.__foundry, plus the
// read-only debug overlay (specs/instrumentation.md).
//
// A thin surface over the exact game the UI drives: it advances the real fixed-timestep
// simulation (game.fixedStep, via the bootstrap loop's manual clock) and reads the real
// state (game.debugSnapshot). Control operations only ARRANGE a situation — a placed rock
// rolls through the real press, a kept candidate harvests through the real path, a combine
// resolves through the real combine code, a spawned unit walks the real pathfinder — and the
// observed result always comes from stepping the real simulation forward. Injected input
// flows through the same keyboard/pointer handlers the real player feeds. Inert during
// normal play: nothing here runs until something calls it.

import { FIXED_STEP, FONT } from "./constants";
import type { Game, FoundrySnapshot } from "./sim";
import type { ComponentType, Difficulty, LoadType, TargetingMode, Tier } from "./types";

// The bootstrap wiring the API routes through: the live game, the manual-clock flag it owns,
// the real input handlers, and the run/pointer helpers. Everything the surface needs that
// lives in the animation-frame loop rather than on the game.
export interface DebugContext {
  game: Game;
  clock: { autoStep: boolean };
  processInput(): void; // the loop's once-per-frame input drain + route
  routeClickAt(x: number, y: number, shift: boolean): void; // the loop's board/HUD click router
  cancelHeld(): void; // right-click cancels a held rock
  startRun(map: string, difficulty: Difficulty): void; // begin a run as the menus would
  setPointer(x: number, y: number): void; // move the pointer (held-ghost / hover)
  resetUi(): void; // clear the loop's menu-index / overlay / pending-map UI state
  panelButtons(): PanelButton[]; // the inspector's action buttons as last rendered
}

// One inspector action button as the panel last drew it: where it sits, what it reads, and
// whether it is currently usable (specs/instrumentation.md).
export interface PanelButton {
  action: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  disabled: boolean;
}

export interface FoundryDebugApi {
  version: number;
  reset(options?: { seed?: number }): void;
  step(seconds: number): void;
  setAutoStep(enabled: boolean): void;
  snapshot(): FoundrySnapshot;
  panelButtons(): PanelButton[];
  startRun(options?: { map?: string; difficulty?: Difficulty }): void;
  setCharge(amount: number): void;
  setIntegrity(amount: number): void;
  setRefinement(level: number): void;
  setWave(n: number): void;
  setNextRoll(type: ComponentType | null, quality?: Tier): void;
  placeRock(col: number, row: number): void;
  select(id: number): void;
  setCombineSet(ids: number[]): void;
  keep(id: number): void;
  downgrade(id: number): void;
  combine(initiatorId: number): void;
  dismantle(id: number): void;
  setTargeting(id: number, priority: TargetingMode): void;
  upgradeQuality(): void;
  upgradeCombo(id: number): void;
  spawnUnit(type: LoadType | "overload", options?: { count?: number; wave?: number }): void;
  keyDown(code: string): void;
  keyUp(code: string): void;
  press(code: string): void;
  pointerMove(x: number, y: number): void;
  click(x: number, y: number): void;
  rightClick(x: number, y: number): void;
  shiftClick(x: number, y: number): void;
}

// Map a standard KeyboardEvent.code to the KeyboardEvent.key the game's input layer routes on
// (specs/controls.md reads e.key). Letters lowercase; the named keys the game binds map through.
function codeToKey(code: string): string {
  if (code.length === 4 && code.startsWith("Key")) return code.slice(3).toLowerCase();
  if (code.length === 6 && code.startsWith("Digit")) return code.slice(5);
  switch (code) {
    case "Space":
      return " ";
    case "Enter":
    case "NumpadEnter":
      return "Enter";
    case "Backquote":
      return "`";
    case "ShiftLeft":
    case "ShiftRight":
      return "Shift";
    default:
      // Escape, ArrowUp/Down/Left/Right, Delete, Backspace, Tab, … already equal e.key.
      return code;
  }
}

export function installDebugApi(ctx: DebugContext): void {
  const { game, clock } = ctx;

  const api: FoundryDebugApi = {
    version: 2,

    // Reset to the title state, reseed all randomness, and begin a driver-clocked session
    // (autoStep off — step() becomes the sole way the sim advances).
    reset(options) {
      game.debugReset(options?.seed);
      ctx.resetUi();
      clock.autoStep = false;
    },

    // Advance the real simulation by `seconds` of game time, in whole fixed steps, without
    // waiting on real frames; turns autoStep off. (fixedStep is inert on a menu / while paused.)
    step(seconds) {
      clock.autoStep = false;
      const steps = Math.max(0, Math.round(seconds / FIXED_STEP));
      for (let i = 0; i < steps; i++) game.fixedStep(FIXED_STEP);
    },

    // Hand the clock back to the animation-frame loop (real-time) or return to manual stepping.
    setAutoStep(enabled) {
      clock.autoStep = Boolean(enabled);
    },

    snapshot() {
      return game.debugSnapshot();
    },

    // The inspector's action buttons exactly as the panel last drew them, in slot order. The set
    // and the geometry depend only on which structure is selected, so a caller can assert the
    // panel did not reflow across a game-state change (specs/controls.md).
    panelButtons() {
      return ctx.panelButtons();
    },

    // ---- Control operations (arrange preconditions; route through the real systems) ----

    startRun(options) {
      ctx.startRun(options?.map ?? "substation", options?.difficulty ?? "medium");
    },

    setCharge(amount) {
      game.debugSetCharge(amount);
    },
    setIntegrity(amount) {
      game.debugSetIntegrity(amount);
    },
    setRefinement(level) {
      game.devSetRefinement(Math.max(0, Math.min(8, Math.floor(level))) as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8);
    },
    setWave(n) {
      game.debugSetWave(n);
    },

    setNextRoll(type, quality) {
      game.armNextRoll(type, quality ?? 1);
    },
    placeRock(col, row) {
      game.placeStamp(col, row);
    },
    select(id) {
      game.select(id);
    },
    setCombineSet(ids) {
      game.debugSetCombineSet(ids ?? []);
    },
    keep(id) {
      game.keep(id);
    },
    downgrade(id) {
      game.downgrade(id);
    },
    combine(initiatorId) {
      game.debugCombine(initiatorId);
    },
    dismantle(id) {
      game.removeStructure(id);
    },
    setTargeting(id, priority) {
      game.debugSetTargeting(id, priority);
    },
    upgradeQuality() {
      game.upgradeQuality();
    },
    upgradeCombo(id) {
      game.upgradeCombo(id);
    },

    spawnUnit(type, options) {
      game.debugSpawn(type, options?.count ?? 1, options?.wave);
    },

    // ---- Input operations (flow through the same handlers the real keyboard/mouse feed) ----

    // Inject a keydown through the very same path the real keyboard feeds (a dispatched
    // KeyboardEvent the Input listener catches), then apply the frame's one-shot action at
    // once so a caller need not wait for a render frame to see it take effect.
    keyDown(code) {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: codeToKey(code), code, bubbles: true }));
      ctx.processInput();
    },
    keyUp(code) {
      window.dispatchEvent(new KeyboardEvent("keyup", { key: codeToKey(code), code, bubbles: true }));
    },
    press(code) {
      this.keyDown(code);
      this.keyUp(code);
    },

    pointerMove(x, y) {
      ctx.setPointer(x, y);
    },
    // Route a click through the loop's board/HUD click router — the same routing a real
    // mousedown feeds after the fit transform maps it into logical space.
    click(x, y) {
      ctx.setPointer(x, y);
      ctx.routeClickAt(x, y, false);
    },
    rightClick(x, y) {
      ctx.setPointer(x, y);
      ctx.cancelHeld();
    },
    shiftClick(x, y) {
      ctx.setPointer(x, y);
      ctx.routeClickAt(x, y, true);
    },
  };

  (window as unknown as { __foundry?: FoundryDebugApi }).__foundry = api;
}

// ---- The read-only debug overlay (specs/instrumentation.md) --------------------
// A diagnostic layer drawn over the running game (toggled with the backtick key by the
// bootstrap loop), reporting the same facts snapshot() does. It never changes gameplay; it
// only draws. Kept visually plain and clearly separate from the HUD.
const TYPE_ABBR: Record<ComponentType, string> = {
  capacitor: "CAP",
  coil: "COIL",
  emitter: "EMIT",
  arcnode: "ARC",
  discharge: "DISC",
  choke: "CHK",
  rectifier: "RECT",
  regulator: "REG",
};

export function drawDebugOverlay(ctx: CanvasRenderingContext2D, game: Game): void {
  const s = game.debugSnapshot();
  const lines: string[] = [
    `screen ${s.screen}   phase ${s.phase ?? "-"}   paused ${s.paused}`,
    `wave ${s.wave}/${s.totalWaves}   waveActive ${s.waveActive}`,
    `charge ${s.charge}   integrity ${s.integrity}   R${s.refinement}`,
    `stamps ${s.stampsLeft}   speed ${s.speed}x   muted ${s.muted}`,
    `units ${s.units.length}   towers ${s.towers.length}   proj ${s.projectiles.length}`,
    `maze ${s.mazeLength.toFixed(1)}t   rating ${Math.round(s.mazeRating)}   sim ${s.simTime.toFixed(2)}s`,
  ];
  const sel = s.selected != null ? s.towers.find((t) => t.id === s.selected) : undefined;
  if (sel) {
    const label = sel.type
      ? sel.kind === "combo"
        ? String(sel.type).toUpperCase()
        : (TYPE_ABBR[sel.type as ComponentType] ?? String(sel.type))
      : "—";
    const grade = sel.quality != null ? `T${sel.quality}` : sel.level != null ? `L${sel.level}` : "";
    lines.push(`sel #${sel.id} ${sel.kind} ${label} ${grade}`.trimEnd());
    lines.push(`  dmg ${sel.damage}  rng ${Math.round(sel.range)}  rate ${sel.fireRate}  tgt ${sel.targeting ?? "-"}`);
    if (sel.abilities.length) lines.push(`  abilities ${sel.abilities.join(",")}`);
  }

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
  for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i]!, x0 + pad, y0 + pad + i * lh);
  ctx.restore();
}
