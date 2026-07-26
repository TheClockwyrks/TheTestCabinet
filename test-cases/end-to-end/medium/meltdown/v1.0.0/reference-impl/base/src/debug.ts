// Meltdown — the debugging and automation API installed on window.__meltdown.
//
// A thin surface over the exact game the UI drives: it advances the real
// fixed-timestep simulation (game.fixedStep) and reads the real state
// (game.debugSnapshot), so a scenario driven from code behaves identically to one
// played by hand. It only sets up situations and steps the real systems forward;
// it never fabricates an outcome. See specs/instrumentation.md.

import { C, FIXED_STEP, MONO } from "./constants";
import type { Game, MeltdownSnapshot } from "./game";
import { containmentConfig, specialConfig, type DifficultyId } from "./modes";
import type { Rotation, SurgeType, TowerType, Vent } from "./types";

// The mode names the instrumentation API uses (specs/instrumentation.md), which
// drop the hyphens the internal mode ids carry.
type StartMode =
  | "containment"
  | "hundred"
  | "deeppockets"
  | "bottleneck"
  | "suddendeath";

export interface MeltdownDebugApi {
  version: number;
  // Core.
  reset(options?: { seed?: number }): void;
  /** Advance the simulation by exactly `ticks` fixed steps. `ticks` must be a non-negative integer. */
  step(ticks: number): void;
  snapshot(): MeltdownSnapshot;
  setAutoStep(enabled: boolean): void;
  // Run setup.
  startGame(mode: StartMode, difficulty?: DifficultyId): void;
  setMoney(amount: number): void;
  setLives(count: number): void;
  setWave(n: number): void;
  setBuildTimer(seconds: number): void;
  startWave(): void;
  // Towers.
  armTower(type: TowerType): void;
  movePreview(col: number, row: number): void;
  rotatePreview(): void;
  place(): void;
  placeTower(
    type: TowerType,
    col: number,
    row: number,
    rotation?: Rotation,
  ): void;
  canPlace(
    type: TowerType,
    col: number,
    row: number,
    rotation?: Rotation,
  ): boolean;
  selectTower(id: number | null): void;
  upgradeTower(id: number): void;
  sellTower(id: number): void;
  hoverShop(type: TowerType | null): void;
  setHeat(id: number, H: number): void;
  // Surge.
  spawnUnit(type: SurgeType, vent: Vent): number;
  // Input.
  keyDown(code: string): void;
  keyUp(code: string): void;
  press(code: string): void;
}

function configFor(mode: StartMode, difficulty?: DifficultyId) {
  switch (mode) {
    case "containment":
      return containmentConfig(difficulty ?? "medium");
    case "deeppockets":
      return specialConfig("deep-pockets");
    case "suddendeath":
      return specialConfig("sudden-death");
    default:
      return specialConfig(mode);
  }
}

export function installDebugApi(game: Game): void {
  const api: MeltdownDebugApi = {
    version: 1,

    reset(options) {
      // The base variant uses no randomness, so the seed is accepted and has no
      // effect; a variant with a seeded generator would reseed it here.
      void options?.seed;
      game.debugReset();
    },

    // Advance the real simulation by exactly `ticks` fixed steps, without waiting
    // on real time. Also switches to manual stepping.
    //
    // The unit is whole ticks, not seconds (specs/instrumentation.md): the timestep
    // is 60 Hz, so step(60) is one second of game time. Nothing is rounded — a
    // fractional or negative count has no honest meaning here, so it is refused
    // loudly rather than guessed at.
    step(ticks) {
      if (!Number.isInteger(ticks) || ticks < 0) {
        throw new Error(
          `__meltdown.step(ticks): ticks must be a non-negative integer number of ` +
            `${1 / FIXED_STEP} Hz simulation steps, got ${String(ticks)}`,
        );
      }
      game.setAutoStep(false);
      for (let i = 0; i < ticks; i++) game.fixedStep(FIXED_STEP);
    },

    snapshot() {
      return game.debugSnapshot();
    },

    setAutoStep(enabled) {
      game.setAutoStep(Boolean(enabled));
    },

    startGame(mode, difficulty) {
      game.beginMatch(configFor(mode, difficulty));
    },

    setMoney(amount) {
      game.money = amount;
    },

    setLives(count) {
      game.lives = count;
    },

    setWave(n) {
      game.debugSetWave(n);
    },

    setBuildTimer(seconds) {
      // Applies only during a timed build phase, not the untimed opening phase.
      if (
        game.state === "playing" &&
        game.phase === "build" &&
        !game.openingPhase
      ) {
        game.buildTimer = seconds;
      }
    },

    startWave() {
      // Release the next wave now (Start in the opening phase, Send between
      // waves), claiming any early-send bonus, through the real wave spawner.
      game.launchWave(true);
    },

    armTower(type) {
      game.debugArm(type);
    },

    movePreview(col, row) {
      game.debugMovePreview(col, row);
    },

    rotatePreview() {
      game.debugRotatePreview();
    },

    place() {
      game.debugPlace();
    },

    placeTower(type, col, row, rotation = 0) {
      game.debugPlaceTower(type, col, row, rotation);
    },

    canPlace(type, col, row, _rotation = 0) {
      // A footprint is square, so rotation does not affect placement validity; it
      // is accepted for symmetry with placeTower.
      void _rotation;
      return game.canPlaceAt(type, col, row);
    },

    selectTower(id) {
      if (id === null) {
        game.selected = null;
        return;
      }
      game.selected = game.towers.find((t) => t.id === id) ?? null;
    },

    upgradeTower(id) {
      const t = game.towers.find((x) => x.id === id);
      if (t) game.upgrade(t);
    },

    sellTower(id) {
      const t = game.towers.find((x) => x.id === id);
      if (t) game.sell(t);
    },

    hoverShop(type) {
      game.hoveredShop = type;
    },

    setHeat(id, H) {
      game.debugSetHeat(id, H);
    },

    spawnUnit(type, vent) {
      return game.debugSpawnUnit(type, vent);
    },

    // Inject keyboard input through the very same path the real keyboard feeds (a
    // dispatched KeyboardEvent the Input listener catches), so the game's actual
    // key bindings run. Unlike the control operations above, this does NOT take
    // control away from normal play, so a caller can confirm the controls work.
    keyDown(code) {
      window.dispatchEvent(new KeyboardEvent("keydown", { code }));
      // Apply any one-shot action (menu move, confirm, arm, rotate, send, speed,
      // pause, mute) at once, so a caller need not wait for a render frame.
      game.handleInput();
    },

    keyUp(code) {
      window.dispatchEvent(new KeyboardEvent("keyup", { code }));
    },

    press(code) {
      this.keyDown(code);
      this.keyUp(code);
    },
  };

  (window as unknown as { __meltdown?: MeltdownDebugApi }).__meltdown = api;
}

// ---- The read-only debug overlay (toggled by backtick) ---------------------
//
// Draws the game's live internal state over the running game, legibly and plainly,
// clearly separate from the HUD. It only draws and never changes gameplay
// (specs/instrumentation.md).
export function drawDebugOverlay(
  ctx: CanvasRenderingContext2D,
  game: Game,
): void {
  const s = game.debugSnapshot();
  const lines: string[] = [];
  lines.push(`DEBUG  screen=${s.screen} phase=${s.phase}`);
  lines.push(
    `mode=${s.mode ?? "-"} difficulty=${s.difficulty ?? "-"} speed=${s.speed}x`,
  );
  lines.push(
    `money=${s.money} lives=${s.lives} score=${s.score} wave=${s.wave}/${s.waveCount}` +
      (s.buildTimer !== null ? ` build=${s.buildTimer.toFixed(1)}s` : "") +
      ` remaining=${s.waveRemaining}`,
  );
  lines.push(
    `paths L=${fmt(s.paths.left.length)} T=${fmt(s.paths.top.length)} muted=${s.muted}`,
  );
  lines.push(`towers ${s.towers.length}:`);
  for (const t of s.towers.slice(0, 14)) {
    lines.push(
      `  #${t.id} ${t.type} L${t.level} heat=${t.heat.toFixed(0)}/${t.redline}` +
        `${t.tripped ? " TRIP" : ""} kills=${t.kills}`,
    );
  }
  if (s.towers.length > 14) lines.push(`  … +${s.towers.length - 14} more`);
  lines.push(`surge ${s.surge.length}:`);
  for (const u of s.surge.slice(0, 14)) {
    lines.push(
      `  #${u.id} ${u.type} (${u.col},${u.row}) hp=${u.hp.toFixed(0)}/${u.maxHp.toFixed(0)}` +
        `${u.slowed ? " SLOW" : ""}`,
    );
  }
  if (s.surge.length > 14) lines.push(`  … +${s.surge.length - 14} more`);

  const size = 12;
  const pad = 8;
  const lh = size + 4;
  ctx.save();
  ctx.font = `400 ${size}px ${MONO}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  let w = 0;
  for (const ln of lines) w = Math.max(w, ctx.measureText(ln).width);
  const boxW = w + pad * 2;
  const boxH = lines.length * lh + pad * 2;
  ctx.fillStyle = "rgba(4, 6, 9, 0.82)";
  ctx.fillRect(6, 6, boxW, boxH);
  ctx.strokeStyle = C.edge;
  ctx.lineWidth = 1;
  ctx.strokeRect(6.5, 6.5, boxW, boxH);
  ctx.fillStyle = C.ok;
  let y = 6 + pad;
  for (const ln of lines) {
    ctx.fillText(ln, 6 + pad, y);
    y += lh;
  }
  ctx.restore();
}

function fmt(n: number): string {
  return isFinite(n) ? n.toFixed(1) : "∞";
}
