// Junction — the in-code HUD chrome (specs/overview.md, DESIGN §4, §5.1).
//
// Everything here is drawn in code in the palette (specs/assets.md §5): the top-strip city
// vitals (treasury, balance, population, power/water meters, an alert chip, the clock +
// speed/pause/mute/overlay controls) and the bottom-strip dashboard (the RCI demand meters,
// the build palette of tool buttons, the tax stepper, and the active-tool cost readout). The
// only produced art the HUD touches is the small 16×16 sprite glyphs (ASSETS.md §1.5); the
// panels, bars, and text are canvas. Every hit target is returned to the caller as a
// `Clickable` so the input layer routes pointer events without re-deriving the layout.
//
// This module also owns the low-level canvas draw primitives (`text`, `roundRect`, `blit`,
// `hexA`, …) the render and overlays slices share, so those helpers live in exactly one place
// (hud.ts imports nothing from render/overlays, so there is no import cycle).

import {
  COL,
  DEBT_LIMIT,
  FONT,
  MONTH_NAMES,
  STAGE_W,
  TAX_MAX,
  TILE_COUNT,
  TOOLS,
  TOP_H,
  VIEW_Y1,
  ZONE_COLOR,
} from "./constants";
import { iconOf } from "./assets";
import type { Assets } from "./assets";
import type { Game } from "./sim";
import type { Clickable } from "./types";

// ---- Shared canvas primitives (used by hud / overlays / render) ----------------

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function text(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  size: number,
  color: string,
  align: CanvasTextAlign = "left",
  weight = "400",
  letter = 0,
): void {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  if (letter > 0) {
    const chars = [...s];
    const adv = size * 0.6 + letter;
    const total = chars.length * adv;
    let cx = align === "center" ? x - total / 2 : align === "right" ? x - total : x;
    ctx.textAlign = "left";
    for (const c of chars) {
      ctx.fillText(c, cx, y);
      cx += adv;
    }
  } else {
    ctx.textAlign = align;
    ctx.fillText(s, x, y);
  }
}

// Blit a produced sprite centred at (cx,cy), sized w×h, optionally rotated — always with
// nearest-neighbour sampling so the pixel art stays crisp (specs/assets.md).
export function blit(ctx: CanvasRenderingContext2D, img: HTMLImageElement, cx: number, cy: number, w: number, h: number, ang = 0): void {
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.translate(cx, cy);
  if (ang) ctx.rotate(ang);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  ctx.restore();
}

export function hexA(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

export function inRect(px: number, py: number, x: number, y: number, w: number, h: number): boolean {
  return px >= x && px <= x + w && py >= y && py <= y + h;
}

// Word-wrap `s` into `maxW`, drawing each line; returns the number of lines drawn.
export function wrap(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, maxW: number, size: number, color: string, lineHeight = 18): number {
  ctx.font = `400 ${size}px ${FONT}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  const words = s.split(" ");
  let line = "";
  let yy = y;
  let n = 1;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, yy);
      line = word;
      yy += lineHeight;
      n++;
    } else line = test;
  }
  ctx.fillText(line, x, yy);
  return n;
}

export function lineCount(ctx: CanvasRenderingContext2D, s: string, maxW: number, size: number): number {
  ctx.font = `400 ${size}px ${FONT}`;
  const words = s.split(" ");
  let line = "";
  let n = 1;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxW && line) {
      n++;
      line = word;
    } else line = test;
  }
  return n;
}

// ---- Money / metric formatting -------------------------------------------------
function money(n: number): string {
  const v = Math.round(n);
  const s = Math.abs(v).toLocaleString("en-US");
  return v < 0 ? `-$${s}` : `$${s}`;
}
function signedMoney(n: number): string {
  const v = Math.round(n);
  if (v > 0) return `+$${v.toLocaleString("en-US")}`;
  if (v < 0) return `-$${Math.abs(v).toLocaleString("en-US")}`;
  return "$0";
}
function servedPct(supply: number, demand: number): number {
  return demand <= 0 ? 1 : Math.max(0, Math.min(1, supply / demand));
}

// ---- The live alert condition (specs/flow.md, DESIGN §5.1) ---------------------
interface AlertInfo {
  text: string;
}
function currentAlert(game: Game): AlertInfo | null {
  const b = game.budget;
  if (b.treasury <= DEBT_LIMIT * 0.5) return { text: "NEAR DEBT LIMIT" };
  const p = game.stats.power;
  if (p.demand > p.supply) return { text: "POWER SHORTAGE" };
  const w = game.stats.water;
  if (w.demand > w.supply) return { text: "WATER SHORTAGE" };
  if (b.balance < 0) return { text: "LOSING MONEY" };
  if (gridlocked(game)) return { text: "GRIDLOCK" };
  return null;
}
// A corridor is gridlocked when any link runs well past its capacity.
function gridlocked(game: Game): boolean {
  const w = game.world;
  for (let i = 0; i < TILE_COUNT; i++) {
    const cap = w.cap[i]!;
    if (cap > 0 && w.load[i]! / cap > 1.6) return true;
  }
  return false;
}

// ---- Top strip: city vitals ----------------------------------------------------
const CLOCK_MUTED_SPEED = ["▶", "▶▶", "▶▶▶"];

function vital(
  ctx: CanvasRenderingContext2D,
  assets: Assets,
  icon: string | null,
  label: string,
  value: string,
  x: number,
  valueColor: string,
): number {
  let tx = x;
  if (icon) {
    blit(ctx, assets.sprite(icon), x + 8, 32, 16, 16, 0);
    tx = x + 22;
  }
  text(ctx, label, tx, 19, 9, COL.text3, "left", "600", 1);
  text(ctx, value, tx, 40, 17, valueColor, "left", "700");
  return tx;
}

// A small horizontal fill meter (power/water balance), red when the supply falls short.
function meter(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, frac: number, color: string, short: boolean): void {
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.fill();
  const fw = Math.max(0, Math.min(1, frac)) * w;
  if (fw > 0) {
    roundRect(ctx, x, y, fw, h, h / 2);
    ctx.fillStyle = short ? COL.alert : color;
    ctx.fill();
  }
}

function drawTopStrip(ctx: CanvasRenderingContext2D, game: Game, assets: Assets, clicks: Clickable[], muted: boolean): void {
  ctx.fillStyle = COL.panel;
  ctx.fillRect(0, 0, STAGE_W, TOP_H);
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, TOP_H - 0.5);
  ctx.lineTo(STAGE_W, TOP_H - 0.5);
  ctx.stroke();

  const b = game.budget;
  const near = b.treasury <= DEBT_LIMIT * 0.5;
  vital(ctx, assets, "icons/money", "TREASURY", money(b.treasury), 14, b.treasury < 0 ? COL.alert : near ? COL.alert : COL.money);
  vital(ctx, assets, null, "BALANCE / MO", signedMoney(b.balance), 208, b.balance < 0 ? COL.alert : COL.money);
  vital(ctx, assets, "icons/pop", "POPULATION", game.stats.population.toLocaleString("en-US"), 356, COL.text);

  const pw = game.stats.power;
  const px = vital(ctx, assets, "icons/power", "POWER", `${Math.round(servedPct(pw.supply, pw.demand) * 100)}%`, 520, pw.demand > pw.supply ? COL.alert : COL.power);
  meter(ctx, px + 46, 30, 54, 7, servedPct(pw.supply, pw.demand), COL.power, pw.demand > pw.supply);

  const wt = game.stats.water;
  const wx = vital(ctx, assets, "icons/water", "WATER", `${Math.round(servedPct(wt.supply, wt.demand) * 100)}%`, 690, wt.demand > wt.supply ? COL.alert : COL.pipe);
  meter(ctx, wx + 46, 30, 54, 7, servedPct(wt.supply, wt.demand), COL.pipe, wt.demand > wt.supply);

  // ---- right-hand control cluster (right-to-left) + clock ----
  let rx = STAGE_W - 12;
  rx -= 34;
  ctrlButton(ctx, clicks, rx, muted ? "♪̸" : "♪", "mute", muted ? COL.text3 : COL.text, 34);
  rx -= 8;
  rx -= 34;
  ctrlButton(ctx, clicks, rx, game.paused ? "▶" : "❚❚", "pause", game.paused ? COL.money : COL.text, 34);
  rx -= 8;
  rx -= 40;
  ctrlButton(ctx, clicks, rx, `${game.speed}x`, "speed", COL.text, 40);
  rx -= 8;
  rx -= 96;
  ctrlButton(ctx, clicks, rx, `◱ ${game.overlay.toUpperCase()}`, "overlay", game.overlay === "none" ? COL.text2 : COL.text, 96);
  rx -= 14;

  const clock = `${MONTH_NAMES[game.clock.month]} ${game.clock.year}`;
  const speedGlyph = game.paused ? "❚❚" : CLOCK_MUTED_SPEED[game.speed - 1]!;
  text(ctx, speedGlyph, rx, 32, 13, game.paused ? COL.money : COL.text2, "right", "700");
  text(ctx, clock, rx - 34, 32, 15, COL.text, "right", "700", 1);

  // ---- alert chip (only when a condition is live) ----
  const alert = currentAlert(game);
  if (alert) {
    ctx.font = `700 12px ${FONT}`;
    const tw = ctx.measureText(alert.text).width;
    const chipW = tw + 44;
    const cx = rx - 34 - ctx.measureText(clock).width - 20 - chipW;
    const chipX = Math.max(wx + 120, cx);
    const pulse = 0.6 + 0.4 * Math.abs(Math.sin(game.stats.monthsSurvived + performance.now() / 400));
    roundRect(ctx, chipX, 16, chipW, 32, 8);
    ctx.fillStyle = hexA(COL.alert, 0.18 * pulse + 0.08);
    ctx.fill();
    ctx.strokeStyle = hexA(COL.alert, 0.7);
    ctx.lineWidth = 1;
    ctx.stroke();
    blit(ctx, assets.sprite("icons/alert"), chipX + 18, 32, 16, 16, 0);
    text(ctx, alert.text, chipX + 30, 33, 12, COL.alert, "left", "700", 0.5);
  }
}

function ctrlButton(ctx: CanvasRenderingContext2D, clicks: Clickable[], x: number, label: string, action: string, color: string, w: number): void {
  const y = 14;
  const h = 34;
  roundRect(ctx, x, y, w, h, 6);
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  ctx.lineWidth = 1;
  ctx.stroke();
  text(ctx, label, x + w / 2, y + h / 2 + 1, 12, color, "center", "600");
  clicks.push({ x, y, w, h, action });
}

// ---- Bottom strip: RCI meters + build palette + tax stepper + cost readout ------
const BOT_Y = VIEW_Y1; // 656
const BOT_TOP = BOT_Y + 4;
const RCI_X = 16;
const RCI_PITCH = 30;
const RCI_W = 18;
const PAL_X = 138;
const PAL_W = 54;
const PAL_PITCH = 58;

function drawRciMeters(ctx: CanvasRenderingContext2D, game: Game): void {
  const bars: { key: "res" | "com" | "ind"; letter: string; value: number }[] = [
    { key: "res", letter: "R", value: game.rci.r },
    { key: "com", letter: "C", value: game.rci.c },
    { key: "ind", letter: "I", value: game.rci.d },
  ];
  const top = BOT_TOP + 4;
  const bottom = BOT_Y + 44;
  const mid = (top + bottom) / 2;
  const halfH = (bottom - top) / 2;
  text(ctx, "DEMAND", RCI_X, BOT_TOP - 1, 8, COL.text3, "left", "600", 1);
  bars.forEach((bar, i) => {
    const x = RCI_X + i * RCI_PITCH;
    // track
    roundRect(ctx, x, top, RCI_W, bottom - top, 3);
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    ctx.fill();
    // zero line
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, mid);
    ctx.lineTo(x + RCI_W, mid);
    ctx.stroke();
    const frac = Math.max(-1, Math.min(1, bar.value / 100));
    const color = ZONE_COLOR[bar.key];
    if (frac >= 0) {
      const h = frac * halfH;
      ctx.fillStyle = color;
      ctx.fillRect(x, mid - h, RCI_W, h);
    } else {
      const h = -frac * halfH;
      ctx.fillStyle = hexA(color, 0.45);
      ctx.fillRect(x, mid, RCI_W, h);
    }
    text(ctx, bar.letter, x + RCI_W / 2, bottom + 8, 10, color, "center", "800");
  });
}

function drawPalette(ctx: CanvasRenderingContext2D, game: Game, assets: Assets, clicks: Clickable[], pointerX: number, pointerY: number): void {
  const y = BOT_TOP + 2;
  const h = 52;
  TOOLS.forEach((def, i) => {
    const x = PAL_X + i * PAL_PITCH;
    const active = game.activeTool === def.tool;
    const afford = game.budget.treasury >= def.cost;
    const hover = inRect(pointerX, pointerY, x, y, PAL_W, h);
    roundRect(ctx, x, y, PAL_W, h, 6);
    ctx.fillStyle = active ? hexA(def.color, 0.22) : hover ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.03)";
    ctx.fill();
    ctx.strokeStyle = active ? def.color : "rgba(255,255,255,0.10)";
    ctx.lineWidth = active ? 2 : 1;
    ctx.stroke();
    ctx.save();
    ctx.globalAlpha = afford ? 1 : 0.4;
    blit(ctx, assets.sprite(iconOf(def.tool)), x + PAL_W / 2, y + 18, 18, 18, 0);
    ctx.restore();
    text(ctx, def.label, x + PAL_W / 2, y + 40, 9, active ? def.color : afford ? COL.text2 : COL.text3, "center", "700", 0.5);
    clicks.push({ x, y, w: PAL_W, h, action: `tool:${def.tool}` });
  });
}

// The tax stepper — `TAX 9% ◂ ▸`, also bound to [ / ] by the input layer (DESIGN §5.1).
export function drawTax(ctx: CanvasRenderingContext2D, game: Game, x: number, clicks: Clickable[]): number {
  const y = BOT_TOP + 8;
  text(ctx, "TAX", x, y + 10, 10, COL.text3, "left", "600", 1);
  const pct = Math.round(game.budget.taxRate * 100);
  const high = game.budget.taxRate >= TAX_MAX * 0.75;
  text(ctx, `${pct}%`, x + 30, y + 10, 18, high ? COL.ind : COL.text, "left", "700");
  const bx = x + 74;
  stepBtn(ctx, clicks, bx, y - 2, "◂", "taxDown");
  stepBtn(ctx, clicks, bx + 26, y - 2, "▸", "taxUp");
  return bx + 26 + 22;
}

function stepBtn(ctx: CanvasRenderingContext2D, clicks: Clickable[], x: number, y: number, glyph: string, action: string): void {
  const w = 22;
  const h = 26;
  roundRect(ctx, x, y, w, h, 5);
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 1;
  ctx.stroke();
  text(ctx, glyph, x + w / 2, y + h / 2 + 1, 13, COL.text, "center", "700");
  clicks.push({ x, y, w, h, action });
}

// The active-tool cost readout at the far right (DESIGN §5.1).
function drawCostReadout(ctx: CanvasRenderingContext2D, game: Game): void {
  const rx = STAGE_W - 14;
  const tool = game.activeTool;
  if (!tool) {
    text(ctx, "SELECT A TOOL", rx, BOT_TOP + 20, 12, COL.text3, "right", "600", 1);
    text(ctx, "◂ ▸ or drag to build", rx, BOT_TOP + 38, 10, COL.text3, "right", "400");
    return;
  }
  const def = TOOLS.find((t) => t.tool === tool)!;
  text(ctx, def.name, rx, BOT_TOP + 18, 13, def.color, "right", "700", 0.5);
  const line = tool === "bulldoze" ? `$${def.cost}/tile · refunds` : def.upkeep > 0 ? `$${def.cost}/tile · $${def.upkeep}/mo` : `$${def.cost}/tile`;
  text(ctx, line, rx, BOT_TOP + 38, 11, COL.text2, "right", "500");
}

function drawBottomStrip(ctx: CanvasRenderingContext2D, game: Game, assets: Assets, clicks: Clickable[], pointerX: number, pointerY: number): void {
  ctx.fillStyle = COL.panel;
  ctx.fillRect(0, BOT_Y, STAGE_W, 720 - BOT_Y);
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, BOT_Y + 0.5);
  ctx.lineTo(STAGE_W, BOT_Y + 0.5);
  ctx.stroke();

  drawRciMeters(ctx, game);
  // divider
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.beginPath();
  ctx.moveTo(PAL_X - 12, BOT_Y + 10);
  ctx.lineTo(PAL_X - 12, 712);
  ctx.stroke();

  drawPalette(ctx, game, assets, clicks, pointerX, pointerY);
  const taxX = PAL_X + TOOLS.length * PAL_PITCH + 6;
  drawTax(ctx, game, taxX, clicks);
  drawCostReadout(ctx, game);
}

// ---- Entry ---------------------------------------------------------------------
export function drawHud(ctx: CanvasRenderingContext2D, game: Game, assets: Assets, clicks: Clickable[], pointerX: number, pointerY: number, muted: boolean): void {
  drawTopStrip(ctx, game, assets, clicks, muted);
  drawBottomStrip(ctx, game, assets, clicks, pointerX, pointerY);
}
