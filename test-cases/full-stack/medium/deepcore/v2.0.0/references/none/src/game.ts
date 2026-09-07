// Deepcore — the game: every piece of authoritative state, and the update that
// advances it (specs/expedition.md, specs/ui.md).
//
// The game is a small state machine over the live mine. `update(dt)` integrates one
// interval of game time against the delta time it is handed: it drills, moves the
// miner under physics, bills fuel and hull, applies the hazards and the Core Sample
// timer, follows the camera, and picks the animation state. Every rate is per second,
// so an interval of game time reaches the same state however it was divided into
// frames. Nothing here reads the renderer, so the whole simulation runs without a
// canvas, which is what makes it driveable from code and testable in Node.

import {
  BUILDINGS,
  BUILDING_H,
  BUILDING_REACH,
  BUILDING_W,
  CAM_LEAD_MAX,
  CAM_LEAD_RAMP,
  CAM_STILL_SPEED,
  CAM_UNWIND_MULT,
  CARGO_CAPACITY,
  CLIMB_CAP_FLOOR,
  DEFAULT_WORLD_SIZE,
  DEEPCORE_DEBUG_VERSION,
  DRILL_DAMAGE,
  FALL_TERMINAL_EMPTY,
  FALL_TERMINAL_LOADED,
  FUEL_TANK_MAX,
  GAS_SEEP_PERIOD,
  HULL_MAX,
  HURT_TIME,
  JETPACK_EMPTY_ACCEL,
  JETPACK_EMPTY_CLIMB,
  JETPACK_LIFT_LIMIT,
  LAUNCH_ANIM_TIME,
  LIFE_SUPPORT_BURN,
  LOW_FUEL_FRACTION,
  MAX_CAM_X,
  METERS_PER_ROW,
  MINER_H,
  MINER_W,
  NOTICE_DELAY,
  NOTICE_FADE,
  RADIATOR_EFFECTIVENESS,
  ROCKET_COMPONENTS,
  SCANNER_RANGE,
  SPAWN_COL,
  SURFACE_ROW,
  SURFACE_Y,
  THRUST_BURN_SIZE_MULT,
  TILE,
  VIEW_H,
  VIEW_W,
  WORLD_COLS,
  AIR_BURN,
  coreRowFor,
  thrustBurnAt,
} from "./constants";
import type { WorldSize } from "./constants";
import { updateDrill } from "./drill";
import { cargoUsed, cargoWeight, emptyCargo } from "./economy";
import { emptyItems, expireCoreTimer } from "./items";
import { DEATH_ANIM, finalizeDeath, triggerDeath } from "./modes";
import { landImpact, updateLavaContact } from "./hazards";
import {
  isGrounded,
  minerCenterX,
  minerCenterY,
  minerCol,
  minerFeetY,
  minerRow,
  stepMovement,
} from "./physics";
import type { MoveInput, MoveResult } from "./physics";
import { computeScan } from "./scanner";
import type { ScanResult } from "./scanner";
import { Rng } from "./rng";
import { allInstalled, nextComponent } from "./rocket";
import { clearSave, hasSave, readSave, writeSave } from "./save";
import {
  colCenterX,
  emptyMine,
  resizeGrid,
  generateMine,
  isMinableKind,
  tileLeft,
  tileMaxHealth,
} from "./world";
import type { MaterialNode } from "./world";
import type { Cue, LoopCue } from "./audio";
import type { FxEvent } from "./particles";
import type {
  Band,
  BuildingId,
  Cargo,
  DeathCause,
  GroundItem,
  Hazard,
  ItemCounts,
  Miner,
  Mode,
  OpenPanel,
  Ore,
  RocketComponentId,
  RunSummary,
  Satchel,
  Screen,
  Tile,
  TileKind,
  UpgradeTiers,
} from "./types";

/** A building's footprint in world units, as the debug surface reports it. */
export interface BuildingBox {
  id: BuildingId;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One cell's observable state. */
export interface TileRead {
  kind: TileKind;
  band: Band | null;
  ore: Ore | null;
  material: "resonite" | "cryenite" | null;
  health: number | null;
  maxHealth: number | null;
}

/** The whole observable state, as the debug surface reports it. */
export interface DeepcoreSnapshot {
  version: number;
  screen: Screen;
  panel: OpenPanel;
  mode: Mode;
  worldSize: WorldSize;
  coreRow: number;
  menuIndex: number;
  autoStep: boolean;
  muted: boolean;
  simTime: number;
  /** The expedition's own clock, in seconds. Rests at 0 until one begins. */
  elapsedSeconds: number;
  hasSave: boolean;
  credits: number;
  creditsEarned: number;
  depthMeters: number;
  deepestDepthMeters: number;
  coreTimer: number | null;
  coreGround: { col: number; row: number } | null;
  camera: { x: number; y: number; lead: number };
  miner: {
    x: number;
    y: number;
    vx: number;
    vy: number;
    col: number;
    row: number;
    facing: Miner["facing"];
    state: Miner["state"];
    grounded: boolean;
    travel: boolean;
    drill: boolean;
    fuel: number;
    maxFuel: number;
    hull: number;
    maxHull: number;
    overloaded: boolean;
    drilling: null | {
      col: number;
      row: number;
      dir: "down" | "left" | "right";
      progress: number;
    };
  };
  cargo: {
    slotsUsed: number;
    slotCap: number;
    loadKg: number;
    liftLimitKg: number;
    ore: Record<string, number>;
  };
  satchel: { resonite: number; cryenite: number; coreSample: boolean };
  tiers: UpgradeTiers;
  items: ItemCounts;
  rocket: {
    installed: RocketComponentId[];
    nextComponent: RocketComponentId | null;
  };
  scanner: {
    locked: boolean;
    target: "resonite" | "cryenite" | null;
    dirX: number;
    dirY: number;
    distanceTiles: number | null;
  };
  notice: null | { hazard: Hazard; shown: boolean };
  noticesFired: { gas: boolean; lava: boolean };
  nextTeleportHeight: number | null;
  nextTeleportSpeed: number | null;
  summary: null | {
    deepestDepthMeters: number;
    creditsEarned: number;
    elapsedSeconds: number;
    mode: Mode;
    componentsInstalled: number;
    deathCause: DeathCause | null;
  };
}

/** How long a note stays on screen. */
const NOTE_LIFE = 2.4;
/** Lateral speed above which the miner reads as walking. */
const WALK_READ_SPEED = 12;
/** Seconds between drill-debris bursts. */
const DRILL_FX_PERIOD = 0.09;
/** Seconds between jetpack-exhaust bursts. */
const THRUST_FX_PERIOD = 0.06;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export class Game {
  // --- The expedition ---
  screen: Screen = "title";
  /** The highlighted item on the current screen's menu. */
  menuIndex = 0;
  mode: Mode = "standard";
  /** The mode chosen at mode-select, held until a world size is picked. */
  pendingMode: Mode = "standard";
  worldSize: WorldSize = DEFAULT_WORLD_SIZE;
  /** The deepest row at the current world size: the Core chamber. */
  coreRow: number = coreRowFor(DEFAULT_WORLD_SIZE);
  panel: OpenPanel = null;
  credits = 0;
  creditsEarned = 0;
  cargo: Cargo = emptyCargo();
  satchel: Satchel = { resonite: 0, cryenite: 0, coreSample: false };
  tiers: UpgradeTiers = {
    fuel: 1,
    drill: 1,
    cargo: 1,
    hull: 1,
    jetpack: 1,
    radiator: 1,
    scanner: 1,
  };
  installed = new Set<RocketComponentId>();
  items: ItemCounts = emptyItems();
  groundItems: GroundItem[] = [];
  coreTimer: number | null = null;
  deepestDepthMeters = 0;
  elapsedSeconds = 0;
  summary: RunSummary | null = null;
  deathCause: DeathCause | null = null;

  // --- The mine and the miner ---
  grid: Tile[][] = [];
  nodes: MaterialNode[] = [];
  miner: Miner = {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    facing: "east",
    state: "idle",
    fuel: FUEL_TANK_MAX[0]!,
    hull: HULL_MAX[0]!,
    drilling: null,
    travel: true,
    drill: true,
  };

  // --- The camera ---
  camX = 0;
  camY = 0;
  /** The carried vertical lead, in world units, positive downward. */
  camLead = 0;

  // --- Session state ---
  /** Accumulated game time, in seconds, whatever the screen. */
  simTime = 0;
  /** The audio mute toggle, which the runtime mirrors. */
  muted = false;
  /** False while a caller clocks the game rather than the wall clock. */
  autoStep = true;
  /** Whether the read-only diagnostics overlay is drawn. */
  overlayVisible = false;
  /** The game's private random source. */
  rng = new Rng();
  /** The height, in tiles, posed for the next Quantum Teleporter use, else null. */
  nextTeleportHeight: number | null = null;
  /** The downward speed posed for the next Quantum Teleporter use, else null. */
  nextTeleportSpeed: number | null = null;

  // --- Transient ---
  input: MoveInput = { left: false, right: false, down: false, thrust: false };
  sndQueue: Cue[] = [];
  fxQueue: FxEvent[] = [];
  activeLoops = new Set<LoopCue>();
  notes: { text: string; t: number }[] = [];
  hurtT = 0;
  dying: { cause: DeathCause; t: number } | null = null;
  launchAnim: number | null = null;
  scan: ScanResult = {
    locked: false,
    target: null,
    dirX: 0,
    dirY: 0,
    distanceTiles: null,
  };
  shakeT = 0;
  shakeAmp = 0;
  drillFxCd = 0;
  thrustFxCd = 0;
  lavaFxCd = 0;
  gasSeepCd = 0;
  private gasSeepIndex = 0;

  /** The one-time hazard notice: armed while `shown` is false, on screen while true. */
  notice: { hazard: Hazard; shown: boolean; t: number } | null = null;
  noticesFired: { gas: boolean; lava: boolean } = { gas: false, lava: false };

  constructor() {
    this.grid = generateMine(this.rng, this.coreRow).grid;
    this.placeMinerAtSpawn();
    this.recenterCamera();
  }

  // -------------------------------------------------------------------------
  // Figures derived from the upgrade tiers
  // -------------------------------------------------------------------------

  maxFuel(): number {
    return FUEL_TANK_MAX[this.tiers.fuel - 1]!;
  }
  maxHull(): number {
    return HULL_MAX[this.tiers.hull - 1]!;
  }
  cargoCap(): number {
    return CARGO_CAPACITY[this.tiers.cargo - 1]!;
  }
  drillDamage(): number {
    return DRILL_DAMAGE[this.tiers.drill - 1]!;
  }
  scannerRange(): number {
    return SCANNER_RANGE[this.tiers.scanner - 1]!;
  }
  radiatorEffect(): number {
    return RADIATOR_EFFECTIVENESS[this.tiers.radiator - 1]!;
  }
  liftLimitKg(): number {
    return JETPACK_LIFT_LIMIT[this.tiers.jetpack - 1]!;
  }
  slotsUsed(): number {
    return cargoUsed(this.cargo);
  }
  loadKg(): number {
    return cargoWeight(this.cargo);
  }

  /** The load fraction: the weight in the bay over the tier's lift limit. */
  loadFraction(): number {
    return this.loadKg() / this.liftLimitKg();
  }

  /** True once the load meets the lift limit, at which point no climb is possible. */
  overloaded(): boolean {
    return this.loadFraction() >= 1;
  }

  /** The net upward acceleration the jetpack produces at the current load. */
  climbAccel(): number {
    return (
      JETPACK_EMPTY_ACCEL[this.tiers.jetpack - 1]! *
      Math.max(0, 1 - this.loadFraction())
    );
  }

  /** The upward speed cap at the current load. */
  climbCap(): number {
    const empty = JETPACK_EMPTY_CLIMB[this.tiers.jetpack - 1]!;
    return (
      empty * (1 - (1 - CLIMB_CAP_FLOOR) * Math.min(1, this.loadFraction()))
    );
  }

  /** The terminal fall speed at the current load. */
  fallTerminal(): number {
    return (
      FALL_TERMINAL_EMPTY +
      (FALL_TERMINAL_LOADED - FALL_TERMINAL_EMPTY) *
        Math.min(1, this.loadFraction())
    );
  }

  /** The miner's depth in meters, read off its feet. */
  depthMeters(): number {
    return Math.max(
      0,
      ((minerFeetY(this.miner) - SURFACE_Y) / TILE) * METERS_PER_ROW,
    );
  }

  /** Whether the miner is at or above the camp ground. */
  atSurface(): boolean {
    return minerRow(this.miner) <= SURFACE_ROW;
  }

  /** The deepest row the mine holds below the Core chamber's row. */
  deepestMinableRow(): number {
    return this.coreRow - 1;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Move to size-select with the expedition's mode set to the one chosen
   * (specs/ui.md), holding it until a size is picked.
   */
  chooseMode(mode: Mode): void {
    this.mode = mode;
    this.pendingMode = mode;
    this.menuIndex = 0;
    this.screen = "size-select";
  }

  /** Start a fresh expedition, which abandons any existing save. */
  newExpedition(mode: Mode, size: WorldSize): void {
    clearSave();
    this.mode = mode;
    this.worldSize = size;
    this.coreRow = coreRowFor(size);
    const mine = generateMine(this.rng, this.coreRow);
    this.grid = mine.grid;
    this.nodes = mine.nodes;
    this.credits = 0;
    this.creditsEarned = 0;
    this.cargo = emptyCargo();
    this.satchel = { resonite: 0, cryenite: 0, coreSample: false };
    this.tiers = {
      fuel: 1,
      drill: 1,
      cargo: 1,
      hull: 1,
      jetpack: 1,
      radiator: 1,
      scanner: 1,
    };
    this.installed = new Set();
    this.items = emptyItems();
    this.groundItems = [];
    this.coreTimer = null;
    this.deepestDepthMeters = 0;
    this.elapsedSeconds = 0;
    this.summary = null;
    this.deathCause = null;
    this.clearTransients();
    this.placeMinerAtSpawn();
    this.miner.fuel = this.maxFuel();
    this.miner.hull = this.maxHull();
    this.recenterCamera();
    this.menuIndex = 0;
    this.screen = "in-mine";
  }

  /** Everything that belongs to a moment rather than to the expedition. */
  private clearTransients(): void {
    this.panel = null;
    this.dying = null;
    this.launchAnim = null;
    this.hurtT = 0;
    this.notes = [];
    this.shakeT = 0;
    this.shakeAmp = 0;
    this.notice = null;
    this.noticesFired = { gas: false, lava: false };
    this.gasSeepIndex = 0;
    this.miner.travel = true;
    this.miner.drill = true;
  }

  /** Stand the miner on the camp ground above SPAWN_COL, at rest and facing east. */
  placeMinerAtSpawn(): void {
    const m = this.miner;
    m.x = colCenterX(SPAWN_COL, MINER_W);
    m.y = SURFACE_Y - MINER_H;
    m.vx = 0;
    m.vy = 0;
    m.facing = "east";
    m.state = "idle";
    m.drilling = null;
  }

  note(text: string): void {
    this.notes.unshift({ text, t: NOTE_LIFE });
    if (this.notes.length > 4) this.notes.length = 4;
  }

  /** Arm the hurt animation state, which holds for HURT_TIME from the blow. */
  hurt(): void {
    this.hurtT = HURT_TIME;
  }

  /** Kick a render-only screen shake, taking the stronger of any already running. */
  addShake(amp: number, time: number): void {
    this.shakeAmp = Math.max(this.shakeAmp, amp);
    this.shakeT = Math.max(this.shakeT, time);
  }

  /**
   * Raise the one-time notice for a hazard, at most once per expedition. The card
   * waits out NOTICE_DELAY so the blow lands before the explanation appears.
   */
  raiseNotice(hazard: Hazard): void {
    if (this.noticesFired[hazard] || this.notice) return;
    this.noticesFired[hazard] = true;
    this.notice = { hazard, shown: false, t: NOTICE_DELAY };
  }

  /** Dismiss the notice card on screen. */
  dismissNotice(): void {
    this.notice = null;
  }

  makeSummary(deathCause: DeathCause | null): RunSummary {
    return {
      deepestDepthMeters: this.deepestDepthMeters,
      creditsEarned: this.creditsEarned,
      elapsedSeconds: this.elapsedSeconds,
      mode: this.mode,
      componentsInstalled: this.installed.size,
      deathCause,
    };
  }

  // -------------------------------------------------------------------------
  // The update
  // -------------------------------------------------------------------------

  /** Advance the game by `dt` seconds of game time. */
  update(dt: number): void {
    // Accumulated game time runs on every screen, so a caller can clock a menu.
    this.simTime += dt;
    if (this.screen !== "in-mine") return;

    this.elapsedSeconds += dt;
    this.decayNotes(dt);
    if (this.hurtT > 0) this.hurtT = Math.max(0, this.hurtT - dt);
    if (this.shakeT > 0) {
      this.shakeT = Math.max(0, this.shakeT - dt);
      if (this.shakeT === 0) this.shakeAmp = 0;
    }
    this.advanceNotice(dt);

    // The Core Sample's timer runs everywhere the expedition does.
    if (this.coreTimer !== null) {
      this.coreTimer -= dt;
      if (this.coreTimer <= 0) {
        this.coreTimer = 0;
        expireCoreTimer(this);
      }
    }

    if (this.launchAnim !== null) {
      this.advanceLaunch(dt);
      return;
    }

    if (this.dying) {
      this.advanceDeath(dt);
      return;
    }

    if (this.panel !== null) {
      // The world holds still behind an overlay; the Core timer above still ran.
      this.activeLoops.clear();
      if (this.coreTimer !== null) this.activeLoops.add("alarm-core");
      this.updateCamera(dt);
      // specs/character.md: an empty hull is never a state the expedition
      // continues from, and no open panel or overlay suspends the check.
      if (this.miner.hull <= 0) triggerDeath(this, "hull-destroyed");
      return;
    }

    this.updateLive(dt);
  }

  private updateLive(dt: number): void {
    updateDrill(this, dt);
    const braced = this.miner.drilling !== null;

    let move: MoveResult;
    if (braced) {
      if (this.miner.travel) {
        this.miner.vx = 0;
        this.miner.vy = 0;
      }
      move = {
        grounded: true,
        thrusting: false,
        lateralAir: false,
        landedSpeed: 0,
      };
    } else {
      move = stepMovement(
        this.miner,
        this.grid,
        this.input,
        this.miner.fuel > 0,
        dt,
        this.climbAccel(),
        this.climbCap(),
        this.fallTerminal(),
      );
    }

    if (move.thrusting) {
      this.thrustFxCd -= dt;
      if (this.thrustFxCd <= 0) {
        this.thrustFxCd = THRUST_FX_PERIOD;
        this.fxQueue.push({
          kind: "jetpack-exhaust",
          x: minerCenterX(this.miner),
          y: this.miner.y + MINER_H,
        });
      }
    }

    // Fuel. The thrust burn eases with the upward speed and is the only drain the
    // world size scales; walking and standing still cost nothing.
    const underground = minerFeetY(this.miner) > SURFACE_Y;
    if (move.thrusting) {
      const up = Math.max(0, -this.miner.vy);
      this.miner.fuel -=
        thrustBurnAt(up) * THRUST_BURN_SIZE_MULT[this.worldSize] * dt;
    }
    if (move.lateralAir) this.miner.fuel -= AIR_BURN * dt;
    if (underground) this.miner.fuel -= LIFE_SUPPORT_BURN * dt;
    if (this.miner.fuel < 0) this.miner.fuel = 0;

    updateLavaContact(this, dt);
    if (move.landedSpeed > 0) landImpact(this, move.landedSpeed);

    this.emitGasSeeps(dt);

    this.deepestDepthMeters = Math.max(
      this.deepestDepthMeters,
      this.depthMeters(),
    );
    this.updateCamera(dt);
    this.scan = computeScan(this);
    this.updateAnimation(move, braced, underground);
    this.updateLoops(move, braced);

    if (this.miner.fuel <= 0 && underground) triggerDeath(this, "fuel-out");
    else if (this.miner.hull <= 0) triggerDeath(this, "hull-destroyed");
  }

  private advanceLaunch(dt: number): void {
    this.launchAnim = (this.launchAnim ?? 0) + dt;
    this.thrustFxCd -= dt;
    if (this.thrustFxCd <= 0) {
      this.thrustFxCd = 0.12;
      const pad = BUILDINGS.find((b) => b.id === "launch-pad")!;
      this.fxQueue.push({
        kind: "launch-exhaust",
        x: tileLeft(pad.col) + TILE / 2,
        y: SURFACE_Y - this.launchAnim * 230 + 60,
        scale: 1.4,
      });
    }
    this.activeLoops.clear();
    if (this.launchAnim >= LAUNCH_ANIM_TIME) {
      this.summary = this.makeSummary(null);
      this.launchAnim = null;
      clearSave(); // a victory consumes the save
      this.menuIndex = 0;
      this.screen = "victory";
    }
  }

  private advanceDeath(dt: number): void {
    const dying = this.dying!;
    dying.t += dt;
    this.miner.state = dying.cause === "fuel-out" ? "fuel-out" : "hurt";
    stepMovement(
      this.miner,
      this.grid,
      { left: false, right: false, down: false, thrust: false },
      false,
      dt,
      0,
      this.climbCap(),
      this.fallTerminal(),
    );
    this.updateCamera(dt);
    this.activeLoops.clear();
    if (dying.t >= DEATH_ANIM) finalizeDeath(this);
  }

  private decayNotes(dt: number): void {
    for (const n of this.notes) n.t -= dt;
    this.notes = this.notes.filter((n) => n.t > 0);
  }

  private advanceNotice(dt: number): void {
    const notice = this.notice;
    if (!notice) return;
    notice.t -= dt;
    if (notice.t > 0) return;
    if (!notice.shown) {
      notice.shown = true;
      notice.t = NOTICE_FADE;
    } else {
      this.notice = null;
    }
  }

  /**
   * Wisp over each gas pocket on screen in turn, so every visible pocket breathes
   * within GAS_SEEP_PERIOD and a player watching a suspect cell catches it.
   */
  private emitGasSeeps(dt: number): void {
    this.gasSeepCd -= dt;
    if (this.gasSeepCd > 0) return;
    const c0 = Math.max(0, Math.floor(this.camX / TILE));
    const c1 = Math.min(
      WORLD_COLS - 1,
      Math.floor((this.camX + VIEW_W) / TILE),
    );
    const r0 = Math.max(0, Math.floor(this.camY / TILE));
    const r1 = Math.min(
      this.grid.length - 1,
      Math.floor((this.camY + VIEW_H) / TILE),
    );
    const pockets: [number, number][] = [];
    for (let r = r0; r <= r1; r++) {
      const line = this.grid[r];
      if (!line) continue;
      for (let c = c0; c <= c1; c++)
        if (line[c]!.kind === "gas") pockets.push([c, r]);
    }
    if (!pockets.length) {
      this.gasSeepCd = GAS_SEEP_PERIOD;
      return;
    }
    this.gasSeepCd = GAS_SEEP_PERIOD / pockets.length;
    this.gasSeepIndex = (this.gasSeepIndex + 1) % pockets.length;
    const [c, r] = pockets[this.gasSeepIndex]!;
    // Scatter the wisp across the cell's face, clear of its very edges so it is never
    // ambiguous which cell is breathing.
    const jx = 0.18 + this.rng.next() * 0.64;
    const jy = 0.18 + this.rng.next() * 0.64;
    this.fxQueue.push({
      kind: "gas-seep",
      x: c * TILE + TILE * jx,
      y: r * TILE + TILE * jy,
    });
  }

  /** Spray chips off the bit while a cut runs. */
  emitDrillDebris(dt: number, dir: "down" | "left" | "right"): void {
    this.drillFxCd -= dt;
    if (this.drillFxCd > 0) return;
    this.drillFxCd = DRILL_FX_PERIOD;
    const m = this.miner;
    const at =
      dir === "down"
        ? { x: m.x + MINER_W / 2, y: m.y + MINER_H }
        : dir === "left"
          ? { x: m.x, y: m.y + MINER_H / 2 }
          : { x: m.x + MINER_W, y: m.y + MINER_H / 2 };
    this.fxQueue.push({ kind: "drill-debris", x: at.x, y: at.y });
  }

  // -------------------------------------------------------------------------
  // The camera (specs/world.md)
  // -------------------------------------------------------------------------

  /** Follow the miner, carrying a vertical lead toward the way it is travelling. */
  updateCamera(dt: number): void {
    const m = this.miner;
    const target =
      Math.abs(m.vy) <= CAM_STILL_SPEED ? 0 : Math.sign(m.vy) * CAM_LEAD_MAX;
    const delta = target - this.camLead;
    if (delta !== 0) {
      const dir = Math.sign(delta);
      const away = this.camLead === 0 || Math.sign(this.camLead) === dir;
      const step =
        (CAM_LEAD_MAX / CAM_LEAD_RAMP) * (away ? 1 : CAM_UNWIND_MULT) * dt;
      this.camLead += Math.abs(delta) <= step ? delta : dir * step;
    }
    this.placeCamera();
  }

  /** Place the camera on the miner from the lead as it stands. */
  placeCamera(): void {
    const m = this.miner;
    this.camX = clamp(minerCenterX(m) - VIEW_W / 2, 0, MAX_CAM_X);
    this.camY = Math.min(
      minerCenterY(m) - VIEW_H / 2 + this.camLead,
      (this.coreRow + 1) * TILE - VIEW_H,
    );
  }

  /** Put the camera on the miner at once, with no lead, after a jump. */
  recenterCamera(): void {
    this.camLead = 0;
    this.placeCamera();
  }

  // -------------------------------------------------------------------------
  // Animation and audio
  // -------------------------------------------------------------------------

  private updateAnimation(
    move: MoveResult,
    braced: boolean,
    underground: boolean,
  ): void {
    const m = this.miner;
    if (this.input.left && !this.input.right) m.facing = "west";
    else if (this.input.right && !this.input.left) m.facing = "east";

    if (braced && m.drilling) {
      m.state = m.drilling.dir === "down" ? "drill-down" : "drill-side";
      if (m.drilling.dir === "left") m.facing = "west";
      else if (m.drilling.dir === "right") m.facing = "east";
      return;
    }
    // Hold the drilling pose across the single update between two down-cut cells, or
    // the miner flashes its standing frame mid-shaft.
    if (
      m.drill &&
      this.input.down &&
      move.grounded &&
      this.minableBelowMiner()
    ) {
      m.state = "drill-down";
      return;
    }
    if (this.hurtT > 0) {
      m.state = "hurt";
      return;
    }
    if (underground && m.fuel <= 0) {
      m.state = "fuel-out";
      return;
    }
    if (move.thrusting) m.state = "jetpack";
    else if (!move.grounded) m.state = "fall";
    else if (move.grounded && Math.abs(m.vx) > WALK_READ_SPEED)
      m.state = "walk";
    else m.state = "idle";
  }

  private minableBelowMiner(): boolean {
    const tile = this.grid[minerRow(this.miner) + 1]?.[minerCol(this.miner)];
    return !!tile && isMinableKind(tile.kind);
  }

  private updateLoops(move: MoveResult, braced: boolean): void {
    this.activeLoops.clear();
    if (braced) this.activeLoops.add("drill");
    if (move.thrusting) this.activeLoops.add("thrust");
    // specs/character.md and specs/assets.md both fix the alarm on the fuel
    // alone: "Below LOW_FUEL_FRACTION (0.2) of the maximum ... the low-fuel
    // alarm cue plays". Depth is not a condition of it, and zero is below the
    // threshold.
    if (this.miner.fuel < this.maxFuel() * LOW_FUEL_FRACTION) {
      this.activeLoops.add("alarm-fuel");
    }
    if (this.coreTimer !== null) this.activeLoops.add("alarm-core");
  }

  // -------------------------------------------------------------------------
  // The surface camp
  // -------------------------------------------------------------------------

  /** Every building's footprint in world units. */
  buildings(): BuildingBox[] {
    return BUILDINGS.map((b) => ({
      id: b.id,
      x: tileLeft(b.col) + TILE / 2 - BUILDING_W / 2,
      y: SURFACE_Y - BUILDING_H,
      w: BUILDING_W,
      h: BUILDING_H,
    }));
  }

  /** The building the miner is standing at, or null. */
  nearbyBuilding(): BuildingId | null {
    if (!this.atSurface()) return null;
    const mx = minerCenterX(this.miner);
    let best: BuildingId | null = null;
    let bestD = BUILDING_REACH;
    for (const b of BUILDINGS) {
      const d = Math.abs(tileLeft(b.col) + TILE / 2 - mx);
      if (d <= bestD) {
        bestD = d;
        best = b.id;
      }
    }
    return best;
  }

  /** Activate the building the miner is standing at. */
  activateNearbyBuilding(): void {
    const id = this.nearbyBuilding();
    if (!id) return;
    if (id === "save-pad") this.trySave();
    else this.openPanel(id);
  }

  /** Open a building's panel, which is only possible at the camp. */
  openPanel(panel: Exclude<OpenPanel, null>): void {
    if (this.screen !== "in-mine" || this.dying || this.launchAnim !== null)
      return;
    if (panel !== "inventory" && !this.atSurface()) return;
    this.panel = panel;
  }

  closePanel(): void {
    this.panel = null;
  }

  /** Open and close the inventory, which opens anywhere. */
  toggleInventory(): void {
    if (this.screen !== "in-mine" || this.dying || this.launchAnim !== null)
      return;
    this.panel = this.panel === "inventory" ? null : "inventory";
  }

  // -------------------------------------------------------------------------
  // The Core Sample on the ground
  // -------------------------------------------------------------------------

  /** The jettisoned Core Sample, or null. */
  coreGround(): GroundItem | null {
    return this.groundItems.find((g) => g.kind === "core-sample") ?? null;
  }

  /** Drop the carried Core Sample onto the miner's cell. It cannot be picked back up. */
  jettisonCoreSample(): void {
    if (this.screen !== "in-mine" || this.dying || this.launchAnim !== null)
      return;
    if (!this.satchel.coreSample) {
      this.note("NO CORE SAMPLE CARRIED");
      return;
    }
    this.satchel.coreSample = false;
    this.groundItems.push({
      kind: "core-sample",
      col: minerCol(this.miner),
      row: minerRow(this.miner),
    });
    this.fxQueue.push({
      kind: "core-extract",
      x: minerCenterX(this.miner),
      y: minerCenterY(this.miner),
    });
    this.sndQueue.push("impact");
    this.note("CORE SAMPLE JETTISONED — CLEAR THE BLAST");
  }

  // -------------------------------------------------------------------------
  // Saving and continuing
  // -------------------------------------------------------------------------

  /** Whether the expedition may be saved right now. */
  canSave(): boolean {
    return (
      this.atSurface() && this.coreTimer === null && this.coreGround() === null
    );
  }

  /** Save from the Save Pad, with a note either way. */
  trySave(): boolean {
    if (this.screen !== "in-mine" || this.dying || this.launchAnim !== null)
      return false;
    if (!this.atSurface()) {
      this.note("NO SAVE PAD HERE");
      return false;
    }
    if (!this.canSave()) {
      this.note("CAN'T SAVE — UNSTABLE CORE SAMPLE ACTIVE");
      return false;
    }
    const ok = writeSave({
      version: 1,
      mode: this.mode,
      size: this.worldSize,
      credits: this.credits,
      creditsEarned: this.creditsEarned,
      tiers: { ...this.tiers },
      installed: [...this.installed],
      items: { ...this.items },
      cargo: { ...this.cargo },
      satchel: {
        resonite: this.satchel.resonite,
        cryenite: this.satchel.cryenite,
      },
      grid: this.grid,
      nodes: this.nodes,
      deepestDepthMeters: this.deepestDepthMeters,
      elapsedSeconds: this.elapsedSeconds,
      fuel: this.miner.fuel,
      hull: this.miner.hull,
    });
    if (ok) {
      this.sndQueue.push("fabricate");
      this.note("EXPEDITION SAVED");
    } else {
      this.note("SAVE FAILED");
    }
    return ok;
  }

  /** Restore the save, placing the miner back on the surface. */
  loadExpedition(): boolean {
    const data = readSave();
    if (!data) return false;
    this.mode = data.mode;
    this.worldSize = data.size ?? DEFAULT_WORLD_SIZE;
    this.coreRow = coreRowFor(this.worldSize);
    this.grid = data.grid;
    this.nodes = data.nodes;
    this.credits = data.credits;
    this.creditsEarned = data.creditsEarned;
    this.cargo = { ...emptyCargo(), ...data.cargo };
    this.satchel = {
      resonite: data.satchel.resonite,
      cryenite: data.satchel.cryenite,
      coreSample: false,
    };
    this.tiers = { ...data.tiers };
    this.installed = new Set(data.installed);
    this.items = { ...emptyItems(), ...data.items };
    this.groundItems = [];
    this.coreTimer = null;
    this.deepestDepthMeters = data.deepestDepthMeters;
    this.elapsedSeconds = data.elapsedSeconds;
    this.summary = null;
    this.deathCause = null;
    this.clearTransients();
    this.placeMinerAtSpawn();
    this.miner.fuel = Math.min(this.maxFuel(), data.fuel);
    this.miner.hull = Math.min(this.maxHull(), data.hull);
    this.recenterCamera();
    this.menuIndex = 0;
    this.screen = "in-mine";
    return true;
  }

  /** Begin the launch, which the Victory screen follows. */
  startLaunch(): boolean {
    if (!allInstalled(this)) {
      this.note("THE ROCKET IS NOT COMPLETE");
      return false;
    }
    if (this.launchAnim !== null) return false;
    this.panel = null;
    this.launchAnim = 0;
    this.thrustFxCd = 0;
    this.sndQueue.push("launch");
    return true;
  }

  // -------------------------------------------------------------------------
  // Readings the debug surface and the overlay share
  // -------------------------------------------------------------------------

  /** One cell's observable state. A cell outside the grid reads as bedrock. */
  tileAt(col: number, row: number): TileRead {
    const tile = this.grid[row]?.[col];
    if (!tile) {
      return {
        kind: "bedrock",
        band: null,
        ore: null,
        material: null,
        health: null,
        maxHealth: null,
      };
    }
    const minable = isMinableKind(tile.kind);
    const inBands = row >= 1 && row < this.coreRow;
    const max = tileMaxHealth(tile);
    return {
      kind: tile.kind,
      band: inBands ? tile.band : null,
      ore: tile.ore ?? null,
      material: tile.material ?? null,
      health: minable ? (tile.health ?? max) : null,
      maxHealth: minable ? max : null,
    };
  }

  /** The cell of that kind nearest the miner, or null where the mine holds none. */
  findTile(kind: TileKind): { col: number; row: number } | null {
    const mc = minerCol(this.miner);
    const mr = minerRow(this.miner);
    let best: { col: number; row: number } | null = null;
    let bestD = Infinity;
    for (let r = 0; r < this.grid.length; r++) {
      const line = this.grid[r]!;
      for (let c = 0; c < line.length; c++) {
        if (line[c]!.kind !== kind) continue;
        const d = (c - mc) * (c - mc) + (r - mr) * (r - mr);
        if (d < bestD) {
          bestD = d;
          best = { col: c, row: r };
        }
      }
    }
    return best;
  }

  /** The whole observable state, as a plain object. */
  snapshot(): DeepcoreSnapshot {
    const m = this.miner;

    let drilling: DeepcoreSnapshot["miner"]["drilling"] = null;
    if (m.drilling) {
      const tile = this.grid[m.drilling.row]?.[m.drilling.col];
      const max = tile ? tileMaxHealth(tile) : 0;
      const health = tile?.health ?? max;
      drilling = {
        col: m.drilling.col,
        row: m.drilling.row,
        dir: m.drilling.dir,
        progress: max > 0 ? clamp(1 - health / max, 0, 1) : 0,
      };
    }

    const ore: Record<string, number> = {};
    for (const id of Object.keys(this.cargo) as Ore[]) {
      if (this.cargo[id] > 0) ore[id] = this.cargo[id];
    }

    const scan = computeScan(this);
    const ground = this.coreGround();
    const next = nextComponent(this);

    return {
      version: DEEPCORE_DEBUG_VERSION,
      screen: this.screen,
      panel: this.panel,
      mode: this.mode,
      worldSize: this.worldSize,
      coreRow: this.coreRow,
      menuIndex: this.menuIndex,
      autoStep: this.autoStep,
      muted: this.muted,
      simTime: this.simTime,
      elapsedSeconds: this.elapsedSeconds,
      hasSave: hasSave(),
      credits: this.credits,
      creditsEarned: this.creditsEarned,
      depthMeters: this.depthMeters(),
      deepestDepthMeters: this.deepestDepthMeters,
      coreTimer: this.coreTimer,
      coreGround: ground ? { col: ground.col, row: ground.row } : null,
      camera: { x: this.camX, y: this.camY, lead: this.camLead },
      miner: {
        x: m.x,
        y: m.y,
        vx: m.vx,
        vy: m.vy,
        col: minerCol(m),
        row: minerRow(m),
        facing: m.facing,
        state: m.state,
        grounded: isGrounded(this.grid, m),
        travel: m.travel,
        drill: m.drill,
        fuel: m.fuel,
        maxFuel: this.maxFuel(),
        hull: m.hull,
        maxHull: this.maxHull(),
        overloaded: this.overloaded(),
        drilling,
      },
      cargo: {
        slotsUsed: this.slotsUsed(),
        slotCap: this.cargoCap(),
        loadKg: this.loadKg(),
        liftLimitKg: this.liftLimitKg(),
        ore,
      },
      satchel: {
        resonite: this.satchel.resonite,
        cryenite: this.satchel.cryenite,
        coreSample: this.satchel.coreSample,
      },
      tiers: { ...this.tiers },
      items: { ...this.items },
      rocket: {
        installed: ROCKET_COMPONENTS.filter((c) =>
          this.installed.has(c.id),
        ).map((c) => c.id),
        nextComponent: next ? next.id : null,
      },
      scanner: {
        locked: scan.locked,
        target: scan.target,
        dirX: scan.dirX,
        dirY: scan.dirY,
        distanceTiles: scan.distanceTiles,
      },
      notice: this.notice
        ? { hazard: this.notice.hazard, shown: this.notice.shown }
        : null,
      noticesFired: { ...this.noticesFired },
      nextTeleportHeight: this.nextTeleportHeight,
      nextTeleportSpeed: this.nextTeleportSpeed,
      summary: this.summary ? { ...this.summary } : null,
    };
  }

  // -------------------------------------------------------------------------
  // Restoring the world, which the debug surface drives
  // -------------------------------------------------------------------------

  /** Restore the whole observable state to its title-screen value. */
  reset(): void {
    this.nextTeleportHeight = null;
    this.nextTeleportSpeed = null;
    this.mode = "standard";
    this.pendingMode = "standard";
    this.worldSize = DEFAULT_WORLD_SIZE;
    this.coreRow = coreRowFor(DEFAULT_WORLD_SIZE);
    this.credits = 0;
    this.creditsEarned = 0;
    this.cargo = emptyCargo();
    this.satchel = { resonite: 0, cryenite: 0, coreSample: false };
    this.tiers = {
      fuel: 1,
      drill: 1,
      cargo: 1,
      hull: 1,
      jetpack: 1,
      radiator: 1,
      scanner: 1,
    };
    this.installed = new Set();
    this.items = emptyItems();
    this.groundItems = [];
    this.coreTimer = null;
    this.deepestDepthMeters = 0;
    this.elapsedSeconds = 0;
    this.simTime = 0;
    this.summary = null;
    this.deathCause = null;
    this.clearTransients();
    this.grid = emptyMine(this.coreRow);
    this.nodes = [];
    this.placeMinerAtSpawn();
    this.miner.fuel = this.maxFuel();
    this.miner.hull = this.maxHull();
    this.recenterCamera();
    this.sndQueue.length = 0;
    this.fxQueue.length = 0;
    this.activeLoops.clear();
    this.scan = {
      locked: false,
      target: null,
      dirX: 0,
      dirY: 0,
      distanceTiles: null,
    };
    this.menuIndex = 0;
    this.screen = "title";
  }

  /** Replace every cell with a freshly generated mine at the current world size. */
  regenerateMine(): void {
    const mine = generateMine(this.rng, this.coreRow);
    this.grid = mine.grid;
    this.nodes = mine.nodes;
  }

  /** Empty the mine, leaving the border, the camp, and the Core chamber standing. */
  clearMine(): void {
    this.grid = emptyMine(this.coreRow);
    this.nodes = [];
  }

  /**
   * Resize the mine onto the current `coreRow`, the way an array is resized.
   * Every cell the old depth and the new one share comes through untouched, rows
   * past the new depth go along with the material nodes that sat in them, and
   * rows the old depth did not reach open as an empty mine's.
   */
  resizeMine(): void {
    this.grid = resizeGrid(this.grid, this.coreRow);
    this.nodes = this.nodes.filter((node) => node.row < this.coreRow);
  }
}
