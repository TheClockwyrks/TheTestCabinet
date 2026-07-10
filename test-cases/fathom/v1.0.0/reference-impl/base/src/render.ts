// Fathom — all canvas drawing (bioluminescence in the abyss). Renders the dark
// trench with its three visibility states, the provided sprite/effect art, the
// forager's lit pocket, plankton, ink, the HUD, and every screen's overlay.

import {
  COLOR,
  COLS,
  FLARE_CHARGE,
  FLARE_BLOOM,
  FLARE_FADE,
  FLARE_RADIUS,
  GRID_X,
  GRID_Y,
  HUD_BOT_Y,
  INK_COOLDOWN,
  INK_RADIUS,
  MONO,
  ROWS,
  SONAR_COOLDOWN,
  STAGE_H,
  STAGE_W,
  TILE,
} from "./constants";
import { Drifter, Predator } from "./entities";
import { Game } from "./game";
import { Maze } from "./maze";
import { tileKey } from "./sensing";
import { Dir, GameState, PredKind, PredState } from "./types";

const MAZE_W = COLS * TILE;
const MAZE_H = ROWS * TILE;

function facingBase(facing: Dir): number {
  switch (facing) {
    case Dir.Up:
      return 2;
    case Dir.Left:
      return 4;
    case Dir.Right:
      return 6;
    default:
      return 0; // down
  }
}

function setSpacing(ctx: CanvasRenderingContext2D, px: number): void {
  (ctx as unknown as { letterSpacing: string }).letterSpacing = `${px}px`;
}

export function render(ctx: CanvasRenderingContext2D, game: Game): void {
  // Stage background (fog / letterbox already handled by the canvas backdrop).
  ctx.fillStyle = COLOR.fog;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);

  const inGame =
    game.state === GameState.Playing ||
    game.state === GameState.Dive ||
    game.state === GameState.Paused ||
    game.state === GameState.Cleared;

  if (inGame) {
    drawTrench(ctx, game);
    drawHud(ctx, game);
  }

  switch (game.state) {
    case GameState.Title:
      drawTitle(ctx, game);
      break;
    case GameState.HowTo:
      drawHowTo(ctx);
      break;
    case GameState.Dive:
      drawDive(ctx, game);
      break;
    case GameState.Paused:
      drawPause(ctx, game);
      break;
    case GameState.Cleared:
      drawCleared(ctx, game);
      break;
    case GameState.GameOver:
      drawGameOver(ctx, game);
      break;
    default:
      break;
  }
}

// ---- the trench --------------------------------------------------------

function drawTrench(ctx: CanvasRenderingContext2D, game: Game): void {
  const { maze, fog, assets } = game;
  ctx.save();
  ctx.beginPath();
  ctx.rect(GRID_X, GRID_Y, MAZE_W, MAZE_H);
  ctx.clip();

  // Fog base.
  ctx.fillStyle = COLOR.fog;
  ctx.fillRect(GRID_X, GRID_Y, MAZE_W, MAZE_H);

  // Tiles (revealed only). Lit = full; remembered = dim.
  ctx.imageSmoothingEnabled = false;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (!fog.isRevealed(c, r)) continue;
      const lit = fog.isLit(c, r);
      ctx.globalAlpha = lit ? 1 : 0.6;
      const dx = GRID_X + c * TILE;
      const dy = GRID_Y + r * TILE;
      if (maze.isWall(c, r)) {
        ctx.drawImage(assets.trench[maze.wallFrame(c, r)], dx, dy, TILE, TILE);
      } else {
        ctx.drawImage(assets.trench[16], dx, dy, TILE, TILE); // floor
        if (maze.isGate(c, r)) ctx.drawImage(assets.trench[18], dx, dy, TILE, TILE);
      }
    }
  }
  ctx.globalAlpha = 1;

  // The forager's lit pocket: a soft cyan glow that brightens the revealed
  // maze around it (specs/sensing.md, reference/gameplay).
  drawLightPocket(ctx, game);

  // Plankton (remembered dim, lit bright).
  ctx.imageSmoothingEnabled = true;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (!game.plankton[tileKey(c, r)] || !fog.isRevealed(c, r)) continue;
      const lit = fog.isLit(c, r);
      const cx = Maze.cx(c);
      const cy = Maze.cy(r);
      if (lit) {
        ctx.fillStyle = COLOR.plankton;
        ctx.shadowColor = "rgba(184,245,200,0.85)";
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(cx, cy, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      } else {
        ctx.globalAlpha = 0.4;
        ctx.fillStyle = COLOR.plankton;
        ctx.beginPath();
        ctx.arc(cx, cy, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  }

  // Ink clouds.
  for (const cl of game.clouds) {
    const a = Math.min(1, cl.life / 1) * 0.9;
    const g = ctx.createRadialGradient(cl.x, cl.y, 0, cl.x, cl.y, INK_RADIUS);
    g.addColorStop(0, `rgba(11,10,31,${a})`);
    g.addColorStop(0.7, `rgba(11,10,31,${a * 0.8})`);
    g.addColorStop(1, "rgba(11,10,31,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cl.x, cl.y, INK_RADIUS, 0, Math.PI * 2);
    ctx.fill();
  }

  // Effects and creatures composite additively where they read as light.
  drawEffectsAndCreatures(ctx, game);

  // Fog-edge vignette: fade the lit pocket back into the dark.
  drawFogEdge(ctx, game);

  ctx.restore();
}

function drawLightPocket(ctx: CanvasRenderingContext2D, game: Game): void {
  const f = game.forager;
  const R = game.visionRadius * 1.35;
  const glow = 0.14 + 0.22 * game.forager.g;
  const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, R);
  g.addColorStop(0, `rgba(70,240,224,${glow})`);
  g.addColorStop(0.5, `rgba(36,80,107,${glow * 0.5})`);
  g.addColorStop(1, "rgba(3,6,12,0)");
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(f.x, f.y, R, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawFogEdge(ctx: CanvasRenderingContext2D, game: Game): void {
  const f = game.forager;
  const R = game.visionRadius * 1.9;
  const g = ctx.createRadialGradient(f.x, f.y, R * 0.5, f.x, f.y, R);
  g.addColorStop(0, "rgba(3,6,12,0)");
  g.addColorStop(0.8, "rgba(3,6,12,0.55)");
  g.addColorStop(1, "rgba(3,6,12,0.9)");
  // Only darken outside the immediate pocket, and never the HUD.
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(f.x, f.y, R, 0, Math.PI * 2);
  ctx.rect(GRID_X + MAZE_W, GRID_Y, -MAZE_W, MAZE_H);
  ctx.fill("evenodd");
}

function spriteFrame(m: { facing: Dir; animT: number; dir: Dir }): number {
  const base = facingBase(m.facing);
  const moving = m.dir !== Dir.None;
  const alt = moving ? Math.floor(m.animT * 8) % 2 : 0;
  return base + alt;
}

function drawEffectsAndCreatures(ctx: CanvasRenderingContext2D, game: Game): void {
  const { assets } = game;

  // Sonar rings (additive, tinted sheets).
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.imageSmoothingEnabled = true;
  for (const ring of game.effects.rings) {
    const p = ring.t / ring.dur;
    const frame = Math.min(7, Math.floor(p * 8));
    const size = 24 + p * ring.range * 2; // ring diameter grows to ~2*range
    const img = ring.violet ? assets.sonarViolet[frame] : assets.sonarCyan[frame];
    ctx.globalAlpha = 0.85 * (1 - p);
    ctx.drawImage(img, ring.x - size / 2, ring.y - size / 2, size, size);
  }
  ctx.globalAlpha = 1;

  // Flare blooms (additive, warm, no tint).
  for (const p of game.predators) {
    if (p.kind !== PredKind.Flarefish || !p.flaring) continue;
    const t = p.flarePhaseT;
    let frame: number;
    let scale: number;
    if (t < FLARE_CHARGE) {
      frame = Math.min(2, Math.floor((t / FLARE_CHARGE) * 3));
      scale = 0.5 + 0.4 * (t / FLARE_CHARGE);
    } else if (t < FLARE_CHARGE + FLARE_BLOOM) {
      frame = 3 + Math.min(2, Math.floor(((t - FLARE_CHARGE) / FLARE_BLOOM) * 3));
      scale = 1;
    } else {
      const ft = (t - FLARE_CHARGE - FLARE_BLOOM) / FLARE_FADE;
      frame = 6 + Math.min(1, Math.floor(ft * 2));
      scale = 1 - 0.3 * ft;
    }
    const size = FLARE_RADIUS * 2 * scale;
    ctx.drawImage(assets.flareBloom[frame], p.x - size / 2, p.y - size / 2, size, size);
  }
  ctx.restore();

  // Creatures (pixel art, nearest-neighbor).
  ctx.save();
  ctx.imageSmoothingEnabled = false;

  // Drifter (drawn in code — a glowing jelly).
  const d = game.drifter;
  if (d && game.entityVisible(d.col, d.row, d.markT)) {
    const lit = game.fog.isLit(d.col, d.row);
    drawDrifter(ctx, d, lit);
  }

  // Predators (only where visible).
  for (const p of game.predators) {
    if (p.state === PredState.Den) continue;
    if (!game.entityVisible(p.col, p.row, p.markT)) continue;
    const lit = game.fog.isLit(p.col, p.row);
    ctx.globalAlpha = lit ? 1 : 0.6;
    drawPredator(ctx, assets, p);
    ctx.globalAlpha = 1;
  }

  // Forager (always drawn).
  const f = game.forager;
  ctx.drawImage(assets.glimmerfin[spriteFrame(f)], f.x - 16, f.y - 16, TILE, TILE);
  ctx.restore();
}

function drawPredator(
  ctx: CanvasRenderingContext2D,
  assets: Game["assets"],
  p: Predator,
): void {
  let frame: number;
  let sheet: HTMLImageElement[];
  if (p.kind === PredKind.Lure) {
    sheet = assets.lanternjaw;
    if (p.state === PredState.Hunt) frame = spriteFrame(p);
    else frame = 8 + (Math.floor(p.animT * 8) % 6); // lure-bob tell
  } else if (p.kind === PredKind.Listener) {
    sheet = assets.gloamfin;
    frame = spriteFrame(p);
  } else {
    sheet = assets.flarefish;
    frame = spriteFrame(p);
  }
  ctx.drawImage(sheet[frame], p.x - 16, p.y - 16, TILE, TILE);

  // The Lure's dangling lure-light: a tiny bright point (runtime glow).
  if (p.kind === PredKind.Lure) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = "#fff0c2";
    ctx.shadowColor = "rgba(255,209,102,0.95)";
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(p.x + 8, p.y + 6, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawDrifter(ctx: CanvasRenderingContext2D, d: Drifter, lit: boolean): void {
  ctx.save();
  ctx.globalAlpha = lit ? 1 : 0.6;
  ctx.globalCompositeOperation = "lighter";
  const g = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, 16);
  g.addColorStop(0, "rgba(150,245,220,0.95)");
  g.addColorStop(0.5, "rgba(94,242,255,0.5)");
  g.addColorStop(1, "rgba(94,242,255,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(d.x, d.y, 16, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#d6fff0";
  ctx.beginPath();
  ctx.arc(d.x, d.y, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ---- HUD ---------------------------------------------------------------

function drawHud(ctx: CanvasRenderingContext2D, game: Game): void {
  // Top strip: score + mode label.
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fillStyle = COLOR.text;
  ctx.font = `700 48px ${MONO}`;
  setSpacing(ctx, 4);
  ctx.fillText(pad(game.score, 5), 40, 60);

  setSpacing(ctx, 6);
  ctx.textAlign = "right";
  ctx.font = `16px ${MONO}`;
  ctx.fillStyle = COLOR.textFaint;
  ctx.fillText("TRENCH", STAGE_W - 40, 44);

  // Bottom strip: lives, gauges, depth.
  ctx.imageSmoothingEnabled = false;
  for (let i = 0; i < game.lives; i++) {
    ctx.drawImage(game.assets.glimmerfin[6], 40 + i * 26, HUD_BOT_Y + 20, 20, 20);
  }
  ctx.imageSmoothingEnabled = true;

  ctx.textAlign = "right";
  ctx.font = `18px ${MONO}`;
  ctx.fillStyle = COLOR.textDim;
  setSpacing(ctx, 6);
  ctx.fillText(`DEPTH ${game.depth}`, STAGE_W - 40, HUD_BOT_Y + 34);
  setSpacing(ctx, 0);

  // Gauges (centered).
  const sonar = 1 - game.sonarCd / SONAR_COOLDOWN;
  const ink = 1 - game.inkCd / INK_COOLDOWN;
  drawGauge(ctx, STAGE_W / 2 - 150, HUD_BOT_Y + 26, "SONAR", sonar, COLOR.sonar, "rgba(94,242,255,0.7)");
  drawGauge(ctx, STAGE_W / 2 + 20, HUD_BOT_Y + 26, "INK", ink, "#9aa6ff", "rgba(154,166,255,0.6)");
}

function drawGauge(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  label: string,
  frac: number,
  color: string,
  glow: string,
): void {
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = `13px ${MONO}`;
  setSpacing(ctx, 4);
  ctx.fillStyle = COLOR.textFaint;
  ctx.fillText(label, x, y);
  setSpacing(ctx, 0);
  const barX = x + ctx.measureText(label).width + 22;
  const w = 88;
  ctx.fillStyle = "rgba(138,148,166,0.16)";
  roundRect(ctx, barX, y - 3, w, 6, 3);
  ctx.fill();
  ctx.save();
  ctx.fillStyle = color;
  ctx.shadowColor = glow;
  ctx.shadowBlur = 8;
  roundRect(ctx, barX, y - 3, Math.max(0, w * frac), 6, 3);
  ctx.fill();
  ctx.restore();
  ctx.textBaseline = "alphabetic";
}

// ---- menus / overlays --------------------------------------------------

function drawTitle(ctx: CanvasRenderingContext2D, game: Game): void {
  drawMazeBackdrop(ctx, game);

  ctx.textAlign = "center";
  ctx.fillStyle = COLOR.forager;
  ctx.font = `700 128px ${MONO}`;
  setSpacing(ctx, 24);
  ctx.save();
  ctx.shadowColor = "rgba(70,240,224,0.5)";
  ctx.shadowBlur = 28;
  ctx.fillText("FATHOM", STAGE_W / 2 + 12, 258);
  ctx.restore();

  ctx.font = `22px ${MONO}`;
  setSpacing(ctx, 14);
  ctx.fillStyle = COLOR.textDim;
  ctx.fillText("HUNT IN THE DARK", STAGE_W / 2 + 7, 306);

  drawMenu(ctx, game.titleItems, game.menu, 420, 60);

  setSpacing(ctx, 8);
  ctx.font = `16px ${MONO}`;
  ctx.fillStyle = COLOR.textFaint;
  ctx.fillText("▲ ▼ MOVE     ENTER SELECT", STAGE_W / 2, STAGE_H - 40);
  setSpacing(ctx, 0);
}

function drawMenu(
  ctx: CanvasRenderingContext2D,
  items: string[],
  sel: number,
  top: number,
  gap: number,
): void {
  ctx.textAlign = "center";
  ctx.font = `30px ${MONO}`;
  setSpacing(ctx, 10);
  items.forEach((it, i) => {
    const y = top + i * gap;
    if (i === sel) {
      ctx.fillStyle = COLOR.text;
      ctx.fillText(`▸  ${it}  ◂`, STAGE_W / 2, y);
    } else {
      ctx.fillStyle = COLOR.textDim;
      ctx.fillText(it, STAGE_W / 2, y);
    }
  });
  setSpacing(ctx, 0);
}

function drawHowTo(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = COLOR.fog;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
  ctx.textAlign = "center";
  ctx.fillStyle = COLOR.forager;
  ctx.font = `700 52px ${MONO}`;
  setSpacing(ctx, 8);
  ctx.fillText("HOW TO PLAY", STAGE_W / 2, 120);
  setSpacing(ctx, 0);

  const lines: [string, string][] = [
    ["MOVE", "Arrow keys or W A S D"],
    ["SONAR", "Space  —  floods corridors, bends round corners, but is HEARD"],
    ["INK", "Shift  —  blinds the sight hunters (not the Listener)"],
    ["PAUSE", "Esc or P"],
    ["", ""],
    ["THE LURE", "hunts your LIGHT — go dim, or ink it"],
    ["THE LISTENER", "hunts your SOUND — juke it through tight turns; ink is useless"],
    ["THE FLAREFISH", "sees only in its FLARE — leave the light, or ink it"],
    ["", ""],
    ["LIGHT travels straight; SOUND bends around corners.", ""],
    ["Graze every plankton to descend. Contact costs a life.", ""],
  ];
  ctx.textAlign = "left";
  let y = 200;
  for (const [k, v] of lines) {
    ctx.font = `20px ${MONO}`;
    if (!k && !v) {
      y += 16;
      continue;
    }
    if (v) {
      ctx.fillStyle = COLOR.forager;
      ctx.textAlign = "right";
      ctx.fillText(k, STAGE_W / 2 - 30, y);
      ctx.fillStyle = COLOR.textDim;
      ctx.textAlign = "left";
      ctx.fillText(v, STAGE_W / 2 - 10, y);
    } else {
      ctx.fillStyle = COLOR.text;
      ctx.textAlign = "center";
      ctx.fillText(k, STAGE_W / 2, y);
    }
    y += 40;
  }
  ctx.textAlign = "center";
  ctx.font = `16px ${MONO}`;
  ctx.fillStyle = COLOR.textFaint;
  setSpacing(ctx, 8);
  ctx.fillText("ESC  BACK", STAGE_W / 2, STAGE_H - 40);
  setSpacing(ctx, 0);
}

function drawDive(ctx: CanvasRenderingContext2D, game: Game): void {
  const n = game.diveNumber();
  ctx.textAlign = "center";
  ctx.fillStyle = COLOR.forager;
  ctx.font = `700 40px ${MONO}`;
  setSpacing(ctx, 16);
  ctx.save();
  ctx.shadowColor = "rgba(70,240,224,0.6)";
  ctx.shadowBlur = 24;
  ctx.fillText("DIVE", STAGE_W / 2, STAGE_H / 2 - 30);
  ctx.font = `700 96px ${MONO}`;
  setSpacing(ctx, 0);
  ctx.fillText(String(n), STAGE_W / 2, STAGE_H / 2 + 60);
  ctx.restore();
  setSpacing(ctx, 0);
}

function drawPause(ctx: CanvasRenderingContext2D, game: Game): void {
  overlay(ctx, 0.78);
  panel(ctx, () => {
    ctx.fillStyle = COLOR.textDim;
    ctx.font = `18px ${MONO}`;
    setSpacing(ctx, 10);
    ctx.fillText("HOLD FAST", STAGE_W / 2, STAGE_H / 2 - 120);
    ctx.fillStyle = COLOR.forager;
    ctx.font = `700 52px ${MONO}`;
    setSpacing(ctx, 8);
    ctx.fillText("PAUSED", STAGE_W / 2, STAGE_H / 2 - 66);
    setSpacing(ctx, 0);
    drawMenu(ctx, game.pauseItems, game.menu, STAGE_H / 2 + 10, 50);
  });
}

function drawCleared(ctx: CanvasRenderingContext2D, game: Game): void {
  overlay(ctx, 0.6);
  ctx.textAlign = "center";
  ctx.fillStyle = COLOR.forager;
  ctx.font = `700 64px ${MONO}`;
  setSpacing(ctx, 10);
  ctx.save();
  ctx.shadowColor = "rgba(70,240,224,0.5)";
  ctx.shadowBlur = 28;
  ctx.fillText(`DEPTH ${game.depth} CLEARED`, STAGE_W / 2, STAGE_H / 2);
  ctx.restore();
  ctx.font = `20px ${MONO}`;
  setSpacing(ctx, 8);
  ctx.fillStyle = COLOR.textDim;
  ctx.fillText("DESCENDING…", STAGE_W / 2, STAGE_H / 2 + 50);
  setSpacing(ctx, 0);
}

function drawGameOver(ctx: CanvasRenderingContext2D, game: Game): void {
  ctx.fillStyle = COLOR.fog;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
  overlay(ctx, 0.64);
  panel(ctx, () => {
    ctx.fillStyle = COLOR.textDim;
    ctx.font = `18px ${MONO}`;
    setSpacing(ctx, 10);
    ctx.fillText("LOST IN THE DARK", STAGE_W / 2, STAGE_H / 2 - 130);
    ctx.fillStyle = COLOR.forager;
    ctx.font = `700 52px ${MONO}`;
    setSpacing(ctx, 8);
    ctx.fillText("GAME OVER", STAGE_W / 2, STAGE_H / 2 - 74);
    ctx.fillStyle = COLOR.text;
    ctx.font = `36px ${MONO}`;
    setSpacing(ctx, 10);
    ctx.fillText(`SCORE ${pad(game.score, 5)}`, STAGE_W / 2, STAGE_H / 2 - 24);
    ctx.fillStyle = COLOR.textDim;
    ctx.font = `20px ${MONO}`;
    setSpacing(ctx, 8);
    ctx.fillText(`REACHED DEPTH ${game.depth}`, STAGE_W / 2, STAGE_H / 2 + 12);
    setSpacing(ctx, 0);
    drawMenu(ctx, game.overItems, game.menu, STAGE_H / 2 + 66, 48);
  });
}

// A dim slice of trench behind the title, for atmosphere.
function drawMazeBackdrop(ctx: CanvasRenderingContext2D, game: Game): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(GRID_X, GRID_Y, MAZE_W, MAZE_H);
  ctx.clip();
  ctx.imageSmoothingEnabled = false;
  ctx.globalAlpha = 0.14;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const dx = GRID_X + c * TILE;
      const dy = GRID_Y + r * TILE;
      if (game.maze.isWall(c, r)) {
        ctx.drawImage(game.assets.trench[game.maze.wallFrame(c, r)], dx, dy, TILE, TILE);
      } else {
        ctx.drawImage(game.assets.trench[16], dx, dy, TILE, TILE);
      }
    }
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

// ---- primitives --------------------------------------------------------

function overlay(ctx: CanvasRenderingContext2D, a: number): void {
  ctx.fillStyle = `rgba(2,4,8,${a})`;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
}

function panel(ctx: CanvasRenderingContext2D, body: () => void): void {
  const w = 560;
  const h = 380;
  const x = STAGE_W / 2 - w / 2;
  const y = STAGE_H / 2 - h / 2;
  ctx.save();
  ctx.fillStyle = COLOR.bgRaised;
  ctx.strokeStyle = COLOR.panelBorder;
  ctx.lineWidth = 1;
  roundRect(ctx, x, y, w, h, 18);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  ctx.textAlign = "center";
  body();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function pad(n: number, width: number): string {
  const s = String(Math.max(0, Math.floor(n)));
  return s.length >= width ? s : "0".repeat(width - s.length) + s;
}
