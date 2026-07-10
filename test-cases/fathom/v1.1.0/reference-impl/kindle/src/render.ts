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
import { Predator } from "./entities";
import { Game } from "./game";
import { Maze } from "./maze";
import { tileKey } from "./sensing";
import { Dir, GameState, PredKind, PredState } from "./types";

const MAZE_W = COLS * TILE;
const MAZE_H = ROWS * TILE;

// Kindle's outer **vision circle**: a pixel-perfect render mask over the
// already-revealed trench. It paints everything beyond radius `R` of the forager
// back to pitch-black fog, cutting the circle at the pixel (not the tile), so
// terrain and pellets show only within it (specs/sensing.md). It is NOT vision
// for predators — that is the smaller, per-tile light circle — so predators, the
// always-visible amber lights, and the enemy effects are all drawn AFTER this
// mask and can appear beyond the circle.
function drawVisionMask(ctx: CanvasRenderingContext2D, game: Game): void {
  const f = game.forager;
  const R = game.visionCircle;
  const inner = Math.max(0, R - 20); // a soft edge over the last ~20px
  const g = ctx.createRadialGradient(f.x, f.y, inner, f.x, f.y, R);
  g.addColorStop(0, "rgba(3,6,12,0)"); // transparent inside the circle
  g.addColorStop(1, COLOR.fog); // opaque fog; the gradient extends this beyond R
  ctx.fillStyle = g;
  ctx.fillRect(GRID_X, GRID_Y, MAZE_W, MAZE_H);
}

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

  // Tiles: revealed like Base (StarCraft fog) — lit = full, remembered = dim.
  // The vision-circle mask (below) clips these to a pixel-perfect circle.
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

  // The forager's light pocket glow, filling the vision circle you carry.
  drawLightPocket(ctx, game);

  // Plankton (remembered dim, lit bright); the vision-circle mask clips these too.
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

  // The pixel-perfect vision-circle mask: paint everything beyond the circle back
  // to pitch-black fog. This clips ONLY the terrain and pellets above — it runs
  // before predators, effects, and the always-visible amber lights, which are
  // drawn next and so can show beyond the circle.
  drawVisionMask(ctx, game);

  // Effects and creatures composite additively where they read as light.
  drawEffectsAndCreatures(ctx, game);

  ctx.restore();
}

// The forager's light circle: a soft cyan glow that lifts the brightness of the
// revealed maze immediately around it (specs/sensing.md). It is a glow, not a
// blackout — remembered terrain outside it stays clearly drawn (Base is a
// StarCraft-style fog of war: what you have explored stays visible).
function drawLightPocket(ctx: CanvasRenderingContext2D, game: Game): void {
  const f = game.forager;
  // The soft glow fills the vision circle you carry (specs/sensing.md — Kindle).
  const R = game.visionCircle;
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

  // Detection-alert bursts (additive): a sharp bright flash in the predator's
  // color when the Gloamfin's ping or the Flarefish's flare acquires you.
  drawBursts(ctx, game);

  // Creatures (pixel art, nearest-neighbor).
  ctx.save();
  ctx.imageSmoothingEnabled = false;

  // Predator bodies, only where visible. The Lanternjaw's body is fog-gated like
  // the rest (its bulb is drawn separately, always, below); the Flarefish shows the
  // same way but makes no tell of its own except its flare.
  for (const p of game.predators) {
    if (p.state === PredState.Den) continue;
    if (!predatorBodyVisible(game, p)) continue;
    const lit = game.fog.isLit(p.col, p.row) || p.alertT > 0;
    ctx.globalAlpha = lit ? 1 : 0.6;
    drawPredator(ctx, assets, p);
    ctx.globalAlpha = 1;
  }

  // Forager (always drawn).
  const f = game.forager;
  ctx.drawImage(assets.glimmerfin[spriteFrame(f)], f.x - 16, f.y - 16, TILE, TILE);
  ctx.restore();

  // The two always-visible amber lights (additive), drawn on top so they read at
  // any distance and look almost identical: the bonus drifter and every out-of-den
  // Lanternjaw's bulb (specs/predators.md, specs/sensing.md).
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const d = game.drifter;
  if (d) drawAmberOrb(ctx, d.x, d.y);
  for (const p of game.predators) {
    if (p.kind === PredKind.Lanternjaw && p.state !== PredState.Den)
      drawAmberOrb(ctx, p.x, p.y);
  }
  ctx.restore();
}

// Whether a predator's body is currently drawn. Every predator — the Flarefish
// included — shows wherever your light falls on it, a sonar mark catches it, or its
// detection alert fires. The Flarefish simply makes no tell of its own but the
// flare (no bulb, no ping); it is also lit by its own flare while it charges/blooms.
function predatorBodyVisible(game: Game, p: Predator): boolean {
  if (p.alertT > 0) return true;
  if (p.kind === PredKind.Flarefish && p.flaring) return true; // lit by its own flare
  return game.entityVisible(p.col, p.row, p.markT);
}

function drawPredator(
  ctx: CanvasRenderingContext2D,
  assets: Game["assets"],
  p: Predator,
): void {
  let frame: number;
  let sheet: HTMLImageElement[];
  if (p.kind === PredKind.Lanternjaw) {
    sheet = assets.lanternjaw;
    if (p.state === PredState.Hunt) frame = spriteFrame(p);
    else frame = 8 + (Math.floor(p.animT * 8) % 6); // bulb-bob tell
  } else if (p.kind === PredKind.Gloamfin) {
    sheet = assets.gloamfin;
    frame = spriteFrame(p);
  } else {
    sheet = assets.flarefish;
    frame = spriteFrame(p);
  }
  ctx.drawImage(sheet[frame], p.x - 16, p.y - 16, TILE, TILE);
}

// A soft amber mote with a bright core (`#ffd166`), used for BOTH the bonus
// drifter and the Lanternjaw's always-visible bulb so the two are confusable at a
// glance (specs/playfield.md, specs/predators.md). Caller composites additively.
function drawAmberOrb(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, 14);
  g.addColorStop(0, "rgba(255,240,194,0.95)");
  g.addColorStop(0.45, "rgba(255,209,102,0.55)");
  g.addColorStop(1, "rgba(255,209,102,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff3cf";
  ctx.beginPath();
  ctx.arc(x, y, 4, 0, Math.PI * 2);
  ctx.fill();
}

function drawBursts(ctx: CanvasRenderingContext2D, game: Game): void {
  if (!game.effects.bursts.length) return;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const b of game.effects.bursts) {
    const p = b.t / b.dur; // 0..1
    const fade = 1 - p;
    // Bright core flash.
    ctx.globalAlpha = fade * 0.9;
    ctx.fillStyle = b.color;
    ctx.shadowColor = b.color;
    ctx.shadowBlur = 24 * fade;
    ctx.beginPath();
    ctx.arc(b.x, b.y, 6 + 4 * fade, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    // A ring that snaps outward and fades.
    ctx.globalAlpha = fade * 0.85;
    ctx.strokeStyle = b.color;
    ctx.lineWidth = 2.5 * fade + 1;
    ctx.beginPath();
    ctx.arc(b.x, b.y, 10 + p * 42, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
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
  ctx.fillText("KINDLE", STAGE_W - 40, 44);

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
    ["INK", "Shift  —  blinds the sight hunters (not the Gloamfin)"],
    ["PAUSE", "Esc or P"],
    ["", ""],
    ["THE LANTERNJAW", "hunts your LIGHT — go dim, or ink it"],
    ["THE GLOAMFIN", "hunts your SOUND — outruns you, so break its fix; ink is useless"],
    ["THE FLAREFISH", "no sign but its FLARE — leave its light, or ink it"],
    ["", ""],
    ["You see the trench only within your vision circle — it grows as you eat.", ""],
    ["Graze every plankton to descend. Contact costs a life.", ""],
  ];
  // Two-column layout anchored left of centre so the long descriptions on
  // the right stay within the stage instead of running off the edge.
  const keyRight = STAGE_W / 2 - 220;
  const valueLeft = STAGE_W / 2 - 200;
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
      ctx.fillText(k, keyRight, y);
      ctx.fillStyle = COLOR.textDim;
      ctx.textAlign = "left";
      ctx.fillText(v, valueLeft, y);
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
