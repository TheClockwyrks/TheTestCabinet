// Deepcore — the game state machine and the owner of all mutable state (specs/flow.md).
//
// A small state machine — title, mode-select, how-to-play, in-mine (with the surface
// building panels), paused, victory, hardcore game-over — wrapped around the live mine
// simulation. `fixedStep` advances the deterministic 60 Hz sim: it drills, moves the miner
// under physics, bills fuel/hull, applies hazards and the Core Sample timer, retrieves a
// dropped cache, follows the camera, and picks the animation state. Every subsystem
// (world / physics / drill / hazards / economy / rocket / scanner / modes) is wired here.
// A dev API (window.__deepcore, exposed in main.ts) drives these same real systems fast
// for the proof-capture harness (specs/proof.md).

import {
  CAMERA_LEAD_FRACTION,
  CAMERA_LEAD_RAMP_TIME,
  CAMERA_LEAD_RELEASE_TIME,
  CAMERA_LEAD_REVERSE_TIME,
  CAMERA_LEAD_MIN_SPEED,
  CAMERA_FOLLOW_RATE,
  CORE_TIMER_SECONDS,
  CARGO_CAPACITY,
  DRILL_POWER,
  FUEL_LATERAL_AIR_RATE,
  FUEL_LIFE_SUPPORT_RATE,
  FUEL_TANK_MAX,
  thrustFuelRate,
  GRAVITY,
  GRID_MARGIN_X,
  HULL_MAX,
  JETPACK_CLIMB,
  JETPACK_ACCEL,
  JETPACK_MAX_LIFT,
  JETPACK_LOAD_CAP_FALLOFF,
  FALL_TERMINAL_EMPTY,
  FALL_TERMINAL_FULL,
  LOW_FUEL_FRACTION,
  MAX_CAMERA_X,
  MAX_TIER,
  METERS_PER_ROW,
  MINER_BASE_MASS,
  RADIATOR_EFFECTIVENESS,
  SCANNER_RANGE,
  SURFACE_ROW,
  TILE_SIZE,
  TIP_LIFE,
  VIEWPORT_HEIGHT,
  VIEWPORT_WIDTH,
  DEFAULT_WORLD_SIZE,
  setWorldSize,
  WORLD,
  WORLD_COLS,
} from "./constants";
import { emptyCargo, cargoUsed, cargoWeight } from "./economy";
import { emptyItems, expireCoreTimer } from "./items";
import { clearSave, readSave, writeSave } from "./save";
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
import { generateWorld, isMinableKind } from "./world";
import type { MaterialNode } from "./world";
import type { Cue, LoopCue } from "./audio";
import type { FxEvent } from "./particles";
import type {
  BuildingId,
  Cargo,
  DeathCause,
  GamePhase,
  GroundItem,
  ItemCounts,
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
import type { WorldSize } from "./constants";

export interface Building {
  id: BuildingId;
  col: number;
  label: string;
}

/** The six surface buildings, spread across the wider camp (specs/world.md). The Save Pad
 *  sits near the spawn/cave mouth so a surfacing miner can bank progress right away; the
 *  Supply Depot (single-use field supplies) sits alongside the Upgrade Shop. */
export const SURFACE_BUILDINGS: Building[] = [
  { id: "fuel-depot", col: 3, label: "Fuel Depot" },
  { id: "ore-market", col: 8, label: "Ore Market" },
  { id: "save-pad", col: 13, label: "Save Pad" },
  { id: "upgrade-shop", col: 18, label: "Upgrade Shop" },
  { id: "supply-depot", col: 23, label: "Supply Depot" },
  { id: "launch-pad", col: 28, label: "Launch Pad" },
];

/** How close (in tiles) the miner must stand to a building to activate it with a key. */
const BUILDING_REACH = 1.6;
const NOTE_LIFE = 2.4;
const LAUNCH_ANIM_TIME = 2.6;
/** Resting top of the camera at the surface (a little sky above the camp is shown). */
const MIN_CAM = -217;
/**
 * When the miner climbs into the open sky above the surface (no ceiling,
 * specs/character.md), keep it this far below the top of the viewport so the camera
 * follows it up instead of letting it clip off the top of the view (specs/world.md).
 */
const SKY_FOLLOW_MARGIN = 217;

export class Game {
  // --- Persistent expedition state (specs/flow.md) ---
  phase: GamePhase = "title";
  mode: Mode = "standard";
  /** The world SIZE this expedition was dug at (specs/world.md). Set by newExpedition /
   *  loadExpedition; persisted in the save so a restored mine keeps its dimensions. */
  worldSize: WorldSize = DEFAULT_WORLD_SIZE;
  /** The mode chosen on the mode-select screen, held while the player then picks a world size
   *  (specs/flow.md). Consumed by newExpedition when the size is chosen. */
  pendingMode: Mode = "standard";
  panel: OpenPanel = null;
  credits = 0;
  creditsEarned = 0;
  cargo: Cargo = emptyCargo();
  satchel: Satchel = { resonite: 0, cryenite: 0, coreSample: false };
  tiers: UpgradeTiers = { fuel: 1, drill: 1, cargo: 1, hull: 1, jetpack: 1, radiator: 1, scanner: 1 };
  installed = new Set<RocketComponentId>();
  /** Held single-use field-supply items, counted per type (specs/items.md). */
  items: ItemCounts = emptyItems();
  /** Items dropped on the grid — today only a jettisoned Core Sample (specs/items.md). */
  groundItems: GroundItem[] = [];
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
  spawnCol = 15;
  cameraX = 0;
  cameraY = 0;
  /** Signed, time-accumulated vertical lead in [-1, 1] (see updateCamera): +1 = full descend
   *  lead (miner ridden up), -1 = full climb lead. Ramps toward the current move direction and
   *  decays to 0 at rest. Scaled by CAMERA_LEAD_FRACTION to place the miner off-centre. */
  cameraLead = 0;
  coreTimer: number | null = null;
  deepestRow = 0;
  elapsedSeconds = 0;
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
  gasSeepCd = 0;
  private gasSeepIdx = 0;
  // Screen shake (render-only; never touches the deterministic sim): remaining time (s) and
  // peak amplitude (px). Set via addShake on a violent event (specs/hazards.md).
  shakeT = 0;
  shakeAmp = 0;
  // First-time hazard tip: a NON-blocking, dismissible card shown the first time the miner is
  // hit by gas / lava this expedition (specs/hazards.md, specs/flow.md). `tip` is the live
  // card (with its remaining lifetime); `tipShown` records which have already fired so each
  // shows at most once per run.
  tip: { kind: "gas" | "lava"; t: number } | null = null;
  tipShown: { gas: boolean; lava: boolean } = { gas: false, lava: false };
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
  /** Weight (kg) currently in the bay (specs/mining.md). */
  cargoWeight(): number {
    return cargoWeight(this.cargo);
  }
  /** Total mass the jetpack lifts: the miner plus its cargo (specs/character.md). Informational
   *  (HUD/flavor) — the climb physics reads `loadFrac()`, not this. */
  totalMass(): number {
    return MINER_BASE_MASS + this.cargoWeight();
  }
  /** Radiator damage-reduction fraction 0..0.8 (specs/upgrades.md, specs/hazards.md). */
  radiatorEff(): number {
    return RADIATOR_EFFECTIVENESS[this.tiers.radiator - 1]!;
  }
  /**
   * Cargo LOAD FRACTION, 0..1: the ore weight in the bay over the jetpack tier's heaviest
   * liftable cargo (JETPACK_MAX_LIFT). This single number drives the climb accel, the climb top
   * speed, and the fall terminal (specs/character.md). 1 = at the lift limit (overloaded).
   */
  loadFrac(): number {
    return clamp(this.cargoWeight() / JETPACK_MAX_LIFT[this.tiers.jetpack - 1]!, 0, 1);
  }
  /**
   * The RAW upward acceleration passed to the integrator when thrusting (specs/character.md).
   * The NET climb accel falls LINEARLY with the load — `JETPACK_ACCEL * (1 − loadFrac)` — so a
   * heavy haul accelerates far more slowly and, at the lift limit, not at all. We return
   * `GRAVITY + net` because the integrator applies gravity every tick and subtracts this while
   * thrust is held (so the net while thrusting is exactly the load-scaled climb accel, and at
   * loadFrac 1 thrust merely cancels gravity — the miner can only slow its descent, not climb).
   */
  thrustAccel(): number {
    const net = JETPACK_ACCEL[this.tiers.jetpack - 1]! * (1 - this.loadFrac());
    return GRAVITY + net;
  }
  /**
   * The EFFECTIVE climb-speed cap for the current load (specs/character.md). The tier's cap
   * (JETPACK_CLIMB) is the EMPTY-load speed; it scales down LINEARLY with the load fraction by
   * JETPACK_LOAD_CAP_FALLOFF (0.42) — full cap when empty, 58% of it at the very lift limit —
   * so top speed tracks weight, but LESS steeply than the acceleration (which falls to zero).
   * An OVERLOADED miner can't climb at all, so its cap is 0.
   */
  climbCap(): number {
    if (this.overloaded()) return 0;
    const emptyCap = JETPACK_CLIMB[this.tiers.jetpack - 1]!;
    return emptyCap * (1 - JETPACK_LOAD_CAP_FALLOFF * this.loadFrac());
  }
  /**
   * The terminal FALL speed for the current load (specs/character.md): weight-scaled from
   * FALL_TERMINAL_EMPTY (empty) up to FALL_TERMINAL_FULL (at the lift limit). A heavy haul falls
   * faster and so lands far harder (specs/hazards.md) — weight is dangerous going down as well
   * as up — and cannot realistically be feathered to a safe landing the way an empty drop can.
   */
  fallTerminal(): number {
    return FALL_TERMINAL_EMPTY + (FALL_TERMINAL_FULL - FALL_TERMINAL_EMPTY) * this.loadFrac();
  }
  /**
   * True when the current load is too heavy for the jetpack to climb at all — the cargo weight
   * meets or exceeds the tier's lift limit (specs/character.md). The miner can only slow its
   * descent and must drop ore from the inventory or upgrade the jetpack. The HUD warns when this
   * holds.
   */
  overloaded(): boolean {
    return this.cargoWeight() >= JETPACK_MAX_LIFT[this.tiers.jetpack - 1]!;
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

  /** Move from mode-select to size-select, holding the chosen mode until a world size is picked
   *  (specs/flow.md). The expedition doesn't start until the size is chosen. */
  chooseMode(mode: Mode): void {
    this.pendingMode = mode;
    this.phase = "size-select";
  }

  /** Start a fresh expedition in the given mode at the given world SIZE (specs/mode.md,
   *  specs/world.md). Starting anew abandons any existing save — there is at most one save slot
   *  (specs/flow.md). The size defaults to Standard so the proof harness and old callers get the
   *  reference mine. */
  newExpedition(mode: Mode, size: WorldSize = DEFAULT_WORLD_SIZE): void {
    clearSave();
    this.mode = mode;
    // Point the active world layout at the chosen size BEFORE generating the mine, so its depth,
    // bands, and every dimension query match (specs/world.md).
    this.worldSize = size;
    setWorldSize(size);
    const w = generateWorld(this.nextSeed());
    this.grid = w.grid;
    this.nodes = w.nodes;
    this.spawnCol = w.spawnCol;
    this.credits = 0;
    this.creditsEarned = 0;
    this.cargo = emptyCargo();
    this.satchel = { resonite: 0, cryenite: 0, coreSample: false };
    this.tiers = { fuel: 1, drill: 1, cargo: 1, hull: 1, jetpack: 1, radiator: 1, scanner: 1 };
    this.installed = new Set();
    this.items = emptyItems();
    this.groundItems = [];
    this.coreTimer = null;
    this.deepestRow = 0;
    this.elapsedSeconds = 0;
    this.summary = null;
    this.deathCause = undefined;
    this.panel = null;
    this.dying = null;
    this.launchAnim = null;
    this.hurtFlash = 0;
    this.notes = [];
    this.shakeT = 0;
    this.shakeAmp = 0;
    this.tip = null;
    this.tipShown = { gas: false, lava: false };
    this.gasSeepIdx = 0;
    this.placeMinerAtSurface();
    this.miner.fuel = this.maxFuel();
    this.miner.hull = this.maxHull();
    this.updateCamera(1);
    this.phase = "in-mine";
  }

  /** Position the miner standing on the surface floor above the spawn column. */
  placeMinerAtSurface(): void {
    const m = this.miner;
    m.x = GRID_MARGIN_X + this.spawnCol * TILE_SIZE + (TILE_SIZE - MINER_W) / 2;
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

  /** Kick a render-only screen shake (specs/hazards.md). Takes the stronger of any shake
   *  already running, so overlapping blasts don't cancel out. */
  addShake(amp: number, time: number): void {
    this.shakeAmp = Math.max(this.shakeAmp, amp);
    this.shakeT = Math.max(this.shakeT, time);
  }

  /** Show the first-time tip for a hazard the miner just met, once per expedition. A no-op if
   *  it has already fired (or one is already up). Non-blocking — see fixedStep / render. */
  maybeShowTip(kind: "gas" | "lava"): void {
    if (this.tipShown[kind] || this.tip) return;
    this.tipShown[kind] = true;
    this.tip = { kind, t: TIP_LIFE };
  }

  /** Dismiss the live hazard tip (a click or a dismiss key — specs/controls.md). */
  dismissTip(): void {
    this.tip = null;
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
    // Screen shake + the non-blocking hazard tip decay on their own clocks, independent of
    // whether a panel is open — neither is part of the deterministic sim (specs/hazards.md).
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      if (this.shakeT <= 0) {
        this.shakeT = 0;
        this.shakeAmp = 0;
      }
    }
    if (this.tip) {
      this.tip.t -= dt;
      if (this.tip.t <= 0) this.tip = null;
    }

    // The Core Sample timer runs EVERYWHERE — surface, shop, mid-climb (specs/hazards.md).
    // It belongs to the carried Sample OR a jettisoned ground Sample; expiry is location-
    // aware (a jettisoned Sample detonates at its ground tile, specs/items.md).
    if (this.coreTimer !== null) {
      this.coreTimer -= dt;
      if (this.coreTimer <= 0) {
        this.coreTimer = 0;
        expireCoreTimer(this);
      }
    }

    // Launch sequence: the rocket lifts off, then Victory (specs/rocket.md).
    if (this.launchAnim !== null) {
      this.launchAnim += dt;
      this.thrustFxCd -= dt;
      if (this.thrustFxCd <= 0) {
        this.thrustFxCd = 0.12;
        const b = SURFACE_BUILDINGS.find((x) => x.id === "launch-pad")!;
        const rx = GRID_MARGIN_X + b.col * TILE_SIZE + TILE_SIZE / 2;
        game_pushLaunchFx(this, rx);
      }
      this.activeLoops.clear();
      if (this.launchAnim >= LAUNCH_ANIM_TIME) {
        this.summary = this.makeSummary();
        this.launchAnim = null;
        // The expedition is won — the save (if any) is spent (specs/flow.md).
        clearSave();
        this.phase = "victory";
      }
      return;
    }

    // Death animation playing out before the mode outcome (specs/modes.md).
    if (this.dying) {
      this.dying.t += dt;
      this.miner.state = this.dying.cause === "fuel-out" ? "fuel-out" : "hurt";
      stepMovement(this.miner, this.grid, { left: false, right: false, down: false, thrust: false }, false, dt, this.thrustAccel(), this.climbCap(), this.fallTerminal());
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
      move = stepMovement(this.miner, this.grid, this.input, this.miner.fuel > 0, dt, this.thrustAccel(), this.climbCap(), this.fallTerminal());
    }

    // Jetpack exhaust while thrusting (specs/assets.md).
    if (move.thrusting) {
      this.thrustFxCd -= dt;
      if (this.thrustFxCd <= 0) {
        this.thrustFxCd = 0.06;
        this.fxQueue.push({ kind: "jetpack-exhaust", x: minerCenterX(this.miner), y: this.miner.y + MINER_H });
      }
    }

    // Fuel accounting (specs/character.md). The thrust burn is speed-scaled: cheap when
    // cruising fast (an empty/light climb), full rate when lifting off or grinding up heavy
    // (upward speed low). `-vy` is the upward climb speed after this step's movement.
    const underground = minerRow(this.miner) >= 1;
    if (move.thrusting) this.miner.fuel -= thrustFuelRate(Math.max(0, -this.miner.vy)) * dt;
    if (move.lateralAir) this.miner.fuel -= FUEL_LATERAL_AIR_RATE * dt;
    if (underground) this.miner.fuel -= FUEL_LIFE_SUPPORT_RATE * dt;
    if (this.miner.fuel < 0) this.miner.fuel = 0;

    // Hazards (a hard landing hurts even on the surface camp floor — specs/hazards.md).
    updateLavaContact(this, dt);
    if (move.landedSpeed > 0) landImpact(this, move.landedSpeed);

    // The faint gas seep — the ONLY tell that a hidden gas pocket is there (specs/hazards.md,
    // specs/assets.md). Emitted sparsely over on-screen pockets so it stays very subtle.
    this.emitGasSeeps(dt);

    // Fuel and hull are NOT restored by being home — they are only bought at the Fuel
    // Depot (specs/character.md, specs/flow.md). Nothing refills automatically here.

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

  /**
   * Fire the subtle gas-seep VFX over gas pockets currently on screen (specs/hazards.md,
   * specs/assets.md). A gas pocket is drawn as ordinary band rock (hidden), so this faint
   * wisp is its only tell. It stays subtle — a hurried dig still misses it — but it must
   * actually READ if a careful eye is on the tile, which the old "one random pocket every
   * 0.45s" failed at: with several pockets on screen a given watched tile almost never got a
   * wisp. Instead we step through the on-screen pockets ROUND-ROBIN on a faster cadence, so
   * EVERY visible pocket seeps in turn (a watched tile wisps within a second or two). Purely
   * cosmetic (drained to the particle bursts), so the pick is allowed to be non-deterministic.
   */
  private emitGasSeeps(dt: number): void {
    this.gasSeepCd -= dt;
    if (this.gasSeepCd > 0) return;
    this.gasSeepCd = 0.22;
    const c0 = Math.max(0, Math.floor(this.cameraX / TILE_SIZE));
    const c1 = Math.min(WORLD_COLS - 1, Math.floor((this.cameraX + VIEWPORT_WIDTH) / TILE_SIZE));
    const r0 = Math.max(0, Math.floor(this.cameraY / TILE_SIZE));
    const r1 = Math.min(WORLD.rows - 1, Math.floor((this.cameraY + VIEWPORT_HEIGHT) / TILE_SIZE));
    const gas: [number, number][] = [];
    for (let r = r0; r <= r1; r++) {
      const line = this.grid[r];
      if (!line) continue;
      for (let c = c0; c <= c1; c++) if (line[c]!.kind === "gas") gas.push([c, r]);
    }
    if (!gas.length) return;
    // Round-robin across the visible pockets so each one seeps in its turn (≈ every
    // 0.22s × pocketCount), rather than one random pocket that a watched tile rarely gets.
    this.gasSeepIdx = (this.gasSeepIdx + 1) % gas.length;
    const [c, r] = gas[this.gasSeepIdx]!;
    // Jitter the wisp within a central band of the tile each time it appears, so a
    // watched pocket doesn't seep from the exact same pixel and give itself away. This
    // is cosmetic (not part of the deterministic proof), so Math.random is fine.
    const jx = 0.3 + Math.random() * 0.4; // 30%–70% across
    const jy = 0.2 + Math.random() * 0.28; // 20%–48% down
    this.fxQueue.push({
      kind: "gas-seep",
      x: c * TILE_SIZE + TILE_SIZE * jx,
      y: r * TILE_SIZE + TILE_SIZE * jy,
    });
  }

  /** Follow the miner in both axes (public so item warps can recenter — specs/items.md). */
  updateCamera(dt: number): void {
    const m = this.miner;
    // Horizontal: center the miner and clamp so the wide mine never scrolls past its side
    // bedrock borders (specs/world.md — the mine is wider than the viewport).
    const targetX = clamp(minerCenterX(m) - VIEWPORT_WIDTH / 2, 0, MAX_CAMERA_X);
    // Vertical LEAD (specs/world.md): the miner does not sit dead-centre — it rides toward the
    // side it is coming FROM so more of the space it is heading INTO is visible. The lead is
    // driven by HOW LONG the miner has been moving in a direction, NOT by how fast: while it is
    // genuinely moving (|vy| above CAMERA_LEAD_MIN_SPEED — so drift and the braced ~0 velocity of
    // a straight-down drill do NOT count) the accumulated lead ramps toward that direction at a
    // fixed rate (full reach after CAMERA_LEAD_RAMP_TIME seconds), regardless of speed; when it is
    // not moving the lead decays back to centre over CAMERA_LEAD_RELEASE_TIME. So a sustained
    // fall/climb walks the miner all the way out to the cap while a brief hop barely leads, and a
    // slow descent never jerks the view. Descending (+dir) rides the miner UP; climbing (−dir)
    // rides it DOWN. On an instant recenter (item warp, dt >= 1) the lead is reset to centre.
    //
    // REVERSAL is the exception to the slow ramp: when the miner turns around (e.g. jetpacking up,
    // then releasing and falling) the accumulated lead is still on the side it just left, so it
    // would have to crawl the whole way through centre at the slow ramp rate and the view lags
    // behind the turn. While the lead is on the WRONG side for the current direction we unwind it
    // toward centre at the faster CAMERA_LEAD_REVERSE_TIME; only once it crosses centre and starts
    // building a lead in the new direction does it drop back to the slow ramp. The result snaps
    // the miner back toward centre quickly on a reversal, then eases out into the new lead.
    let dir = 0;
    if (m.vy > CAMERA_LEAD_MIN_SPEED) dir = 1;
    else if (m.vy < -CAMERA_LEAD_MIN_SPEED) dir = -1;
    if (dt >= 1) {
      this.cameraLead = 0;
    } else {
      let rate: number;
      if (dir === 0) rate = 1 / CAMERA_LEAD_RELEASE_TIME; // at rest → decay to centre
      else if (this.cameraLead * dir < 0) rate = 1 / CAMERA_LEAD_REVERSE_TIME; // wrong side → unwind fast
      else rate = 1 / CAMERA_LEAD_RAMP_TIME; // building lead in the travel direction → slow
      const step = rate * dt;
      this.cameraLead += clamp(dir - this.cameraLead, -step, step);
    }
    const biasFrac = 0.5 - this.cameraLead * CAMERA_LEAD_FRACTION; // 0.165 full descend … 0.835 full climb
    // Vertical: at rest the top clamp is MIN_CAM (frames the camp); once the miner rises
    // into the sky above the surface, the clamp follows it up so it stays on screen.
    // FEED-FORWARD: the per-frame ease below (factor k) makes the RENDERED miner trail its lead
    // target by vy·dt·(1−k)/k px in the steady state (the follow lag Δ/k of a ramp minus the
    // one-frame render offset Δ), which would drag the falling miner back down-screen and eat the
    // lead. We add exactly that back into the target so the fall/climb lag cancels and the miner
    // reaches the CAMERA_LEAD_FRACTION cap — its leading edge ~one character height from the edge —
    // at ANY speed or frame rate. Derived from the SAME k as the lerp; 0 on a snap (k = 1). Added
    // BEFORE the clamps so it never pushes the view past the world floor/ceiling.
    const snap = dt >= 1;
    const k = snap ? 1 : Math.min(1, CAMERA_FOLLOW_RATE * dt);
    const leadFF = k >= 1 ? 0 : (m.vy * dt * (1 - k)) / k;
    const topClamp = Math.min(MIN_CAM, minerCenterY(m) - SKY_FOLLOW_MARGIN);
    const targetY = clamp(
      minerCenterY(m) - VIEWPORT_HEIGHT * biasFrac + leadFF,
      topClamp,
      this.maxCam(),
    );
    if (snap) {
      this.cameraX = targetX;
      this.cameraY = targetY;
    } else {
      this.cameraX += (targetX - this.cameraX) * k;
      this.cameraY += (targetY - this.cameraY) * k;
    }
  }

  maxCam(): number {
    return WORLD.rows * TILE_SIZE - VIEWPORT_HEIGHT;
  }

  /** Whether the tile directly beneath the miner's cell is minable (so a held-down cut will
   *  bite into it) — used to keep the drill-down pose across the one-frame gap between two
   *  down-drilled tiles (specs/character.md). */
  private minableBelowMiner(): boolean {
    const line = this.grid[minerRow(this.miner) + 1];
    const t = line?.[minerCol(this.miner)];
    return !!t && isMinableKind(t.kind);
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
    // Bridge the single-frame gap between two down-drilled tiles: the instant one tile breaks
    // the miner is briefly un-braced (it settles onto the next tile) before the down cut resumes
    // next step. Without this it flashes the standing sprite for one frame mid-shaft (and the
    // player reads a stutter). If DOWN is held while grounded over a minable tile the cut WILL
    // resume this coming step, so hold the drill-down pose across the gap (specs/character.md).
    if (this.input.down && move.grounded && this.minableBelowMiner()) {
      m.state = "drill-down";
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
      const bx = GRID_MARGIN_X + b.col * TILE_SIZE + TILE_SIZE / 2;
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

  /** Activate the building the miner is standing at (the E / Enter key). The Save Pad has no
   *  menu — it banks the expedition on the spot (specs/flow.md); every other building opens
   *  its overlay panel. */
  activateNearbyBuilding(): void {
    const b = this.nearbyBuilding();
    if (!b) return;
    if (b.id === "save-pad") this.trySave();
    else this.openPanel(b.id);
  }

  /** Bank the expedition from the Save Pad (key or click), with a note either way — there is
   *  no separate save menu (specs/flow.md). A no-op away from the surface. */
  trySave(): void {
    if (this.phase !== "in-mine" || !this.atSurface() || this.dying || this.launchAnim !== null) return;
    if (this.canSave()) this.saveExpedition();
    else this.note("CAN'T SAVE — UNSTABLE CORE SAMPLE ACTIVE");
  }

  closePanel(): void {
    this.panel = null;
  }

  /**
   * Toggle the inventory (cargo hold) overlay (specs/mining.md, specs/flow.md). Unlike the
   * surface building panels it opens ANYWHERE — surface or mid-dig — so the player can review
   * the haul and drop specific ore to shed weight when overloaded (specs/character.md). Like
   * every panel it freezes movement while open (the Core timer keeps running — no free pause).
   */
  openInventory(): void {
    if (this.phase !== "in-mine" || this.dying || this.launchAnim !== null) return;
    this.panel = this.panel === "inventory" ? null : "inventory";
  }

  // ---- Ground items — the jettisoned Core Sample (specs/items.md) ----

  /** The jettisoned Core Sample on the ground, or null. Today the only ground item. */
  coreGround(): GroundItem | null {
    return this.groundItems.find((g) => g.kind === "core-sample") ?? null;
  }

  /**
   * Jettison the carried Core Sample onto the miner's current tile as a ground item
   * (specs/items.md). The destabilization timer keeps running on the dropped Sample (it
   * belongs to the ground item now, not the satchel), so the player can drop it and flee
   * before it detonates. This is a ONE-WAY discard — the Sample cannot be picked back up;
   * another must be drilled from the (inexhaustible) Core (specs/mining.md). A no-op if not
   * carrying it.
   */
  jettisonCoreSample(): void {
    if (this.phase !== "in-mine" || this.dying || this.launchAnim !== null) return;
    if (!this.satchel.coreSample) return;
    const col = minerCol(this.miner);
    const row = minerRow(this.miner);
    this.satchel.coreSample = false;
    this.groundItems.push({ kind: "core-sample", col, row });
    this.fxQueue.push({ kind: "core-extract", x: minerCenterX(this.miner), y: minerCenterY(this.miner) });
    this.sndQueue.push("impact");
    this.note("CORE SAMPLE JETTISONED — CLEAR THE BLAST");
  }

  // ---- Save / continue (single slot, specs/flow.md, specs/modes.md, save.ts) ----

  /**
   * Whether the expedition may be saved right now: only at the surface Save Pad, and never
   * while the unstable Core Sample's timer is running — whether it is in hand OR jettisoned
   * as a ground item — so the destabilization timer is never frozen out by saving-and-
   * quitting (specs/hazards.md, specs/items.md, specs/flow.md).
   */
  canSave(): boolean {
    return (
      this.atSurface() &&
      this.coreTimer === null &&
      !this.satchel.coreSample &&
      this.coreGround() === null
    );
  }

  /** Write the single save slot from the Save Pad (specs/flow.md). Returns false if it can't
   *  save right now or storage is unavailable. */
  saveExpedition(): boolean {
    if (this.phase !== "in-mine" || !this.canSave()) return false;
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
      satchel: { resonite: this.satchel.resonite, cryenite: this.satchel.cryenite },
      grid: this.grid,
      nodes: this.nodes,
      spawnCol: this.spawnCol,
      deepestRow: this.deepestRow,
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

  /** Restore the saved expedition (from the menu CONTINUE or a Standard death), placing the
   *  miner back at the surface with the saved fuel/hull. Returns false if there is no save. */
  loadExpedition(): boolean {
    const data = readSave();
    if (!data) return false;
    this.mode = data.mode;
    // Restore the saved mine's SIZE before adopting its grid, so band lookups, gas depth, and the
    // camera bounds all match the dimensions the world was generated at (specs/world.md). Saves
    // written before world sizes existed default to Standard.
    this.worldSize = data.size ?? DEFAULT_WORLD_SIZE;
    setWorldSize(this.worldSize);
    this.grid = data.grid;
    this.nodes = data.nodes;
    this.spawnCol = data.spawnCol;
    this.credits = data.credits;
    this.creditsEarned = data.creditsEarned;
    this.cargo = { ...emptyCargo(), ...data.cargo };
    this.satchel = { resonite: data.satchel.resonite, cryenite: data.satchel.cryenite, coreSample: false };
    this.tiers = { ...data.tiers };
    this.installed = new Set(data.installed);
    // Item counts persist across a save/continue; the Core Sample never does (save is
    // blocked while its timer runs), so ground items always restore empty (specs/items.md).
    this.items = { ...emptyItems(), ...(data.items ?? {}) };
    this.groundItems = [];
    this.coreTimer = null;
    this.deepestRow = data.deepestRow;
    this.elapsedSeconds = data.elapsedSeconds;
    this.summary = null;
    this.deathCause = undefined;
    this.panel = null;
    this.dying = null;
    this.launchAnim = null;
    this.hurtFlash = 0;
    this.notes = [];
    this.shakeT = 0;
    this.shakeAmp = 0;
    this.tip = null;
    this.tipShown = { gas: false, lava: false };
    this.gasSeepIdx = 0;
    this.placeMinerAtSurface();
    this.miner.fuel = Math.min(this.maxFuel(), data.fuel);
    this.miner.hull = Math.min(this.maxHull(), data.hull);
    this.updateCamera(1);
    this.phase = "in-mine";
    return true;
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
      this.tiers = { fuel: t, drill: t, cargo: t, hull: t, jetpack: t, radiator: t, scanner: t };
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
    m.x = GRID_MARGIN_X + col * TILE_SIZE + (TILE_SIZE - MINER_W) / 2;
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

  /** Begin an expedition (the proof harness's entry — same as choosing a mode then a size). The
   *  size defaults to Standard so existing harness calls get the reference mine (specs/proof.md). */
  startExpedition(mode: Mode, size: WorldSize = DEFAULT_WORLD_SIZE): void {
    this.newExpedition(mode, size);
  }
}

// A launch-exhaust burst under the rising rocket (kept out of the class for brevity).
function game_pushLaunchFx(game: Game, rocketX: number): void {
  const pad = SURFACE_FEET_Y - 10;
  const y = pad - (game.launchAnim ?? 0) * 230;
  game.fxQueue.push({ kind: "launch-exhaust", x: rocketX, y: y + 60, scale: 1.4 });
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
function clampInt(v: number, lo: number, hi: number): number {
  return Math.round(clamp(v, lo, hi));
}
