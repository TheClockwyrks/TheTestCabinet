// Floe — all canvas drawing. Reads the Game's public state and the loaded sprites
// and paints the fixed 1280x720 stage in logical space (main.ts maps it to the
// backing store). The strait furniture, HUD, bays, and VFX are drawn in code; the
// critter, bear, vehicles, and floes use the provided sprites (specs/assets.md).

import {
  BAYS,
  COLOR,
  HUD_H,
  ICE_BOTTOM,
  ICE_TOP,
  MONO,
  ROW_BAYS,
  ROW_MEDIAN,
  ROW_NEAR,
  STAGE_H,
  STAGE_W,
  STRAIT_TOP,
  STRAIT_W,
  TILE,
  WATER_BOTTOM,
  WATER_TOP,
} from "./constants";
import type { Bear, Critter } from "./entities";
import { Game, OVER_ITEMS, PAUSE_ITEMS, TITLE_ITEMS } from "./game";
import type { Sprites } from "./assets";
import type { Dir, Floe, Lane, Vehicle } from "./types";

// Two-frame run/swim cycle offsets by facing.
const RUN_BASE: Record<Dir, number> = { down: 0, up: 2, left: 4, right: 6 };
const SWIM_BASE: Record<Dir, number> = { down: 8, up: 10, left: 12, right: 14 };
const CROSSER_BASE: Record<Dir, number> = { down: 0, up: 2, left: 4, right: 6 };

export function render(ctx: CanvasRenderingContext2D, game: Game, s: Sprites): void {
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = COLOR.seaDeep;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);

  const st = game.state;
  const dimWorld = st === "title" || st === "gameover" || st === "victory";
  const showHud = st === "playing" || st === "paused";

  ctx.save();
  ctx.globalAlpha = dimWorld ? 0.34 : 1;
  drawStrait(ctx, game, s);
  ctx.restore();

  if (showHud) drawHud(ctx, game, s);

  switch (st) {
    case "title":
      drawTitle(ctx, game);
      break;
    case "howto":
      drawHowTo(ctx);
      break;
    case "paused":
      drawPaused(ctx, game);
      break;
    case "victory":
      drawEndCard(ctx, game, true);
      break;
    case "gameover":
      drawEndCard(ctx, game, false);
      break;
    case "playing":
      if (game.phase === "clearing" && game.clearActive()) drawLevelClear(ctx, game);
      break;
  }

  if (game.muteFlash > 0) drawMuteFlash(ctx, game);
}

// ---- The strait ---------------------------------------------------------

function drawStrait(ctx: CanvasRenderingContext2D, game: Game, s: Sprites): void {
  ctx.save();
  ctx.translate(0, STRAIT_TOP);

  drawBands(ctx);
  drawBays(ctx, game, s);
  drawFloes(ctx, game.lanes.water, s);
  drawCritter(ctx, game.critter, s, game);
  // Bears draw above floes so a swimming silhouette reads over the water.
  for (const h of game.hunters) if (h.bear) drawBear(ctx, h.bear, s, game);
  drawVehicles(ctx, game.lanes.ice, s);
  drawSplashes(ctx, game);

  ctx.restore();
}

function bandRect(ctx: CanvasRenderingContext2D, r0: number, r1: number, fill: string): void {
  ctx.fillStyle = fill;
  ctx.fillRect(0, r0 * TILE, STRAIT_W, (r1 - r0 + 1) * TILE);
}

function drawBands(ctx: CanvasRenderingContext2D): void {
  // Far-shore ice (rows 0-1), median (10), near shore (19): bright ice.
  bandRect(ctx, 0, ROW_BAYS, COLOR.ice);
  // Water band (2-9).
  const wy = WATER_TOP * TILE;
  const wh = (WATER_BOTTOM - WATER_TOP + 1) * TILE;
  const grad = ctx.createLinearGradient(0, wy, 0, wy + wh);
  grad.addColorStop(0, COLOR.sea);
  grad.addColorStop(1, COLOR.seaDeep);
  ctx.fillStyle = grad;
  ctx.fillRect(0, wy, STRAIT_W, wh);
  gridLines(ctx, wy, wh, COLOR.grid);
  // Median shelf (row 10) — bright safe strip.
  bandRect(ctx, ROW_MEDIAN, ROW_MEDIAN, COLOR.median);
  ctx.strokeStyle = COLOR.iceEdge;
  ctx.lineWidth = 2;
  ctx.strokeRect(0, ROW_MEDIAN * TILE + 1, STRAIT_W, TILE - 2);
  // Ice band / road (rows 11-18) — darker, duller ice.
  const iy = ICE_TOP * TILE;
  const ih = (ICE_BOTTOM - ICE_TOP + 1) * TILE;
  ctx.fillStyle = COLOR.road;
  ctx.fillRect(0, iy, STRAIT_W, ih);
  gridLines(ctx, iy, ih, COLOR.roadGrid);
  // Near shore (row 19).
  bandRect(ctx, ROW_NEAR, ROW_NEAR, COLOR.ice);
  ctx.strokeStyle = COLOR.iceEdge;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, ROW_NEAR * TILE + 0.5);
  ctx.lineTo(STRAIT_W, ROW_NEAR * TILE + 0.5);
  ctx.stroke();
}

function gridLines(ctx: CanvasRenderingContext2D, y: number, h: number, color: string): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.globalAlpha *= 0.6;
  ctx.beginPath();
  for (let c = 1; c < STAGE_W / TILE; c++) {
    ctx.moveTo(c * TILE + 0.5, y);
    ctx.lineTo(c * TILE + 0.5, y + h);
  }
  for (let yy = y + TILE; yy < y + h; yy += TILE) {
    ctx.moveTo(0, yy + 0.5);
    ctx.lineTo(STAGE_W, yy + 0.5);
  }
  ctx.stroke();
  ctx.globalAlpha /= 0.6;
}

function drawBays(ctx: CanvasRenderingContext2D, game: Game, s: Sprites): void {
  const y = ROW_BAYS * TILE;
  for (let i = 0; i < BAYS.length; i++) {
    const [c0] = BAYS[i];
    const x = c0 * TILE;
    const w = 2 * TILE;
    if (game.bays[i]) {
      // Filled: darkened, with the critter resting in it.
      ctx.fillStyle = "rgba(0,0,0,0.18)";
      roundedTop(ctx, x, y, w, TILE, 6);
      ctx.fill();
      ctx.strokeStyle = COLOR.iceEdge;
      ctx.lineWidth = 2;
      roundedTop(ctx, x + 1, y + 1, w - 2, TILE, 6);
      ctx.stroke();
      ctx.drawImage(s.crosser[0], x + TILE / 2, y, TILE, TILE);
    } else {
      // Open: warm inviting glow.
      const g = ctx.createRadialGradient(x + w / 2, y + TILE * 0.7, 4, x + w / 2, y + TILE * 0.7, w * 0.7);
      g.addColorStop(0, "rgba(255,210,127,0.55)");
      g.addColorStop(1, "transparent");
      ctx.fillStyle = g;
      ctx.fillRect(x - 6, y - 8, w + 12, TILE + 8);
      ctx.strokeStyle = COLOR.bay;
      ctx.lineWidth = 2;
      roundedTop(ctx, x + 1, y + 1, w - 2, TILE, 6);
      ctx.stroke();
    }
  }
}

function roundedTop(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h);
}

function inView(x: number, w: number): boolean {
  return x < STRAIT_W && x + w > 0;
}

function drawFloes(ctx: CanvasRenderingContext2D, lanes: Lane<Floe>[], s: Sprites): void {
  for (const lane of lanes) {
    const y = lane.row * TILE;
    for (const f of lane.items) {
      const w = f.len * TILE;
      if (!inView(f.x, w)) continue;
      if (f.kind === "pan") {
        ctx.drawImage(s.pan, f.x, y, TILE, TILE);
      } else if (f.kind === "raft3") {
        ctx.drawImage(s.raft[0], 0, 0, 96, 32, f.x, y, 96, TILE);
      } else {
        ctx.drawImage(s.raft[1], f.x, y, 128, TILE);
      }
    }
  }
}

function drawVehicles(ctx: CanvasRenderingContext2D, lanes: Lane<Vehicle>[], s: Sprites): void {
  for (const lane of lanes) {
    const y = lane.row * TILE;
    const mirror = lane.dir === -1; // sprites face right; mirror a left-moving lane
    for (const v of lane.items) {
      const w = v.len * TILE;
      if (!inView(v.x, w)) continue;
      const img = v.kind === "plow" ? s.plow : v.kind === "dogsled" ? s.dogsled : s.car;
      if (mirror) {
        ctx.save();
        ctx.translate(v.x + w, y);
        ctx.scale(-1, 1);
        ctx.drawImage(img, 0, 0, w, TILE);
        ctx.restore();
      } else {
        ctx.drawImage(img, v.x, y, w, TILE);
      }
    }
  }
}

function drawCritter(ctx: CanvasRenderingContext2D, c: Critter, s: Sprites, game: Game): void {
  if (game.state === "playing" && game.phase === "dying") return; // gone; splash shows
  const base = CROSSER_BASE[c.facing];
  const leap = c.hopT > 0 ? 1 : 0;
  const img = s.crosser[base + leap];
  ctx.drawImage(img, Math.round(c.rx), Math.round(c.ry + c.hopArc()), TILE, TILE);
}

function drawBear(ctx: CanvasRenderingContext2D, b: Bear, s: Sprites, game: Game): void {
  const x = Math.round(b.rx);
  const y = Math.round(b.ry);
  const cycle = Math.floor(game.simTime * 6) % 2;

  if (b.swimming) {
    // Wake / ripple so the submerged bear stays trackable over open water.
    ctx.save();
    ctx.strokeStyle = COLOR.bearWake;
    ctx.globalAlpha *= 0.7;
    ctx.lineWidth = 1.5;
    const cx = x + TILE / 2;
    const cy = y + TILE * 0.72 + Math.sin(game.simTime * 6) * 1.5;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 18, 7, 0, 0, Math.PI);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(cx, cy - 3, 11, 4, 0, 0, Math.PI);
    ctx.stroke();
    ctx.restore();
    ctx.drawImage(s.bear[SWIM_BASE[b.facing] + cycle], x, y, TILE, TILE);
    return;
  }

  if (b.lunge > 0) {
    ctx.drawImage(s.bear[16 + cycle], x, y, TILE, TILE);
    return;
  }
  ctx.drawImage(s.bear[RUN_BASE[b.facing] + cycle], x, y, TILE, TILE);
}

function drawSplashes(ctx: CanvasRenderingContext2D, game: Game): void {
  for (const sp of game.splashes) {
    const t = sp.age / 0.7;
    const r = 6 + t * 22;
    ctx.save();
    ctx.globalAlpha *= Math.max(0, 1 - t);
    ctx.strokeStyle = sp.color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = sp.color;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + t;
      const rr = r * 0.9;
      ctx.globalAlpha *= 0.9;
      ctx.beginPath();
      ctx.arc(sp.x + Math.cos(a) * rr, sp.y + Math.sin(a) * rr, 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha /= 0.9;
    }
    ctx.restore();
  }
}

// ---- HUD ----------------------------------------------------------------

function drawHud(ctx: CanvasRenderingContext2D, game: Game, s: Sprites): void {
  ctx.fillStyle = COLOR.hudBg;
  ctx.fillRect(0, 0, STAGE_W, HUD_H);
  ctx.fillStyle = COLOR.hudBorder;
  ctx.fillRect(0, HUD_H - 2, STAGE_W, 2);

  label(ctx, "SCORE", 28, 26);
  ctx.font = `700 30px ${MONO}`;
  ctx.fillStyle = COLOR.score;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(formatScore(game.score), 28, 58);

  // Lives — small critter icons.
  label(ctx, "LIVES", 300, 26);
  for (let i = 0; i < game.lives; i++) {
    ctx.drawImage(s.crosser[0], 300 + i * 26, 34, 22, 22);
  }

  // Bay markers.
  label(ctx, "BAYS", 470, 26);
  for (let i = 0; i < game.bays.length; i++) {
    const bx = 470 + i * 18;
    if (game.bays[i]) {
      ctx.fillStyle = COLOR.critter;
      ctx.fillRect(bx, 38, 12, 12);
    } else {
      ctx.strokeStyle = COLOR.bay;
      ctx.lineWidth = 1;
      ctx.strokeRect(bx + 0.5, 38.5, 11, 11);
    }
  }

  // Timer bar.
  label(ctx, "TIME", 640, 26);
  const bw = 170;
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  roundRect(ctx, 640, 40, bw, 10, 5);
  ctx.fill();
  const frac = game.timerFrac();
  ctx.fillStyle = frac < 0.25 ? COLOR.danger : COLOR.score;
  roundRect(ctx, 640, 40, Math.max(2, bw * frac), 10, 5);
  ctx.fill();

  // Level, right-aligned.
  ctx.textAlign = "right";
  label(ctx, "LEVEL", STAGE_W - 28, 26, "right");
  ctx.font = `700 26px ${MONO}`;
  ctx.fillStyle = COLOR.text;
  ctx.fillText(`${game.level} / 8`, STAGE_W - 28, 58);
  ctx.textAlign = "left";
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, align: CanvasTextAlign = "left"): void {
  ctx.font = `11px ${MONO}`;
  ctx.fillStyle = COLOR.textFaint;
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(spaced(text, 3), x, y);
  ctx.textAlign = "left";
}

// ---- Menus & overlays ---------------------------------------------------

function drawTitle(ctx: CanvasRenderingContext2D, game: Game): void {
  const cx = STAGE_W / 2;
  gradientText(ctx, "FLOE", cx, 250, 118, [COLOR.critter, COLOR.ice, COLOR.score], 18);
  ctx.fillStyle = COLOR.textDim;
  ctx.font = `20px ${MONO}`;
  ctx.textAlign = "center";
  ctx.fillText(spaced("DON'T LOOK BACK", 6), cx, 300);

  drawMenu(ctx, TITLE_ITEMS, game.menuIndex, 400, 54);

  ctx.fillStyle = COLOR.textFaint;
  ctx.font = `15px ${MONO}`;
  ctx.fillText(spaced("▲ ▼ SELECT    ENTER START    M MUTE", 3), cx, STAGE_H - 40);
  ctx.textAlign = "left";
}

function drawHowTo(ctx: CanvasRenderingContext2D): void {
  panel(ctx, 760, 520);
  const cx = STAGE_W / 2;
  ctx.textAlign = "center";
  gradientText(ctx, "HOW TO PLAY", cx, 170, 40, [COLOR.score, COLOR.ice, COLOR.critter], 6);

  const lines: Array<[string, string]> = [
    ["GOAL", "Cross the strait and fill all 5 far-shore bays."],
    ["MOVE", "Arrow keys / WASD hop one tile. No diagonals."],
    ["THE BEAR", "A polar bear hunts you across the WHOLE strait."],
    ["", "Only your speed keeps you ahead — never stop."],
    ["ICE", "Dodge the sliding plows, dogsleds, and cars."],
    ["WATER", "Ride drifting floes; open water and the edge kill."],
    ["TIMER", "Reach a bay before it drains. 3 lives, 8 levels."],
    ["PAUSE", "P or Esc. Mute with M."],
  ];
  ctx.textAlign = "left";
  let y = 226;
  for (const [k, v] of lines) {
    ctx.font = `700 15px ${MONO}`;
    ctx.fillStyle = COLOR.score;
    ctx.fillText(k, cx - 330, y);
    ctx.font = `15px ${MONO}`;
    ctx.fillStyle = k ? COLOR.text : COLOR.textDim;
    ctx.fillText(v, cx - 190, y);
    y += 34;
  }
  ctx.textAlign = "center";
  ctx.fillStyle = COLOR.textFaint;
  ctx.font = `15px ${MONO}`;
  ctx.fillText(spaced("ENTER / ESC  —  BACK", 4), cx, y + 24);
  ctx.textAlign = "left";
}

function drawLevelClear(ctx: CanvasRenderingContext2D, game: Game): void {
  const cx = STAGE_W / 2;
  ctx.textAlign = "center";
  gradientText(
    ctx,
    "LEVEL CLEAR",
    cx,
    STAGE_H / 2,
    58,
    [COLOR.score, COLOR.ice, COLOR.critter],
    8,
  );
  ctx.font = `18px ${MONO}`;
  ctx.fillStyle = COLOR.textDim;
  ctx.fillText(spaced(`ON TO LEVEL ${game.level + 1} / 8`, 6), cx, STAGE_H / 2 + 44);
  ctx.textAlign = "left";
}

function drawPaused(ctx: CanvasRenderingContext2D, game: Game): void {
  ctx.fillStyle = "rgba(4,14,20,0.72)";
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
  const cx = STAGE_W / 2;
  ctx.textAlign = "center";
  gradientText(ctx, "PAUSED", cx, 250, 56, [COLOR.score, COLOR.ice, COLOR.critter], 8);
  drawMenu(ctx, PAUSE_ITEMS, game.menuIndex, 360, 40);
  ctx.textAlign = "left";
}

function drawEndCard(ctx: CanvasRenderingContext2D, game: Game, victory: boolean): void {
  ctx.fillStyle = "rgba(4,14,20,0.82)";
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
  panel(ctx, 600, 400);
  const cx = STAGE_W / 2;
  ctx.textAlign = "center";

  ctx.font = `18px ${MONO}`;
  ctx.fillStyle = victory ? COLOR.score : COLOR.danger;
  ctx.fillText(spaced(victory ? "STRAIT CROSSED" : "CAUGHT ON THE ICE", 8), cx, 210);

  gradientText(
    ctx,
    victory ? "VICTORY" : "GAME OVER",
    cx,
    276,
    52,
    [COLOR.score, COLOR.ice, COLOR.critter],
    8,
  );

  ctx.font = `700 34px ${MONO}`;
  ctx.fillStyle = COLOR.text;
  ctx.fillText(spaced(`SCORE ${formatScore(game.score)}`, 2), cx, 330);

  ctx.font = `17px ${MONO}`;
  ctx.fillStyle = COLOR.textDim;
  if (victory) {
    ctx.fillText(spaced("LEVELS CLEARED 8 / 8", 4), cx, 364);
    ctx.fillText(spaced(`LIVES REMAINING ${game.lives}`, 4), cx, 390);
  } else {
    ctx.fillText(spaced(`REACHED LEVEL ${game.levelReached} / 8`, 4), cx, 372);
  }

  drawMenuRow(ctx, OVER_ITEMS, game.menuIndex, 440);
  ctx.textAlign = "left";
}

function drawMenu(ctx: CanvasRenderingContext2D, items: string[], selected: number, top: number, gap: number): void {
  const cx = STAGE_W / 2;
  ctx.textAlign = "center";
  for (let i = 0; i < items.length; i++) {
    const y = top + i * gap;
    const sel = i === selected;
    ctx.font = `${sel ? 700 : 400} 28px ${MONO}`;
    ctx.fillStyle = sel ? COLOR.text : COLOR.textDim;
    const t = sel ? `▸  ${items[i]}  ◂` : items[i];
    ctx.fillText(spaced(t, 6), cx, y);
  }
  ctx.textAlign = "left";
}

function drawMenuRow(ctx: CanvasRenderingContext2D, items: string[], selected: number, y: number): void {
  const cx = STAGE_W / 2;
  ctx.textAlign = "center";
  ctx.font = `700 22px ${MONO}`;
  const widths = items.map((it) => ctx.measureText(spaced(it, 4)).width + 60);
  const total = widths.reduce((a, b) => a + b, 0);
  let x = cx - total / 2;
  for (let i = 0; i < items.length; i++) {
    const w = widths[i];
    const sel = i === selected;
    ctx.fillStyle = sel ? COLOR.text : COLOR.textDim;
    const t = sel ? `▸ ${items[i]} ◂` : items[i];
    ctx.fillText(spaced(t, 4), x + w / 2, y);
    x += w;
  }
  ctx.textAlign = "left";
}

function drawMuteFlash(ctx: CanvasRenderingContext2D, game: Game): void {
  ctx.save();
  ctx.globalAlpha = Math.min(1, game.muteFlash);
  ctx.fillStyle = COLOR.text;
  ctx.font = `16px ${MONO}`;
  ctx.textAlign = "center";
  ctx.fillText(game.audio.isMuted() ? "MUTED" : "SOUND ON", STAGE_W / 2, STAGE_H - 16);
  ctx.restore();
  ctx.textAlign = "left";
}

// ---- Drawing primitives -------------------------------------------------

function panel(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const x = (STAGE_W - w) / 2;
  const y = (STAGE_H - h) / 2;
  ctx.fillStyle = COLOR.cardBg;
  roundRect(ctx, x, y, w, h, 18);
  ctx.fill();
  ctx.strokeStyle = COLOR.cardBorder;
  ctx.lineWidth = 1.5;
  roundRect(ctx, x, y, w, h, 18);
  ctx.stroke();
}

function gradientText(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  y: number,
  size: number,
  stops: string[],
  tracking: number,
): void {
  ctx.font = `700 ${size}px ${MONO}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  const spacedText = spaced(text, tracking);
  const w = ctx.measureText(spacedText).width;
  const grad = ctx.createLinearGradient(cx - w / 2, 0, cx + w / 2, 0);
  stops.forEach((c, i) => grad.addColorStop(i / (stops.length - 1), c));
  ctx.fillStyle = grad;
  ctx.fillText(spacedText, cx, y);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// Insert thin/hair spaces between characters to fake the tracked, uppercase look
// of the reference mockups without relying on the non-standard canvas
// letterSpacing property. Wider `px` uses a wider Unicode space.
function spaced(text: string, px: number): string {
  if (px <= 0) return text;
  const sep = px >= 6 ? "\u2005" : "\u200a"; // four-per-em vs hair space
  return text.split("").join(sep);
}

function formatScore(n: number): string {
  return n.toLocaleString("en-US");
}
