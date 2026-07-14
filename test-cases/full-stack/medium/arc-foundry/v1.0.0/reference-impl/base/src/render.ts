// Arc Foundry — the renderer (specs/board.md, specs/towers.md, specs/build.md,
// specs/flow.md, specs/controls.md, specs/assets.md).
//
// Draws the whole fixed 1280×720 stage every frame from the simulation state, reading it
// and never mutating it: the yard substrate + faint tile grid, each map's waypoint pylons /
// Entry / Collector / fixed housings and the 4-tile waypoint PLATFORMS, the flow direction
// toward the sink, the maze of produced component / candidate / blocker sprites (with the
// quality-tier finish escalating rung by rung, and candidates shown uncommitted), the Load
// with per-unit health bars and charge cycles, travelling projectiles, the live produced
// electrical particle bursts (via Bursts), and the in-code HUD / build panel / menus — plus
// the blank held-rock ghost with its legal/illegal placement cue and the range rings (only
// on placed pieces, whose roll is known). Returns the frame's hit-testable UI regions so the input layer can route pointer
// events (specs/controls.md) without re-deriving the layout. Component TYPE and quality
// TIER must both read at a glance (specs/overview.md, specs/towers.md).

import {
  BOARD_X0,
  BOARD_X1,
  BOARD_Y0,
  BOARD_Y1,
  BUILDS_PER_LEVEL,
  COL,
  COMPONENT_COLOR,
  COMPONENT_LABEL,
  DIFFICULTY,
  DIFFICULTY_ORDER,
  FONT,
  FOOTPRINT_PX,
  GRID_COLS,
  GRID_ROWS,
  GRID_X0,
  GRID_Y0,
  LOAD,
  MAPS,
  MAX_TIER,
  PANEL_X,
  STAGE_H,
  STAGE_W,
  STATUS_H,
  TARGETING_LABEL,
  TIER_NAME,
  TILE,
  deriveStats,
  footprintCenter,
  tileCenter,
} from "./constants";
import type { Assets } from "./assets";
import type { Bursts } from "./particles";
import { Game } from "./sim";
import { menuItems, type MenuItem } from "./menus";
import type {
  Candidate,
  Clickable,
  Component,
  Difficulty,
  LoadType,
  MapDef,
  Structure,
  Tier,
  Unit,
} from "./types";

// Frame state the loop pushes in before rendering (interpolation clock, menu cursor, mute).
let time = 0;
let menuIndex = 0;
let muted = false;

export function setRenderTime(t: number): void {
  time = t;
}
export function setMenuIndex(i: number): void {
  menuIndex = i;
}
export function setMuted(m: boolean): void {
  muted = m;
}

// The quality ladder's per-tier accent (specs/overview.md) — the SECOND, non-color read of
// quality (beside the escalating head finish + VFX): a tier ring, pips, and a Roman badge.
const TIER_COLOR: Record<Tier, string> = {
  1: "#7a8794", // Scrap
  2: "#8fd0a0", // Tuned
  3: "#6cb6ff", // Charged
  4: "#c78cff", // Primed
  5: "#ffe45a", // Tesla-Prime
};
const ROMAN: Record<Tier, string> = { 1: "I", 2: "II", 3: "III", 4: "IV", 5: "V" };

// A load type's next-wave-preview icon (produced glyph) — specs/assets.md icons.
const LOAD_ICON: Record<LoadType, string> = {
  mote: "icons/mote",
  spark: "icons/spark",
  slug: "icons/slug",
  cluster: "icons/cluster",
  filament: "icons/filament",
  dynamo: "icons/dynamo",
};

// A cached repeating pattern of the produced substrate tile (built once from the sprite).
let substratePattern: CanvasPattern | null = null;

// ---- small drawing helpers ----------------------------------------------------

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

function text(
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

function blit(ctx: CanvasRenderingContext2D, img: HTMLImageElement, cx: number, cy: number, w: number, h: number, ang = 0): void {
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.translate(cx, cy);
  if (ang) ctx.rotate(ang);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  ctx.restore();
}

function hexA(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

function inRect(px: number, py: number, x: number, y: number, w: number, h: number): boolean {
  return px >= x && px <= x + w && py >= y && py <= y + h;
}

function ring(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, c: string, a: number, lw = 1.5): void {
  ctx.save();
  ctx.strokeStyle = hexA(c, a);
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function glow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, c: string, a: number): void {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, hexA(c, a));
  g.addColorStop(1, hexA(c, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function wrap(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, maxW: number, size: number, color: string, lineHeight = 18): number {
  ctx.font = `400 ${size}px ${FONT}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  const words = s.split(" ");
  let line = "";
  let yy = y;
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, yy);
      line = w;
      yy += lineHeight;
    } else line = test;
  }
  ctx.fillText(line, x, yy);
  return yy + lineHeight;
}

function drawSpaced(ctx: CanvasRenderingContext2D, s: string, cx: number, y: number, size: number, letter: number): void {
  const chars = [...s];
  const adv = size * 0.62 + letter;
  const total = chars.length * adv;
  let x = cx - total / 2 + adv / 2;
  ctx.textAlign = "center";
  for (const c of chars) {
    ctx.fillText(c, x, y);
    x += adv;
  }
}

// A generic panel button. Returns nothing; pushes a Clickable when enabled.
function button(ctx: CanvasRenderingContext2D, clicks: Clickable[], x: number, y: number, w: number, h: number, label: string, action: string, color: string, enabled: boolean): void {
  roundRect(ctx, x, y, w, h, 6);
  ctx.fillStyle = enabled ? hexA(color, 0.14) : "rgba(255,255,255,0.03)";
  ctx.fill();
  ctx.strokeStyle = enabled ? color : "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  text(ctx, label, x + w / 2, y + h / 2 + 1, 12, enabled ? color : COL.text3, "center", "700");
  clicks.push({ x, y, w, h, action, disabled: !enabled });
}

// ---- entry --------------------------------------------------------------------

export function render(ctx: CanvasRenderingContext2D, game: Game, A: Assets, bursts: Bursts): Clickable[] {
  ctx.imageSmoothingEnabled = true;
  ctx.fillStyle = COL.void;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);

  const clicks: Clickable[] = [];

  if (game.state === "title") {
    drawTitle(ctx, game, A, clicks);
    return clicks;
  }
  if (game.state === "mapselect") {
    drawMapSelect(ctx, game, A, clicks);
    return clicks;
  }
  if (game.state === "difficultyselect") {
    drawDifficultySelect(ctx, game, clicks);
    return clicks;
  }
  if (game.state === "howto") {
    drawHowto(ctx, clicks);
    return clicks;
  }

  // The live board (also seen frozen behind the pause menu / end screens).
  drawBoard(ctx, game, A);
  drawUnits(ctx, game, A);
  drawProjectiles(ctx, game, A);
  bursts.draw(ctx);
  drawBuildCursor(ctx, game, A);
  drawStatusBar(ctx, game, A, clicks);
  drawPanel(ctx, game, A, clicks);

  if (game.state === "paused") drawPauseMenu(ctx, game, clicks);
  if (game.state === "victory") drawEnd(ctx, game, clicks, true);
  if (game.state === "defeat") drawEnd(ctx, game, clicks, false);

  return clicks;
}

// ---- board --------------------------------------------------------------------

function drawBoard(ctx: CanvasRenderingContext2D, game: Game, A: Assets): void {
  const board = game.board;
  const bw = BOARD_X1 - BOARD_X0;
  const bh = BOARD_Y1 - BOARD_Y0;

  // Substrate (tiled from the produced tile), then the faint tile grid.
  ctx.fillStyle = COL.substrate;
  ctx.fillRect(BOARD_X0, BOARD_Y0, bw, bh);
  if (A.has("board/substrate")) {
    if (!substratePattern) {
      ctx.imageSmoothingEnabled = false;
      substratePattern = ctx.createPattern(A.sprite("board/substrate"), "repeat");
    }
    if (substratePattern) {
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = substratePattern;
      ctx.fillRect(BOARD_X0, BOARD_Y0, bw, bh);
      ctx.restore();
    }
  }

  ctx.save();
  ctx.strokeStyle = hexA(COL.grid, 0.5);
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let c = 0; c <= GRID_COLS; c++) {
    const x = GRID_X0 + c * TILE + 0.5;
    ctx.moveTo(x, GRID_Y0);
    ctx.lineTo(x, GRID_Y0 + GRID_ROWS * TILE);
  }
  for (let r = 0; r <= GRID_ROWS; r++) {
    const y = GRID_Y0 + r * TILE + 0.5;
    ctx.moveTo(GRID_X0, y);
    ctx.lineTo(GRID_X0 + GRID_COLS * TILE, y);
  }
  ctx.stroke();
  ctx.restore();

  // Fixed transformer housings (Map C).
  for (const h of board.map.housings) {
    const x = GRID_X0 + h.col0 * TILE;
    const y = GRID_Y0 + h.row0 * TILE;
    const w = (h.col1 - h.col0 + 1) * TILE;
    const hh = (h.row1 - h.row0 + 1) * TILE;
    if (A.has("board/housing")) {
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(A.sprite("board/housing"), x, y, w, hh);
      ctx.restore();
    } else {
      ctx.fillStyle = COL.housing;
      ctx.fillRect(x, y, w, hh);
    }
    ctx.strokeStyle = hexA("#000000", 0.5);
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, w - 2, hh - 2);
  }

  drawFlow(ctx, board.chain);
  drawPlatforms(ctx, board);
  drawWaypoints(ctx, board.chain, A);

  // Range / preview rings under the pieces so the pieces stay legible. A placed piece whose
  // roll is known (a firing component OR an uncommitted candidate) previews its range when
  // selected; a blocker has no range.
  const sel = game.selected();
  if (sel && sel.kind === "component") {
    const ctr = footprintCenter(sel.col, sel.row);
    drawRange(ctx, ctr.x, ctr.y, game.statsOf(sel).range, COMPONENT_COLOR[sel.type]);
  } else if (sel && sel.kind === "candidate") {
    const ctr = footprintCenter(sel.col, sel.row);
    drawRange(ctx, ctr.x, ctr.y, deriveStats(sel.type, sel.tier).range, COMPONENT_COLOR[sel.type]);
  }

  // The maze: firing components, this-level candidates, and inert blockers — every piece is
  // a 2×2 wall (specs/board.md).
  for (const s of game.structures) {
    if (s.kind === "component") drawComponent(ctx, game, s, A);
    else if (s.kind === "candidate") drawCandidate(ctx, game, s, A);
    else drawBlocker(ctx, game, s, A);
  }
}

// The waypoint PLATFORMS — each interior waypoint is a 4-tile T of walkable-but-never-
// buildable plating (specs/board.md). Draw the plate distinctly so a platform never reads
// as buildable open yard (you cannot drop a rock on it).
function drawPlatforms(ctx: CanvasRenderingContext2D, board: { waypointTiles: Set<number> }): void {
  ctx.save();
  for (const key of board.waypointTiles) {
    const col = key % GRID_COLS;
    const row = (key - col) / GRID_COLS;
    const x = GRID_X0 + col * TILE;
    const y = GRID_Y0 + row * TILE;
    ctx.fillStyle = hexA(COL.flow, 0.24);
    ctx.fillRect(x, y, TILE, TILE);
    ctx.strokeStyle = hexA(COL.integrity, 0.4);
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
  }
  ctx.restore();
}

// The ordered waypoint chain, drawn as a guide line with animated flow chevrons pointing
// toward the Collector (specs/board.md — a clear sense of flow direction).
function drawFlow(ctx: CanvasRenderingContext2D, chain: { col: number; row: number }[]): void {
  const pts = chain.map((t) => tileCenter(t.col, t.row));
  ctx.save();
  ctx.strokeStyle = hexA(COL.flow, 0.35);
  ctx.lineWidth = 3;
  ctx.setLineDash([2, 10]);
  ctx.lineCap = "round";
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.stroke();
  ctx.restore();

  // Marching chevrons along each leg.
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    const ang = Math.atan2(uy, ux);
    const march = (time * 40) % 40;
    for (let d = march; d < len; d += 40) {
      const x = a.x + ux * d;
      const y = a.y + uy * d;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang);
      ctx.strokeStyle = hexA(COL.flow, 0.55);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-4, -4);
      ctx.lineTo(2, 0);
      ctx.lineTo(-4, 4);
      ctx.stroke();
      ctx.restore();
    }
  }
}

function drawWaypoints(ctx: CanvasRenderingContext2D, chain: { col: number; row: number }[], A: Assets): void {
  for (let i = 0; i < chain.length; i++) {
    const p = tileCenter(chain[i]!.col, chain[i]!.row);
    if (i === 0) {
      // Entry — a blown feeder vent.
      glow(ctx, p.x, p.y, 26, COL.entry, 0.28 + 0.06 * Math.sin(time * 4));
      if (A.has("board/entry")) blit(ctx, A.sprite("board/entry"), p.x, p.y, FOOTPRINT_PX, FOOTPRINT_PX);
    } else if (i === chain.length - 1) {
      // Collector — a grounding sink (hazard).
      glow(ctx, p.x, p.y, 28, COL.collector, 0.26 + 0.06 * Math.sin(time * 5));
      if (A.has("board/collector")) blit(ctx, A.sprite("board/collector"), p.x, p.y, FOOTPRINT_PX, FOOTPRINT_PX);
    } else {
      // Ordered waypoint pylon with its index.
      if (A.has("board/pylon")) blit(ctx, A.sprite("board/pylon"), p.x, p.y, 22, 22);
      else ring(ctx, p.x, p.y, 8, COL.flow, 0.8);
      text(ctx, `${i}`, p.x, p.y - 14, 9, hexA(COL.integrity, 0.9), "center", "700");
    }
  }
}

function drawRange(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, c: string): void {
  ctx.save();
  ctx.strokeStyle = hexA(c, 0.8);
  ctx.fillStyle = hexA(c, 0.07);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

// A single component: fixed base + rotatable per-tier head, the tier finish escalating each
// rung (glow, an at-rest arc from Primed up), the firing cycle when it just fired, plus a
// glanceable quality read — a tier ring, pips, and a Roman badge (specs/towers.md).
function drawComponent(ctx: CanvasRenderingContext2D, game: Game, c: Component, A: Assets): void {
  const ctr = footprintCenter(c.col, c.row);
  const tierC = TIER_COLOR[c.tier];
  const typeC = COMPONENT_COLOR[c.type];
  const size = FOOTPRINT_PX;

  // Type-coded mount ring beneath the base.
  ring(ctx, ctr.x, ctr.y, size / 2 - 2, typeC, 0.5, 2);

  // Tier finish glow (escalates every rung).
  glow(ctx, ctr.x, ctr.y, 12 + c.tier * 4, tierC, 0.12 + 0.05 * c.tier);

  const base = A.componentBase(c.type);
  if (base) blit(ctx, base, ctr.x, ctr.y, size, size, 0);

  // High tiers arc continuously at rest — a Tesla-Prime "wreathed in arcs" read.
  if (c.tier >= 4) {
    const n = c.tier === 5 ? 5 : 3;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = hexA(COL.arc, c.tier === 5 ? 0.5 : 0.32);
    ctx.lineWidth = 1;
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * Math.PI * 2 + time * 3;
      ctx.beginPath();
      ctx.moveTo(ctr.x + Math.cos(a0) * 6, ctr.y + Math.sin(a0) * 6);
      ctx.lineTo(ctr.x + Math.cos(a0 + 1.2) * (size / 2 - 3), ctr.y + Math.sin(a0 + 1.2) * (size / 2 - 3));
      ctx.stroke();
    }
    ctx.restore();
  }

  const head = A.componentHead(c.type, c.tier);
  if (head) blit(ctx, head, ctr.x, ctr.y, size, size, c.aimAngle);

  // Firing cycle overlay right after a shot (specs/assets.md — components visibly discharge).
  const fire = A.componentFire(c.type);
  if (fire.length && c.fireAnim < 0.22) {
    const idx = Math.min(fire.length - 1, Math.floor((c.fireAnim / 0.22) * fire.length));
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.9;
    blit(ctx, fire[idx]!, ctr.x, ctr.y, size, size, c.aimAngle);
    ctx.restore();
  }

  // Selection outline.
  if (game.selectedId === c.id) {
    ctx.strokeStyle = COL.text;
    ctx.lineWidth = 2;
    roundRect(ctx, ctr.x - size / 2, ctr.y - size / 2, size, size, 5);
    ctx.stroke();
  }

  // Quality read: a tier ring, pips, and a Roman badge (the non-color second read).
  ring(ctx, ctr.x, ctr.y, size / 2 - 1, tierC, 0.85, 1.5);
  for (let i = 0; i < c.tier; i++) {
    ctx.fillStyle = tierC;
    ctx.beginPath();
    ctx.arc(ctr.x - (c.tier - 1) * 3 + i * 6, ctr.y + size / 2 - 3, 1.8, 0, Math.PI * 2);
    ctx.fill();
  }
  // Roman badge in a chip at the top-left of the footprint.
  const bx = ctr.x - size / 2 + 2;
  const by = ctr.y - size / 2 + 2;
  const bw = 6 + ROMAN[c.tier].length * 5;
  roundRect(ctx, bx, by, bw, 11, 3);
  ctx.fillStyle = hexA("#05080c", 0.75);
  ctx.fill();
  text(ctx, ROMAN[c.tier], bx + bw / 2, by + 6, 8, tierC, "center", "800");
}

// An inert BLOCKER — a hardened fused-scrap rock with no head, unmistakably dead: it walls
// the Load but never fires (specs/build.md). Every un-kept candidate hardens into one of
// these at wave start.
function drawBlocker(ctx: CanvasRenderingContext2D, game: Game, s: Structure, A: Assets): void {
  const ctr = footprintCenter(s.col, s.row);
  const size = FOOTPRINT_PX;
  if (A.blocker) blit(ctx, A.blocker, ctr.x, ctr.y, size, size, 0);
  else {
    ctx.fillStyle = COL.blocker;
    roundRect(ctx, ctr.x - size / 2 + 2, ctr.y - size / 2 + 2, size - 4, size - 4, 4);
    ctx.fill();
  }
  if (game.selectedId === s.id) {
    ctx.strokeStyle = hexA(COL.text, 0.7);
    ctx.lineWidth = 2;
    roundRect(ctx, ctr.x - size / 2, ctr.y - size / 2, size, size, 5);
    ctx.stroke();
  }
}

// A CANDIDATE — a rock placed THIS build phase that has rolled a random type + quality and
// is eligible to be KEPT or COMBINED this level only (specs/build.md). It draws its rolled
// component sprite with an UNCOMMITTED treatment (dimmed, a pulsing dashed outline, a "NEW"
// tag) so it never reads as a settled firing component, and a bright KEEP / COMBINE marker
// when it is this level's harvest choice.
function drawCandidate(ctx: CanvasRenderingContext2D, game: Game, c: Candidate, A: Assets): void {
  const ctr = footprintCenter(c.col, c.row);
  const tierC = TIER_COLOR[c.tier];
  const typeC = COMPONENT_COLOR[c.type];
  const size = FOOTPRINT_PX;
  const pulse = 0.5 + 0.5 * Math.sin(time * 5);
  const kept = game.keptId() === c.id;

  // A faint tier glow so quality still reads, but muted (this rock is not committed yet).
  glow(ctx, ctr.x, ctr.y, 10 + c.tier * 3, tierC, 0.08 + 0.03 * c.tier);

  // The rolled component sprite, dimmed.
  ctx.save();
  ctx.globalAlpha = 0.6;
  const base = A.componentBase(c.type);
  if (base) blit(ctx, base, ctr.x, ctr.y, size, size, 0);
  const head = A.componentHead(c.type, c.tier);
  if (head) blit(ctx, head, ctr.x, ctr.y, size, size, 0);
  ctx.restore();

  // Uncommitted pulsing dashed outline in the type accent.
  ctx.save();
  ctx.strokeStyle = hexA(typeC, 0.35 + 0.45 * pulse);
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 3]);
  roundRect(ctx, ctr.x - size / 2, ctr.y - size / 2, size, size, 5);
  ctx.stroke();
  ctx.restore();

  // The quality read (tier ring + Roman badge), so type AND quality still read at a glance.
  ring(ctx, ctr.x, ctr.y, size / 2 - 1, tierC, 0.7, 1.5);
  const bx = ctr.x - size / 2 + 2;
  const by = ctr.y - size / 2 + 2;
  const bw = 6 + ROMAN[c.tier].length * 5;
  roundRect(ctx, bx, by, bw, 11, 3);
  ctx.fillStyle = hexA("#05080c", 0.75);
  ctx.fill();
  text(ctx, ROMAN[c.tier], bx + bw / 2, by + 6, 8, tierC, "center", "800");

  if (kept) {
    // The level's committed harvest — a bright marker ring + a KEEP / COMBINE tag.
    const label = game.harvest.mode === "combine" ? "COMBINE" : "KEEP";
    glow(ctx, ctr.x, ctr.y, size / 2 + 4, COL.charge, 0.2 + 0.1 * pulse);
    ring(ctx, ctr.x, ctr.y, size / 2 + 2, COL.charge, 0.9, 2);
    const tw = 8 + label.length * 6;
    roundRect(ctx, ctr.x - tw / 2, ctr.y - size / 2 - 13, tw, 12, 3);
    ctx.fillStyle = hexA(COL.charge, 0.9);
    ctx.fill();
    text(ctx, label, ctr.x, ctr.y - size / 2 - 7, 8, COL.void, "center", "800", 0.5);
  } else {
    // A small "NEW" tag at the bottom so an uncommitted candidate reads as a fresh roll.
    roundRect(ctx, ctr.x - 12, ctr.y + size / 2 - 11, 24, 11, 3);
    ctx.fillStyle = hexA(typeC, 0.85);
    ctx.fill();
    text(ctx, "NEW", ctr.x, ctr.y + size / 2 - 5, 7, COL.void, "center", "800", 0.5);
  }

  // Selection outline.
  if (game.selectedId === c.id) {
    ctx.strokeStyle = COL.text;
    ctx.lineWidth = 2;
    roundRect(ctx, ctr.x - size / 2, ctr.y - size / 2, size, size, 5);
    ctx.stroke();
  }
}

// ---- projectiles --------------------------------------------------------------
// Every shot is a visible travelling projectile (specs/towers.md). Single-bolt types
// (Capacitor / Emitter / Discharge) carry a produced sprite; the Coil and Arc-Node bolts
// (whose payloads are the chain / ring particle effects) draw a code bolt in their accent.
function drawProjectiles(ctx: CanvasRenderingContext2D, game: Game, A: Assets): void {
  for (const pr of game.projectiles) {
    const c = COMPONENT_COLOR[pr.type];
    const spr = A.projectile(pr.type);
    ctx.save();
    ctx.shadowColor = c;
    ctx.shadowBlur = 8;
    if (spr) {
      blit(ctx, spr, pr.x, pr.y, 16, 16, pr.angle);
    } else {
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = hexA(c, 0.95);
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(pr.x - Math.cos(pr.angle) * 7, pr.y - Math.sin(pr.angle) * 7);
      ctx.lineTo(pr.x + Math.cos(pr.angle) * 7, pr.y + Math.sin(pr.angle) * 7);
      ctx.stroke();
    }
    ctx.restore();
  }
}

// ---- the Load -----------------------------------------------------------------

function drawUnits(ctx: CanvasRenderingContext2D, game: Game, A: Assets): void {
  for (const u of game.units) {
    if (u.dead) continue;
    drawUnit(ctx, u, A);
    drawHealthBar(ctx, u);
  }
}

function drawUnit(ctx: CanvasRenderingContext2D, u: Unit, A: Assets): void {
  const frames = A.loadFrames[u.type];
  const size = u.radius * 2.4;
  const boss = u.type === "dynamo";

  // Flyer read: a soft shadow + lift so the Filament reads as airborne (specs/enemies.md).
  if (u.flies) {
    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = "#000000";
    ctx.beginPath();
    ctx.ellipse(u.x, u.y + 8, u.radius, u.radius * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  const seethe = boss ? 1 + 0.06 * Math.sin(time * 9 + u.id) : 1;
  glow(ctx, u.x, u.y, u.radius + (boss ? 12 : 4), boss ? COL.boss : COL.arc, boss ? 0.3 : 0.14);

  if (frames.length) {
    const idx = Math.floor((u.animT * 10 + u.id) % frames.length);
    blit(ctx, frames[idx]!, u.x, u.y, size * seethe, size * seethe, 0);
  } else {
    ctx.fillStyle = boss ? COL.boss : COL.text2;
    ctx.beginPath();
    ctx.arc(u.x, u.y, u.radius, 0, Math.PI * 2);
    ctx.fill();
  }

  // Hit flash.
  if (u.hitFlash < 0.09) glow(ctx, u.x, u.y, u.radius + 6, COL.spark, 0.5 * (1 - u.hitFlash / 0.09));
}

function drawHealthBar(ctx: CanvasRenderingContext2D, u: Unit): void {
  const frac = u.maxHp > 0 ? Math.max(0, u.hp) / u.maxHp : 0;
  const w = Math.max(16, u.radius * 2.2);
  const h = u.type === "dynamo" ? 5 : 3;
  const x = u.x - w / 2;
  const y = u.y - u.radius - (u.flies ? 12 : 8);
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  ctx.fillStyle = frac > 0.5 ? COL.legal : frac > 0.25 ? COL.charge : COL.alert;
  ctx.fillRect(x, y, w * frac, h);
}

// ---- held-rock ghost (position + legal/illegal cue) ----------------------------
// specs/controls.md, specs/build.md: a GENERIC blank rock is held on the cursor as its 2×2
// footprint, snapped to the grid, with a legal/illegal placement cue. There is NO range
// ring and NO head — the type + quality only ROLL when the rock lands (placeStamp).
function drawBuildCursor(ctx: CanvasRenderingContext2D, game: Game, A: Assets): void {
  if (game.state !== "playing" || !game.holding) return;
  const px = game.pointerX;
  const py = game.pointerY;
  if (px < BOARD_X0 || px > BOARD_X1 || py < BOARD_Y0 || py > BOARD_Y1) return;

  const anchor = game.board.pixelToAnchor(px, py);
  const legal = game.canPlaceAt(anchor.col, anchor.row);
  const ctr = footprintCenter(anchor.col, anchor.row);
  const cue = legal ? COL.legal : COL.illegal;

  // Footprint tiles cue (specs/overview.md placement-cue palette).
  const x0 = GRID_X0 + anchor.col * TILE;
  const y0 = GRID_Y0 + anchor.row * TILE;
  ctx.save();
  ctx.fillStyle = hexA(cue, 0.28);
  ctx.fillRect(x0, y0, FOOTPRINT_PX, FOOTPRINT_PX);
  ctx.strokeStyle = cue;
  ctx.lineWidth = 2;
  ctx.strokeRect(x0 + 1, y0 + 1, FOOTPRINT_PX - 2, FOOTPRINT_PX - 2);
  ctx.restore();

  // The blank rock lump + a "?" — its roll is unknown until it lands.
  ctx.save();
  ctx.globalAlpha = legal ? 0.8 : 0.4;
  if (A.blocker) blit(ctx, A.blocker, ctr.x, ctr.y, FOOTPRINT_PX - 4, FOOTPRINT_PX - 4, 0);
  ctx.restore();
  text(ctx, "?", ctr.x, ctr.y, 18, legal ? COL.spark : COL.illegal, "center", "800");
}

// ---- status bar ---------------------------------------------------------------

function drawStatusBar(ctx: CanvasRenderingContext2D, game: Game, A: Assets, clicks: Clickable[]): void {
  ctx.fillStyle = COL.panel;
  ctx.fillRect(0, 0, STAGE_W, STATUS_H);
  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  ctx.beginPath();
  ctx.moveTo(0, STATUS_H - 0.5);
  ctx.lineTo(STAGE_W, STATUS_H - 0.5);
  ctx.stroke();

  if (A.has("icons/charge")) blit(ctx, A.sprite("icons/charge"), 26, 28, 18, 18);
  text(ctx, "CHARGE", 42, 20, 10, COL.text3, "left", "600", 1);
  text(ctx, `${Math.floor(game.charge)}`, 42, 36, 18, COL.charge, "left", "700");

  const low = game.integrity <= game.maxIntegrity * 0.25;
  if (A.has("icons/integrity")) blit(ctx, A.sprite("icons/integrity"), 176, 28, 18, 18);
  text(ctx, "GRID INTEGRITY", 192, 20, 10, COL.text3, "left", "600", 1);
  text(ctx, `${Math.max(0, Math.floor(game.integrity))}`, 192, 36, 18, low ? COL.alert : COL.integrity, "left", "700");

  const N = game.diff.waves;
  const wnum = game.wave === 0 ? 1 : game.wave;
  text(ctx, "WAVE", 380, 20, 10, COL.text3, "left", "600", 1);
  text(ctx, `${wnum}`, 380, 36, 18, COL.text, "left", "700");
  text(ctx, `/ ${N}`, 412, 37, 13, COL.text2, "left", "500");

  let sub = "";
  let subColor: string = COL.text2;
  if (game.paused) {
    sub = "PAUSED";
    subColor = COL.alert;
  } else if (game.phase === "build") {
    // The build phase is UNTIMED (specs/flow.md) — no countdown, SEND when ready.
    sub = "BUILD";
    subColor = COL.integrity;
  } else {
    sub = `${Math.round(game.waveProgress() * 100)}%`;
  }
  text(ctx, sub, 470, 37, 12, subColor, "left", "600", 1);

  text(ctx, `SCORE ${game.score.toLocaleString()}`, 640, 30, 12, COL.text2, "left", "500", 1);

  ctrl(ctx, clicks, 1112, `${game.speed}×`, "speed", COL.text, 52);
  ctrl(ctx, clicks, 1172, game.paused ? "▶" : "❚❚", "pause", game.paused ? COL.alert : COL.text, 40);
  ctrl(ctx, clicks, 1220, muted ? "♪̸" : "♪", "mute", muted ? COL.text3 : COL.text, 40);
}

function ctrl(ctx: CanvasRenderingContext2D, clicks: Clickable[], x: number, label: string, action: string, color: string, w: number): void {
  const y = 12;
  const h = 32;
  roundRect(ctx, x, y, w, h, 6);
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  ctx.lineWidth = 1;
  ctx.stroke();
  text(ctx, label, x + w / 2, y + h / 2 + 1, 14, color, "center", "600");
  clicks.push({ x, y, w, h, action });
}

// ---- right build panel --------------------------------------------------------

function drawPanel(ctx: CanvasRenderingContext2D, game: Game, A: Assets, clicks: Clickable[]): void {
  const pw = STAGE_W - PANEL_X;
  ctx.fillStyle = COL.panel;
  ctx.fillRect(PANEL_X, STATUS_H, pw, STAGE_H - STATUS_H);
  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  ctx.beginPath();
  ctx.moveTo(PANEL_X + 0.5, STATUS_H);
  ctx.lineTo(PANEL_X + 0.5, STAGE_H);
  ctx.stroke();

  const px = PANEL_X + 14;
  const w = pw - 28;

  // --- Scrap-press (STAMP) control (specs/build.md) ---
  // Arms a BLANK rock; the roll happens on placement. 10 Charge and one of the level's 5
  // stamps per placed rock — the cap is 5 regardless of Charge.
  text(ctx, "SCRAP-PRESS", px, 74, 11, COL.text3, "left", "700", 1);
  const stampY = 84;
  const stampH = 46;
  const canStamp = game.canStamp();
  roundRect(ctx, px, stampY, w, stampH, 8);
  ctx.fillStyle = canStamp ? hexA(COL.charge, 0.16) : "rgba(255,255,255,0.03)";
  ctx.fill();
  ctx.strokeStyle = canStamp ? COL.charge : "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  text(ctx, "STAMP", px + 12, stampY + 17, 15, canStamp ? COL.text : COL.text3, "left", "800", 1);
  text(ctx, `${game.stampsLeft()} / ${BUILDS_PER_LEVEL} ROCKS LEFT`, px + 12, stampY + 34, 9, COL.text3, "left", "500", 0.5);
  text(ctx, `${game.stampCost()}`, px + w - 12, stampY + 19, 15, canStamp ? COL.charge : COL.text3, "right", "700");
  if (A.has("icons/charge")) blit(ctx, A.sprite("icons/charge"), px + w - 40, stampY + 33, 12, 12);
  clicks.push({ x: px, y: stampY, w, h: stampH, action: "stamp", disabled: !canStamp });

  // --- UPGRADE QUALITY (Refinement track) control (specs/build.md) ---
  // Spend Charge to raise Refinement R, biasing every future roll toward higher tiers.
  const upHeadY = stampY + stampH + 22;
  text(ctx, "UPGRADE QUALITY", px, upHeadY, 11, COL.text3, "left", "700", 1);
  const upY = stampY + stampH + 32;
  const upH = 44;
  const canUp = game.canUpgradeQuality();
  const refCost = game.refineCost(); // number | null (null at max R)
  const atMax = refCost === null;
  roundRect(ctx, px, upY, w, upH, 8);
  ctx.fillStyle = canUp ? hexA(COL.integrity, 0.14) : "rgba(255,255,255,0.03)";
  ctx.fill();
  ctx.strokeStyle = canUp ? COL.integrity : "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  text(ctx, "UPGRADE", px + 12, upY + 16, 14, canUp ? COL.text : COL.text3, "left", "800", 1);
  const rProgress = atMax ? `R${game.refinement} · MAX` : `R${game.refinement} → R${game.refinement + 1}`;
  text(ctx, rProgress, px + 12, upY + 33, 9, canUp ? COL.integrity : COL.text3, "left", "600", 0.5);
  if (atMax) {
    text(ctx, "MAX", px + w - 12, upY + 22, 14, COL.text3, "right", "700");
  } else {
    text(ctx, `${refCost}`, px + w - 12, upY + 22, 15, canUp ? COL.charge : COL.text3, "right", "700");
    if (A.has("icons/charge")) blit(ctx, A.sprite("icons/charge"), px + w - 40, upY + 36, 12, 12);
  }
  clicks.push({ x: px, y: upY, w, h: upH, action: "upgrade", disabled: !canUp });

  // --- Inspector / next-wave info area ---
  const infoY = upY + upH + 12;
  const infoH = STAGE_H - 62 - infoY - 8;
  roundRect(ctx, px, infoY, w, infoH, 8);
  ctx.fillStyle = "rgba(255,255,255,0.02)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 1;
  ctx.stroke();

  const sel = game.selected();
  if (game.holding) drawHeldInfo(ctx, game, A, px + 14, infoY + 12, w - 28);
  else if (sel) drawInspector(ctx, game, sel, A, px + 14, infoY + 12, w - 28, clicks);
  else drawNextWave(ctx, game, A, px + 14, infoY + 12, w - 28);

  drawWaveControl(ctx, game, px, w, clicks);
}

// While a blank rock is on the cursor: no type/quality yet — it rolls only when it lands.
function drawHeldInfo(ctx: CanvasRenderingContext2D, game: Game, A: Assets, x: number, y: number, w: number): void {
  text(ctx, "PLACING ROCK", x, y + 6, 11, COL.charge, "left", "700", 1);
  if (A.blocker) {
    ctx.save();
    ctx.globalAlpha = 0.8;
    blit(ctx, A.blocker, x + 24, y + 44, 40, 40, 0);
    ctx.restore();
  }
  text(ctx, "?", x + 24, y + 44, 20, COL.spark, "center", "800");
  wrap(ctx, "Drop it on a legal spot — it rolls a RANDOM component type and quality the instant it lands. Esc / right-click cancels for free.", x, y + 82, w, 11, COL.text2, 15);
  text(ctx, `${game.stampsLeft()} / ${BUILDS_PER_LEVEL} ROCKS LEFT`, x, y + 150, 10, COL.text3, "left", "500", 0.5);
}

// The selected-piece inspector (specs/board.md, specs/build.md, specs/controls.md).
// A CANDIDATE offers KEEP / COMBINE (build phase); a COMPONENT offers the targeting cycle;
// a BLOCKER is inert (no stats, no actions).
function drawInspector(ctx: CanvasRenderingContext2D, game: Game, s: Structure, A: Assets, x: number, y: number, w: number, clicks: Clickable[]): void {
  if (s.kind === "blocker") {
    text(ctx, "INERT BLOCKER", x, y + 6, 14, COL.text2, "left", "700", 0.5);
    wrap(ctx, "A hardened scrap rock — it walls the Load's route but never fires. Drop a fresh rock onto it to reroll a new component.", x, y + 32, w, 11, COL.text2, 15);
    return;
  }

  const isCand = s.kind === "candidate";
  const stats = isCand ? deriveStats(s.type, s.tier) : game.statsOf(s);
  const typeC = COMPONENT_COLOR[s.type];

  const head = A.componentHead(s.type, s.tier);
  if (head) blit(ctx, head, x + 18, y + 20, 40, 40, 0);
  text(ctx, COMPONENT_LABEL[s.type], x + 44, y + 12, 13, typeC, "left", "700", 0.5);
  text(ctx, `${TIER_NAME[s.tier]} · ${ROMAN[s.tier]}`, x + 44, y + 28, 11, TIER_COLOR[s.tier], "left", "600", 0.5);
  text(ctx, isCand ? "UNCOMMITTED ROLL" : "HITS GROUND & AIR", x + 44, y + 42, 8, isCand ? COL.charge : COL.text3, "left", "500", 0.5);

  let row = y + 66;
  const line = (k: string, v: string, col: string = COL.text): void => {
    text(ctx, k, x, row, 11, COL.text3, "left", "500", 0.5);
    text(ctx, v, x + w, row, 12, col, "right", "700");
    row += 18;
  };
  line("DAMAGE", `${stats.dmg}`);
  line("RANGE", `${Math.round(stats.range)}`);
  line("FIRE RATE", `${stats.fireRate.toFixed(1)}/s`);
  if (stats.splash > 0) line("SPLASH", `${Math.round(stats.splash)}`, COL.arcnode);
  if (stats.chainLeaps > 0) line("CHAIN", `+${stats.chainLeaps} leaps`, COL.coil);
  if (!isCand) line("TARGET", TARGETING_LABEL[s.targeting], COL.integrity);

  const baseY = STAGE_H - 62 - 8; // just above the wave control

  if (isCand) {
    // The one keep-or-combine choice per level (specs/build.md). Reversible until SEND.
    const kept = game.keptId() === s.id;
    const half = (w - 8) / 2;
    const by = baseY - 30;
    // A status line above the buttons.
    if (kept) {
      const msg = game.harvest.mode === "combine" ? "COMBINING THIS LEVEL" : "KEPT THIS LEVEL";
      text(ctx, msg, x, by - 12, 10, COL.charge, "left", "700", 1);
    } else {
      text(ctx, "KEEP ONE ROLL PER LEVEL", x, by - 12, 10, COL.text3, "left", "600", 1);
    }
    const keepLabel = kept && game.harvest.mode === "keep" ? "KEEP ✓" : "KEEP";
    if (game.canCombine(s)) {
      const combLabel = kept && game.harvest.mode === "combine" ? "COMBINE ✓" : "COMBINE";
      button(ctx, clicks, x, by, half, 30, keepLabel, "keep", COL.charge, true);
      button(ctx, clicks, x + half + 8, by, half, 30, combLabel, "combine", TIER_COLOR[Math.min(MAX_TIER, s.tier + 1) as Tier], true);
    } else {
      button(ctx, clicks, x, by, w, 30, keepLabel, "keep", COL.charge, true);
    }
  } else {
    // A firing component: cycle its targeting priority (specs/towers.md).
    const cy = baseY - 26;
    button(ctx, clicks, x, cy, w, 26, `TARGET · ${TARGETING_LABEL[s.targeting]}`, "targeting", COL.integrity, true);
  }
}

// The next-wave preview (specs/enemies.md, specs/flow.md) — shown when nothing is selected.
function drawNextWave(ctx: CanvasRenderingContext2D, game: Game, A: Assets, x: number, y: number, w: number): void {
  const wv = game.nextWavePreview();
  text(ctx, "NEXT WAVE", x, y + 6, 11, COL.text3, "left", "700", 1);
  const label = wv.hasBoss ? `WAVE ${wv.wave} · BOSS` : `WAVE ${wv.wave}`;
  text(ctx, label, x, y + 26, 15, wv.hasBoss ? COL.boss : COL.text, "left", "700", 0.5);

  // Count each type in the coming wave.
  const counts = new Map<LoadType, number>();
  for (const e of wv.events) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);

  let row = y + 48;
  for (const t of wv.types) {
    const def = LOAD[t];
    if (A.has(LOAD_ICON[t])) blit(ctx, A.sprite(LOAD_ICON[t]), x + 9, row + 7, 18, 18);
    text(ctx, def.label, x + 24, row + 7, 11, t === "dynamo" ? COL.boss : COL.text2, "left", "600", 0.5);
    const n = counts.get(t) ?? 0;
    text(ctx, n > 1 ? `×${n}` : def.flies ? "FLYER" : "", x + w, row + 7, 10, COL.text3, "right", "500");
    row += 22;
  }
}

// The wave control: START the opening wave / SEND the next one when ready (build phases are
// untimed — no countdown, specs/flow.md) + a speed toggle. During a live wave it reads the
// wave progress instead.
function drawWaveControl(ctx: CanvasRenderingContext2D, game: Game, px: number, w: number, clicks: Clickable[]): void {
  const y = STAGE_H - 62;
  const h = 46;
  if (game.phase === "build") {
    const speedW = 52;
    const sendW = w - speedW - 8;
    const label = game.wave === 0 ? "START" : "SEND";
    roundRect(ctx, px, y, sendW, h, 8);
    ctx.fillStyle = hexA(COL.charge, 0.92);
    ctx.fill();
    text(ctx, label, px + sendW / 2, y + h / 2 + 1, 15, COL.void, "center", "800", 1);
    clicks.push({ x: px, y, w: sendW, h, action: "startWave" });
    // Speed toggle (alternative to the status bar's, specs/board.md).
    roundRect(ctx, px + sendW + 8, y, speedW, h, 8);
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.lineWidth = 1;
    ctx.stroke();
    text(ctx, `${game.speed}×`, px + sendW + 8 + speedW / 2, y + h / 2 + 1, 15, COL.text, "center", "700");
    clicks.push({ x: px + sendW + 8, y, w: speedW, h, action: "speed" });
  } else {
    roundRect(ctx, px, y, w, h, 8);
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.lineWidth = 1;
    ctx.stroke();
    text(ctx, `WAVE ${game.wave} · ${Math.round(game.waveProgress() * 100)}%`, px + w / 2, y + h / 2 + 1, 14, COL.text2, "center", "700", 1);
  }
}

// ---- title --------------------------------------------------------------------

function drawTitle(ctx: CanvasRenderingContext2D, game: Game, A: Assets, clicks: Clickable[]): void {
  // A dim slice of yard behind the menu for atmosphere.
  if (A.has("board/substrate")) {
    if (!substratePattern) {
      ctx.imageSmoothingEnabled = false;
      substratePattern = ctx.createPattern(A.sprite("board/substrate"), "repeat");
    }
    if (substratePattern) {
      ctx.save();
      ctx.globalAlpha = 0.25;
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = substratePattern;
      ctx.fillRect(0, 0, STAGE_W, STAGE_H);
      ctx.restore();
    }
  }

  const grad = ctx.createLinearGradient(360, 0, 920, 0);
  grad.addColorStop(0, COL.capacitor);
  grad.addColorStop(0.4, COL.coil);
  grad.addColorStop(0.7, COL.arcnode);
  grad.addColorStop(1, COL.charge);
  ctx.save();
  ctx.shadowColor = COL.arc;
  ctx.shadowBlur = 26;
  ctx.font = `800 88px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = grad;
  drawSpaced(ctx, "ARC FOUNDRY", STAGE_W / 2, 230, 88, 12);
  ctx.restore();
  text(ctx, game.campaign.tagline, STAGE_W / 2, 300, 15, COL.text2, "center", "500", 6);

  const items = menuItems("title", game);
  items.forEach((it, i) => {
    const y = 410 + i * 62;
    const on = highlighted(game, i, STAGE_W / 2 - 200, y - 26, 400, 52);
    text(ctx, it.label, STAGE_W / 2, y, 28, on ? COL.charge : COL.text, "center", "700", 6);
    if (on) {
      text(ctx, "▶", STAGE_W / 2 - 190, y, 20, COL.charge, "center", "700");
      text(ctx, "◀", STAGE_W / 2 + 190, y, 20, COL.charge, "center", "700");
    }
    clicks.push({ x: STAGE_W / 2 - 200, y: y - 26, w: 400, h: 52, action: it.action });
  });
  text(ctx, "↑↓ SELECT   ENTER CONFIRM   MOUSE OK", STAGE_W / 2, 660, 13, COL.text3, "center", "500", 4);
}

// ---- map select ---------------------------------------------------------------

function drawMapPreview(ctx: CanvasRenderingContext2D, map: MapDef, x: number, y: number, w: number, h: number): void {
  ctx.save();
  roundRect(ctx, x, y, w, h, 8);
  ctx.fillStyle = COL.substrate;
  ctx.fill();
  ctx.clip();
  const sx = (c: number) => x + ((c + 0.5) / GRID_COLS) * w;
  const sy = (r: number) => y + ((r + 0.5) / GRID_ROWS) * h;

  // Fixed housings (Map C).
  for (const hh of map.housings) {
    ctx.fillStyle = hexA(COL.housing, 0.9);
    ctx.fillRect(sx(hh.col0) - 2, sy(hh.row0) - 2, (hh.col1 - hh.col0 + 1) * (w / GRID_COLS), (hh.row1 - hh.row0 + 1) * (h / GRID_ROWS));
  }

  const chain = [map.entry, ...map.waypoints, map.collector];
  ctx.strokeStyle = hexA(COL.flow, 0.9);
  ctx.lineWidth = 2.5;
  ctx.lineJoin = "round";
  ctx.beginPath();
  chain.forEach((t, i) => (i === 0 ? ctx.moveTo(sx(t.col), sy(t.row)) : ctx.lineTo(sx(t.col), sy(t.row))));
  ctx.stroke();

  // Waypoint dots.
  chain.forEach((t, i) => {
    if (i === 0) ctx.fillStyle = COL.entry;
    else if (i === chain.length - 1) ctx.fillStyle = COL.collector;
    else ctx.fillStyle = COL.integrity;
    ctx.beginPath();
    ctx.arc(sx(t.col), sy(t.row), i === 0 || i === chain.length - 1 ? 4 : 3, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();

  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  roundRect(ctx, x, y, w, h, 8);
  ctx.stroke();
}

function drawMapSelect(ctx: CanvasRenderingContext2D, game: Game, A: Assets, clicks: Clickable[]): void {
  void A;
  ctx.fillStyle = COL.void;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
  text(ctx, "SELECT MAP", STAGE_W / 2, 66, 32, COL.text, "center", "700", 6);
  text(ctx, "EVERY MAP PLAYS THE SAME CAMPAIGN — ONLY THE TOPOLOGY DIFFERS", STAGE_W / 2, 104, 12, COL.text3, "center", "500", 2);

  const n = MAPS.length;
  const cardW = 356;
  const gap = 28;
  const total = n * cardW + (n - 1) * gap;
  const x0 = (STAGE_W - total) / 2;
  const cardY = 150;
  const cardH = 402;

  MAPS.forEach((map, i) => {
    const x = x0 + i * (cardW + gap);
    const on = highlighted(game, i, x, cardY, cardW, cardH);
    roundRect(ctx, x, cardY, cardW, cardH, 12);
    ctx.fillStyle = on ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.02)";
    ctx.fill();
    ctx.strokeStyle = on ? COL.charge : "rgba(255,255,255,0.10)";
    ctx.lineWidth = on ? 2.5 : 1;
    ctx.stroke();

    drawMapPreview(ctx, map, x + 18, cardY + 18, cardW - 36, 210);
    text(ctx, map.name, x + 20, cardY + 254, 22, on ? COL.charge : COL.text, "left", "800", 1);
    text(ctx, map.styleLabel, x + 20, cardY + 282, 11, COL.integrity, "left", "700", 2);
    wrap(ctx, map.blurb, x + 20, cardY + 308, cardW - 40, 12, COL.text3, 17);

    clicks.push({ x, y: cardY, w: cardW, h: cardH, action: `map:${map.id}` });
  });

  const bx = STAGE_W / 2 - 90;
  const byy = cardY + cardH + 24;
  const onBack = highlighted(game, MAPS.length, bx, byy, 180, 42);
  button(ctx, clicks, bx, byy, 180, 42, "BACK", "menu:back", onBack ? COL.charge : COL.text, true);
  text(ctx, "↑↓ / ← → SELECT   ENTER CONFIRM   MOUSE OK", STAGE_W / 2, STAGE_H - 22, 12, COL.text3, "center", "500", 2);
}

// ---- difficulty select --------------------------------------------------------

function drawDifficultySelect(ctx: CanvasRenderingContext2D, game: Game, clicks: Clickable[]): void {
  ctx.fillStyle = COL.void;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
  text(ctx, "SELECT DIFFICULTY", STAGE_W / 2, 66, 32, COL.text, "center", "700", 6);
  text(ctx, "DIFFICULTY CHANGES ONLY THE WAVE COUNT AND ENEMY TOUGHNESS", STAGE_W / 2, 104, 12, COL.text3, "center", "500", 2);

  const order = DIFFICULTY_ORDER;
  const cardW = 320;
  const gap = 30;
  const total = order.length * cardW + (order.length - 1) * gap;
  const x0 = (STAGE_W - total) / 2;
  const cardY = 170;
  const cardH = 340;
  const accents: Record<Difficulty, string> = { easy: COL.legal, medium: COL.charge, hard: COL.alert };

  order.forEach((key, i) => {
    const d = DIFFICULTY[key];
    const x = x0 + i * (cardW + gap);
    const on = highlighted(game, i, x, cardY, cardW, cardH);
    const ac = accents[key];
    roundRect(ctx, x, cardY, cardW, cardH, 12);
    ctx.fillStyle = on ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.02)";
    ctx.fill();
    ctx.strokeStyle = on ? ac : "rgba(255,255,255,0.10)";
    ctx.lineWidth = on ? 2.5 : 1;
    ctx.stroke();

    text(ctx, d.label, x + cardW / 2, cardY + 54, 34, on ? ac : COL.text, "center", "800", 4);
    text(ctx, `${d.waves} WAVES`, x + cardW / 2, cardY + 110, 20, COL.text, "center", "700", 2);
    text(ctx, "ENEMY TOUGHNESS", x + cardW / 2, cardY + 156, 10, COL.text3, "center", "600", 1);
    text(ctx, `BASE ×${d.baseMult.toFixed(2)}`, x + cardW / 2, cardY + 180, 14, COL.text2, "center", "600", 1);
    text(ctx, `RAMP +${Math.round(d.k * 100)}% / WAVE`, x + cardW / 2, cardY + 204, 14, COL.text2, "center", "600", 1);
    text(ctx, `BOSS WAVES ${d.milestones.join(" · ")}`, x + cardW / 2, cardY + 236, 11, COL.boss, "center", "600", 1);
    wrap(ctx, d.note, x + 22, cardY + 272, cardW - 44, 12, COL.text3, 17);

    clicks.push({ x, y: cardY, w: cardW, h: cardH, action: `diff:${key}` });
  });

  const bx = STAGE_W / 2 - 90;
  const byy = cardY + cardH + 26;
  const onBack = highlighted(game, order.length, bx, byy, 180, 42);
  button(ctx, clicks, bx, byy, 180, 42, "BACK", "menu:back", onBack ? COL.charge : COL.text, true);
  text(ctx, "↑↓ / ← → SELECT   ENTER CONFIRM   MOUSE OK", STAGE_W / 2, STAGE_H - 22, 12, COL.text3, "center", "500", 2);
}

// ---- how to play --------------------------------------------------------------

function drawHowto(ctx: CanvasRenderingContext2D, clicks: Clickable[]): void {
  ctx.fillStyle = COL.void;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
  text(ctx, "HOW TO PLAY", STAGE_W / 2, 56, 30, COL.text, "center", "700", 4);
  const lines: [string, string][] = [
    ["GOAL", "The Load spills from the feeder vent and crawls to the grounding collector. Every unit that grounds out costs Grid Integrity; at 0 the grid overloads and you lose. Clear all the waves with integrity left to win."],
    ["THE MAZE", "Every component, candidate, AND blocker is a 2×2 WALL. The Load must reach each ordered 4-tile waypoint PLATFORM in sequence, taking the shortest OPEN route around your walls — so building lengthens its route. You cannot build on a platform and can never fully seal a segment (a sealing placement is refused); the floor re-paths live as walls change."],
    ["THE SCRAP-PRESS", "You do not buy towers. Pull the press (B / STAMP) to arm a BLANK rock, then drop it on a legal spot — the instant it lands it ROLLS a random component type and quality (weighted low). Place up to 5 rocks per level, 10 Charge each; keep placing back-to-back until the allowance or Charge runs out."],
    ["KEEP ONE PER LEVEL", "Select a placed rock and KEEP (K) exactly ONE per level to make it a firing tower — every rock you don't keep hardens into an inert BLOCKER. Or COMBINE (C) two same-TYPE + same-QUALITY rolls into one a tier higher, which counts as the level's keep. Choose KEEP or COMBINE, then SEND: the mobs enter."],
    ["UPGRADE QUALITY", "Spend Charge on UPGRADE QUALITY (U) to raise your Refinement level R0→R5, biasing every future roll toward the higher tiers of the ladder Scrap→Tuned→Charged→Primed→Tesla-Prime. Refinement is the odds; combining is the direct climb."],
    ["COMPONENTS", "Capacitor (single bolt), Coil (chain-lightning), Emitter (rapid spark), Arc-Node (area discharge), Discharge Rig (heavy long-range bolt). All hit ground and air. Select one to read its stats and cycle its TARGET (T). The Filament flies and ignores the maze — air only arrives every 4th wave."],
    ["ECONOMY", "Kills pay Charge bounty; clearing a wave pays a bonus; banked Charge earns interest each build phase. Build phases are UNTIMED — take your time, then SEND when ready. There is no selling."],
    ["CONTROLS", "B stamp · click place · click select · K keep · C combine · U upgrade quality · T target · SPACE start/send wave then in-place pause · F speed 1×/2× · Esc cancel then pause menu · M mute."],
  ];
  let y = 100;
  for (const [k, v] of lines) {
    text(ctx, k, 120, y, 13, COL.integrity, "left", "700", 1);
    y = wrap(ctx, v, 300, y, 840, 13, COL.text2, 18) + 8;
  }
  const bx = STAGE_W / 2 - 90;
  button(ctx, clicks, bx, STAGE_H - 60, 180, 42, "BACK", "menu:back", COL.text, true);
}

// ---- overlays -----------------------------------------------------------------

function drawPauseMenu(ctx: CanvasRenderingContext2D, game: Game, clicks: Clickable[]): void {
  dim(ctx);
  panelBox(ctx, 440, 200, 400, 320);
  text(ctx, "PAUSED", STAGE_W / 2, 252, 30, COL.text, "center", "700", 4);
  menuButtons(ctx, game, menuItems("paused", game), 320, 56, 260, clicks);
}

function drawEnd(ctx: CanvasRenderingContext2D, game: Game, clicks: Clickable[], won: boolean): void {
  dim(ctx);
  panelBox(ctx, 400, 170, 480, 380);
  text(ctx, won ? "CONTAINMENT HELD" : "GRID OVERLOAD", STAGE_W / 2, 222, 14, won ? COL.integrity : COL.alert, "center", "700", 3);
  text(ctx, won ? "VICTORY" : "OVERLOAD", STAGE_W / 2, 272, 42, won ? COL.charge : COL.alert, "center", "800", 4);
  if (won) {
    text(ctx, `ALL ${game.diff.waves} WAVES SURVIVED`, STAGE_W / 2, 332, 18, COL.text, "center", "600", 2);
    text(ctx, `GRID INTEGRITY ${Math.max(0, Math.floor(game.integrity))}`, STAGE_W / 2, 362, 14, COL.integrity, "center", "500", 1);
  } else {
    text(ctx, `REACHED WAVE ${game.wave} / ${game.diff.waves}`, STAGE_W / 2, 340, 20, COL.text, "center", "600", 2);
  }
  text(ctx, `SCORE ${game.score.toLocaleString()}`, STAGE_W / 2, 398, 15, COL.text2, "center", "500", 1);

  const items = menuItems(won ? "victory" : "defeat", game);
  const xs = [STAGE_W / 2 - 170, STAGE_W / 2 + 10];
  items.forEach((it, i) => {
    const on = highlighted(game, i, xs[i]!, 452, 160, 46);
    button(ctx, clicks, xs[i]!, 452, 160, 46, it.label, it.action, on ? COL.charge : COL.text, true);
  });
}

function menuButtons(ctx: CanvasRenderingContext2D, game: Game, items: MenuItem[], y0: number, gap: number, w: number, clicks: Clickable[]): void {
  const x = STAGE_W / 2 - w / 2;
  items.forEach((it, i) => {
    const y = y0 + i * gap;
    const on = highlighted(game, i, x, y, w, 44);
    button(ctx, clicks, x, y, w, 44, it.label, it.action, on ? COL.charge : COL.text, true);
  });
}

function highlighted(game: Game, i: number, x: number, y: number, w: number, h: number): boolean {
  return menuIndex === i || inRect(game.pointerX, game.pointerY, x, y, w, h);
}

function dim(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = "rgba(5,8,12,0.72)";
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
}

function panelBox(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.5)";
  ctx.shadowBlur = 30;
  roundRect(ctx, x, y, w, h, 14);
  ctx.fillStyle = COL.panel;
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  roundRect(ctx, x, y, w, h, 14);
  ctx.stroke();
}
