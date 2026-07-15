// Deepcore — the game state machine and the owner of all mutable state (specs/flow.md).
//
// A small state machine — title, mode-select, how-to-play, in-mine (with the four surface
// building panels), paused, victory, hardcore game-over — wrapped around the live mine
// simulation. `fixedStep` advances the deterministic 60 Hz sim: it drills, moves the miner
// under physics, bills fuel/hull, applies hazards and the Core Sample timer, retrieves a
// dropped cache, follows the camera, and picks the animation state. Every subsystem
// (world / physics / drill / hazards / economy / rocket / scanner / modes) is wired here.
// A dev API (window.__deepcore, exposed in main.ts) drives these same real systems fast
// for the proof-capture harness (specs/proof.md).

import {
  CORE_TIMER_SECONDS,
  CARGO_CAPACITY,
  DRILL_POWER,
  FUEL_LATERAL_AIR_RATE,
  FUEL_LIFE_SUPPORT_RATE,
  FUEL_TANK_MAX,
  FUEL_THRUST_RATE,
  HULL_MAX,
  LOW_FUEL_FRACTION,
  MAX_TIER,
  METERS_PER_ROW,
  SCANNER_RANGE,
  SURFACE_ROW,
  TILE_SIZE,
  VIEWPORT_HEIGHT,
  WORLD_ROWS,
} from "./constants";
import { emptyCargo, cargoUsed } from "./economy";
import { updateDrill } from "./drill";
import { landImpact, updateLavaContact } from "./hazards";
import {
  MINER_H,
  MINER_W,
  SURFACE_FEET_Y,
  minerCenterX,
  minerCenterY,
  minerCol,
  minerRow,
  stepMovement,
} from "./physics";
import type { MoveInput, MoveResult } from "./physics";
import { computeScan } from "./scanner";
import type { ScanResult } from "./scanner";
import { DEATH_ANIM, finalizeDeath, triggerDeath } from "./modes";
import { allInstalled } from "./rocket";
import { generateWorld } from "./world";
import type { MaterialNode } from "./world";
import type { Cue, LoopCue } from "./audio";
import type { FxEvent } from "./particles";
import type {
  Cargo,
  DeathCache,
  DeathCause,
  GamePhase,
  Material,
  Miner,
  Mode,
  OpenPanel,
  RocketComponentId,
  RunSummary,
  Satchel,
  Tile,
  UpgradeTiers,
  UpgradeTrack,
} from "./types";

export interface Building {
  panel: Exclude<OpenPanel, null>;
  col: number;
  label: string;
}

/** The four surface buildings, spread across the camp (specs/world.md). */
export const SURFACE_BUILDINGS: Building[] = [
  { panel: "fuel-depot", col: 3, label: "Fuel Depot" },
  { panel: "ore-market", col: 7, label: "Ore Market" },
  { panel: "upgrade-shop", col: 12, label: "Upgrade Shop" },
  { panel: "launch-pad", col: 18, label: "Launch Pad" },
];

/** How close (in tiles) the miner must stand to a building to activate it with a key. */
const BUILDING_REACH = 1.6;
const NOTE_LIFE = 2.4;
const LAUNCH_ANIM_TIME = 2.6;
/** Resting top of the camera at the surface (a little sky above the camp is shown). */
const MIN_CAM = -130;
/**
 * When the miner climbs into the open sky above the surface (no ceiling,
 * specs/character.md), keep it this far below the top of the viewport so the camera
 * follows it up instead of letting it clip off the top of the view (specs/world.md).
 */
const SKY_FOLLOW_MARGIN = 130;

export class Game {
  // --- Persistent expedition state (specs/flow.md) ---
  phase: GamePhase = "title";
  mode: Mode = "standard";
  panel: OpenPanel = null;
  credits = 0;
  creditsEarned = 0;
  cargo: Cargo = emptyCargo();
  satchel: Satchel = { resonite: 0, cryenite: 0, coreSample: false };
  tiers: UpgradeTiers = { fuel: 1, drill: 1, cargo: 1, hull: 1, scanner: 1 };
  installed = new Set<RocketComponentId>();
  miner: Miner = {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    facing: "east",
    state: "idle",
    fuel: 100,
    hull: 100,
    drilling: null,
  };
  grid: Tile[][] = [];
  nodes: MaterialNode[] = [];
  spawnCol = 11;
  cameraY = 0;
  coreTimer: number | null = null;
  deepestRow = 0;
  elapsedSeconds = 0;
  cache: DeathCache | null = null;
  summary: RunSummary | null = null;
  deathCause?: DeathCause;

  // --- Transient runtime ---
  input: MoveInput = { left: false, right: false, down: false, thrust: false };
  sndQueue: Cue[] = [];
  fxQueue: FxEvent[] = [];
  activeLoops = new Set<LoopCue>();
  notes: { text: string; t: number }[] = [];
  hurtFlash = 0;
  dying: { cause: DeathCause; t: number } | null = null;
  launchAnim: number | null = null;
  scan: ScanResult = { needed: false, hasSignal: false, angle: 0, distTiles: 0, material: null };
  // Effect emission cooldowns (kept on the Game so drill/hazards can share them).
  drillFxCd = 0;
  thrustFxCd = 0;
  lavaFxCd = 0;
  private seedCounter = 0x9e3779b9;

  constructor() {
    // A dim slice of mine for the title backdrop (specs/flow.md, Game states).
    const w = generateWorld(1);
    this.grid = w.grid;
    this.nodes = w.nodes;
    this.spawnCol = w.spawnCol;
    this.placeMinerAtSurface();
    this.updateCamera(1);
  }

  // ---- Derived stat maxima (specs/upgrades.md) ----
  maxFuel(): number {
    return FUEL_TANK_MAX[this.tiers.fuel - 1]!;
  }
  maxHull(): number {
    return HULL_MAX[this.tiers.hull - 1]!;
  }
  cargoCap(): number {
    return CARGO_CAPACITY[this.tiers.cargo - 1]!;
  }
  drillPower(): number {
    return DRILL_POWER[this.tiers.drill - 1]!;
  }
  scannerRange(): number {
    return SCANNER_RANGE[this.tiers.scanner - 1]!;
  }
  cargoUsed(): number {
    return cargoUsed(this.cargo);
  }
  depthMeters(): number {
    return Math.max(0, minerRow(this.miner)) * METERS_PER_ROW;
  }
  atSurface(): boolean {
    return minerRow(this.miner) <= SURFACE_ROW;
  }

  // ---- Lifecycle ----
  private nextSeed(): number {
    this.seedCounter = (this.seedCounter + 0x6d2b79f5) >>> 0;
    return this.seedCounter;
  }

  /** Start a fresh expedition in the given mode (specs/mode-standard.md). */
  newExpedition(mode: Mode): void {
    this.mode = mode;
    const w = generateWorld(this.nextSeed());
    this.grid = w.grid;
    this.nodes = w.nodes;
    this.spawnCol = w.spawnCol;
    this.credits = 0;
    this.creditsEarned = 0;
    this.cargo = emptyCargo();
    this.satchel = { resonite: 0, cryenite: 0, coreSample: false };
    this.tiers = { fuel: 1, drill: 1, cargo: 1, hull: 1, scanner: 1 };
    this.installed = new Set();
    this.coreTimer = null;
    this.deepestRow = 0;
    this.elapsedSeconds = 0;
    this.cache = null;
    this.summary = null;
    this.deathCause = undefined;
    this.panel = null;
    this.dying = null;
    this.launchAnim = null;
    this.hurtFlash = 0;
    this.notes = [];
    this.placeMinerAtSurface();
    this.miner.fuel = this.maxFuel();
    this.miner.hull = this.maxHull();
    this.updateCamera(1);
    this.phase = "in-mine";
  }

  /** Position the miner standing on the surface floor above the spawn column. */
  placeMinerAtSurface(): void {
    const m = this.miner;
    m.x = TILE_SIZE + this.spawnCol * TILE_SIZE + (TILE_SIZE - MINER_W) / 2;
    m.y = SURFACE_FEET_Y - MINER_H;
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

  makeSummary(deathCause?: DeathCause): RunSummary {
    return {
      deepestDepthMeters: this.deepestRow * METERS_PER_ROW,
      creditsEarned: this.creditsEarned,
      elapsedSeconds: this.elapsedSeconds,
      mode: this.mode,
      componentsInstalled: this.installed.size,
      deathCause,
    };
  }

  // ---- The fixed-step simulation ----
  fixedStep(dt: number): void {
    if (this.phase !== "in-mine") return;
    this.elapsedSeconds += dt;
    this.decayNotes(dt);
    if (this.hurtFlash > 0) this.hurtFlash = Math.max(0, this.hurtFlash - dt);

    // The Core Sample timer runs EVERYWHERE — surface, shop, mid-climb (specs/hazards.md).
    if (this.coreTimer !== null) {
      this.coreTimer -= dt;
      if (this.coreTimer <= 0) {
        this.coreTimer = 0;
        triggerDeath(this, "core-detonation");
      }
    }

    // Launch sequence: the rocket lifts off, then Victory (specs/rocket.md).
    if (this.launchAnim !== null) {
      this.launchAnim += dt;
      this.thrustFxCd -= dt;
      if (this.thrustFxCd <= 0) {
        this.thrustFxCd = 0.12;
        const b = SURFACE_BUILDINGS.find((x) => x.panel === "launch-pad")!;
        const rx = TILE_SIZE + b.col * TILE_SIZE + TILE_SIZE / 2;
        game_pushLaunchFx(this, rx);
      }
      this.activeLoops.clear();
      if (this.launchAnim >= LAUNCH_ANIM_TIME) {
        this.summary = this.makeSummary();
        this.launchAnim = null;
        this.phase = "victory";
      }
      return;
    }

    // Death animation playing out before the mode outcome (specs/modes.md).
    if (this.dying) {
      this.dying.t += dt;
      this.miner.state = this.dying.cause === "fuel-out" ? "fuel-out" : "hurt";
      stepMovement(this.miner, this.grid, { left: false, right: false, down: false, thrust: false }, false, dt);
      this.updateCamera(dt);
      this.activeLoops.clear();
      if (this.dying.t >= DEATH_ANIM) finalizeDeath(this);
      return;
    }

    // A building panel is open at the surface — the world behind it is frozen (the miner is
    // safe), but the Core timer (above) still ran. Fuel and hull do NOT refill here; they
    // are only restored by buying at the Fuel Depot panel (specs/character.md, specs/flow.md).
    if (this.panel !== null) {
      this.activeLoops.clear();
      if (this.coreTimer !== null) this.activeLoops.add("alarm-core");
      return;
    }

    // --- Live play ---
    updateDrill(this, dt);
    const braced = this.miner.drilling !== null;

    let move: MoveResult;
    if (braced) {
      this.miner.vx = 0;
      this.miner.vy = 0;
      move = { grounded: true, thrusting: false, lateralAir: false, landedSpeed: 0 };
    } else {
      move = stepMovement(this.miner, this.grid, this.input, this.miner.fuel > 0, dt);
    }

    // Jetpack exhaust while thrusting (specs/assets.md).
    if (move.thrusting) {
      this.thrustFxCd -= dt;
      if (this.thrustFxCd <= 0) {
        this.thrustFxCd = 0.06;
        this.fxQueue.push({ kind: "jetpack-exhaust", x: minerCenterX(this.miner), y: this.miner.y + MINER_H });
      }
    }

    // Fuel accounting (specs/character.md).
    const underground = minerRow(this.miner) >= 1;
    if (move.thrusting) this.miner.fuel -= FUEL_THRUST_RATE * dt;
    if (move.lateralAir) this.miner.fuel -= FUEL_LATERAL_AIR_RATE * dt;
    if (underground) this.miner.fuel -= FUEL_LIFE_SUPPORT_RATE * dt;
    if (this.miner.fuel < 0) this.miner.fuel = 0;

    // Hazards (a hard landing hurts even on the surface camp floor — specs/hazards.md).
    updateLavaContact(this, dt);
    if (move.landedSpeed > 0) landImpact(this, move.landedSpeed);

    // Fuel and hull are NOT restored by being home — they are only bought at the Fuel
    // Depot (specs/character.md, specs/flow.md). Nothing refills automatically here.

    // Retrieve a dropped Standard cache by reaching it (specs/modes.md).
    this.retrieveCache();

    if (minerRow(this.miner) > this.deepestRow) this.deepestRow = minerRow(this.miner);

    this.updateCamera(dt);
    this.scan = computeScan(this);
    this.updateAnimation(move, braced);
    this.updateLoops(move, braced, underground);

    // Deaths (specs/character.md, specs/modes.md).
    if (this.miner.fuel <= 0 && underground) triggerDeath(this, "fuel-out");
    else if (this.miner.hull <= 0) triggerDeath(this, "hull-destroyed");
  }

  private decayNotes(dt: number): void {
    for (const n of this.notes) n.t -= dt;
    this.notes = this.notes.filter((n) => n.t > 0);
  }

  private retrieveCache(): void {
    if (!this.cache) return;
    const mc = minerCol(this.miner);
    const mr = minerRow(this.miner);
    if (Math.abs(mc - this.cache.col) <= 1 && Math.abs(mr - this.cache.row) <= 1) {
      const cap = this.cargoCap();
      for (const o of Object.keys(this.cache.cargo) as (keyof Cargo)[]) {
        let n = this.cache.cargo[o];
        while (n > 0 && cargoUsed(this.cargo) < cap) {
          this.cargo[o]++;
          n--;
        }
      }
      this.satchel.resonite += this.cache.resonite;
      this.satchel.cryenite += this.cache.cryenite;
      this.cache = null;
      this.sndQueue.push("material-chime");
      this.note("CACHE RECOVERED");
    }
  }

  private updateCamera(dt: number): void {
    // At rest the top clamp is MIN_CAM (frames the camp); once the miner rises into the
    // sky above the surface, the clamp follows it up so it stays on screen (specs/world.md).
    const topClamp = Math.min(MIN_CAM, minerCenterY(this.miner) - SKY_FOLLOW_MARGIN);
    const target = clamp(minerCenterY(this.miner) - VIEWPORT_HEIGHT / 2, topClamp, this.maxCam());
    if (dt >= 1) {
      this.cameraY = target;
    } else {
      this.cameraY += (target - this.cameraY) * Math.min(1, 9 * dt);
    }
  }

  maxCam(): number {
    return WORLD_ROWS * TILE_SIZE - VIEWPORT_HEIGHT;
  }

  private updateAnimation(move: MoveResult, braced: boolean): void {
    const m = this.miner;
    if (this.input.left && !this.input.right) m.facing = "west";
    else if (this.input.right && !this.input.left) m.facing = "east";

    if (braced && m.drilling) {
      m.state = m.drilling.dir === "down" ? "drill-down" : "drill-side";
      if (m.drilling.dir === "left") m.facing = "west";
      else if (m.drilling.dir === "right") m.facing = "east";
      return;
    }
    if (this.hurtFlash > 0.16) {
      m.state = "hurt";
      return;
    }
    if (move.thrusting) m.state = "jetpack";
    else if (!move.grounded && m.vy > 30) m.state = "fall";
    else if (move.grounded && Math.abs(m.vx) > 12) m.state = "walk";
    else m.state = "idle";
  }

  private updateLoops(move: MoveResult, braced: boolean, underground: boolean): void {
    this.activeLoops.clear();
    if (braced) this.activeLoops.add("drill");
    if (move.thrusting) this.activeLoops.add("thrust");
    if (underground && this.miner.fuel > 0 && this.miner.fuel < this.maxFuel() * LOW_FUEL_FRACTION) {
      this.activeLoops.add("alarm-fuel");
    }
    if (this.coreTimer !== null) this.activeLoops.add("alarm-core");
  }

  // ---- Surface building interactions (called by main on click / key) ----

  /** The building the miner is standing at (within reach at the surface), or null. */
  nearbyBuilding(): Building | null {
    if (!this.atSurface()) return null;
    const mcx = minerCenterX(this.miner);
    let best: Building | null = null;
    let bestD = BUILDING_REACH * TILE_SIZE;
    for (const b of SURFACE_BUILDINGS) {
      const bx = TILE_SIZE + b.col * TILE_SIZE + TILE_SIZE / 2;
      const d = Math.abs(bx - mcx);
      if (d <= bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }

  /** Open a building panel (only valid in the mine, at the surface). */
  openPanel(panel: Exclude<OpenPanel, null>): void {
    if (this.phase !== "in-mine" || !this.atSurface() || this.dying || this.launchAnim !== null) return;
    this.panel = panel;
  }

  /** Activate the building the miner is standing at (the E / Enter key). */
  activateNearbyBuilding(): void {
    const b = this.nearbyBuilding();
    if (b) this.openPanel(b.panel);
  }

  closePanel(): void {
    this.panel = null;
  }

  /** Begin the launch sequence (all five components installed). */
  startLaunch(): void {
    if (!allInstalled(this) || this.launchAnim !== null) return;
    this.panel = null;
    this.launchAnim = 0;
    this.thrustFxCd = 0;
    this.sndQueue.push("launch");
  }

  // ---- Dev API (specs/proof.md) — drives the REAL systems, fast ----

  /** Bank Credits (counts toward the run summary as earned). */
  grantCredits(n: number): void {
    this.credits += n;
    this.creditsEarned += n;
  }

  /** Set upgrade tiers — a single tier for all tracks, or a per-track partial. */
  grantGear(tiers: number | Partial<UpgradeTiers>): void {
    if (typeof tiers === "number") {
      const t = clampInt(tiers, 1, MAX_TIER);
      this.tiers = { fuel: t, drill: t, cargo: t, hull: t, scanner: t };
    } else {
      for (const k of Object.keys(tiers) as UpgradeTrack[]) {
        const v = tiers[k];
        if (v !== undefined) this.tiers[k] = clampInt(v, 1, MAX_TIER);
      }
    }
    this.miner.fuel = this.maxFuel();
    this.miner.hull = this.maxHull();
  }

  /**
   * Teleport the miner into a tile, clearing motion and any drill. The destination cell is
   * carved to open tunnel so the miner stands in open space (never embedded in solid rock),
   * resting on whatever is below — the dev fast-forward the proof harness uses to reach a
   * depth, from which it then drives the REAL drill/move systems (specs/proof.md).
   */
  teleport(col: number, row: number): void {
    const line = this.grid[row];
    if (line && line[col] && line[col]!.kind !== "bedrock" && line[col]!.kind !== "core") {
      line[col] = { kind: "tunnel", band: line[col]!.band };
    }
    const m = this.miner;
    m.x = TILE_SIZE + col * TILE_SIZE + (TILE_SIZE - MINER_W) / 2;
    m.y = (row + 1) * TILE_SIZE - MINER_H; // feet on the bottom of the carved cell
    m.vx = 0;
    m.vy = 0;
    m.drilling = null;
    if (row > this.deepestRow) this.deepestRow = row;
    this.updateCamera(1);
  }

  /** Bank an exotic material (Resonite / Cryenite / Core Sample) directly. */
  giveMaterial(kind: Material): void {
    if (kind === "resonite") this.satchel.resonite++;
    else if (kind === "cryenite") this.satchel.cryenite++;
    else this.spawnCoreSample();
  }

  /** Extract a Core Sample in hand and start its destabilization timer. */
  spawnCoreSample(): void {
    this.satchel.coreSample = true;
    this.coreTimer = CORE_TIMER_SECONDS;
    this.fxQueue.push({ kind: "core-extract", x: minerCenterX(this.miner), y: minerCenterY(this.miner) });
  }

  setMode(mode: Mode): void {
    this.mode = mode;
  }

  /** Begin an expedition (the proof harness's entry — same as choosing a mode). */
  startExpedition(mode: Mode): void {
    this.newExpedition(mode);
  }
}

// A launch-exhaust burst under the rising rocket (kept out of the class for brevity).
function game_pushLaunchFx(game: Game, rocketX: number): void {
  const pad = SURFACE_FEET_Y - 10;
  const y = pad - (game.launchAnim ?? 0) * 140;
  game.fxQueue.push({ kind: "launch-exhaust", x: rocketX, y: y + 40, scale: 1.4 });
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
function clampInt(v: number, lo: number, hi: number): number {
  return Math.round(clamp(v, lo, hi));
}
