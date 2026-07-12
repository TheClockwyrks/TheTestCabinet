// Junction — the simulation front-end binding (specs/simulation.md).
//
// The city simulation itself is authored in Rust and runs as WebAssembly (`sim-core/`,
// compiled to the committed `sim-core-pkg/`). This module is the thin TS layer that drives
// that core and presents it to the rest of the front end in the shape the renderer, HUD, and
// input layer already expect: a `Game` object whose fields read straight from the wasm core.
//
// The bulk per-tile state is read ZERO-COPY: the tile arrays live in the wasm module's linear
// memory and the `World` view here wraps them with typed-array views (rebuilt only when the
// backing buffer changes on a memory growth — the array pointers themselves are stable). The
// moving agents, HUD stats, menus, and notifications are tiny, so they cross as small
// per-frame copies. A frame is one `fixedStep` call plus direct reads — the front end never
// re-implements a rule; it forwards actions in and renders the state out.

import init, { Sim as WasmSim, wasm_memory } from "./sim-core-pkg/junction_sim_core.js";
import { Camera } from "./camera";
import { MAP_COLS, MAP_ROWS, TILE_COUNT } from "./constants";
import { colOf, rowOf, idx } from "./grid";
import type { Cue, FxEvent, FxKind, GameState, Overlay, Tool, VehicleKind, ZoneKind } from "./types";

// ---- Enum ↔ code tables (must mirror the Rust `types` module) ------------------
const STATES: GameState[] = ["title", "howto", "playing", "paused", "bankrupt"];
const OVERLAYS: Overlay[] = ["none", "traffic", "utility", "landvalue"];
const TOOL_CODES: Tool[] = ["zoneRes", "zoneCom", "zoneInd", "road", "rail", "station", "plant", "wire", "source", "pipe", "bulldoze"];
const CUES: Cue[] = ["build", "chime", "alert"];
const FX: FxKind[] = ["haze", "dust", "fireworks"];
const TONES: Array<"info" | "good" | "alert"> = ["info", "good", "alert"];
const VEHICLE_KINDS: VehicleKind[] = ["car", "truck", "tram"];
const SOURCE_KINDS: Array<"plant" | "source"> = ["plant", "source"];
const ZONES: ZoneKind[] = ["res", "com", "ind"];
const ZONE_TOOL: Record<ZoneKind, Tool> = { res: "zoneRes", com: "zoneCom", ind: "zoneInd" };

export interface MenuItem {
  label: string;
  action: string;
}

// A produced-source read the render/inspector layer uses.
export interface SourceView {
  col: number;
  row: number;
  kind: "plant" | "source";
  capacity: number;
  supplied: number;
}

// A visible vehicle, its interpolated world position already resolved by the core.
export interface VehicleView {
  kind: VehicleKind;
  x: number;
  y: number;
  angle: number;
  animT: number;
}

let initialized = false;

/// Load the wasm core once (idempotent). The `.wasm` is resolved page-relative by the
/// generated glue via `import.meta.url`, so it works under any base path (specs/simulation.md).
export async function initSim(): Promise<void> {
  if (!initialized) {
    await init();
    initialized = true;
  }
}

// ---- The tile-array views over wasm linear memory ------------------------------
// The renderer reads these directly. They are rebuilt only when the backing ArrayBuffer
// changes (a wasm memory growth detaches the old views); the tile-array pointers are stable
// because those Vecs are allocated once in the core and never resized.
class World {
  readonly cols = MAP_COLS;
  readonly rows = MAP_ROWS;
  terrain!: Uint8Array;
  zone!: Uint8Array;
  net!: Uint8Array;
  tier!: Uint8Array;
  powered!: Uint8Array;
  watered!: Uint8Array;
  access!: Uint8Array;
  build!: Float32Array;
  decay!: Float32Array;
  pollution!: Float32Array;
  land!: Float32Array;
  load!: Float32Array;
  cap!: Float32Array;
  private buf: ArrayBuffer | null = null;

  constructor(private wasm: WasmSim) {
    this.rebuild();
  }

  // Rebuild the views if the wasm memory buffer has changed since last time.
  ensure(): void {
    const mem = wasm_memory() as WebAssembly.Memory;
    if (mem.buffer !== this.buf) this.rebuild();
  }

  private rebuild(): void {
    const mem = wasm_memory() as WebAssembly.Memory;
    const b = mem.buffer;
    this.buf = b;
    const u8 = (ptr: number): Uint8Array => new Uint8Array(b, ptr, TILE_COUNT);
    const f32 = (ptr: number): Float32Array => new Float32Array(b, ptr, TILE_COUNT);
    this.terrain = u8(this.wasm.terrain_ptr());
    this.zone = u8(this.wasm.zone_ptr());
    this.net = u8(this.wasm.net_ptr());
    this.tier = u8(this.wasm.tier_ptr());
    this.powered = u8(this.wasm.powered_ptr());
    this.watered = u8(this.wasm.watered_ptr());
    this.access = u8(this.wasm.access_ptr());
    this.build = f32(this.wasm.build_ptr());
    this.decay = f32(this.wasm.decay_ptr());
    this.pollution = f32(this.wasm.pollution_ptr());
    this.land = f32(this.wasm.land_ptr());
    this.load = f32(this.wasm.load_ptr());
    this.cap = f32(this.wasm.cap_ptr());
  }

  zoneAt(i: number): ZoneKind | null {
    const z = this.zone[i]!;
    return z === 0 ? null : ZONES[z - 1]!;
  }
  developedAt(i: number): boolean {
    return this.zone[i]! !== 0 && this.tier[i]! > 0;
  }

  get sources(): SourceView[] {
    const p = this.wasm.sources();
    const out: SourceView[] = [];
    for (let k = 0; k < p.length; k += 5) {
      out.push({ col: p[k]!, row: p[k + 1]!, kind: SOURCE_KINDS[p[k + 2]!]!, capacity: p[k + 3]!, supplied: p[k + 4]! });
    }
    return out;
  }
}

// ---- The Game: the front-end handle to the wasm core ---------------------------
// Its readable fields are live getters over the core, so a value is never stale after an
// action; the camera is the one piece of spatial state the FRONT END owns (specs/simulation.md).
export class Game {
  readonly wasm: WasmSim;
  readonly camera = new Camera();
  readonly mode: { menuLabel: string; tagline: string };
  private readonly _world: World;

  constructor() {
    this.wasm = new WasmSim();
    this._world = new World(this.wasm);
    this.mode = { menuLabel: this.wasm.mode_menu_label(), tagline: this.wasm.mode_tagline() };
    this.centerOnMode();
  }

  // The tile view, guaranteed current (rebuilt if wasm memory grew since last access).
  get world(): World {
    this._world.ensure();
    return this._world;
  }

  private centerOnMode(): void {
    this.camera.centerOnTile(this.wasm.center_col(), this.wasm.center_row());
  }

  // ---- Live scalar / aggregate reads ----------------------------------------
  get state(): GameState {
    return STATES[this.wasm.state()]!;
  }
  get overlay(): Overlay {
    return OVERLAYS[this.wasm.overlay()]!;
  }
  get activeTool(): Tool | null {
    const c = this.wasm.active_tool();
    return c < 0 ? null : TOOL_CODES[c]!;
  }
  get paused(): boolean {
    return this.wasm.paused();
  }
  get speed(): number {
    return this.wasm.speed();
  }
  set speed(n: number) {
    this.wasm.set_speed(n);
  }
  get hoverTile(): number {
    return this.wasm.hover_tile();
  }
  get selectedTile(): number {
    return this.wasm.selected_tile();
  }
  get budget(): { treasury: number; income: number; upkeep: number; balance: number; taxRate: number } {
    return {
      treasury: this.wasm.treasury(),
      income: this.wasm.income(),
      upkeep: this.wasm.upkeep(),
      balance: this.wasm.balance(),
      taxRate: this.wasm.tax_rate(),
    };
  }
  get stats(): {
    population: number;
    jobs: number;
    shops: number;
    peakPopulation: number;
    monthsSurvived: number;
    power: { supply: number; demand: number };
    water: { supply: number; demand: number };
  } {
    return {
      population: this.wasm.population(),
      jobs: this.wasm.jobs(),
      shops: this.wasm.shops(),
      peakPopulation: this.wasm.peak_population(),
      monthsSurvived: this.wasm.months_survived(),
      power: { supply: this.wasm.power_supply(), demand: this.wasm.power_demand() },
      water: { supply: this.wasm.water_supply(), demand: this.wasm.water_demand() },
    };
  }
  get rci(): { r: number; c: number; d: number } {
    return { r: this.wasm.rci_r(), c: this.wasm.rci_c(), d: this.wasm.rci_d() };
  }
  get clock(): { month: number; year: number } {
    return { month: this.wasm.clock_month(), year: this.wasm.clock_year() };
  }

  get vehicles(): VehicleView[] {
    const p = this.wasm.vehicles();
    const out: VehicleView[] = [];
    for (let k = 0; k < p.length; k += 5) {
      out.push({ x: p[k]!, y: p[k + 1]!, angle: p[k + 2]!, kind: VEHICLE_KINDS[p[k + 3]!]!, animT: p[k + 4]! });
    }
    return out;
  }
  get signals(): Array<{ col: number; row: number; phase: number }> {
    const p = this.wasm.signals();
    const out: Array<{ col: number; row: number; phase: number }> = [];
    for (let k = 0; k < p.length; k += 3) out.push({ col: p[k]!, row: p[k + 1]!, phase: p[k + 2]! });
    return out;
  }
  get notifications(): Array<{ text: string; age: number; ttl: number; tone: "info" | "good" | "alert" }> {
    const n = this.wasm.notif_len();
    const out: Array<{ text: string; age: number; ttl: number; tone: "info" | "good" | "alert" }> = [];
    for (let i = 0; i < n; i++) {
      out.push({ text: this.wasm.notif_text(i), age: this.wasm.notif_age(i), ttl: this.wasm.notif_ttl(i), tone: TONES[this.wasm.notif_tone(i)]! });
    }
    return out;
  }

  // The source (if any) whose 2×2 footprint covers tile `i` — a placed-object read, not a rule.
  sourceCovering(i: number): SourceView | null {
    const c = colOf(i);
    const r = rowOf(i);
    for (const s of this.world.sources) {
      if (c >= s.col && c <= s.col + 1 && r >= s.row && r <= s.row + 1) return s;
    }
    return null;
  }

  // ---- Menus (the core owns the list + highlight index) ---------------------
  menuItems(): MenuItem[] {
    const n = this.wasm.menu_len();
    const out: MenuItem[] = [];
    for (let i = 0; i < n; i++) out.push({ label: this.wasm.menu_label(i), action: this.wasm.menu_action(i) });
    return out;
  }
  get menuIndex(): number {
    return this.wasm.menu_index();
  }
  menuMove(delta: number): void {
    this.wasm.menu_move(delta);
  }
  menuSetIndex(i: number): void {
    this.wasm.menu_set_index(i);
  }
  menuConfirm(): void {
    const item = this.menuItems()[this.menuIndex];
    if (item) this.dispatch(item.action);
  }

  // ---- Tool preview (legality + cost + refusal, computed in the core) --------
  toolPreview(anchor: number, hover: number): { cells: Array<{ i: number; ok: boolean }>; cost: number; refusal: string | null } {
    const tp = this.wasm.tool_preview(anchor, hover);
    const cost = tp.cost;
    const refusal = tp.refusal ?? null;
    const packed = tp.cells();
    tp.free();
    const cells: Array<{ i: number; ok: boolean }> = [];
    for (let k = 0; k < packed.length; k += 2) cells.push({ i: packed[k]!, ok: packed[k + 1]! !== 0 });
    return { cells, cost, refusal };
  }

  // ---- The tick + queue drains ----------------------------------------------
  fixedStep(dt: number): void {
    this.wasm.step(dt);
  }
  advance(months: number): void {
    this.wasm.advance(months);
  }
  drainSounds(): Cue[] {
    return Array.from(this.wasm.drain_sounds()).map((c) => CUES[c]!);
  }
  drainFx(): FxEvent[] {
    const p = this.wasm.drain_fx();
    const out: FxEvent[] = [];
    for (let k = 0; k < p.length; k += 4) out.push({ kind: FX[p[k]!]!, x: p[k + 1]!, y: p[k + 2]!, strength: p[k + 3]! });
    return out;
  }

  // ---- Player actions --------------------------------------------------------
  selectTool(tool: Tool | null): void {
    this.wasm.select_tool(tool === null ? -1 : TOOL_CODES.indexOf(tool));
  }
  dispatch(action: string): void {
    this.wasm.dispatch(action);
    // `menu:play`/`again`/`restart` start a fresh city; the camera (a front-end concern)
    // re-centres on the mode's focus tile since the core does not touch it.
    if (action === "menu:play" || action === "menu:again" || action === "menu:restart") this.centerOnMode();
  }
  applyDrag(tool: Tool, c0: number, r0: number, c1: number, r1: number): number {
    return this.wasm.apply_drag(TOOL_CODES.indexOf(tool), c0, r0, c1, r1);
  }
  applyStamp(tool: Tool, col: number, row: number): number {
    return this.wasm.apply_stamp(TOOL_CODES.indexOf(tool), col, row);
  }
  setHover(tile: number): void {
    this.wasm.set_hover(tile);
  }
  setSelected(tile: number): void {
    this.wasm.set_selected(tile);
  }
  setSpeed(n: number): void {
    this.wasm.set_speed(n);
  }
  cycleSpeed(): void {
    this.wasm.cycle_speed();
  }
  setOverlay(o: Overlay): void {
    this.wasm.set_overlay(OVERLAYS.indexOf(o));
  }
  cycleOverlay(): void {
    this.wasm.cycle_overlay();
  }
  togglePause(): void {
    this.wasm.toggle_pause();
  }
  taxUp(): void {
    this.wasm.tax_up();
  }
  taxDown(): void {
    this.wasm.tax_down();
  }
  setTax(rate: number): void {
    this.wasm.set_tax(rate);
  }
  centerOn(col: number, row: number): void {
    this.camera.centerOnTile(col, row);
  }

  // ---- State machine ---------------------------------------------------------
  newCity(seed?: number): void {
    if (seed === undefined) this.wasm.new_city();
    else this.wasm.new_city_seeded(seed >>> 0);
    this.centerOnMode();
  }
  showHowto(): void {
    this.wasm.show_howto();
  }
  backToTitle(): void {
    this.wasm.back_to_title();
  }
  openPauseMenu(): void {
    this.wasm.open_pause_menu();
  }
  resume(): void {
    this.wasm.resume();
  }
  restart(): void {
    this.wasm.restart();
    this.centerOnMode();
  }
  quitToMenu(): void {
    this.wasm.quit_to_menu();
  }
  setState(state: GameState): void {
    this.wasm.set_state(STATES.indexOf(state));
  }

  // ---- Scripted control surface (window.__junction, DESIGN §6) ---------------
  zoneRect(kind: ZoneKind, c0: number, r0: number, c1: number, r1: number): { placed: number } {
    return { placed: this.applyDrag(ZONE_TOOL[kind], c0, r0, c1, r1) };
  }
  road(c0: number, r0: number, c1: number, r1: number): { placed: number } {
    return { placed: this.applyDrag("road", c0, r0, c1, r1) };
  }
  rail(c0: number, r0: number, c1: number, r1: number): { placed: number } {
    return { placed: this.applyDrag("rail", c0, r0, c1, r1) };
  }
  wire(c0: number, r0: number, c1: number, r1: number): { placed: number } {
    return { placed: this.applyDrag("wire", c0, r0, c1, r1) };
  }
  pipe(c0: number, r0: number, c1: number, r1: number): { placed: number } {
    return { placed: this.applyDrag("pipe", c0, r0, c1, r1) };
  }
  station(col: number, row: number): { placed: number } {
    return { placed: this.applyStamp("station", col, row) };
  }
  plant(col: number, row: number): { placed: number } {
    return { placed: this.applyStamp("plant", col, row) };
  }
  source(col: number, row: number): { placed: number } {
    return { placed: this.applyStamp("source", col, row) };
  }
  bulldozeRect(c0: number, r0: number, c1: number, r1: number): { placed: number } {
    return { placed: this.applyDrag("bulldoze", c0, r0, c1, r1) };
  }
  setTreasury(value: number): void {
    this.wasm.set_treasury(value);
  }
  forceBankruptcy(): void {
    this.wasm.force_bankruptcy();
  }
  snapshot(): { population: number; peakPopulation: number; treasury: number; balance: number; monthsSurvived: number; bankrupt: boolean } {
    const s = this.wasm.snapshot();
    const o = {
      population: s.population,
      peakPopulation: s.peak_population,
      treasury: s.treasury,
      balance: s.balance,
      monthsSurvived: s.months_survived,
      bankrupt: s.bankrupt,
    };
    s.free();
    return o;
  }
}

/// Construct a Game after ensuring the wasm core is loaded.
export async function createGame(): Promise<Game> {
  await initSim();
  return new Game();
}

// Handy re-exports for the input layer (which maps a screen point to a tile then a core call).
export { idx };
