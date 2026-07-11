// Meltdown — the game: state machine, economy, the fixed-step simulation (heat,
// firing, coupling, pathing), and all input handling. Rendering lives in
// render.ts and reads this object's public fields. main.ts drives it:
// handleInput() (edge events) each frame, then fixedStep() at a fixed timestep,
// then updatePointer() before render.

import { heatColor } from "./colors";
import {
  BUILD_PHASE_TIME,
  COLS,
  FLOOR_X0,
  FLOOR_Y0,
  heatMultiplier,
  hpScale,
  INTEREST_CAP,
  INTEREST_RATE,
  PANEL_X,
  REDLINE,
  ROWS,
  START_LIVES,
  START_MONEY,
  TILE,
  TOTAL_WAVES,
  TRIP_TIME,
  waveClearBonus,
} from "./constants";
import { isEmitterDef, SURGE_DEFS, TOWER_DEFS, type EmitterDef } from "./defs";
import { Grid, idx, tileAtPixel } from "./grid";
import type { Input } from "./input";
import { Surge, type Goal } from "./surge";
import { Tower } from "./towers";
import type { AppState, Phase, SurgeType, TowerType, Vent } from "./types";
import { TOWER_ORDER } from "./types";
import {
  ctlRect,
  inRect,
  sellBtnRect,
  sendBtnRect,
  shopItemRect,
  upgradeBtnRect,
  type Rect,
} from "./ui";
import { generateWave } from "./waves";

export const TITLE_ITEMS = ["DEFEND", "HOW TO PLAY"];
export const PAUSE_ITEMS = ["RESUME", "RESTART", "QUIT TO MENU"];
export const END_ITEMS = ["PLAY AGAIN", "MENU"];

export interface Shot {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  life: number; // seconds remaining
}

export interface Preview {
  i: number;
  j: number;
  valid: boolean;
}

export interface MenuHit {
  index: number;
  rect: Rect;
}

const HOTKEYS: Record<string, number> = {
  Digit1: 0,
  Digit2: 1,
  Digit3: 2,
  Digit4: 3,
  Digit5: 4,
  Digit6: 5,
  Digit7: 6,
  Digit8: 7,
};

export class Game {
  readonly input: Input;

  state: AppState = "title";
  phase: Phase = "build";
  menuIndex = 0;

  grid = new Grid();
  towers: Tower[] = [];
  surge: Surge[] = [];
  shots: Shot[] = [];

  private fieldRight: Float64Array;
  private fieldBottom: Float64Array;

  money = START_MONEY;
  lives = START_LIVES;
  score = 0;
  waveNumber = 1;

  buildTimer = BUILD_PHASE_TIME;
  // The opening build phase (before Wave 1) is untimed: no countdown, never
  // auto-starts, no early-send bonus, no interest (specs/flow.md).
  openingPhase = false;
  private waveEvents: ReturnType<typeof generateWave> = [];
  private spawnCursor = 0;
  private waveElapsed = 0;
  private spawnCounter: Record<Vent, number> = { left: 0, top: 0 };

  speed: 1 | 2 = 1;
  armed: TowerType | null = null;
  selected: Tower | null = null;
  preview: Preview | null = null;

  simTime = 0;
  reachedWave = 1; // for the end screen

  // Menu-overlay item rects, laid out by the renderer for click hit-testing.
  menuHits: MenuHit[] = [];

  constructor(input: Input) {
    this.input = input;
    this.fieldRight = this.grid.distanceField(this.grid.rightExhaust.tiles);
    this.fieldBottom = this.grid.distanceField(this.grid.bottomExhaust.tiles);
    this.toTitle();
  }

  // ---- State transitions -------------------------------------------------

  private toTitle(): void {
    this.state = "title";
    this.menuIndex = 0;
    this.resetMatch();
    this.buildTitleScene();
  }

  private resetMatch(): void {
    this.grid = new Grid();
    this.towers = [];
    this.surge = [];
    this.shots = [];
    this.money = START_MONEY;
    this.lives = START_LIVES;
    this.score = 0;
    this.waveNumber = 1;
    this.reachedWave = 1;
    this.openingPhase = false;
    this.armed = null;
    this.selected = null;
    this.preview = null;
    this.speed = 1;
    this.spawnCounter = { left: 0, top: 0 };
    this.recomputePaths();
  }

  // A dim slice of reactor floor with a few glowing towers behind the menu.
  private buildTitleScene(): void {
    const add = (type: TowerType, i: number, j: number, heat: number) => {
      const t = new Tower(type, i, j);
      t.heat = heat;
      for (const tile of this.grid.footprintTiles(i, j)) this.grid.blocked[tile] = 1;
      this.towers.push(t);
    };
    add("lance", 7, 7, 12);
    add("forge", 9, 7, 0);
    add("arc", 11, 24, 96);
    add("bloom", 13, 24, 70);
    add("rime", 33, 27, 6);
    add("stutter", 41, 9, 100);
    this.towers[5].tripped = true;
    this.towers[5].tripTimer = TRIP_TIME;
    this.recomputeCoupling();
  }

  private startMatch(): void {
    this.resetMatch();
    this.state = "playing";
    this.enterBuildPhase(1, false);
  }

  private enterBuildPhase(wave: number, payInterest: boolean): void {
    this.waveNumber = wave;
    this.reachedWave = wave;
    this.phase = "build";
    // Wave 1's build phase is the untimed opening phase; the between-wave phases
    // carry the countdown and auto-start (specs/flow.md).
    this.openingPhase = wave === 1;
    this.buildTimer = BUILD_PHASE_TIME;
    if (payInterest) {
      const interest = Math.min(INTEREST_CAP, Math.floor(this.money * INTEREST_RATE));
      this.money += interest;
    }
  }

  private beginWave(): void {
    this.phase = "wave";
    this.waveEvents = generateWave(this.waveNumber);
    this.spawnCursor = 0;
    this.waveElapsed = 0;
  }

  private sendWave(early: boolean): void {
    if (this.state !== "playing" || this.phase !== "build") return;
    // The opening phase pays no early-send bonus; the timed between-wave phases
    // pay the remaining seconds when the player sends early (specs/flow.md).
    if (early && !this.openingPhase) {
      const bonus = Math.floor(Math.max(0, this.buildTimer));
      this.money += bonus;
    }
    this.openingPhase = false;
    this.beginWave();
  }

  private pause(): void {
    if (this.state !== "playing") return;
    this.state = "paused";
    this.menuIndex = 0;
  }

  private resume(): void {
    if (this.state === "paused") this.state = "playing";
  }

  private clearWave(): void {
    this.money += waveClearBonus(this.waveNumber);
    this.score += 100 * this.waveNumber;
    if (this.waveNumber >= TOTAL_WAVES) {
      this.score += 250 * this.lives;
      this.state = "victory";
      this.menuIndex = 0;
      return;
    }
    this.enterBuildPhase(this.waveNumber + 1, true);
  }

  private gameOver(): void {
    this.state = "gameover";
    this.menuIndex = 0;
    this.armed = null;
    this.selected = null;
  }

  // ---- Pathing & coupling ------------------------------------------------

  private recomputePaths(): void {
    this.fieldRight = this.grid.distanceField(this.grid.rightExhaust.tiles);
    this.fieldBottom = this.grid.distanceField(this.grid.bottomExhaust.tiles);
    this.recomputeCoupling();
  }

  private fieldFor(goal: Goal): Float64Array {
    return goal === "right" ? this.fieldRight : this.fieldBottom;
  }
  private exhaustTilesFor(goal: Goal): number[] {
    return goal === "right" ? this.grid.rightExhaust.tiles : this.grid.bottomExhaust.tiles;
  }

  // Orthogonal-footprint edge coupling factor (specs/heat.md): full edge = 1,
  // one-tile staggered = 0.5, otherwise 0.
  private couplingFactor(a: Tower, b: Tower): number {
    const di = Math.abs(a.i - b.i);
    const dj = Math.abs(a.j - b.j);
    if (di === 2 && dj === 0) return 1;
    if (di === 0 && dj === 2) return 1;
    if (di === 2 && dj === 1) return 0.5;
    if (di === 1 && dj === 2) return 0.5;
    return 0;
  }

  // Recompute each emitter's forge-heat-in and sink-cool-added from its movers.
  private recomputeCoupling(): void {
    for (const t of this.towers) {
      t.forgeHeat = 0;
      t.sinkCool = 0;
    }
    for (const mover of this.towers) {
      if (mover.type !== "forge" && mover.type !== "sink") continue;
      const out = mover.moverOutput();
      for (const e of this.towers) {
        if (!e.isEmitter) continue;
        const f = this.couplingFactor(mover, e);
        if (f === 0) continue;
        if (mover.type === "forge") e.forgeHeat += out * f;
        else e.sinkCool += out * f;
      }
    }
  }

  // ---- Fixed-timestep simulation -----------------------------------------

  fixedStep(dt: number): void {
    if (this.state !== "playing") return;

    // Decay transient shot tracers.
    for (const s of this.shots) s.life -= dt;
    if (this.shots.length) this.shots = this.shots.filter((s) => s.life > 0);

    if (this.phase === "build") {
      // Towers still heat/cool (and idle-cool) during the build phase.
      this.updateTowers(dt);
      // The opening phase never counts down or auto-starts — the player presses
      // Start when ready (specs/flow.md).
      if (!this.openingPhase) {
        this.buildTimer -= dt;
        if (this.buildTimer <= 0) {
          this.buildTimer = 0;
          this.sendWave(false);
        }
      }
    } else {
      this.spawn(dt);
      this.updateTowers(dt);
      this.cullDead();
      this.moveSurge(dt);
      this.cullLeaked();
      if (this.state === "playing" && this.spawnCursor >= this.waveEvents.length && this.surge.length === 0) {
        this.clearWave();
      }
    }

    this.simTime += dt;
  }

  private spawn(dt: number): void {
    this.waveElapsed += dt;
    while (this.spawnCursor < this.waveEvents.length && this.waveEvents[this.spawnCursor].t <= this.waveElapsed) {
      const e = this.waveEvents[this.spawnCursor++];
      this.spawnUnit(e.type, e.vent);
    }
  }

  private spawnUnit(type: SurgeType, vent: Vent): void {
    const tiles = vent === "left" ? this.grid.leftVent.tiles : this.grid.topVent.tiles;
    const slot = this.spawnCounter[vent]++ % tiles.length;
    const tile = tiles[slot];
    const hp = SURGE_DEFS[type].hp * hpScale(this.waveNumber);
    this.surge.push(new Surge(type, vent, tile, hp));
  }

  private updateTowers(dt: number): void {
    for (const t of this.towers) {
      if (!t.isEmitter) continue;
      t.firedThisStep = false;

      if (t.tripped) {
        t.tripTimer -= dt;
        t.heat = (REDLINE * Math.max(0, t.tripTimer)) / TRIP_TIME; // bleed to 0
        if (t.tripTimer <= 0) {
          t.tripped = false;
          t.heat = 0;
          t.fireCooldown = 0;
        }
        continue;
      }

      const target = this.pickTarget(t);
      if (target) {
        const stats = t.stats();
        const interval = 1 / stats.fireRate;
        t.fireCooldown -= dt;
        let guard = 0;
        while (t.fireCooldown <= 0 && guard++ < 8) {
          this.fire(t, target);
          t.fireCooldown += interval;
        }
      } else {
        t.fireCooldown = Math.max(0, t.fireCooldown - dt);
      }

      // Forge pours in heat; cooling (own + sink) scales with heat.
      t.heat += t.forgeHeat * dt;
      t.heat -= (t.stats().coolRate + t.sinkCool) * (t.heat / REDLINE) * dt;
      if (t.heat < 0) t.heat = 0;
      if (t.heat >= REDLINE) {
        t.heat = REDLINE;
        t.tripped = true;
        t.tripTimer = TRIP_TIME;
      }
    }
  }

  private pickTarget(t: Tower): Surge | null {
    const def = t.def as EmitterDef;
    const stats = t.stats();
    const range = stats.range * TILE;
    const r2 = range * range;
    let best: Surge | null = null;
    let bestRemaining = Infinity;
    for (const u of this.surge) {
      if (!u.alive) continue;
      if (def.airOnly && !u.flies) continue;
      const dx = u.x - t.cx;
      const dy = u.y - t.cy;
      if (dx * dx + dy * dy > r2) continue;
      const remaining = u.progressRemaining(this.fieldFor(u.goal));
      if (remaining < bestRemaining) {
        bestRemaining = remaining;
        best = u;
      }
    }
    return best;
  }

  private fire(t: Tower, target: Surge): void {
    const def = t.def as EmitterDef;
    const stats = t.stats();
    const dmg = stats.baseDamage * heatMultiplier(t.heat);

    if (t.isRime) {
      // Cryo: slows hardest when cold; still lands a little damage.
      const slow = stats.slowCeil * (1 - t.heat / REDLINE);
      target.applySlow(slow, this.simTime);
      target.damage(dmg);
    } else if (def.splash) {
      // Bloom: splash all surge within the splash radius of the impact.
      const sr = def.splash * TILE;
      const sr2 = sr * sr;
      for (const u of this.surge) {
        if (!u.alive) continue;
        const dx = u.x - target.x;
        const dy = u.y - target.y;
        if (dx * dx + dy * dy <= sr2) u.damage(dmg);
      }
    } else {
      target.damage(dmg);
    }

    t.heat += stats.heatPerShot;
    t.firedThisStep = true;
    this.shots.push({
      x1: t.cx,
      y1: t.cy,
      x2: target.x,
      y2: target.y,
      color: t.isRime ? "#79e0ff" : heatColor(t.heat),
      life: 0.07,
    });
  }

  private moveSurge(dt: number): void {
    for (const u of this.surge) {
      if (!u.alive) continue;
      if (u.flies) {
        u.updateFly(this.simTime, dt);
      } else {
        u.updateGround(this.grid, this.fieldFor(u.goal), this.exhaustTilesFor(u.goal), this.simTime, dt);
      }
    }
  }

  private cullDead(): void {
    const survivors: Surge[] = [];
    for (const u of this.surge) {
      if (!u.alive && !u.leaked) {
        // Killed — pay bounty and score.
        this.money += u.def.bounty;
        this.score += u.def.bounty;
      } else {
        survivors.push(u);
      }
    }
    this.surge = survivors;
  }

  private cullLeaked(): void {
    const survivors: Surge[] = [];
    for (const u of this.surge) {
      if (u.leaked) {
        this.lives -= u.def.leak;
      } else {
        survivors.push(u);
      }
    }
    this.surge = survivors;
    if (this.lives <= 0) {
      this.lives = 0;
      this.gameOver();
    }
  }

  // ---- Building / selling / upgrading ------------------------------------

  private snapIntersection(x: number, y: number): { i: number; j: number } {
    // Intersections are grid-relative to the floor origin (specs/playfield.md).
    const i = Math.max(1, Math.min(COLS - 1, Math.round((x - FLOOR_X0) / TILE)));
    const j = Math.max(1, Math.min(ROWS - 1, Math.round((y - FLOOR_Y0) / TILE)));
    return { i, j };
  }

  // Full placement validity, including the can't-seal rule (specs/playfield.md).
  canPlaceAt(type: TowerType, i: number, j: number): boolean {
    const footprint = this.grid.footprintTiles(i, j);
    for (const tile of footprint) {
      const c = tile % COLS;
      const r = Math.floor(tile / COLS);
      // Edge tiles at the vents/exhausts are ordinary open floor; only the
      // casing (off-grid) and occupied tiles are unbuildable. The never-seal
      // rule below keeps the four openings passable.
      if (!this.grid.inBounds(c, r)) return false;
      if (this.grid.blocked[tile]) return false;
    }
    // No tile in the footprint may be under a surge unit currently on the floor.
    for (const u of this.surge) {
      if (!u.alive || u.flies) continue;
      const cell = tileAtPixel(u.x, u.y);
      if (footprint.includes(idx(cell.c, cell.r))) return false;
    }
    // Affordability.
    if (this.money < TOWER_DEFS[type].cost) return false;
    // Can't seal: both required routes and every walking unit must keep a path.
    const extra = new Set(footprint);
    const reachRight = this.grid.reachable(this.grid.rightExhaust.tiles, extra);
    const reachBottom = this.grid.reachable(this.grid.bottomExhaust.tiles, extra);
    for (const tile of this.grid.leftVent.tiles) if (!reachRight[tile]) return false;
    for (const tile of this.grid.topVent.tiles) if (!reachBottom[tile]) return false;
    for (const u of this.surge) {
      if (!u.alive || u.flies) continue;
      const cell = tileAtPixel(u.x, u.y);
      const reach = u.goal === "right" ? reachRight : reachBottom;
      if (!reach[idx(cell.c, cell.r)]) return false;
    }
    return true;
  }

  private placeTower(type: TowerType, i: number, j: number): void {
    if (!this.canPlaceAt(type, i, j)) return;
    const t = new Tower(type, i, j);
    for (const tile of this.grid.footprintTiles(i, j)) this.grid.blocked[tile] = 1;
    this.towers.push(t);
    this.money -= TOWER_DEFS[type].cost;
    this.recomputePaths();
    // Sticky placement while Shift is held; otherwise disarm after one build.
    if (!this.input.isHeld("ShiftLeft") && !this.input.isHeld("ShiftRight")) {
      this.armed = null;
    }
  }

  private sellSelected(): void {
    const t = this.selected;
    if (!t) return;
    this.money += Math.floor(t.totalSpend * 0.7);
    for (const tile of this.grid.footprintTiles(t.i, t.j)) this.grid.blocked[tile] = 0;
    this.towers = this.towers.filter((x) => x !== t);
    this.selected = null;
    this.recomputePaths();
  }

  private upgradeSelected(): void {
    const t = this.selected;
    if (!t || t.level >= 3) return;
    const cost = t.level === 1 ? Math.round(t.def.cost) : Math.round(t.def.cost * 1.8);
    if (this.money < cost) return;
    this.money -= cost;
    t.totalSpend += cost;
    t.level += 1;
    this.recomputeCoupling();
  }

  upgradeCostOf(t: Tower): number {
    if (t.level >= 3) return 0;
    return t.level === 1 ? Math.round(t.def.cost) : Math.round(t.def.cost * 1.8);
  }
  sellRefundOf(t: Tower): number {
    return Math.floor(t.totalSpend * 0.7);
  }

  private towerAt(x: number, y: number): Tower | null {
    for (const t of this.towers) {
      if (x >= t.cx - TILE && x <= t.cx + TILE && y >= t.cy - TILE && y <= t.cy + TILE) return t;
    }
    return null;
  }

  // ---- Pointer & preview (per frame, before render) ----------------------

  updatePointer(): void {
    // Placement preview.
    if (this.state === "playing" && this.armed) {
      const mx = this.input.mouseX;
      const my = this.input.mouseY;
      if (mx < PANEL_X && mx >= 0 && my >= 0 && my <= 720) {
        const { i, j } = this.snapIntersection(mx, my);
        this.preview = { i, j, valid: this.canPlaceAt(this.armed, i, j) };
      } else {
        this.preview = null;
      }
    } else {
      this.preview = null;
    }

    // Menu hover highlight.
    if (this.isMenuState()) {
      for (const hit of this.menuHits) {
        if (inRect(hit.rect, this.input.mouseX, this.input.mouseY)) {
          this.menuIndex = hit.index;
          break;
        }
      }
    }
  }

  private isMenuState(): boolean {
    return (
      this.state === "title" ||
      this.state === "paused" ||
      this.state === "victory" ||
      this.state === "gameover"
    );
  }

  // ---- Input handling (edge events, once per frame) ----------------------

  handleInput(): void {
    for (const ev of this.input.drain()) {
      if (ev.kind === "key") this.onKey(ev.code);
      else this.onClick(ev.button, ev.x, ev.y);
    }
  }

  private onKey(code: string): void {
    switch (this.state) {
      case "title":
        this.menuNav(code, TITLE_ITEMS.length, (i) => this.selectTitle(i));
        break;
      case "howto":
        if (code === "Escape" || code === "Enter" || code === "Space") this.state = "title";
        break;
      case "paused":
        if (code === "Escape" || code === "KeyP") this.resume();
        else this.menuNav(code, PAUSE_ITEMS.length, (i) => this.selectPause(i));
        break;
      case "victory":
      case "gameover":
        this.menuNav(code, END_ITEMS.length, (i) => this.selectEnd(i));
        break;
      case "playing":
        this.onPlayKey(code);
        break;
    }
  }

  private onPlayKey(code: string): void {
    if (code in HOTKEYS) {
      const type = TOWER_ORDER[HOTKEYS[code]];
      if (this.money >= TOWER_DEFS[type].cost) {
        this.armed = type;
        this.selected = null;
      }
      return;
    }
    switch (code) {
      case "Escape":
        if (this.armed) this.armed = null;
        else if (this.selected) this.selected = null;
        else this.pause();
        break;
      case "KeyP":
        this.pause();
        break;
      case "Space":
        this.sendWave(true);
        break;
      case "KeyF":
        this.speed = this.speed === 1 ? 2 : 1;
        break;
      case "KeyU":
        this.upgradeSelected();
        break;
      case "KeyS":
        this.sellSelected();
        break;
    }
  }

  private menuNav(code: string, count: number, confirm: (i: number) => void): void {
    if (code === "ArrowUp" || code === "KeyW") {
      this.menuIndex = (this.menuIndex + count - 1) % count;
    } else if (code === "ArrowDown" || code === "KeyS") {
      this.menuIndex = (this.menuIndex + 1) % count;
    } else if (code === "Enter" || code === "Space") {
      confirm(this.menuIndex);
    }
  }

  private selectTitle(i: number): void {
    if (i === 0) this.startMatch();
    else this.state = "howto";
  }
  private selectPause(i: number): void {
    if (i === 0) this.resume();
    else if (i === 1) this.startMatch();
    else this.toTitle();
  }
  private selectEnd(i: number): void {
    if (i === 0) this.startMatch();
    else this.toTitle();
  }

  private onClick(button: number, x: number, y: number): void {
    // Menu-overlay states: a click on an item activates it.
    if (this.isMenuState()) {
      for (const hit of this.menuHits) {
        if (inRect(hit.rect, x, y)) {
          if (this.state === "title") this.selectTitle(hit.index);
          else if (this.state === "paused") this.selectPause(hit.index);
          else this.selectEnd(hit.index);
          return;
        }
      }
      return;
    }
    if (this.state === "howto") {
      this.state = "title";
      return;
    }
    if (this.state !== "playing") return;

    if (x >= PANEL_X) {
      this.onPanelClick(x, y);
      return;
    }
    // Floor click.
    if (button === 2) {
      this.armed = null;
      return;
    }
    if (this.armed) {
      if (this.preview && this.preview.valid) {
        this.placeTower(this.armed, this.preview.i, this.preview.j);
      }
      return;
    }
    const hit = this.towerAt(x, y);
    this.selected = hit;
  }

  private onPanelClick(x: number, y: number): void {
    // Shop.
    for (let k = 0; k < TOWER_ORDER.length; k++) {
      if (inRect(shopItemRect(k), x, y)) {
        const type = TOWER_ORDER[k];
        if (this.money >= TOWER_DEFS[type].cost) {
          this.armed = this.armed === type ? null : type;
          this.selected = null;
        }
        return;
      }
    }
    // Inspector actions.
    if (this.selected) {
      if (inRect(upgradeBtnRect(), x, y)) {
        this.upgradeSelected();
        return;
      }
      if (inRect(sellBtnRect(), x, y)) {
        this.sellSelected();
        return;
      }
    }
    // Wave controls.
    if (inRect(sendBtnRect(), x, y)) {
      this.sendWave(true);
      return;
    }
    if (inRect(ctlRect(0), x, y)) {
      this.speed = 1;
      return;
    }
    if (inRect(ctlRect(1), x, y)) {
      this.speed = 2;
      return;
    }
    if (inRect(ctlRect(2), x, y)) {
      this.pause();
      return;
    }
  }

  // ---- Read-only helpers for the renderer --------------------------------

  fieldForGoal(goal: Goal): Float64Array {
    return this.fieldFor(goal);
  }

  // Live-fire damage/heat multiplier for a tower (for the inspector).
  damageMultiplier(t: Tower): number {
    return heatMultiplier(t.heat);
  }

  // A live damage value for the inspector (emitters only).
  liveDamage(t: Tower): number {
    if (!isEmitterDef(t.def)) return 0;
    return t.stats().baseDamage * heatMultiplier(t.heat);
  }
}
