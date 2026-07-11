// Wireworm — the game state machine and simulation glue. Owns the world (the node
// field, the worms, the foes, the bolts, the cursor, effects) and the run
// (score/lives/level), advances everything on a fixed step, and routes menu input.
// The worm's per-step motion is in worm.ts and foe motion is in foes.ts; the
// signature charge/discharge rules live here because they touch every subsystem.

import type { Arc, Flash, Foe, GameState, PlayPhase, Tile, Worm } from "./types";
import { Input } from "./input";
import { Audio } from "./audio";
import { stepWorm } from "./worm";
import {
  spawnCorruptor,
  spawnDropper,
  spawnGlitch,
  updateFoe,
} from "./foes";
import {
  clearNode,
  emptyField,
  hasNode,
  idx,
  lowerHalfNodeCount,
  scatterField,
  setCharge,
  EMPTY,
} from "./field";
import {
  BAND_TOP_Y,
  BOARD_Y,
  BONUS_LIFE_EVERY,
  BOLT_SPEED,
  CHARGE_MAX,
  COLS,
  CORRUPTOR_FROM_LEVEL,
  CORRUPTOR_MAX_INTERVAL,
  CORRUPTOR_MIN_INTERVAL,
  CURSOR_SPEED,
  DISCHARGE_RADIUS,
  DROPPER_FROM_LEVEL,
  DROPPER_RECHECK,
  DROPPER_SPARSE_THRESHOLD,
  DROPPER_SPEED_HIT,
  FIRE_COOLDOWN,
  GLITCH_FROM_LEVEL,
  GLITCH_MAX_INTERVAL,
  GLITCH_MAX_ON_BOARD,
  GLITCH_MIN_INTERVAL,
  MAX_BOLTS,
  RESPAWN_INVULN,
  ROWS,
  SCORE_BODY,
  SCORE_CORRUPTOR,
  SCORE_DISCHARGE_FRY,
  SCORE_DISCHARGE_NODE,
  SCORE_DROPPER,
  SCORE_GLITCH,
  SCORE_HEAD,
  SCORE_INERT_NODE,
  SCORE_LEVEL_CLEAR,
  SCORE_VICTORY,
  STAGE_H,
  STAGE_W,
  START_LIVES,
  TILE,
  TOTAL_LEVELS,
  inBounds,
  tileCX,
  tileCY,
  tileLeft,
  tileTop,
  wormLength,
  wormStepInterval,
} from "./constants";

interface Cursor {
  x: number;
  y: number;
  invuln: number;
}

const rand = (lo: number, hi: number): number => lo + Math.random() * (hi - lo);

export class Game {
  state: GameState = "title";
  phase: PlayPhase = "banner";
  phaseTimer = 0;
  bannerText = "";
  time = 0; // global animation clock

  // World
  field: Int8Array = emptyField();
  worms: Worm[] = [];
  foes: Foe[] = [];
  bolts: { x: number; y: number }[] = [];
  arcs: Arc[] = [];
  flashes: Flash[] = [];
  cursor: Cursor = { x: STAGE_W / 2, y: (BAND_TOP_Y + STAGE_H) / 2, invuln: 0 };

  // Run
  score = 0;
  lives = START_LIVES;
  level = 1;
  reachedLevel = 1;
  private nextBonus = BONUS_LIFE_EVERY;

  // Timing
  private wormInterval = 0.14;
  private wormStepTimer = 0;
  private fireCooldown = 0;
  private glitchTimer = 0;
  private corruptorTimer = 0;
  private dropperCheckTimer = 0;
  private levelWormActive = false;

  // Menu selection (reused per menu state)
  sel = 0;

  readonly dropperHitSpeed = DROPPER_SPEED_HIT;

  constructor(
    private input: Input,
    private audio: Audio,
  ) {}

  // ---- Field helpers used by worm.ts / foes.ts -----------------------------
  segmentAt(c: number, r: number): boolean {
    for (const w of this.worms) {
      for (const s of w.segs) if (s.c === c && s.r === r) return true;
    }
    return false;
  }

  chargeNode(c: number, r: number): void {
    if (!inBounds(c, r)) return;
    const cur = this.field[idx(c, r)];
    if (cur >= 0 && cur < CHARGE_MAX) {
      this.field[idx(c, r)] = cur + 1;
      if (cur + 1 === CHARGE_MAX) this.audio.play("critical");
    }
  }

  eatNode(c: number, r: number): void {
    if (inBounds(c, r) && hasNode(this.field, c, r)) clearNode(this.field, c, r);
  }

  dropNode(c: number, r: number): void {
    if (inBounds(c, r) && !hasNode(this.field, c, r)) setCharge(this.field, c, r, 0);
  }

  slamNode(c: number, r: number): void {
    if (inBounds(c, r) && hasNode(this.field, c, r)) {
      const wasCrit = this.field[idx(c, r)] === CHARGE_MAX;
      this.field[idx(c, r)] = CHARGE_MAX;
      if (!wasCrit) this.audio.play("critical");
    }
  }

  private leaveNode(c: number, r: number): void {
    if (inBounds(c, r) && !hasNode(this.field, c, r)) setCharge(this.field, c, r, 0);
  }

  addScore(n: number): void {
    this.score += n;
    // A bonus life at every 12,000 points (specs/flow.md); a single jump may
    // cross more than one milestone.
    while (this.score >= this.nextBonus) {
      this.lives++;
      this.nextBonus += BONUS_LIFE_EVERY;
    }
  }

  // ---- Lifecycle -----------------------------------------------------------
  private startGame(): void {
    this.field = emptyField();
    scatterField(this.field);
    this.worms = [];
    this.foes = [];
    this.bolts = [];
    this.arcs = [];
    this.flashes = [];
    this.score = 0;
    this.lives = START_LIVES;
    this.level = 1;
    this.reachedLevel = 1;
    this.nextBonus = BONUS_LIFE_EVERY;
    this.cursor = { x: STAGE_W / 2, y: (BAND_TOP_Y + STAGE_H) / 2, invuln: RESPAWN_INVULN };
    this.resetFoeTimers();
    this.levelWormActive = false;
    this.state = "playing";
    this.startBanner(`LEVEL 1`);
  }

  private resetFoeTimers(): void {
    this.glitchTimer = rand(GLITCH_MIN_INTERVAL, GLITCH_MAX_INTERVAL);
    this.corruptorTimer = rand(CORRUPTOR_MIN_INTERVAL, CORRUPTOR_MAX_INTERVAL);
    this.dropperCheckTimer = DROPPER_RECHECK;
  }

  private startBanner(text: string): void {
    this.phase = "banner";
    this.phaseTimer = 1.3;
    this.bannerText = text;
  }

  private spawnWorm(): void {
    const len = wormLength(this.level);
    const fromLeft = Math.random() < 0.5;
    const segs: Tile[] = [];
    for (let i = 0; i < len; i++) {
      segs.push({ c: fromLeft ? -i : COLS - 1 + i, r: 0 });
    }
    const dh = fromLeft ? 1 : -1;
    this.worms = [{ segs, dh, dv: 1, diving: false, facing: dh }];
    this.wormInterval = wormStepInterval(this.level);
    this.wormStepTimer = 0;
    this.levelWormActive = true;
  }

  private loseLife(): void {
    this.lives--;
    this.audio.play("life");
    if (this.lives <= 0) {
      this.reachedLevel = this.level;
      this.state = "gameover";
      this.sel = 0;
      this.audio.play("gameover");
      return;
    }
    // Clear worms and foes; the node field is left standing (specs/flow.md).
    this.worms = [];
    this.foes = [];
    this.bolts = [];
    this.phase = "respawn";
    this.phaseTimer = 1.4;
    this.cursor.x = STAGE_W / 2;
    this.cursor.y = (BAND_TOP_Y + STAGE_H) / 2;
    this.cursor.invuln = RESPAWN_INVULN;
  }

  private levelClear(): void {
    this.addScore(SCORE_LEVEL_CLEAR * this.level);
    this.levelWormActive = false;
    if (this.level >= TOTAL_LEVELS) {
      this.addScore(SCORE_VICTORY * this.lives);
      this.reachedLevel = TOTAL_LEVELS;
      this.state = "victory";
      this.sel = 0;
      this.audio.play("victory");
      return;
    }
    this.level++;
    this.foes = [];
    this.bolts = [];
    this.resetFoeTimers();
    this.audio.play("level");
    this.startBanner(`LEVEL ${this.level}`);
  }

  // ---- Input (once-per-frame edge handling) --------------------------------
  handleInput(): void {
    const keys = this.input.drainKeys();
    if (keys.length) this.audio.resume();

    for (const k of keys) {
      if (k === "m") this.audio.toggleMute();
    }

    switch (this.state) {
      case "title":
        this.menuNav(keys, 2);
        if (this.confirm(keys)) {
          if (this.sel === 0) this.startGame();
          else {
            this.state = "howto";
          }
        }
        break;
      case "howto":
        if (keys.some((k) => ["Enter", " ", "Escape", "Backspace"].includes(k))) {
          this.state = "title";
          this.sel = 0;
          this.audio.play("menu");
        }
        break;
      case "playing":
        if (keys.some((k) => k === "p" || k === "Escape")) {
          this.state = "paused";
          this.sel = 0;
          this.audio.play("menu");
        }
        break;
      case "paused":
        this.menuNav(keys, 3);
        if (keys.some((k) => k === "p" || k === "Escape")) {
          this.state = "playing";
        } else if (this.confirm(keys)) {
          if (this.sel === 0) this.state = "playing";
          else if (this.sel === 1) this.startGame();
          else {
            this.state = "title";
            this.sel = 0;
          }
        }
        break;
      case "victory":
      case "gameover":
        this.menuNav(keys, 2);
        if (this.confirm(keys)) {
          if (this.sel === 0) this.startGame();
          else {
            this.state = "title";
            this.sel = 0;
          }
        }
        break;
    }
  }

  private menuNav(keys: string[], count: number): void {
    for (const k of keys) {
      if (k === "ArrowUp" || k === "w" || k === "ArrowLeft" || k === "a") {
        this.sel = (this.sel + count - 1) % count;
        this.audio.play("menu");
      } else if (
        k === "ArrowDown" ||
        k === "s" ||
        k === "ArrowRight" ||
        k === "d"
      ) {
        this.sel = (this.sel + 1) % count;
        this.audio.play("menu");
      }
    }
  }

  private confirm(keys: string[]): boolean {
    return keys.some((k) => k === "Enter" || k === " ");
  }

  // ---- Fixed-step simulation ----------------------------------------------
  fixedStep(dt: number): void {
    this.time += dt;
    this.decayEffects(dt);

    if (this.state !== "playing") return;
    if (this.cursor.invuln > 0) this.cursor.invuln = Math.max(0, this.cursor.invuln - dt);

    if (this.phase === "banner") {
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0) {
        if (!this.levelWormActive) this.spawnWorm();
        this.phase = "active";
      }
      return;
    }
    if (this.phase === "respawn") {
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0) {
        this.spawnWorm();
        this.phase = "active";
      }
      return;
    }

    // ---- Active play ----
    this.moveCursor(dt);
    this.updateFiring(dt);
    this.updateBolts(dt);
    this.updateWorms(dt);
    if (this.phase !== "active") return; // a life may have been lost mid-step
    this.updateFoes(dt);
    this.checkCursorHit();
    if (this.phase !== "active") return;

    if (this.levelWormActive && this.worms.length === 0) this.levelClear();
  }

  private decayEffects(dt: number): void {
    for (const a of this.arcs) a.life -= dt;
    for (const f of this.flashes) f.life -= dt;
    this.arcs = this.arcs.filter((a) => a.life > 0);
    this.flashes = this.flashes.filter((f) => f.life > 0);
  }

  private moveCursor(dt: number): void {
    const c = this.cursor;
    let vx = 0;
    let vy = 0;
    if (this.input.left) vx -= 1;
    if (this.input.right) vx += 1;
    if (this.input.up) vy -= 1;
    if (this.input.down_) vy += 1;

    if (vx !== 0 || vy !== 0) {
      const len = Math.hypot(vx, vy) || 1;
      c.x += (vx / len) * CURSOR_SPEED * dt;
      c.y += (vy / len) * CURSOR_SPEED * dt;
    }
    // Clamp to the player band (never leaves it).
    c.x = Math.max(TILE / 2, Math.min(STAGE_W - TILE / 2, c.x));
    c.y = Math.max(BAND_TOP_Y + TILE / 2, Math.min(STAGE_H - TILE / 2, c.y));
  }

  private updateFiring(dt: number): void {
    this.fireCooldown -= dt;
    if (this.input.firing && this.fireCooldown <= 0 && this.bolts.length < MAX_BOLTS) {
      this.bolts.push({ x: this.cursor.x, y: this.cursor.y - TILE / 2 });
      this.fireCooldown = FIRE_COOLDOWN;
      this.audio.play("fire");
    }
  }

  private updateBolts(dt: number): void {
    const survivors: { x: number; y: number }[] = [];
    for (const b of this.bolts) {
      b.y -= BOLT_SPEED * dt;
      if (b.y < BOARD_Y) continue; // vanished at the top of the board
      if (this.resolveBolt(b)) continue; // consumed by a hit
      survivors.push(b);
    }
    this.bolts = survivors;
  }

  // Returns true if the bolt hit something (and is consumed).
  private resolveBolt(b: { x: number; y: number }): boolean {
    // Foe first (foes move in pixel space, between tiles).
    const fi = this.foes.findIndex(
      (f) => Math.abs(f.x - b.x) <= 15 && Math.abs(f.y - b.y) <= 15,
    );
    if (fi >= 0) {
      this.hitFoe(fi);
      return true;
    }
    const c = Math.floor(b.x / TILE);
    const r = Math.floor((b.y - BOARD_Y) / TILE);
    if (!inBounds(c, r)) return false;
    // Worm segment next.
    for (const w of this.worms) {
      const si = w.segs.findIndex((s) => s.c === c && s.r === r);
      if (si >= 0) {
        this.hitWorm(w, si);
        return true;
      }
    }
    // Node last.
    if (this.field[idx(c, r)] >= 0) {
      this.hitNode(c, r);
      return true;
    }
    return false;
  }

  private hitNode(c: number, r: number): void {
    const ch = this.field[idx(c, r)];
    if (ch === 0) {
      clearNode(this.field, c, r);
      this.addScore(SCORE_INERT_NODE);
    } else if (ch === 1 || ch === 2) {
      this.field[idx(c, r)] = ch - 1; // de-energize one level; not removed
    } else if (ch >= CHARGE_MAX) {
      this.detonate(c, r); // the chain-arc discharge
    }
  }

  private hitFoe(index: number): void {
    const f = this.foes[index];
    if (f.kind === "dropper" && !f.hitOnce) {
      f.hitOnce = true; // first hit only speeds it up
      this.audio.play("fire");
      return;
    }
    this.foes.splice(index, 1);
    if (f.kind === "glitch") this.addScore(SCORE_GLITCH);
    else if (f.kind === "dropper") this.addScore(SCORE_DROPPER);
    else this.addScore(SCORE_CORRUPTOR);
    this.audio.play("foe");
  }

  // A direct shot into a worm segment: split (middle) or shorten (end), leaving a
  // fresh inert node where the segment died (specs/worm.md).
  private hitWorm(worm: Worm, i: number): void {
    const seg = worm.segs[i];
    this.addScore(i === 0 ? SCORE_HEAD : SCORE_BODY);
    this.leaveNode(seg.c, seg.r);
    const keep = worm.segs.map((_, j) => j !== i);
    const runs = this.splitRuns(worm, keep, false);
    const wi = this.worms.indexOf(worm);
    this.worms.splice(wi, 1, ...runs);
    this.audio.play("cut");
  }

  // Break a worm into independent worms at the gaps in `keep`. The first kept run
  // retains the original heading/dive; later runs each get a fresh head.
  private splitRuns(worm: Worm, keep: boolean[], keepDive: boolean): Worm[] {
    const runs: Worm[] = [];
    let cur: Tile[] | null = null;
    let first = true;
    const flush = (): void => {
      if (!cur) return;
      runs.push({
        segs: cur,
        dh: worm.dh,
        dv: worm.dv,
        diving: first && keepDive ? worm.diving : false,
        facing: worm.facing,
      });
      first = false;
      cur = null;
    };
    for (let j = 0; j < worm.segs.length; j++) {
      if (keep[j]) {
        if (!cur) cur = [];
        cur.push(worm.segs[j]);
      } else {
        flush();
      }
    }
    flush();
    return runs;
  }

  // ---- The chain-arc discharge (specs/charge.md — the signature) -----------
  private detonate(sc: number, sr: number): void {
    const R = DISCHARGE_RADIUS;
    const det = new Set<number>();
    const order: Tile[] = [];
    const queue: Tile[] = [{ c: sc, r: sr }];
    det.add(idx(sc, sr));
    while (queue.length) {
      const { c, r } = queue.shift() as Tile;
      order.push({ c, r });
      for (let dc = -R; dc <= R; dc++) {
        for (let dr = -R; dr <= R; dr++) {
          if (dc === 0 && dr === 0) continue;
          const nc = c + dc;
          const nr = r + dr;
          if (!inBounds(nc, nr)) continue;
          const ni = idx(nc, nr);
          if (this.field[ni] >= 1 && !det.has(ni)) {
            det.add(ni);
            queue.push({ c: nc, r: nr });
            this.arcs.push({
              x1: tileCX(c),
              y1: tileCY(r),
              x2: tileCX(nc),
              y2: tileCY(nr),
              life: 0.32,
              max: 0.32,
            });
          }
        }
      }
    }
    // Clear every detonated node; each scores the discharge purge bonus.
    for (const { c, r } of order) {
      this.field[idx(c, r)] = EMPTY;
      this.addScore(SCORE_DISCHARGE_NODE);
      this.flashes.push({ x: tileCX(c), y: tileCY(r), life: 0.3, max: 0.3 });
    }
    this.fryWorms(det);
    this.audio.play("discharge");
  }

  // Every worm segment within 2 tiles of any detonated node is fried, leaving NO
  // node; fragments left by the cull become independent worms.
  private fryWorms(det: Set<number>): void {
    const R = DISCHARGE_RADIUS;
    const near = (c: number, r: number): boolean => {
      for (let dc = -R; dc <= R; dc++) {
        for (let dr = -R; dr <= R; dr++) {
          const nc = c + dc;
          const nr = r + dr;
          if (inBounds(nc, nr) && det.has(idx(nc, nr))) return true;
        }
      }
      return false;
    };
    const next: Worm[] = [];
    for (const w of this.worms) {
      const keep = w.segs.map((s) => !near(s.c, s.r));
      const fried = keep.filter((k) => !k).length;
      if (fried > 0) this.addScore(fried * SCORE_DISCHARGE_FRY);
      for (const run of this.splitRuns(w, keep, true)) next.push(run);
    }
    this.worms = next;
  }

  private updateWorms(dt: number): void {
    this.wormStepTimer += dt;
    let guard = 4;
    while (this.wormStepTimer >= this.wormInterval && guard-- > 0) {
      this.wormStepTimer -= this.wormInterval;
      for (const w of this.worms.slice()) stepWorm(this, w);
      this.checkCursorHit();
      if (this.phase !== "active") return;
    }
  }

  private updateFoes(dt: number): void {
    // Advance / despawn.
    this.foes = this.foes.filter((f) => updateFoe(this, f, dt));

    if (this.level >= GLITCH_FROM_LEVEL) {
      this.glitchTimer -= dt;
      if (this.glitchTimer <= 0) {
        this.glitchTimer = rand(GLITCH_MIN_INTERVAL, GLITCH_MAX_INTERVAL);
        if (this.foes.filter((f) => f.kind === "glitch").length < GLITCH_MAX_ON_BOARD) {
          this.foes.push(spawnGlitch());
        }
      }
    }
    if (this.level >= DROPPER_FROM_LEVEL) {
      this.dropperCheckTimer -= dt;
      if (this.dropperCheckTimer <= 0) {
        this.dropperCheckTimer = DROPPER_RECHECK;
        const active = this.foes.some((f) => f.kind === "dropper");
        if (!active && lowerHalfNodeCount(this.field) < DROPPER_SPARSE_THRESHOLD) {
          this.foes.push(spawnDropper());
        }
      }
    }
    if (this.level >= CORRUPTOR_FROM_LEVEL) {
      this.corruptorTimer -= dt;
      if (this.corruptorTimer <= 0) {
        this.corruptorTimer = rand(CORRUPTOR_MIN_INTERVAL, CORRUPTOR_MAX_INTERVAL);
        if (!this.foes.some((f) => f.kind === "corruptor")) {
          this.foes.push(spawnCorruptor());
        }
      }
    }
  }

  // A worm segment or a foe reaching the cursor costs a life (specs/flow.md).
  private checkCursorHit(): void {
    if (this.cursor.invuln > 0) return;
    const cx = this.cursor.x - 12;
    const cy = this.cursor.y - 12;
    const cw = 24;
    for (const w of this.worms) {
      for (const s of w.segs) {
        if (
          rectsOverlap(cx, cy, cw, cw, tileLeft(s.c), tileTop(s.r), TILE, TILE)
        ) {
          this.loseLife();
          return;
        }
      }
    }
    for (const f of this.foes) {
      if (rectsOverlap(cx, cy, cw, cw, f.x - 12, f.y - 12, 24, 24)) {
        this.loseLife();
        return;
      }
    }
  }

  // Read-only accessors for the renderer.
  get invulnFlicker(): boolean {
    return this.cursor.invuln > 0 && Math.floor(this.time * 12) % 2 === 0;
  }
  get lowerNodes(): number {
    return lowerHalfNodeCount(this.field);
  }
  hasFoe(kind: Foe["kind"]): boolean {
    return this.foes.some((f) => f.kind === kind);
  }
}

function rectsOverlap(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number,
): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

// Re-export a couple of grid consts the renderer needs from one place.
export { ROWS, COLS };
