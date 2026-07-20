// Locomotivation — the HUD (top status bar) drawn in code (specs/flow.md, specs/overview.md).
//
// The status bar (y in [0, STATUS_BAR_H]) shows the shift clock (alerting/pulsing under the
// low threshold), the per-color quota progress and each unique's status, lives, the carried
// -load weight bar (with the ~50%/~80% marks and OVERWEIGHT / SPRINT LOCKED reads), the
// recharging sprint bar (greyed/LOCKED over the load threshold), and the pause/mute controls.
// Drawn entirely in code in the palette and monospace type.

import {
  FONT_STACK,
  FREIGHT_COLOR,
  LOW_CLOCK_THRESHOLD,
  PALETTE,
  SPRINT_LOCK_FRACTION,
  SPRINT_MAX,
  STAGE_W,
  STATUS_BAR_H,
  W_MAX,
  WEIGHT_FULL_UNTIL,
  WEIGHT_SLOW_UNTIL,
} from "./constants";
import type { GameAssets } from "./assets";
import type { SimState } from "./sim/world";
import { currentLoad, loadFraction, sprintLocked } from "./sim/step";

/** Draw the top status bar for the live shift. */
export function drawHud(ctx: CanvasRenderingContext2D, state: SimState, muted: boolean, _assets: GameAssets): void {
  // Bar background.
  ctx.fillStyle = PALETTE.panel;
  ctx.fillRect(0, 0, STAGE_W, STATUS_BAR_H);
  ctx.fillStyle = "#00000030";
  ctx.fillRect(0, STATUS_BAR_H - 3, STAGE_W, 3);

  drawClock(ctx, state);
  drawQuota(ctx, state);
  drawLives(ctx, state);
  drawWeightBar(ctx, state);
  drawSprintBar(ctx, state);
  drawLevelAndScore(ctx, state);
  drawControls(ctx, muted);
}

// ─── Clock ────────────────────────────────────────────────────────────────────────────

function drawClock(ctx: CanvasRenderingContext2D, state: SimState): void {
  const secs = Math.max(0, state.clock);
  const mm = Math.floor(secs / 60);
  const ss = Math.floor(secs % 60);
  const label = `${mm}:${ss.toString().padStart(2, "0")}`;
  const low = secs <= LOW_CLOCK_THRESHOLD;
  const pulse = low ? 0.5 + 0.5 * Math.abs(Math.sin(state.time * 6)) : 1;

  ctx.font = `12px ${FONT_STACK}`;
  ctx.fillStyle = PALETTE.textTertiary;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("SHIFT", 18, 24);

  ctx.font = `bold 30px ${FONT_STACK}`;
  ctx.fillStyle = low ? PALETTE.signalDanger : PALETTE.gaugeClock;
  ctx.globalAlpha = pulse;
  ctx.fillText(label, 16, 56);
  ctx.globalAlpha = 1;
}

// ─── Quota ────────────────────────────────────────────────────────────────────────────

function drawQuota(ctx: CanvasRenderingContext2D, state: SimState): void {
  const x0 = 128;
  ctx.font = `bold 13px ${FONT_STACK}`;
  ctx.textAlign = "left";
  ctx.fillStyle = PALETTE.textTertiary;
  ctx.font = `11px ${FONT_STACK}`;
  ctx.fillText("QUOTA", x0, 20);

  let x = x0;
  ctx.font = `bold 14px ${FONT_STACK}`;
  for (const q of state.level.quota) {
    const got = Math.min(state.delivered[q.color], q.required);
    const done = got >= q.required;
    const label = `${q.color.slice(0, 1).toUpperCase()}${q.color.slice(1, 3)} ${got}/${q.required}`;
    // Color chip.
    ctx.fillStyle = FREIGHT_COLOR[q.color];
    ctx.fillRect(x, 30, 10, 10);
    ctx.fillStyle = done ? PALETTE.signalClear : PALETTE.textPrimary;
    ctx.fillText(label, x + 14, 40);
    x += 20 + ctx.measureText(label).width + 14;
  }

  // Unique statuses as a second line of pips.
  if (state.level.uniques.length > 0) {
    let ux = x0;
    ctx.font = `11px ${FONT_STACK}`;
    ctx.fillStyle = PALETTE.textTertiary;
    ctx.fillText("UNIQUE", ux, 58);
    ux += 52;
    for (const u of state.level.uniques) {
      const delivered = state.uniquesDelivered[u.id];
      const lost = state.uniquesLost[u.id];
      const carried = state.worker.carried.some((p) => p.originId === u.id);
      ctx.fillStyle = FREIGHT_COLOR[u.color];
      ctx.beginPath();
      ctx.arc(ux + 6, 54, 6, 0, Math.PI * 2);
      ctx.fill();
      // Ring/mark for status.
      ctx.lineWidth = 2;
      ctx.strokeStyle = lost ? PALETTE.signalDanger : delivered ? PALETTE.signalClear : carried ? PALETTE.signalWarning : PALETTE.textTertiary;
      ctx.beginPath();
      ctx.arc(ux + 6, 54, 8, 0, Math.PI * 2);
      ctx.stroke();
      if (delivered) {
        ctx.strokeStyle = PALETTE.signalClear;
        ctx.beginPath();
        ctx.moveTo(ux + 2, 54);
        ctx.lineTo(ux + 5, 57);
        ctx.lineTo(ux + 10, 50);
        ctx.stroke();
      } else if (lost) {
        ctx.strokeStyle = PALETTE.signalDanger;
        ctx.beginPath();
        ctx.moveTo(ux + 2, 50);
        ctx.lineTo(ux + 10, 58);
        ctx.moveTo(ux + 10, 50);
        ctx.lineTo(ux + 2, 58);
        ctx.stroke();
      }
      ux += 22;
    }
  }
}

// ─── Lives ────────────────────────────────────────────────────────────────────────────

function drawLives(ctx: CanvasRenderingContext2D, state: SimState): void {
  const x = STAGE_W * 0.5 + 40;
  ctx.font = `11px ${FONT_STACK}`;
  ctx.fillStyle = PALETTE.textTertiary;
  ctx.textAlign = "left";
  ctx.fillText("LIVES", x, 20);
  for (let i = 0; i < state.level.lives; i++) {
    const px = x + i * 20;
    const alive = i < state.lives;
    ctx.fillStyle = alive ? PALETTE.workerHiVis : "#3a3f47";
    // A small worker pip: hat + body.
    ctx.fillRect(px + 3, 30, 10, 4);
    ctx.fillStyle = alive ? PALETTE.workerOveralls : "#2a2e34";
    ctx.fillRect(px + 3, 34, 10, 8);
  }
}

// ─── Weight & sprint bars ─────────────────────────────────────────────────────────────

function drawWeightBar(ctx: CanvasRenderingContext2D, state: SimState): void {
  const w = state.worker;
  const load = currentLoad(w);
  const frac = Math.min(1, loadFraction(load));
  const x = STAGE_W * 0.5 + 130;
  const y = 22;
  const bw = 220;
  const bh = 14;

  ctx.font = `11px ${FONT_STACK}`;
  ctx.fillStyle = PALETTE.textTertiary;
  ctx.textAlign = "left";
  ctx.fillText("LOAD", x, y - 4);

  // Track.
  ctx.fillStyle = "#0c0e12";
  ctx.fillRect(x, y, bw, bh);
  // Fill.
  ctx.fillStyle = frac > SPRINT_LOCK_FRACTION ? PALETTE.signalDanger : PALETTE.gaugeLoad;
  ctx.fillRect(x, y, bw * frac, bh);
  // Threshold marks at 50% and 80%.
  ctx.strokeStyle = "#ffffff70";
  ctx.lineWidth = 1;
  for (const t of [WEIGHT_FULL_UNTIL, WEIGHT_SLOW_UNTIL]) {
    ctx.beginPath();
    ctx.moveTo(x + bw * t, y - 2);
    ctx.lineTo(x + bw * t, y + bh + 2);
    ctx.stroke();
  }
  ctx.strokeStyle = "#00000055";
  ctx.strokeRect(x, y, bw, bh);

  // Read-out.
  ctx.font = `bold 11px ${FONT_STACK}`;
  ctx.textAlign = "right";
  const pct = Math.round(frac * 100);
  let msg = `${load}/${W_MAX}`;
  if (frac > SPRINT_LOCK_FRACTION) msg = `OVERWEIGHT ${pct}%`;
  ctx.fillStyle = frac > SPRINT_LOCK_FRACTION ? PALETTE.signalDanger : PALETTE.textSecondary;
  ctx.fillText(msg, x + bw, y + bh + 12);
  ctx.textAlign = "left";
}

function drawSprintBar(ctx: CanvasRenderingContext2D, state: SimState): void {
  const w = state.worker;
  const frac = Math.min(1, loadFraction(currentLoad(w)));
  const locked = sprintLocked(frac);
  const charge = w.sprintCharge / SPRINT_MAX;
  const x = STAGE_W * 0.5 + 130;
  const y = 54;
  const bw = 220;
  const bh = 10;

  ctx.font = `11px ${FONT_STACK}`;
  ctx.fillStyle = PALETTE.textTertiary;
  ctx.textAlign = "left";
  ctx.fillText("SPRINT", x, y - 3);

  ctx.fillStyle = "#0c0e12";
  ctx.fillRect(x, y, bw, bh);
  if (locked) {
    ctx.fillStyle = "#33383f";
    ctx.fillRect(x, y, bw, bh);
    ctx.font = `bold 11px ${FONT_STACK}`;
    ctx.fillStyle = PALETTE.signalDanger;
    ctx.textAlign = "center";
    ctx.fillText("SPRINT LOCKED", x + bw / 2, y + bh - 1);
    ctx.textAlign = "left";
  } else {
    ctx.fillStyle = w.sprinting ? "#8ff0ff" : PALETTE.gaugeSprint;
    ctx.fillRect(x, y, bw * charge, bh);
  }
  ctx.strokeStyle = "#00000055";
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, bw, bh);
}

// ─── Level & score / controls ───────────────────────────────────────────────────────────

function drawLevelAndScore(ctx: CanvasRenderingContext2D, state: SimState): void {
  ctx.textAlign = "right";
  ctx.font = `11px ${FONT_STACK}`;
  ctx.fillStyle = PALETTE.textTertiary;
  ctx.fillText(`LEVEL ${state.level.id} · ${state.level.name.toUpperCase()}`, STAGE_W - 70, 22);
  ctx.font = `bold 18px ${FONT_STACK}`;
  ctx.fillStyle = PALETTE.score;
  ctx.fillText(`${state.score}`, STAGE_W - 70, 46);
  ctx.font = `10px ${FONT_STACK}`;
  ctx.fillStyle = PALETTE.textTertiary;
  ctx.fillText("SCORE", STAGE_W - 70, 58);
  ctx.textAlign = "left";
}

function drawControls(ctx: CanvasRenderingContext2D, muted: boolean): void {
  // Pause (Esc) and mute (M) glyphs, top-right corner.
  const px = STAGE_W - 54;
  ctx.fillStyle = PALETTE.textSecondary;
  // Pause icon.
  ctx.fillRect(px, 14, 5, 16);
  ctx.fillRect(px + 8, 14, 5, 16);
  ctx.font = `9px ${FONT_STACK}`;
  ctx.fillStyle = PALETTE.textTertiary;
  ctx.textAlign = "center";
  ctx.fillText("ESC", px + 6, 40);

  // Mute icon.
  const mx = STAGE_W - 24;
  ctx.fillStyle = muted ? PALETTE.signalDanger : PALETTE.textSecondary;
  ctx.beginPath();
  ctx.moveTo(mx - 6, 20);
  ctx.lineTo(mx - 2, 20);
  ctx.lineTo(mx + 2, 16);
  ctx.lineTo(mx + 2, 28);
  ctx.lineTo(mx - 2, 24);
  ctx.lineTo(mx - 6, 24);
  ctx.closePath();
  ctx.fill();
  if (muted) {
    ctx.strokeStyle = PALETTE.signalDanger;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(mx + 4, 15);
    ctx.lineTo(mx + 10, 29);
    ctx.stroke();
  }
  ctx.font = `9px ${FONT_STACK}`;
  ctx.fillStyle = PALETTE.textTertiary;
  ctx.fillText("M", mx + 2, 40);
  ctx.textAlign = "left";
}
