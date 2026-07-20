// Rendering (specs/overview.md, specs/assets.md). Everything is drawn in logical
// 1280x720 space; main.ts sets the canvas transform that scales this to the
// window. Sprites (nodes, worm, cursor, foes) come from the provided art with
// nearest-neighbor sampling; the board, bolts, discharge arcs, HUD, and all
// menus/overlays are drawn in code in the canonical palette.

import type { Game } from "./game";
import type { Worm } from "./types";
import { assetsReady, frame } from "./assets";
import {
  BAND_TOP_Y,
  BOARD_H,
  BOARD_W,
  BOARD_Y,
  COLORS,
  COLS,
  HUD_H,
  MONO,
  ROWS,
  STAGE_H,
  STAGE_W,
  TILE,
  TOTAL_LEVELS,
  tileLeft,
  tileTop,
} from "./constants";
import { idx } from "./field";

type Ctx = CanvasRenderingContext2D;

export function render(ctx: Ctx, g: Game): void {
  ctx.imageSmoothingEnabled = false;
  ctx.textBaseline = "alphabetic";

  // Background.
  ctx.fillStyle = COLORS.board;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);

  if (!assetsReady()) {
    drawCentered(ctx, "LOADING…", 30, COLORS.textDim, STAGE_W / 2, STAGE_H / 2, 6);
    return;
  }

  if (g.state === "title") {
    drawBoardBackdrop(ctx, true);
    drawTitleFurniture(ctx, g);
    drawTitle(ctx, g);
    return;
  }
  if (g.state === "howto") {
    drawBoardBackdrop(ctx, true);
    drawHowTo(ctx);
    return;
  }

  // In game / paused / end: the live board and HUD.
  drawBoardBackdrop(ctx, false);
  drawField(ctx, g);
  drawWorms(ctx, g);
  drawFoes(ctx, g);
  drawBolts(ctx, g);
  drawCursor(ctx, g);
  drawEffects(ctx, g);
  drawHud(ctx, g);

  if (g.state === "playing" && g.phase === "banner") drawBanner(ctx, g.bannerText);
  if (g.state === "playing" && g.phase === "respawn") drawBanner(ctx, "READY");
  if (g.state === "paused") drawPause(ctx, g);
  if (g.state === "victory") drawEndCard(ctx, g, true);
  if (g.state === "gameover") drawEndCard(ctx, g, false);

  if (g.debugOverlay) drawDebugOverlay(ctx, g);
}

// ---- Debug overlay (specs/instrumentation.md) ------------------------------
// A read-only diagnostic layer over the running game, toggled with the backtick
// key. It only draws the same facts snapshot() reports and never affects gameplay.
function drawDebugOverlay(ctx: Ctx, g: Game): void {
  const s = g.debugSnapshot();
  const lines: string[] = [];
  lines.push(`screen ${s.screen}/${s.phase}   sim ${s.simTime.toFixed(2)}s`);
  lines.push(
    `score ${s.score}  lives ${s.lives}  level ${s.level}/${TOTAL_LEVELS}${s.muted ? "  [muted]" : ""}`,
  );
  lines.push(
    `cursor ${s.cursor.x.toFixed(0)},${s.cursor.y.toFixed(0)}${s.cursor.invulnerable ? "  invuln" : ""}   nodes ${s.nodes.length}`,
  );
  if (s.worms.length === 0) lines.push("worms none");
  s.worms.forEach((w, i) => {
    const h = w.segments[0];
    lines.push(
      `worm${i} len ${w.segments.length} head ${h ? `${h.c},${h.r}` : "-"} dh ${w.dh} dv ${w.dv}${w.diving ? " dive" : ""}`,
    );
  });
  s.foes.forEach((f, i) => {
    lines.push(
      `foe${i} ${f.kind} ${f.x.toFixed(0)},${f.y.toFixed(0)}${f.firstHit ? " hit1" : ""}`,
    );
  });

  const pad = 12;
  const lineH = 18;
  const w = 380;
  const x = 16;
  const y = HUD_H + 12;
  const h = pad * 2 + 20 + lines.length * lineH;

  ctx.save();
  ctx.fillStyle = "rgba(6, 12, 14, 0.82)";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = COLORS.edge;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w, h);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.font = `700 12px ${MONO}`;
  ctx.fillStyle = COLORS.spark;
  ctx.fillText("DEBUG", x + pad, y + pad);
  ctx.font = `13px ${MONO}`;
  ctx.fillStyle = COLORS.textDim;
  let ly = y + pad + 20;
  for (const line of lines) {
    ctx.fillText(line, x + pad, ly);
    ly += lineH;
  }
  ctx.restore();
}

// ---- Board -----------------------------------------------------------------
function drawBoardBackdrop(ctx: Ctx, dim: boolean): void {
  ctx.save();
  if (dim) ctx.globalAlpha = 0.5;
  // Board panel.
  ctx.fillStyle = COLORS.board;
  ctx.fillRect(0, BOARD_Y, BOARD_W, BOARD_H);
  // Player-band tint (bottom 2 rows).
  ctx.fillStyle = COLORS.band;
  ctx.fillRect(0, BAND_TOP_Y, BOARD_W, STAGE_H - BAND_TOP_Y);
  // Faint trace grid.
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let c = 0; c <= COLS; c++) {
    const x = tileLeft(c) + 0.5;
    ctx.moveTo(x, BOARD_Y);
    ctx.lineTo(x, BOARD_Y + BOARD_H);
  }
  for (let r = 0; r <= ROWS; r++) {
    const y = tileTop(r) + 0.5;
    ctx.moveTo(0, y);
    ctx.lineTo(BOARD_W, y);
  }
  ctx.stroke();
  // Band top edge, subtly marked.
  ctx.strokeStyle = "rgba(84, 230, 189, 0.18)";
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.moveTo(0, BAND_TOP_Y + 0.5);
  ctx.lineTo(BOARD_W, BAND_TOP_Y + 0.5);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

function drawField(ctx: Ctx, g: Game): void {
  // Critical nodes pulse by alternating sprite frames 3/4 at ~6 fps.
  const critFrame = Math.floor(g.time * 6) % 2 === 0 ? 3 : 4;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const ch = g.field[idx(c, r)];
      if (ch < 0) continue;
      const f = ch >= 3 ? critFrame : ch;
      ctx.drawImage(frame("node", f), tileLeft(c), tileTop(r), TILE, TILE);
    }
  }
}

// ---- Worms -----------------------------------------------------------------
function drawWorms(ctx: Ctx, g: Game): void {
  const headFrame = Math.floor(g.time * 5) % 2; // 0/1
  const bodyFrame = 2 + (Math.floor(g.time * 6) % 2); // 2/3
  const tailFrame = 4 + (Math.floor(g.time * 6) % 2); // 4/5
  for (const w of g.worms) drawWorm(ctx, w, headFrame, bodyFrame, tailFrame);
}

function drawWorm(
  ctx: Ctx,
  w: Worm,
  headFrame: number,
  bodyFrame: number,
  tailFrame: number,
): void {
  const last = w.segs.length - 1;
  const mirror = w.facing < 0;
  for (let i = 0; i < w.segs.length; i++) {
    const s = w.segs[i];
    if (s.c < 0 || s.c >= COLS || s.r < 0 || s.r >= ROWS) continue; // off-board
    let f: number;
    if (i === 0) f = headFrame;
    else if (i === last) f = tailFrame;
    else f = bodyFrame;
    drawSprite(ctx, frame("worm", f), tileLeft(s.c), tileTop(s.r), mirror);
  }
}

// ---- Foes ------------------------------------------------------------------
function drawFoes(ctx: Ctx, g: Game): void {
  for (const foe of g.foes) {
    const x = foe.x - TILE / 2;
    const y = foe.y - TILE / 2;
    if (foe.kind === "glitch") {
      const f = Math.floor(g.time * 10) % 4;
      ctx.drawImage(frame("glitch", f), x, y, TILE, TILE);
    } else if (foe.kind === "dropper") {
      ctx.drawImage(frame("dropper", 0), x, y, TILE, TILE);
    } else {
      const f = Math.floor(g.time * 8) % 4;
      drawSprite(ctx, frame("corruptor", f), x, y, foe.vx < 0);
    }
  }
}

// ---- Cursor & bolts --------------------------------------------------------
function drawCursor(ctx: Ctx, g: Game): void {
  if (g.state === "playing" && g.invulnFlicker) return; // blink while invulnerable
  ctx.drawImage(
    frame("cursor", 0),
    g.cursor.x - TILE / 2,
    g.cursor.y - TILE / 2,
    TILE,
    TILE,
  );
}

function drawBolts(ctx: Ctx, g: Game): void {
  ctx.save();
  ctx.fillStyle = COLORS.cursorCore;
  ctx.shadowColor = COLORS.cursorCore;
  ctx.shadowBlur = 8;
  for (const b of g.bolts) {
    roundRect(ctx, b.x - 1.5, b.y - 7, 3, 14, 1.5);
    ctx.fill();
  }
  ctx.restore();
}

// ---- Discharge effects -----------------------------------------------------
function drawEffects(ctx: Ctx, g: Game): void {
  ctx.save();
  ctx.lineCap = "round";
  ctx.strokeStyle = COLORS.arc;
  ctx.shadowColor = COLORS.arc;
  ctx.shadowBlur = 10;
  for (const a of g.arcs) {
    const t = a.life / a.max;
    ctx.globalAlpha = Math.min(1, t * 1.4);
    ctx.lineWidth = 2;
    // A jagged lightning bolt between the two node centers.
    ctx.beginPath();
    const segs = 4;
    for (let i = 0; i <= segs; i++) {
      const u = i / segs;
      const jitter = i === 0 || i === segs ? 0 : (Math.random() - 0.5) * 10;
      const nx = -(a.y2 - a.y1);
      const ny = a.x2 - a.x1;
      const len = Math.hypot(nx, ny) || 1;
      const px = a.x1 + (a.x2 - a.x1) * u + (nx / len) * jitter;
      const py = a.y1 + (a.y2 - a.y1) * u + (ny / len) * jitter;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  for (const f of g.flashes) {
    const t = f.life / f.max;
    const rad = 8 + (1 - t) * 20;
    const grad = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, rad);
    grad.addColorStop(0, `rgba(230, 255, 247, ${0.85 * t})`);
    grad.addColorStop(0.6, `rgba(184, 255, 230, ${0.4 * t})`);
    grad.addColorStop(1, "rgba(184, 255, 230, 0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(f.x, f.y, rad, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ---- HUD -------------------------------------------------------------------
function drawHud(ctx: Ctx, g: Game): void {
  ctx.save();
  ctx.fillStyle = COLORS.hud;
  ctx.fillRect(0, 0, STAGE_W, HUD_H);
  ctx.fillStyle = COLORS.edge;
  ctx.fillRect(0, HUD_H - 2, STAGE_W, 2);

  ctx.textBaseline = "alphabetic";
  // SCORE (left).
  label(ctx, "SCORE", 28, 30);
  ctx.font = `700 30px ${MONO}`;
  ctx.fillStyle = COLORS.score;
  ctx.textAlign = "left";
  ctx.fillText(formatScore(g.score), 28, 58);

  // LIVES (cursor pips).
  label(ctx, "LIVES", 300, 30);
  for (let i = 0; i < g.lives; i++) drawPip(ctx, 302 + i * 26, 42);

  // Hazard indicator (center).
  let hazard = "";
  if (g.hasFoe("corruptor")) hazard = "⚠ CORRUPTOR CROSSING";
  else if (g.hasFoe("dropper")) hazard = "⚠ PACKET DROPPER";
  else if (g.hasFoe("glitch")) hazard = "⚠ GLITCH LOOSE";
  if (hazard) {
    ctx.font = `12px ${MONO}`;
    ctx.fillStyle = COLORS.spark;
    ctx.textAlign = "center";
    ctx.fillText(hazard, STAGE_W / 2, 46);
  }

  // LEVEL (right).
  ctx.textAlign = "right";
  label(ctx, "LEVEL", STAGE_W - 28, 30, "right");
  ctx.font = `700 26px ${MONO}`;
  ctx.fillStyle = COLORS.text;
  ctx.fillText(`${g.level} / ${TOTAL_LEVELS}`, STAGE_W - 28, 58);
  ctx.restore();
}

function drawPip(ctx: Ctx, x: number, y: number): void {
  ctx.save();
  ctx.fillStyle = "#3f8ba3";
  ctx.beginPath();
  ctx.moveTo(x + 9, y);
  ctx.lineTo(x + 18, y + 18);
  ctx.lineTo(x + 9, y + 14);
  ctx.lineTo(x, y + 18);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// ---- Title -----------------------------------------------------------------
function drawTitleFurniture(ctx: Ctx, g: Game): void {
  ctx.save();
  ctx.globalAlpha = 0.32;
  const critFrame = Math.floor(g.time * 6) % 2 === 0 ? 3 : 4;
  const deco: [number, number, number][] = [
    [5, 1, 1],
    [10, 3, 2],
    [29, 2, 0],
    [33, 5, critFrame],
    [7, 8, 1],
  ];
  for (const [c, r, f] of deco) {
    ctx.drawImage(frame("node", f), tileLeft(c), tileTop(r), TILE, TILE);
  }
  // A short worm winding along the upper right.
  const bodyFrame = 2 + (Math.floor(g.time * 6) % 2);
  ctx.drawImage(frame("worm", 4), tileLeft(31), tileTop(1), TILE, TILE);
  ctx.drawImage(frame("worm", bodyFrame), tileLeft(32), tileTop(1), TILE, TILE);
  ctx.drawImage(frame("worm", Math.floor(g.time * 5) % 2), tileLeft(33), tileTop(1), TILE, TILE);
  ctx.restore();
}

function drawTitle(ctx: Ctx, g: Game): void {
  const cx = STAGE_W / 2;
  // Title with a charge-ramp gradient.
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.font = `700 108px ${MONO}`;
  const grad = ctx.createLinearGradient(cx - 360, 0, cx + 360, 0);
  grad.addColorStop(0, COLORS.c1);
  grad.addColorStop(0.4, COLORS.c2);
  grad.addColorStop(0.75, COLORS.c3);
  grad.addColorStop(1, COLORS.wormEdge);
  ctx.save();
  ctx.shadowColor = "rgba(84, 230, 189, 0.35)";
  ctx.shadowBlur = 26;
  ctx.fillStyle = grad;
  ctx.fillText("W I R E W O R M", cx, 214);
  ctx.restore();

  ctx.font = `22px ${MONO}`;
  ctx.fillStyle = COLORS.textDim;
  ctx.fillText("C U T   T H E   C U R R E N T", cx, 262);

  const items = ["DESCEND", "HOW TO PLAY"];
  drawMenu(ctx, items, g.sel, cx, 386, 58, 30);

  ctx.font = `16px ${MONO}`;
  ctx.fillStyle = COLORS.textFaint;
  ctx.fillText("▲ ▼ SELECT      ENTER START", cx, STAGE_H - 40);
}

function drawMenu(
  ctx: Ctx,
  items: string[],
  sel: number,
  cx: number,
  y0: number,
  gap: number,
  size: number,
): void {
  ctx.textAlign = "center";
  for (let i = 0; i < items.length; i++) {
    const y = y0 + i * gap;
    const selected = i === sel;
    ctx.font = `${selected ? 700 : 400} ${size}px ${MONO}`;
    ctx.fillStyle = selected ? COLORS.text : COLORS.textDim;
    const label = spaced(items[i]);
    ctx.fillText(label, cx, y);
    if (selected) {
      const w = ctx.measureText(label).width;
      ctx.fillStyle = COLORS.c2;
      ctx.fillText("▸", cx - w / 2 - size * 0.7, y);
      ctx.fillStyle = COLORS.wormEdge;
      ctx.fillText("◂", cx + w / 2 + size * 0.7, y);
    }
  }
}

// ---- How to play -----------------------------------------------------------
function drawHowTo(ctx: Ctx): void {
  const cx = STAGE_W / 2;
  ctx.textAlign = "center";
  ctx.font = `700 46px ${MONO}`;
  ctx.fillStyle = COLORS.c2;
  ctx.fillText("HOW TO PLAY", cx, 118);

  const lines: [string, string][] = [
    ["GOAL", "Cut the data-worm apart before it reaches your band."],
    ["MOVE", "Arrows / WASD glide the cursor in the bottom band."],
    ["FIRE", "Space (hold to auto-fire) shoots straight up."],
    ["CHARGE", "The worm charges every node it bumps: teal → cyan → white-hot critical."],
    ["SHOOT NODES", "Inert clears; charged de-energizes a level; CRITICAL detonates."],
    ["DISCHARGE", "A critical node chain-arcs through the charged cluster, frying the worm clean."],
    ["DIVE", "A critical node makes the worm plunge straight down at you."],
    ["FIELD", "Every worm segment you shoot leaves a node — the field thickens as you fight."],
    ["SPLIT", "Hit a middle segment to split the worm in two; an end shot shortens it."],
    ["FOES", "Glitch eats nodes · Dropper reseeds (2 hits) · Corruptor slams a critical line."],
  ];
  ctx.textAlign = "left";
  let y = 176;
  const lx = 220;
  for (const [k, v] of lines) {
    ctx.font = `700 15px ${MONO}`;
    ctx.fillStyle = COLORS.score;
    ctx.fillText(k, lx, y);
    ctx.font = `15px ${MONO}`;
    ctx.fillStyle = COLORS.text;
    ctx.fillText(v, lx + 130, y);
    y += 42;
  }
  ctx.textAlign = "center";
  ctx.font = `16px ${MONO}`;
  ctx.fillStyle = COLORS.textFaint;
  ctx.fillText("ENTER / ESC  —  BACK", cx, STAGE_H - 40);
}

// ---- Banner / pause / end --------------------------------------------------
function drawBanner(ctx: Ctx, text: string): void {
  ctx.save();
  ctx.textAlign = "center";
  ctx.font = `700 64px ${MONO}`;
  ctx.shadowColor = "rgba(84, 230, 189, 0.5)";
  ctx.shadowBlur = 24;
  ctx.fillStyle = COLORS.c2;
  ctx.fillText(spaced(text), STAGE_W / 2, STAGE_H / 2);
  ctx.restore();
}

function drawPause(ctx: Ctx, g: Game): void {
  overlay(ctx);
  const cx = STAGE_W / 2;
  ctx.textAlign = "center";
  ctx.font = `700 52px ${MONO}`;
  ctx.fillStyle = COLORS.text;
  ctx.fillText("PAUSED", cx, 250);
  drawMenu(ctx, ["RESUME", "RESTART", "QUIT TO MENU"], g.sel, cx, 344, 56, 26);
  ctx.font = `15px ${MONO}`;
  ctx.fillStyle = COLORS.textFaint;
  ctx.fillText("P / ESC  RESUME       M  MUTE", cx, STAGE_H - 60);
}

function drawEndCard(ctx: Ctx, g: Game, victory: boolean): void {
  overlay(ctx);
  const cx = STAGE_W / 2;
  const cy = STAGE_H / 2;
  // Card panel.
  const cardW = 600;
  const cardH = 360;
  ctx.save();
  ctx.fillStyle = COLORS.hud;
  ctx.strokeStyle = COLORS.edge;
  ctx.lineWidth = 1;
  roundRect(ctx, cx - cardW / 2, cy - cardH / 2, cardW, cardH, 18);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  ctx.textAlign = "center";
  ctx.font = `18px ${MONO}`;
  ctx.fillStyle = victory ? COLORS.score : COLORS.eye;
  ctx.fillText(victory ? "SYSTEM SECURED" : "CONNECTION LOST", cx, cy - 118);

  ctx.font = `700 52px ${MONO}`;
  const grad = ctx.createLinearGradient(cx - 200, 0, cx + 200, 0);
  grad.addColorStop(0, COLORS.c2);
  grad.addColorStop(0.5, COLORS.c3);
  grad.addColorStop(1, COLORS.wormEdge);
  ctx.fillStyle = grad;
  ctx.fillText(victory ? "VICTORY" : "GAME OVER", cx, cy - 58);

  ctx.font = `34px ${MONO}`;
  ctx.fillStyle = COLORS.text;
  ctx.fillText(`SCORE ${formatScore(g.score)}`, cx, cy - 8);

  ctx.font = `17px ${MONO}`;
  ctx.fillStyle = COLORS.textDim;
  if (victory) {
    ctx.fillText(`LEVELS CLEARED ${TOTAL_LEVELS} / ${TOTAL_LEVELS}`, cx, cy + 26);
    ctx.fillText(`LIVES REMAINING ${g.lives}`, cx, cy + 52);
  } else {
    ctx.fillText(`REACHED LEVEL ${g.reachedLevel} / ${TOTAL_LEVELS}`, cx, cy + 30);
  }

  drawMenuRow(ctx, ["PLAY AGAIN", "MENU"], g.sel, cx, cy + 118);
}

function drawMenuRow(
  ctx: Ctx,
  items: string[],
  sel: number,
  cx: number,
  y: number,
): void {
  ctx.font = `22px ${MONO}`;
  const gap = 60;
  const widths = items.map((it) => ctx.measureText(spaced(it)).width);
  const total = widths.reduce((a, b) => a + b, 0) + gap * (items.length - 1);
  let x = cx - total / 2;
  ctx.textAlign = "left";
  for (let i = 0; i < items.length; i++) {
    const selected = i === sel;
    ctx.font = `${selected ? 700 : 400} 22px ${MONO}`;
    ctx.fillStyle = selected ? COLORS.text : COLORS.textDim;
    const label = spaced(items[i]);
    if (selected) {
      ctx.fillStyle = COLORS.c2;
      ctx.fillText("▸ ", x - 22, y);
      ctx.fillStyle = COLORS.text;
    }
    ctx.fillText(label, x, y);
    x += widths[i] + gap;
  }
  ctx.textAlign = "center";
}

// ---- Small drawing helpers -------------------------------------------------
function overlay(ctx: Ctx): void {
  ctx.fillStyle = "rgba(6, 12, 14, 0.82)";
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
}

function label(
  ctx: Ctx,
  text: string,
  x: number,
  y: number,
  align: CanvasTextAlign = "left",
): void {
  ctx.font = `11px ${MONO}`;
  ctx.fillStyle = COLORS.textFaint;
  ctx.textAlign = align;
  ctx.save();
  // Emulate the mockup's wide letter-spacing by drawing each char.
  const ls = 3;
  if (align === "left") {
    let cx = x;
    for (const ch of text) {
      ctx.fillText(ch, cx, y);
      cx += ctx.measureText(ch).width + ls;
    }
  } else {
    let cx = x;
    for (let i = text.length - 1; i >= 0; i--) {
      const ch = text[i];
      cx -= ctx.measureText(ch).width + ls;
    }
    let dx = cx + ls;
    ctx.textAlign = "left";
    for (const ch of text) {
      ctx.fillText(ch, dx, y);
      dx += ctx.measureText(ch).width + ls;
    }
  }
  ctx.restore();
}

function drawSprite(
  ctx: Ctx,
  img: HTMLImageElement,
  x: number,
  y: number,
  mirror: boolean,
): void {
  if (!mirror) {
    ctx.drawImage(img, x, y, TILE, TILE);
    return;
  }
  ctx.save();
  ctx.translate(x + TILE, y);
  ctx.scale(-1, 1);
  ctx.drawImage(img, 0, 0, TILE, TILE);
  ctx.restore();
}

function drawCentered(
  ctx: Ctx,
  text: string,
  size: number,
  color: string,
  x: number,
  y: number,
  _ls: number,
): void {
  ctx.font = `${size}px ${MONO}`;
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.fillText(text, x, y);
}

function roundRect(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function spaced(s: string): string {
  return s.split("").join(" ");
}

function formatScore(n: number): string {
  const s = Math.floor(n).toString();
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += " ";
    out += s[i];
  }
  return out;
}
