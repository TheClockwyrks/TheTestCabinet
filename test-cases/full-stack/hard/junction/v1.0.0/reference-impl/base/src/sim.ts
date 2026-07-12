// Junction — the Game: owns the world/camera/economy state and the state machine, and
// orders the fixed simulation step (specs/flow.md, DESIGN §4, §5.2).
//
// `fixedStep(dt)` is the whole tick, in the order DESIGN §4 fixes:
//   transit → utilities → develop → pollution/land → (monthly) RCI + budget settle → stats +
//   milestones. It is DOM-free and deterministic, driven identically by the browser loop and
//   the headless balance harness / proof hook. The Game also exposes the player actions
//   (tools, tax, speed, overlay, pause), the notification/sound/fx queues the presentation
//   layer drains, and the scripted control surface (`newCity`, `zoneRect`, `road`, `advance`,
//   `snapshot`, `forceBankruptcy`, …) that `main.ts` wires to `window.__junction`.

import { Camera } from "./camera";
import {
  FIXED_STEP,
  JOBS,
  MILESTONES,
  NET_RAIL,
  NET_ROAD,
  POP,
  POP_MILESTONES,
  SHOP_CAP,
  START_MONTH,
  TAX_MAX,
  TAX_MIN,
  TAX_STEP,
  TICKS_PER_MONTH,
  TILE,
  TILE_COUNT,
} from "./constants";
import { computeStationBonus, recomputeLand, settleBudget, stepPollution, updateRci } from "./economy";
import { stepDevelopment } from "./develop";
import { rebuildNetworks } from "./graph";
import { rebuildSignals, stepTransit } from "./transit";
import { applyTool, tilesForDrag } from "./tools";
import { stepUtilities } from "./utilities";
import { MODE, type CityMode } from "./mode";
import { Rng } from "./rng";
import { World, generateValley, idx } from "./world";
import type { ApplyResult } from "./tools";
import type { Budget, Clock, Cue, FxEvent, GameState, GameStats, Notification, Overlay, Rci, Signal, Tool, Vehicle, ZoneKind } from "./types";

const NOTIFY_TTL = 6; // seconds a HUD toast lives
const MAX_NOTIFICATIONS = 5;
const DISTRICT_MILESTONE = 8; // fully-served developed tiles that count as a "district"

const ZONE_TOOL: Record<ZoneKind, Tool> = { res: "zoneRes", com: "zoneCom", ind: "zoneInd" };

export interface Snapshot {
  population: number;
  peakPopulation: number;
  treasury: number;
  balance: number;
  monthsSurvived: number;
  bankrupt: boolean;
}

export class Game {
  readonly mode: CityMode;
  world: World;
  camera = new Camera();

  state: GameState = "title";
  overlay: Overlay = "none";
  activeTool: Tool | null = null;
  paused = false; // in-place pause (specs/controls.md) — distinct from the paused STATE
  speed: 1 | 2 | 3 = 1;

  vehicles: Vehicle[] = [];
  signals: Signal[] = [];
  rci: Rci = { r: 0, c: 0, d: 0 };
  budget: Budget = { treasury: 0, income: 0, upkeep: 0, balance: 0, taxRate: 0 };
  stats: GameStats = emptyStats();
  clock: Clock = { ...START_MONTH };

  notifications: Notification[] = [];
  private milestonesFired = new Set<string>();

  hoverTile = -1;
  selectedTile = -1;

  // Queues drained by the presentation layer each frame (sim owns no audio/canvas).
  sndQueue: Cue[] = [];
  fxQueue: FxEvent[] = [];

  rng = new Rng(1);
  nextVehicleId = 1;
  private tickCount = 0;

  // Derived flags refreshed by recomputeStats (drive the milestone checks cheaply).
  private railTiles = 0;
  private tier3Tiles = 0;
  private servedDistrict = 0;

  constructor(mode: CityMode = MODE) {
    this.mode = mode;
    this.world = generateValley(mode.seed); // a valley behind the title menu for atmosphere
    this.markNetworksDirty();
  }

  // ---- Lifecycle / state machine ---------------------------------------------
  // Start a fresh city (specs/mode.md): a new valley, the pre-placed stub, the starting
  // treasury/tax/demand, the camera centred on the stub, then straight into play.
  newCity(seed?: number): void {
    const s = (seed ?? this.mode.seed) >>> 0;
    this.world = generateValley(s);
    this.rng = new Rng(s ^ 0x9e3779b9);

    // The short pre-placed starting road stub (mode owns the geometry).
    for (let k = 0; k < this.mode.stub.len; k++) {
      const col = this.mode.stub.col + k;
      const row = this.mode.stub.row;
      if (col >= 0 && col < this.world.cols && row >= 0 && row < this.world.rows) {
        this.world.setNet(idx(col, row), NET_ROAD);
      }
    }

    this.budget = { treasury: this.mode.startTreasury, income: 0, upkeep: 0, balance: 0, taxRate: this.mode.startTax };
    this.rci = { ...this.mode.startRci };
    this.stats = emptyStats();
    this.clock = { ...START_MONTH };
    this.vehicles = [];
    this.notifications = [];
    this.milestonesFired.clear();
    this.tickCount = 0;
    this.nextVehicleId = 1;
    this.paused = false;
    this.speed = 1;
    this.activeTool = null;
    this.overlay = "none";
    this.selectedTile = -1;
    this.hoverTile = -1;

    this.markNetworksDirty();
    recomputeLand(this.world);
    this.recomputeStats();
    this.camera.centerOnTile(this.mode.centerCol, this.mode.centerRow);
    this.state = "playing";
  }

  showHowto(): void {
    this.state = "howto";
  }
  backToTitle(): void {
    this.state = "title";
  }
  openPauseMenu(): void {
    if (this.state === "playing") this.state = "paused";
  }
  resume(): void {
    if (this.state === "paused") this.state = "playing";
  }
  restart(): void {
    this.newCity();
  }
  quitToMenu(): void {
    this.state = "title";
    this.vehicles = [];
  }

  // Re-label the carrier components + station bonus + signals after any tool edit.
  markNetworksDirty(): void {
    rebuildNetworks(this.world);
    computeStationBonus(this.world);
    rebuildSignals(this);
  }

  declareBankrupt(): void {
    if (this.state === "bankrupt") return;
    this.state = "bankrupt";
    this.activeTool = null;
    this.paused = false;
    this.notify("CITY BANKRUPT", "alert");
    this.sndQueue.push("alert");
  }

  // ---- The fixed simulation step (DESIGN §4 order) ---------------------------
  fixedStep(dt: number): void {
    if (this.state !== "playing" || this.paused) return;
    this.tickCount++;
    stepTransit(this, dt);
    stepUtilities(this);
    stepDevelopment(this);
    stepPollution(this.world);
    recomputeLand(this.world);
    this.recomputeStats();
    if (this.tickCount % TICKS_PER_MONTH === 0) {
      updateRci(this);
      settleBudget(this);
      this.raiseBudgetAlert();
    }
    this.checkMilestones();
    this.ageNotifications(dt);
  }

  // Aggregate the developed tiles into the HUD stats + the milestone flags in one sweep.
  private recomputeStats(): void {
    const w = this.world;
    let population = 0;
    let jobs = 0;
    let shops = 0;
    let rail = 0;
    let tier3 = 0;
    let district = 0;
    for (let i = 0; i < TILE_COUNT; i++) {
      if (w.net[i]! & NET_RAIL) rail++;
      if (!w.developedAt(i)) continue;
      const t = w.tier[i]!;
      const z = w.zoneAt(i)!;
      if (z === "res") population += POP.res[t]!;
      else if (z === "com") {
        jobs += JOBS.com[t]!;
        shops += SHOP_CAP.com[t]!;
      } else jobs += JOBS.ind[t]!;
      if (t >= 3) tier3++;
      if (w.powered[i]! && w.watered[i]! && w.access[i]!) district++;
    }
    this.stats.population = population;
    this.stats.jobs = jobs;
    this.stats.shops = shops;
    this.stats.peakPopulation = Math.max(this.stats.peakPopulation, population);
    this.railTiles = rail;
    this.tier3Tiles = tier3;
    this.servedDistrict = district;
  }

  private checkMilestones(): void {
    if (this.railTiles > 0) this.fireMilestone("first-rail");
    for (const threshold of POP_MILESTONES) {
      if (this.stats.population >= threshold) this.fireMilestone(`pop-${threshold}`);
    }
    if (this.tier3Tiles > 0) this.fireMilestone("first-tier3");
    if (this.servedDistrict >= DISTRICT_MILESTONE) this.fireMilestone("first-district");
  }

  private fireMilestone(id: string): void {
    if (this.milestonesFired.has(id)) return;
    this.milestonesFired.add(id);
    const label = MILESTONES.find((m) => m.id === id)?.label ?? id;
    this.notify(label, "good");
    this.sndQueue.push("chime");
    // Fireworks at the current view centre so the flourish is on-screen.
    this.fxQueue.push({ kind: "fireworks", x: this.camera.cx, y: this.camera.cy, strength: 1 });
  }

  private raiseBudgetAlert(): void {
    if (this.budget.balance < 0 && this.budget.treasury < this.mode.startTreasury * 0.25) {
      this.notify("LOSING MONEY", "alert");
      this.sndQueue.push("alert");
    }
  }

  private notify(text: string, tone: Notification["tone"]): void {
    this.notifications.push({ text, age: 0, ttl: NOTIFY_TTL, tone });
    if (this.notifications.length > MAX_NOTIFICATIONS) this.notifications.shift();
  }

  private ageNotifications(dt: number): void {
    for (const n of this.notifications) n.age += dt;
    this.notifications = this.notifications.filter((n) => n.age < n.ttl);
  }

  // ---- Player actions (called by input, routed via clickables) ---------------
  selectTool(tool: Tool | null): void {
    this.activeTool = tool;
  }
  setSpeed(n: number): void {
    this.speed = (n < 1 ? 1 : n > 3 ? 3 : n) as 1 | 2 | 3;
  }
  cycleSpeed(): void {
    this.setSpeed(this.speed >= 3 ? 1 : this.speed + 1);
  }
  setOverlay(o: Overlay): void {
    this.overlay = o;
  }
  cycleOverlay(): void {
    const order: Overlay[] = ["none", "traffic", "utility", "landvalue"];
    this.overlay = order[(order.indexOf(this.overlay) + 1) % order.length]!;
  }
  togglePause(): void {
    if (this.state === "playing") this.paused = !this.paused;
  }
  setTaxRate(rate: number): void {
    const stepped = Math.round(rate / TAX_STEP) * TAX_STEP;
    this.budget.taxRate = Math.max(TAX_MIN, Math.min(TAX_MAX, Number(stepped.toFixed(2))));
  }
  taxUp(): void {
    this.setTaxRate(this.budget.taxRate + TAX_STEP);
  }
  taxDown(): void {
    this.setTaxRate(this.budget.taxRate - TAX_STEP);
  }
  setHover(tile: number): void {
    this.hoverTile = tile;
  }
  setSelected(tile: number): void {
    this.selectedTile = tile;
  }
  centerOn(col: number, row: number): void {
    this.camera.centerOnTile(col, row);
  }
  panBy(dx: number, dy: number): void {
    this.camera.panBy(dx, dy);
  }

  // Apply the active tool over an explicit tile list (single click) or a drag run/rectangle.
  applyToolTiles(tool: Tool, tiles: number[]): ApplyResult {
    if (this.state !== "playing") return { placed: 0, spent: 0 };
    return applyTool(this, tool, tiles);
  }
  applyDrag(tool: Tool, c0: number, r0: number, c1: number, r1: number): ApplyResult {
    return this.applyToolTiles(tool, tilesForDrag(tool, c0, r0, c1, r1));
  }

  // ---- Scripted control surface (window.__junction / balance harness) --------
  // Each helper drives the real Game methods — no fake state — so the captures are
  // reproducible (DESIGN §6).
  zoneRect(kind: ZoneKind, c0: number, r0: number, c1: number, r1: number): ApplyResult {
    return this.applyDrag(ZONE_TOOL[kind], c0, r0, c1, r1);
  }
  road(c0: number, r0: number, c1: number, r1: number): ApplyResult {
    return this.applyDrag("road", c0, r0, c1, r1);
  }
  rail(c0: number, r0: number, c1: number, r1: number): ApplyResult {
    return this.applyDrag("rail", c0, r0, c1, r1);
  }
  wire(c0: number, r0: number, c1: number, r1: number): ApplyResult {
    return this.applyDrag("wire", c0, r0, c1, r1);
  }
  pipe(c0: number, r0: number, c1: number, r1: number): ApplyResult {
    return this.applyDrag("pipe", c0, r0, c1, r1);
  }
  station(col: number, row: number): ApplyResult {
    return this.applyToolTiles("station", [idx(col, row)]);
  }
  plant(col: number, row: number): ApplyResult {
    return this.applyToolTiles("plant", [idx(col, row)]);
  }
  source(col: number, row: number): ApplyResult {
    return this.applyToolTiles("source", [idx(col, row)]);
  }
  bulldozeRect(c0: number, r0: number, c1: number, r1: number): ApplyResult {
    return this.applyToolTiles("bulldoze", tilesForDrag("bulldoze", c0, r0, c1, r1));
  }
  setTax(rate: number): void {
    this.setTaxRate(rate);
  }

  // Run `months` whole budget periods of simulation (used by the proof/harness).
  advance(months: number): void {
    const ticks = Math.max(0, Math.round(months * TICKS_PER_MONTH));
    for (let k = 0; k < ticks; k++) {
      if (this.state !== "playing") break;
      this.fixedStep(FIXED_STEP);
    }
  }

  // Drop tax to zero so income dries up and upkeep drives the treasury toward the debt
  // limit — the deliberate slide into bankruptcy for the crisis clip (DESIGN §6).
  forceBankruptcy(): void {
    this.setTaxRate(0);
  }

  snapshot(): Snapshot {
    return {
      population: this.stats.population,
      peakPopulation: this.stats.peakPopulation,
      treasury: Math.round(this.budget.treasury),
      balance: Math.round(this.budget.balance),
      monthsSurvived: this.stats.monthsSurvived,
      bankrupt: this.state === "bankrupt",
    };
  }

  // World-pixel size of a tile (handy for the render/proof layers that import the Game).
  get tilePx(): number {
    return TILE;
  }
}

function emptyStats(): GameStats {
  return {
    population: 0,
    jobs: 0,
    shops: 0,
    peakPopulation: 0,
    power: { supply: 0, demand: 0 },
    water: { supply: 0, demand: 0 },
    monthsSurvived: 0,
  };
}
