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
  COMBOS,
  COMBO_ORDER,
  COMPONENT_COLOR,
  COMPONENT_DESC,
  COMPONENT_LABEL,
  DIFFICULTY,
  DIFFICULTY_ORDER,
  FONT,
  type ComboDef,
  FOOTPRINT_PX,
  GRID_COLS,
  GRID_ROWS,
  GRID_X0,
  GRID_Y0,
  LOAD,
  LOAD_DESC,
  MAPS,
  MAX_COMBO_LEVEL,
  MAX_TIER,
  PANEL_X,
  QUALITY_ODDS_BY_R,
  STAGE_H,
  STAGE_W,
  STATUS_H,
  TARGETING_LABEL,
  TIER_NAME,
  TILE,
  comboStats,
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
  ComponentType,
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
// Player-toggled HUD overlays (specs/controls.md): the COMBOS recipe book and the live tower
// DAMAGE BOARD. Held in the loop (main.ts) and pushed in each frame — they are view-only.
let showCombos = false;
let showBoard = false;
// While the DAMAGE BOARD is open and the pointer hovers one of its rows, the id of that
// tower — every OTHER piece on the yard is then drawn in grayscale so the hovered tower is
// unmistakable (specs/controls.md). Recomputed each frame before the board is drawn.
let boardFocusId: number | null = null;

export function setRenderTime(t: number): void {
  time = t;
}
export function setMenuIndex(i: number): void {
  menuIndex = i;
}
export function setMuted(m: boolean): void {
  muted = m;
}
export function setOverlays(combos: boolean, board: boolean): void {
  showCombos = combos;
  showBoard = board;
}

// The quality ladder's per-tier accent (specs/overview.md) — the SECOND, non-color read of
// quality (beside the escalating head finish + VFX): a tier ring and a Roman badge.
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

// A hover tooltip queued during panel drawing (e.g. an enemy name in the next-wave list),
// drawn last so it floats above everything on the board (specs/enemies.md).
let pendingTooltip: { title: string; body: string; color: string; y: number } | null = null;

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

// Break a string into lines that each fit `maxW` at `size`, for measuring before drawing.
function wrapLines(ctx: CanvasRenderingContext2D, s: string, maxW: number, size: number): string[] {
  ctx.font = `400 ${size}px ${FONT}`;
  const words = s.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

// Draw the queued hover tooltip (an enemy description) as a floating card to the LEFT of the
// build panel, clamped inside the stage (specs/enemies.md).
function drawTooltip(ctx: CanvasRenderingContext2D): void {
  if (!pendingTooltip) return;
  const { title, body, color } = pendingTooltip;
  const boxW = 250;
  const pad = 12;
  const bodyLines = wrapLines(ctx, body, boxW - pad * 2, 11);
  const h = pad + 16 + 6 + bodyLines.length * 15 + pad - 4;
  const bx = PANEL_X - boxW - 14;
  const by = Math.max(STATUS_H + 8, Math.min(STAGE_H - h - 8, pendingTooltip.y - h / 2));
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 18;
  roundRect(ctx, bx, by, boxW, h, 10);
  ctx.fillStyle = "rgba(12,17,24,0.97)";
  ctx.fill();
  ctx.restore();
  roundRect(ctx, bx, by, boxW, h, 10);
  ctx.strokeStyle = hexA(color, 0.6);
  ctx.lineWidth = 1.5;
  ctx.stroke();
  text(ctx, title, bx + pad, by + pad + 6, 13, color, "left", "800", 0.5);
  let yy = by + pad + 24;
  for (const ln of bodyLines) {
    text(ctx, ln, bx + pad, yy, 11, COL.text2, "left", "400");
    yy += 15;
  }
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
    drawHowto(ctx, game, clicks);
    return clicks;
  }

  // The live board (also seen frozen behind the pause menu / end screens).
  pendingTooltip = null; // recomputed each frame during panel drawing
  // If the DAMAGE BOARD is open and the pointer is over one of its rows, spotlight that tower
  // by graying out every other piece (computed before the board draws — specs/controls.md).
  boardFocusId = game.state === "playing" && showBoard ? leaderboardHoverId(game) : null;
  drawBoard(ctx, game, A);
  drawUnits(ctx, game, A);
  drawProjectiles(ctx, game, A);
  bursts.draw(ctx);
  drawBuildCursor(ctx, game, A);
  // Waypoint index numbers are drawn LAST of the board layer so towers / rocks / units never
  // render over them (specs/board.md — the ordered chain must always read).
  drawWaypointNumbers(ctx, game.board.chain);
  drawStatusBar(ctx, game, A, clicks);
  drawPanel(ctx, game, A, clicks);
  drawTooltip(ctx);

  // Player-toggled HUD overlays sit above the board / panel but below the modal menus.
  if (game.state === "playing" && showCombos) drawCombosBook(ctx, game, clicks);
  if (game.state === "playing" && showBoard) drawLeaderboard(ctx, game, clicks);

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
    const st = game.statsOf(sel);
    const col = sel.combo ? COMBOS[sel.combo].color : COMPONENT_COLOR[sel.type];
    if (st.fires && st.range > 0) drawRange(ctx, ctr.x, ctr.y, st.range, col);
    // A Regulator or an aura combo also previews its aura RADIUS in the support color.
    if (st.auraRadius > 0) drawAuraRange(ctx, ctr.x, ctr.y, st.auraRadius);
  } else if (sel && sel.kind === "candidate") {
    const ctr = footprintCenter(sel.col, sel.row);
    const st = deriveStats(sel.type, sel.tier);
    if (st.range > 0) drawRange(ctx, ctr.x, ctr.y, st.range, COMPONENT_COLOR[sel.type]);
    if (st.auraRadius > 0) drawAuraRange(ctx, ctr.x, ctr.y, st.auraRadius);
  }

  // The maze: firing components, this-level candidates, and inert blockers — every piece is
  // a 2×2 wall (specs/board.md). When a DAMAGE BOARD row is hovered, every piece EXCEPT the
  // hovered tower is drawn grayscale so the leaderboard tower stands out (specs/controls.md).
  for (const s of game.structures) {
    const dim = boardFocusId !== null && s.id !== boardFocusId;
    if (dim) {
      ctx.save();
      ctx.filter = "grayscale(1) brightness(0.72)";
    }
    if (s.kind === "component") drawComponent(ctx, game, s, A);
    else if (s.kind === "candidate") drawCandidate(ctx, game, s, A);
    else drawBlocker(ctx, game, s, A);
    if (dim) ctx.restore();
  }

  // Pulse the pieces that will FOLD TOGETHER for this level's harvest (specs/build.md) so the
  // player can see exactly what merges — drawn over the pieces so it always reads.
  drawMergePulses(ctx, game);
}

// A pulsing marker on the pieces that can combine (specs/build.md). AMBIENT layer: every piece
// that could fold into some combine right now pulses softly AT ALL TIMES — the pulse's job is to
// announce, unprompted, that combines are available and which pieces can merge, so it must not
// wait on a selection. FOCUSED layer: once a base piece is selected, the exact set it will fold
// (its quality match + reachable combo ingredients, or the explicit multi-select) pulses brighter
// on top — committed sets in the gold combo accent, an uncommitted selection in the charge accent.
function drawMergePulses(ctx: CanvasRenderingContext2D, game: Game): void {
  const byId = new Map<number, Structure>();
  for (const s of game.structures) byId.set(s.id, s);
  const markOne = (id: number, accent: string, primary: boolean, ambient: boolean): void => {
    const s = byId.get(id);
    if (!s) return;
    const ctr = footprintCenter(s.col, s.row);
    const half = FOOTPRINT_PX / 2;
    // The ambient layer breathes slower and softer than the focused one so it reads as a hint,
    // not a commitment.
    const pulse = ambient ? 0.5 + 0.5 * Math.sin(time * 3) : 0.5 + 0.5 * Math.sin(time * 6);
    const grow = (primary ? 4 : 3) + 3 * pulse;
    ctx.save();
    // A soft glow, then a pulsing rounded ring hugging the 2×2 footprint.
    glow(ctx, ctr.x, ctr.y, half + 12 + 6 * pulse, accent, (ambient ? 0.05 : 0.12) + (ambient ? 0.07 : 0.14) * pulse);
    roundRect(ctx, ctr.x - half - grow, ctr.y - half - grow, (half + grow) * 2, (half + grow) * 2, 6);
    ctx.strokeStyle = hexA(accent, (ambient ? 0.22 : 0.5) + (ambient ? 0.22 : 0.45) * pulse);
    ctx.lineWidth = ambient ? 1.5 : primary ? 2.5 : 2;
    ctx.setLineDash(ambient ? [5, 4] : []);
    ctx.stroke();
    ctx.restore();
  };

  // Ambient: pulse everything that could combine, skipping the pieces the focused layer will
  // draw brighter so they don't muddy each other.
  const mh = game.mergeHighlight();
  const focused = new Set<number>(mh.partnerIds);
  if (mh.primaryId != null) focused.add(mh.primaryId);
  for (const id of game.combinablePieces()) if (!focused.has(id)) markOne(id, COL.charge, false, true);

  // Focused: the selection's exact fold, on top.
  if (mh.primaryId == null && mh.partnerIds.size === 0) return;
  const accent = mh.committed ? COL.combo : COL.charge;
  if (mh.primaryId != null) markOne(mh.primaryId, accent, true, false);
  for (const id of mh.partnerIds) markOne(id, accent, false, false);
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
      // Ordered waypoint pylon (its index number is drawn later, on top of everything).
      if (A.has("board/pylon")) blit(ctx, A.sprite("board/pylon"), p.x, p.y, 22, 22);
      else ring(ctx, p.x, p.y, 8, COL.flow, 0.8);
    }
  }
}

// The waypoint index badges, drawn LAST (after the maze / units) so a placed tower or a
// walking unit can never obscure the ordered chain (specs/board.md). Each interior waypoint
// gets a small pill with its 1-based order number.
function drawWaypointNumbers(ctx: CanvasRenderingContext2D, chain: { col: number; row: number }[]): void {
  for (let i = 1; i < chain.length - 1; i++) {
    const p = tileCenter(chain[i]!.col, chain[i]!.row);
    const bx = p.x;
    const by = p.y - 15;
    ctx.save();
    roundRect(ctx, bx - 8, by - 7, 16, 14, 4);
    ctx.fillStyle = "rgba(5,8,12,0.82)";
    ctx.fill();
    ctx.strokeStyle = hexA(COL.integrity, 0.7);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
    text(ctx, `${i}`, bx, by + 0.5, 10, COL.integrity, "center", "800");
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

// ---- code-drawn fallbacks (so the game is fully playable before new art lands) ----------
// Every produced-sprite lookup below has a code fallback in the piece's accent, so a type or
// combo with no PNG yet still reads at a glance (specs/assets.md — art is produced during a
// run; the reference build must stand on its own until it is).

// A simple base plate in the type/combo accent, drawn under a code head when no base sprite
// exists.
function codeBasePlate(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, color: string): void {
  ctx.save();
  ctx.fillStyle = hexA(color, 0.16);
  roundRect(ctx, cx - size / 2 + 3, cy - size / 2 + 3, size - 6, size - 6, 5);
  ctx.fill();
  ctx.strokeStyle = hexA(color, 0.5);
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}

// A rotating firing head (a barrel + core) in the accent — the code stand-in for a produced
// head sprite. Angle 0 points right, matching the produced heads.
function codeHead(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, angle: number, color: string): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.fillStyle = hexA(color, 0.9);
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = hexA(color, 0.85);
  roundRect(ctx, size * 0.05, -size * 0.09, size * 0.4, size * 0.18, 3);
  ctx.fill();
  ctx.fillStyle = hexA(COL.spark, 0.75);
  ctx.fillRect(size * 0.4, -size * 0.05, size * 0.08, size * 0.1);
  ctx.restore();
}

// The Regulator's read: a pulsing hex support core with NO barrel — it must never look like it
// shoots (specs/towers.md — a non-firing buff node).
function supportCore(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, color: string): void {
  const pulse = 0.5 + 0.5 * Math.sin(time * 4);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
    const r = size * 0.28;
    const px = Math.cos(a) * r;
    const py = Math.sin(a) * r;
    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = hexA(color, 0.45 + 0.2 * pulse);
  ctx.fill();
  ctx.strokeStyle = hexA(color, 0.9);
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = hexA(COL.spark, 0.55 + 0.3 * pulse);
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// A faint aura pulse ring drawn ON the board around an aura source (Regulator / aura combo), so
// its support role reads without cluttering — the full aura RADIUS shows only when selected.
function auraPulse(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  const pulse = 0.5 + 0.5 * Math.sin(time * 3);
  ring(ctx, cx, cy, size / 2 + 4 + pulse * 2, COL.regulator, 0.3 + 0.25 * pulse, 1.5);
}

// The full aura RADIUS ring (support color, dashed) — shown when an aura tower is selected, so
// the player sees exactly which towers a Regulator / aura combo buffs (specs/towers.md).
function drawAuraRange(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.save();
  ctx.strokeStyle = hexA(COL.regulator, 0.7);
  ctx.fillStyle = hexA(COL.regulator, 0.05);
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

// The gold combo badge — a COL.combo diamond with the combo's initial, so a combination tower
// reads instantly as a special TERMINAL tower, never a tiered base component (no pips/Roman).
function comboBadge(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, initial: string): void {
  const bx = cx - size / 2 + 9;
  const by = cy - size / 2 + 9;
  ctx.save();
  ctx.translate(bx, by);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = hexA(COL.combo, 0.95);
  roundRect(ctx, -7, -7, 14, 14, 2);
  ctx.fill();
  ctx.strokeStyle = hexA("#05080c", 0.6);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
  text(ctx, initial, bx, by + 0.5, 9, COL.void, "center", "800");
}

// The one-line ability tag list for a combo recipe preview (splash·burn·crit …).
function abilityTags(def: ComboDef): string {
  const t: string[] = [];
  if (def.splash > 0) t.push("splash");
  if (def.chainLeaps > 0) t.push("chain");
  if (def.slowAmt > 0) t.push("slow");
  if (def.burnFrac > 0) t.push("burn");
  if (def.critChance > 0) t.push("crit");
  if (def.multishot > 1) t.push("multi");
  if (def.auraRadius > 0) t.push("aura");
  return t.join("·");
}

// A single component: fixed base + rotatable per-tier head, the tier finish escalating each
// rung (glow, an at-rest arc from Primed up), the firing cycle when it just fired, plus a
// glanceable quality read — a tier ring and a Roman badge (specs/towers.md). A
// combination tower (c.combo set) is drawn distinctly by drawComboTower; the Regulator draws a
// non-firing support core instead of a gun head.
function drawComponent(ctx: CanvasRenderingContext2D, game: Game, c: Component, A: Assets): void {
  const ctr = footprintCenter(c.col, c.row);
  const size = FOOTPRINT_PX;

  // A COMBINATION TOWER reads as its own special tower, not a tiered base component.
  if (c.combo) {
    drawComboTower(ctx, game, c, A, ctr, size);
    return;
  }

  const tierC = TIER_COLOR[c.tier];
  const typeC = COMPONENT_COLOR[c.type];
  const nonFiring = c.type === "regulator"; // the support node never fires

  // Type-coded mount ring beneath the base.
  ring(ctx, ctr.x, ctr.y, size / 2 - 2, typeC, 0.5, 2);

  // Tier finish glow (escalates every rung).
  glow(ctx, ctr.x, ctr.y, 12 + c.tier * 4, tierC, 0.12 + 0.05 * c.tier);

  const base = A.componentBase(c.type);
  if (base) blit(ctx, base, ctr.x, ctr.y, size, size, 0);
  else codeBasePlate(ctx, ctr.x, ctr.y, size, typeC);

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

  if (nonFiring) {
    // Regulator: a support core (NO gun head) + a faint aura pulse — it never shoots, it buffs.
    supportCore(ctx, ctr.x, ctr.y, size, typeC);
    auraPulse(ctx, ctr.x, ctr.y, size);
  } else {
    const head = A.componentHead(c.type, c.tier);
    if (head) blit(ctx, head, ctr.x, ctr.y, size, size, c.aimAngle);
    else codeHead(ctx, ctr.x, ctr.y, size, c.aimAngle, typeC);
    // Choke reads icy (slow / EM-drag); Rectifier reads ember (overcurrent burn).
    if (c.type === "choke") ring(ctx, ctr.x, ctr.y, size / 2 - 4, COL.choke, 0.35 + 0.2 * Math.sin(time * 3 + c.id), 1);
    else if (c.type === "rectifier") glow(ctx, ctr.x, ctr.y, 10, COL.rectifier, 0.16 + 0.12 * (0.5 + 0.5 * Math.sin(time * 9 + c.id)));

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
  }

  // Selection outline.
  if (game.selectedId === c.id) {
    ctx.strokeStyle = COL.text;
    ctx.lineWidth = 2;
    roundRect(ctx, ctr.x - size / 2, ctr.y - size / 2, size, size, 5);
    ctx.stroke();
  }

  // Quality read: a tier ring plus a Roman badge (the non-color second read). The Roman
  // numeral already states the tier, so no redundant tier pips are drawn (declutter).
  ring(ctx, ctr.x, ctr.y, size / 2 - 1, tierC, 0.85, 1.5);
  // Roman badge in a chip at the top-left of the footprint.
  const bx = ctr.x - size / 2 + 2;
  const by = ctr.y - size / 2 + 2;
  const bw = 6 + ROMAN[c.tier].length * 5;
  roundRect(ctx, bx, by, bw, 11, 3);
  ctx.fillStyle = hexA("#05080c", 0.75);
  ctx.fill();
  text(ctx, ROMAN[c.tier], bx + bw / 2, by + 6, 8, tierC, "center", "800");
}

// A COMBINATION TOWER (specs/towers.md, specs/build.md): a single-grade, terminal tower with
// its own accent + a gold combo badge and a rotating head (combos fire). No quality tier is
// drawn (no pips / Roman). An aura combo also shows the faint on-board aura pulse.
function drawComboTower(ctx: CanvasRenderingContext2D, game: Game, c: Component, A: Assets, ctr: { x: number; y: number }, size: number): void {
  const def = COMBOS[c.combo!];
  const comboC = def.color;
  const stats = game.statsOf(c);

  // A bright accent mount + a gold shimmer, so it reads as a keystone tower.
  ring(ctx, ctr.x, ctr.y, size / 2 - 2, comboC, 0.6, 2.5);
  glow(ctx, ctr.x, ctr.y, 18, comboC, 0.2);
  glow(ctx, ctr.x, ctr.y, 12, COL.combo, 0.12 + 0.06 * (0.5 + 0.5 * Math.sin(time * 3 + c.id)));

  const base = A.comboBase(c.combo!);
  if (base) blit(ctx, base, ctr.x, ctr.y, size, size, 0);
  else {
    // Code-drawn octagonal base plate in the combo accent.
    ctx.save();
    ctx.translate(ctr.x, ctr.y);
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const r = size / 2 - 3;
      i === 0 ? ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r) : ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fillStyle = hexA(comboC, 0.22);
    ctx.fill();
    ctx.strokeStyle = hexA(comboC, 0.7);
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  // Combos are always "charged" — a couple of slow at-rest arcs.
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.strokeStyle = hexA(COL.combo, 0.4);
  ctx.lineWidth = 1;
  for (let k = 0; k < 3; k++) {
    const a0 = (k / 3) * Math.PI * 2 + time * 2.2;
    ctx.beginPath();
    ctx.moveTo(ctr.x + Math.cos(a0) * 6, ctr.y + Math.sin(a0) * 6);
    ctx.lineTo(ctr.x + Math.cos(a0 + 1.1) * (size / 2 - 3), ctr.y + Math.sin(a0 + 1.1) * (size / 2 - 3));
    ctx.stroke();
  }
  ctx.restore();

  // Rotating head (combos fire) — produced sprite if present, else a code head in the accent.
  const head = A.comboHead(c.combo!);
  if (head) blit(ctx, head, ctr.x, ctr.y, size, size, c.aimAngle);
  else codeHead(ctx, ctr.x, ctr.y, size, c.aimAngle, comboC);

  // Firing cycle overlay right after a shot.
  const fire = A.comboFire(c.combo!);
  if (fire.length && c.fireAnim < 0.22) {
    const idx = Math.min(fire.length - 1, Math.floor((c.fireAnim / 0.22) * fire.length));
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.9;
    blit(ctx, fire[idx]!, ctr.x, ctr.y, size, size, c.aimAngle);
    ctx.restore();
  }

  // An aura combo shows the same on-board support pulse a Regulator does.
  if (stats.auraRadius > 0) auraPulse(ctx, ctr.x, ctr.y, size);

  // Selection outline.
  if (game.selectedId === c.id) {
    ctx.strokeStyle = COL.text;
    ctx.lineWidth = 2;
    roundRect(ctx, ctr.x - size / 2, ctr.y - size / 2, size, size, 5);
    ctx.stroke();
  }

  // The gold combo badge (never tier pips / Roman).
  comboBadge(ctx, ctr.x, ctr.y, size, def.name.charAt(0));
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

  // A faint tier glow so quality still reads, but muted (this rock is not committed yet).
  glow(ctx, ctr.x, ctr.y, 10 + c.tier * 3, tierC, 0.08 + 0.03 * c.tier);

  // The rolled component sprite, dimmed (with code fallbacks so any rolled type still reads).
  // A rolled Regulator shows its non-firing support core instead of a gun head.
  ctx.save();
  ctx.globalAlpha = 0.6;
  const base = A.componentBase(c.type);
  if (base) blit(ctx, base, ctr.x, ctr.y, size, size, 0);
  else codeBasePlate(ctx, ctr.x, ctr.y, size, typeC);
  if (c.type === "regulator") {
    supportCore(ctx, ctr.x, ctr.y, size, typeC);
  } else {
    const head = A.componentHead(c.type, c.tier);
    if (head) blit(ctx, head, ctr.x, ctr.y, size, size, 0);
    else codeHead(ctx, ctr.x, ctr.y, size, 0, typeC);
  }
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

  // A small "NEW" tag at the bottom so an uncommitted candidate reads as a fresh roll. A candidate
  // is never a persisted "kept" marker now — KEEP is immediate and sends the wave (specs/build.md).
  roundRect(ctx, ctr.x - 12, ctr.y + size / 2 - 11, 24, 11, 3);
  ctx.fillStyle = hexA(typeC, 0.85);
  ctx.fill();
  text(ctx, "NEW", ctr.x, ctr.y + size / 2 - 5, 7, COL.void, "center", "800", 0.5);

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

  const seethe = boss ? 1 + (u.invincible ? 0.1 : 0.06) * Math.sin(time * 9 + u.id) : 1;
  glow(ctx, u.x, u.y, u.radius + (boss ? 12 : 4), boss ? COL.boss : COL.arc, boss ? 0.3 : 0.14);
  // The post-final invincible Overload Dynamo: an outsized, roiling overload halo + arcing ring
  // so it reads instantly as the maze-rating boss, not a normal Dynamo (specs/enemies.md).
  if (u.invincible) {
    glow(ctx, u.x, u.y, u.radius + 22 + 6 * Math.sin(time * 5), COL.boss, 0.22);
    ring(ctx, u.x, u.y, u.radius + 10 + 3 * Math.sin(time * 4), COL.spark, 0.5, 2);
  }

  if (frames.length) {
    const idx = Math.floor((u.animT * 10 + u.id) % frames.length);
    blit(ctx, frames[idx]!, u.x, u.y, size * seethe, size * seethe, 0);
  } else {
    ctx.fillStyle = boss ? COL.boss : COL.text2;
    ctx.beginPath();
    ctx.arc(u.x, u.y, u.radius, 0, Math.PI * 2);
    ctx.fill();
  }

  // Status readouts (specs/enemies.md, specs/towers.md) — kept small and off the health bar.
  // Slowed: a thin icy ring + faint cyan wash (Choke's EM-drag). Burning: an ember flicker
  // (Rectifier's overcurrent DoT). Both read at 2× speed without clutter.
  if (u.slowFactor < 1) {
    ring(ctx, u.x, u.y, u.radius + 3, COL.choke, 0.75, 1.5);
    glow(ctx, u.x, u.y, u.radius + 2, COL.choke, 0.16);
  }
  if (u.burnDps > 0) {
    const fl = 0.22 + 0.18 * (0.5 + 0.5 * Math.sin(time * 22 + u.id));
    glow(ctx, u.x, u.y, u.radius + 4, COL.rectifier, fl);
  }

  // Hit flash.
  if (u.hitFlash < 0.09) glow(ctx, u.x, u.y, u.radius + 6, COL.spark, 0.5 * (1 - u.hitFlash / 0.09));
}

function drawHealthBar(ctx: CanvasRenderingContext2D, u: Unit): void {
  // The invincible finale boss has no depleting health — it shows an OVERLOAD banner instead of a
  // bar, since the point is the damage dealt to it, not killing it (specs/enemies.md).
  if (u.invincible) {
    const y = u.y - u.radius - 14;
    text(ctx, "OVERLOAD DYNAMO", u.x, y, 10, COL.boss, "center", "800", 0.5);
    return;
  }
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
  } else if (game.finale) {
    // The post-final Overload Dynamo is walking the maze (specs/flow.md).
    sub = "OVERLOAD";
    subColor = COL.boss;
  } else if (game.phase === "build") {
    // The build phase is UNTIMED (specs/flow.md) — no countdown, SEND when ready.
    sub = "BUILD";
    subColor = COL.integrity;
  } else {
    sub = `${Math.round(game.waveProgress() * 100)}%`;
  }
  text(ctx, sub, 470, 37, 12, subColor, "left", "600", 1);

  // The run keeps NO running score (specs/flow.md). During the post-final OVERLOAD finale, this
  // slot shows the live MAZE RATING accruing on the invincible boss; otherwise it is blank.
  if (game.finale) {
    text(ctx, "OVERLOAD", 560, 20, 10, COL.boss, "left", "800", 1);
    text(ctx, `${Math.round(game.mazeRating).toLocaleString()}`, 560, 37, 16, COL.spark, "left", "800");
  }

  // MAZE LENGTH readout (specs/board.md, specs/controls.md) — how long the ground route the
  // Load walks is, in tiles. A longer maze keeps the Load under fire longer. Hovering it draws
  // the full ground path on the board (air units ignore the maze, so they are not shown).
  const mazeLen = Math.round(game.mazeLengthTiles());
  const mzX = 700;
  const mzY = 8;
  const mzW = 120;
  const mzH = 40;
  const mzHover = inRect(game.pointerX, game.pointerY, mzX, mzY, mzW, mzH);
  roundRect(ctx, mzX, mzY, mzW, mzH, 6);
  ctx.fillStyle = mzHover ? hexA(COL.flow, 0.22) : "rgba(255,255,255,0.05)";
  ctx.fill();
  ctx.strokeStyle = mzHover ? COL.arc : "rgba(255,255,255,0.10)";
  ctx.lineWidth = 1;
  ctx.stroke();
  text(ctx, "MAZE", mzX + 10, mzY + 12, 9, COL.text3, "left", "700", 1);
  text(ctx, mzHover ? "▸ PATH" : "hover ▸", mzX + mzW - 9, mzY + 12, 8, mzHover ? COL.arc : COL.text3, "right", "600");
  const numStr = `${mazeLen}`;
  text(ctx, numStr, mzX + 10, mzY + 28, 16, COL.arc, "left", "700");
  text(ctx, "tiles", mzX + 10 + numStr.length * 10 + 6, mzY + 30, 10, COL.text3, "left", "500");
  if (mzHover) drawMazePath(ctx, game);

  // COMBOS recipe book + live DAMAGE BOARD toggles (specs/controls.md).
  toggle(ctx, clicks, 838, "COMBOS", "toggleCombos", showCombos);
  toggle(ctx, clicks, 926, "DMG BOARD", "toggleLeaderboard", showBoard);

  ctrl(ctx, clicks, 1112, `${game.speed}×`, "speed", COL.text, 52);
  ctrl(ctx, clicks, 1172, game.paused ? "▶" : "❚❚", "pause", game.paused ? COL.alert : COL.text, 40);
  ctrl(ctx, clicks, 1220, muted ? "♪̸" : "♪", "mute", muted ? COL.text3 : COL.text, 40);
}

// A top-bar TOGGLE button (a lit state when its overlay is open). Mirrors ctrl() but shows an
// on/off accent so the player can see which HUD overlays are active (specs/controls.md).
function toggle(ctx: CanvasRenderingContext2D, clicks: Clickable[], x: number, label: string, action: string, on: boolean): void {
  const y = 12;
  const h = 32;
  const w = 80;
  roundRect(ctx, x, y, w, h, 6);
  ctx.fillStyle = on ? hexA(COL.integrity, 0.2) : "rgba(255,255,255,0.06)";
  ctx.fill();
  ctx.strokeStyle = on ? COL.integrity : "rgba(255,255,255,0.10)";
  ctx.lineWidth = on ? 1.5 : 1;
  ctx.stroke();
  text(ctx, label, x + w / 2, y + h / 2 + 1, 11, on ? COL.integrity : COL.text2, "center", "700", 0.3);
  clicks.push({ x, y, w, h, action });
}

// Draw the ground maze route as a bright line with a start/end marker, over the board — the
// hover preview for the MAZE readout (specs/board.md). Flyers are not shown (they ignore it).
function drawMazePath(ctx: CanvasRenderingContext2D, game: Game): void {
  const pts = game.mazePath();
  if (pts.length < 2) return;
  ctx.save();
  // A dark under-stroke for contrast against a busy board, then the bright route.
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(5,8,12,0.7)";
  ctx.lineWidth = 6;
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.stroke();
  ctx.strokeStyle = hexA(COL.arc, 0.9);
  ctx.lineWidth = 2.5;
  ctx.setLineDash([9, 6]);
  ctx.lineDashOffset = -(time * 40) % 15;
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.stroke();
  ctx.restore();
  // Endpoints: a green start dot, a red grounding-sink dot.
  const a = pts[0]!;
  const b = pts[pts.length - 1]!;
  glow(ctx, a.x, a.y, 12, COL.legal, 0.5);
  glow(ctx, b.x, b.y, 12, COL.collector, 0.5);
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
  // Arms a BLANK rock; the roll happens on placement. Placing is FREE — it spends one of the
  // level's 5 stamps per placed rock, and the cap is 5 per level.
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
  clicks.push({ x: px, y: stampY, w, h: stampH, action: "stamp", disabled: !canStamp });

  // --- Live QUALITY ODDS for the next roll (specs/build.md) ---
  // Always visible so the player can read the quality probabilities before placing a rock.
  const oddsBottom = drawQualityOdds(ctx, game, px, stampY + stampH + 6, w);

  // --- UPGRADE QUALITY (Refinement track) control (specs/build.md) ---
  // Spend Charge to raise Refinement R, biasing every future roll toward higher tiers.
  const upHeadY = oddsBottom + 6;
  text(ctx, "UPGRADE QUALITY", px, upHeadY, 11, COL.text3, "left", "700", 1);
  const upY = upHeadY + 10;
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

// The current QUALITY ROLL odds for a placed rock at the live Refinement level (specs/build.md
// — UPGRADE QUALITY). A stacked bar over the five tiers (Scrap…Tesla-Prime) plus a legend, so
// the player can always see the probability of each quality BEFORE placing. Returns the y just
// below the block it drew.
function drawQualityOdds(ctx: CanvasRenderingContext2D, game: Game, x: number, y: number, w: number): number {
  const odds = QUALITY_ODDS_BY_R[game.refinement]!;
  text(ctx, "QUALITY ODDS", x, y + 5, 9, COL.text3, "left", "700", 0.5);
  text(ctx, `R${game.refinement}`, x + w, y + 5, 9, COL.integrity, "right", "700", 0.5);
  const barY = y + 14;
  const barH = 12;
  let cx = x;
  for (let t = 1 as Tier; t <= 5; t = (t + 1) as Tier) {
    const frac = odds[t - 1]!;
    const segW = frac * w;
    if (segW > 0.5) {
      ctx.fillStyle = hexA(TIER_COLOR[t], 0.9);
      ctx.fillRect(cx, barY, Math.max(1, segW - 1), barH);
      if (segW >= 30) text(ctx, `${Math.round(frac * 100)}%`, cx + segW / 2, barY + barH / 2 + 1, 8, COL.void, "center", "800");
    }
    cx += segW;
  }
  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, barY + 0.5, w - 1, barH - 1);
  // Legend: the nonzero tiers as "roman pct".
  const parts: string[] = [];
  for (let t = 1 as Tier; t <= 5; t = (t + 1) as Tier) {
    if (odds[t - 1]! > 0) parts.push(`${ROMAN[t]} ${Math.round(odds[t - 1]! * 100)}%`);
  }
  text(ctx, parts.join("  ·  "), x, barY + barH + 9, 8, COL.text2, "left", "500", 0.2);
  return barY + barH + 18;
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
  text(ctx, `${game.stampsLeft()} / ${BUILDS_PER_LEVEL} ROCKS LEFT`, x, y + 148, 10, COL.text3, "left", "500", 0.5);
  drawQualityOdds(ctx, game, x, y + 162, w);
}

// The selected-piece inspector (specs/board.md, specs/build.md, specs/controls.md).
// A CANDIDATE offers KEEP / COMBINE (build phase); a COMPONENT offers the targeting cycle;
// a BLOCKER is inert (no stats, no actions).
function drawInspector(ctx: CanvasRenderingContext2D, game: Game, s: Structure, A: Assets, x: number, y: number, w: number, clicks: Clickable[]): void {
  const baseY = STAGE_H - 62 - 8; // just above the wave control
  const inBuild = game.phase === "build"; // dismantling is a build-phase-only correction

  if (s.kind === "blocker") {
    text(ctx, "INERT BLOCKER", x, y + 6, 14, COL.text2, "left", "700", 0.5);
    wrap(ctx, "A hardened scrap rock — it walls the Load's route but never fires. Drop a fresh rock onto it to reroll a new component.", x, y + 32, w, 11, COL.text2, 15);
    if (inBuild) button(ctx, clicks, x, baseY - 30, w, 30, "DISMANTLE ROCK", "remove", COL.alert, true);
    return;
  }

  const isCand = s.kind === "candidate";
  const comp = s.kind === "component" ? s : null;
  const isCombo = comp !== null && !!comp.combo;
  const stats = isCand ? deriveStats(s.type, s.tier) : game.statsOf(comp!);

  // Header. A COMBINATION TOWER reads by its combo name + gold badge (no quality tier); a base
  // component / candidate reads by its type + quality rung. A Regulator shows its support core.
  if (isCombo) {
    const def = COMBOS[comp!.combo!];
    const chead = A.comboHead(comp!.combo!);
    if (chead) blit(ctx, chead, x + 18, y + 20, 40, 40, 0);
    else codeHead(ctx, x + 18, y + 20, 40, 0, def.color);
    comboBadge(ctx, x + 18, y + 20, 40, def.name.charAt(0));
    text(ctx, def.name, x + 44, y + 12, 13, def.color, "left", "700", 0.3);
    text(ctx, `COMBINATION · LEVEL ${comp!.comboLevel}/${MAX_COMBO_LEVEL}`, x + 44, y + 28, 9, COL.combo, "left", "700", 0.3);
    text(ctx, "UPGRADE ANYTIME · HITS GROUND & AIR", x + 44, y + 42, 8, COL.text3, "left", "500", 0.3);
  } else {
    const typeC = COMPONENT_COLOR[s.type];
    const head = A.componentHead(s.type, s.tier);
    if (head) blit(ctx, head, x + 18, y + 20, 40, 40, 0);
    else if (s.type === "regulator") supportCore(ctx, x + 18, y + 20, 40, typeC);
    else codeHead(ctx, x + 18, y + 20, 40, 0, typeC);
    text(ctx, COMPONENT_LABEL[s.type], x + 44, y + 12, 13, typeC, "left", "700", 0.5);
    text(ctx, `${TIER_NAME[s.tier]} · ${ROMAN[s.tier]}`, x + 44, y + 28, 11, TIER_COLOR[s.tier], "left", "600", 0.5);
    const sub = isCand ? "UNCOMMITTED ROLL" : !stats.fires ? "SUPPORT · DOES NOT FIRE" : "HITS GROUND & AIR";
    const subC = isCand ? COL.charge : !stats.fires ? COL.regulator : COL.text3;
    text(ctx, sub, x + 44, y + 42, 8, subC, "left", "500", 0.5);
  }

  // What this piece does (specs/towers.md) — its role at a glance.
  const desc = isCombo ? COMBOS[comp!.combo!].desc : COMPONENT_DESC[s.type];
  const descEnd = wrap(ctx, desc, x, y + 68, w, 10, COL.text2, 14);

  let row = descEnd + 4;
  const line = (k: string, v: string, col: string = COL.text): void => {
    text(ctx, k, x, row, 11, COL.text3, "left", "500", 0.5);
    text(ctx, v, x + w, row, 12, col, "right", "700");
    row += 18;
  };
  if (!stats.fires) {
    // A Regulator (non-firing support node): show its aura instead of dmg / rate / targeting.
    line("AURA RADIUS", `${Math.round(stats.auraRadius)}`, COL.regulator);
    line("DMG BONUS", `+${Math.round(stats.auraBonus * 100)}%`, COL.regulator);
  } else {
    line("DAMAGE", `${stats.dmg}`);
    line("RANGE", `${Math.round(stats.range)}`);
    line("FIRE RATE", `${stats.fireRate.toFixed(1)}/s`);
    if (stats.splash > 0) line("SPLASH", `${Math.round(stats.splash)}`, COL.arcnode);
    if (stats.chainLeaps > 0) line("CHAIN", `+${stats.chainLeaps} leaps`, COL.coil);
    if (stats.slowAmt > 0) line("SLOW", `-${Math.round(stats.slowAmt * 100)}% · ${stats.slowDur.toFixed(1)}s`, COL.choke);
    if (stats.burnFrac > 0) line("BURN", `${Math.round(stats.burnFrac * 100)}%/s · ${stats.burnDur.toFixed(1)}s`, COL.rectifier);
    if (stats.critChance > 0) line("CRIT", `${Math.round(stats.critChance * 100)}% · ×${stats.critMult.toFixed(1)}`, COL.combo);
    if (stats.multishot > 1) line("MULTISHOT", `${stats.multishot} targets`, COL.emitter);
    if (stats.auraRadius > 0) line("AURA", `+${Math.round(stats.auraBonus * 100)}% · r${Math.round(stats.auraRadius)}`, COL.regulator);
    if (comp && comp.auraBonus > 0) line("AURA BUFF", `+${Math.round(comp.auraBonus * 100)}%`, COL.regulator);
  }
  if (comp) {
    if (stats.fires) line("TARGET", TARGETING_LABEL[comp.targeting], COL.integrity);
    // Per-component performance tally (specs/towers.md) — like Meltdown's tower inspector.
    line("KILLS", `${comp.kills}`, COL.charge);
    line("DMG DEALT", `${Math.round(comp.damageDealt).toLocaleString()}`, COL.spark);
  }

  // ---- Action area (specs/build.md, specs/controls.md) ----
  // COMBINING (quality-climb or a recipe) is IMMEDIATE and allowed in the build phase AND during
  // a live wave; KEEP / DOWNGRADE / DISMANTLE are build-phase corrections. Buttons stack upward
  // from a bottom anchor so the layout adapts to what the piece offers.
  let ay = baseY - 26;
  const rowGap = 4;
  const stack = (label: string, action: string, color: string, enabled: boolean, h = 26, payload?: string): void => {
    button(ctx, clicks, x, ay, w, h, label, action, color, enabled);
    if (payload) clicks[clicks.length - 1]!.payload = payload;
    ay -= h + rowGap;
  };

  if (isCombo) {
    // A COMBINATION TOWER: UPGRADE its level (spends Charge, ANY phase — incl. mid-wave),
    // retarget, dismantle (build-phase correction only).
    if (inBuild) stack("DISMANTLE TOWER", "remove", COL.alert, true, 24);
    if (stats.fires) stack(`TARGET · ${TARGETING_LABEL[comp!.targeting]}`, "targeting", COL.integrity, true);
    const lvl = comp!.comboLevel;
    const cost = game.comboUpgradeCostFor(comp!);
    if (cost !== null) {
      const nextDmg = comboStats(comp!.combo!, lvl + 1).dmg;
      stack(`UPGRADE ▲  ${cost}`, "comboupgrade", COL.combo, game.canUpgradeCombo(comp!.id));
      text(ctx, `LEVEL ${lvl} → ${lvl + 1}  ·  DMG ${stats.dmg} → ${nextDmg}`, x, ay + 4, 9, COL.combo, "left", "600", 0.2);
    } else {
      text(ctx, `LEVEL ${lvl}/${MAX_COMBO_LEVEL} · MAX — fully upgraded`, x, ay + 6, 9, COL.text3, "left", "700", 0.3);
    }
    return;
  }

  // A base structure (candidate OR base component). It can be KEPT (candidate), DOWNGRADED,
  // quality-COMBINED with a match, or folded into a COMBINATION TOWER — all from here.
  const sid = s.id;
  const canComb = game.canCombine(s);
  const nt = Math.min(MAX_TIER, s.tier + 1) as Tier;
  const dt = Math.max(1, s.tier - 1) as Tier;
  const recipes = game.reachableCombosFor(sid);
  const explicit = game.combineSet().length >= 2 && game.combineSet()[0] === sid;

  if (inBuild) stack(isCand ? "DISMANTLE — NO REFUND" : "DISMANTLE COMPONENT", "remove", COL.alert, true, 24);
  if (comp && stats.fires) stack(`TARGET · ${TARGETING_LABEL[comp.targeting]}`, "targeting", COL.integrity, true, 24);

  // KEEP is a candidate's harvest — committing it LAUNCHES the wave (specs/build.md, no SEND).
  // DOWNGRADE (candidate at tier ≥ 2) is a KEEP at one tier lower — also the harvest, so it too
  // sends the wave (fold the lowered tower into a recipe with a standing COMBINE mid-wave). Side
  // by side when both apply.
  const canDown = isCand && inBuild && s.tier > 1;
  if (isCand && canDown) {
    const half = (w - 8) / 2;
    button(ctx, clicks, x, ay, half, 26, "KEEP → SEND", "keep", COL.charge, true);
    button(ctx, clicks, x + half + 8, ay, half, 26, `KEEP ▼ ${TIER_NAME[dt]}`, "downgrade", COL.text2, true);
    ay -= 30;
  } else if (isCand) {
    stack("KEEP → SEND WAVE", "keep", COL.charge, true);
  }

  // MERGE INTO — fold this fresh candidate into a matching STANDING tower, landing the higher-tier
  // result at the EXISTING tower's footprint (specs/build.md), so you never have to keep-then-merge.
  // A fresh-consuming combine, so it also SENDS the wave.
  if (isCand) {
    const mt = game.mergeTargetFor(sid);
    if (mt) {
      stack(`MERGE INTO ${COMPONENT_LABEL[mt.type]} ${ROMAN[mt.tier]} ▲`, "merge", COL.combo, true);
      text(ctx, `→ ${TIER_NAME[nt]} at that tower · sends wave`, x, ay + 4, 8, COL.combo, "left", "600", 0.2);
    }
  }

  // Quality COMBINE — fold a matching (type+tier) pair one rung higher, landing at THIS piece. A
  // fold that consumes a fresh roll is the level's harvest and SENDS the wave (specs/build.md); a
  // fold of only standing towers leaves the phase running (and is the wave-time combine).
  if (canComb) {
    const sendsWave = game.qualityCombineIsSpecial(sid);
    const label = explicit ? "COMBINE SELECTED ▲" : "COMBINE ▲";
    stack(label, "combine", TIER_COLOR[nt], true);
    const tail = sendsWave ? " · sends wave" : "";
    text(ctx, `→ ${TIER_NAME[nt]} · DMG ${stats.dmg} → ${deriveStats(s.type, nt).dmg}${tail}`, x, ay + 4, 8, TIER_COLOR[nt], "left", "600", 0.2);
  }

  // COMBINATION-TOWER recipes in reach (specs/build.md, specs/towers.md) — each a one-click
  // COMBINE → <tower> that folds this piece + matching partners into a terminal combo (which
  // lands at LEVEL 0 and is upgraded from there). Listed from just under the stats down to the
  // bottom buttons; a shift-multi-select picks exactly which duplicate copies fold.
  if (recipes.length > 0) {
    text(ctx, "COMBINE → TOWER", x, row + 4, 9, COL.combo, "left", "700", 0.5);
    let ry = row + 16;
    const rh = 30;
    const maxRy = ay - 6;
    let shown = 0;
    for (const rec of recipes) {
      if (ry + rh > maxRy) break;
      const def = COMBOS[rec.combo];
      const land = comboStats(rec.combo, 0);
      roundRect(ctx, x, ry, w, rh, 5);
      ctx.fillStyle = hexA(def.color, 0.1);
      ctx.fill();
      ctx.strokeStyle = hexA(def.color, 0.5);
      ctx.lineWidth = 1;
      ctx.stroke();
      text(ctx, def.name, x + 8, ry + 10, 10, def.color, "left", "700", 0.3);
      // A recipe that folds in a fresh roll is the level's harvest — assembling it SENDS the wave
      // (specs/build.md); flag it so the player knows the wave will launch.
      if (game.recipeCombineIsSpecial(sid, rec.combo)) text(ctx, "SENDS WAVE", x + w - 8, ry + 10, 7, COL.combo, "right", "700", 0.3);
      const tags = abilityTags(def);
      const prev = `${land.dmg} dmg (Lv0) · ${Math.round(land.range)} r${tags ? " · " + tags : ""}`;
      text(ctx, prev, x + 8, ry + 22, 8, COL.text2, "left", "500", 0.2);
      clicks.push({ x, y: ry, w, h: rh, action: "comborecipe", payload: rec.combo });
      ry += rh + 4;
      shown++;
    }
    if (shown < recipes.length && ry + 2 < maxRy) text(ctx, `+${recipes.length - shown} more (free space to see)`, x, ry + 2, 8, COL.text3, "left", "500");
  }
}

// The next-wave preview (specs/enemies.md, specs/flow.md) — shown when nothing is selected.
function drawNextWave(ctx: CanvasRenderingContext2D, game: Game, A: Assets, x: number, y: number, w: number): void {
  const wv = game.nextWavePreview();
  text(ctx, "NEXT WAVE", x, y + 6, 11, COL.text3, "left", "700", 1);
  text(ctx, "HOVER A NAME FOR INTEL", x + w, y + 6, 8, COL.text3, "right", "500", 0.5);
  const label = wv.hasBoss ? `WAVE ${wv.wave} · BOSS` : `WAVE ${wv.wave}`;
  text(ctx, label, x, y + 26, 15, wv.hasBoss ? COL.boss : COL.text, "left", "700", 0.5);

  // Count each type in the coming wave.
  const counts = new Map<LoadType, number>();
  for (const e of wv.events) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);

  const rowH = 22;
  let row = y + 48;
  for (const t of wv.types) {
    const def = LOAD[t];
    // Each row is a hover target: hovering it floats a tooltip describing the unit.
    const hover = inRect(game.pointerX, game.pointerY, x - 4, row - 2, w + 8, rowH);
    if (hover) {
      roundRect(ctx, x - 4, row - 2, w + 8, rowH - 2, 4);
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      ctx.fill();
    }
    if (A.has(LOAD_ICON[t])) blit(ctx, A.sprite(LOAD_ICON[t]), x + 9, row + 7, 18, 18);
    text(ctx, def.label, x + 24, row + 7, 11, t === "dynamo" ? COL.boss : hover ? COL.text : COL.text2, "left", "600", 0.5);
    const n = counts.get(t) ?? 0;
    text(ctx, n > 1 ? `×${n}` : def.flies ? "FLYER" : "", x + w, row + 7, 10, COL.text3, "right", "500");
    if (hover) {
      pendingTooltip = { title: def.label, body: LOAD_DESC[t], color: t === "dynamo" ? COL.boss : COL.integrity, y: row + 7 };
    }
    row += rowH;
  }
}

// The wave control: START the opening wave / SEND the next one when ready (build phases are
// untimed — no countdown, specs/flow.md) + a speed toggle. During a live wave it reads the
// wave progress instead.
function drawWaveControl(ctx: CanvasRenderingContext2D, game: Game, px: number, w: number, clicks: Clickable[]): void {
  const y = STAGE_H - 62;
  const h = 46;
  if (game.phase === "build") {
    // There is NO SEND button (specs/flow.md): a wave launches when you commit the level's
    // harvest — KEEP a roll, or fold rolls into a stronger tower with COMBINE. This bar is a
    // non-clickable prompt that says so, beside the speed toggle (which carries into the wave).
    const speedW = 52;
    const promptW = w - speedW - 8;
    roundRect(ctx, px, y, promptW, h, 8);
    ctx.fillStyle = hexA(COL.charge, 0.08);
    ctx.fill();
    ctx.strokeStyle = hexA(COL.charge, 0.35);
    ctx.lineWidth = 1;
    ctx.stroke();
    const verb = game.wave === 0 ? "START" : "SEND";
    text(ctx, `KEEP OR COMBINE A ROLL TO ${verb}`, px + promptW / 2, y + h / 2 + 1, 11.5, COL.charge, "center", "700", 0.4);
    // Speed toggle (alternative to the status bar's, specs/board.md) — persists into the wave.
    roundRect(ctx, px + promptW + 8, y, speedW, h, 8);
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.lineWidth = 1;
    ctx.stroke();
    text(ctx, `${game.speed}×`, px + promptW + 8 + speedW / 2, y + h / 2 + 1, 15, COL.text, "center", "700");
    clicks.push({ x: px + promptW + 8, y, w: speedW, h, action: "speed" });
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

// ---- HUD overlays (COMBOS book + live DAMAGE BOARD) — specs/controls.md --------

// A combo recipe as a readable ingredient list ("REGULATOR I + RECTIFIER I + ARC-NODE I").
function recipeText(def: ComboDef): string {
  return def.recipe.map((i) => `${COMPONENT_LABEL[i.type]} ${ROMAN[i.tier]}`).join(" + ");
}

// The (type, quality tier) of the currently selected BASE piece — a standing base component or
// an uncommitted candidate — that could serve as a combo INGREDIENT, or null when nothing
// ingredient-eligible is selected (a combination tower or a blocker is not an ingredient). Used
// to highlight, in the COMBINATIONS book, the combos that consume the selection (specs/controls.md).
function selectedIngredient(game: Game): { type: ComponentType; tier: Tier } | null {
  const sel = game.selected();
  if (!sel) return null;
  if (sel.kind === "candidate") return { type: sel.type, tier: sel.tier };
  if (sel.kind === "component" && !sel.combo) return { type: sel.type, tier: sel.tier };
  return null;
}

// Whether combo `def`'s recipe consumes an ingredient at the given (type, quality tier).
function comboUsesIngredient(def: ComboDef, ing: { type: ComponentType; tier: Tier }): boolean {
  return def.recipe.some((r) => r.type === ing.type && r.tier === ing.tier);
}

// The DAMAGE BOARD's ranking: every firing tower that has dealt damage, sorted high→low, capped
// at the top 8 shown. Shared by the board's layout and its pointer hit-test (specs/controls.md).
function leaderboardTop(game: Game): Component[] {
  const comps = game.structures.filter((s): s is Component => s.kind === "component" && s.damageDealt > 0);
  comps.sort((a, b) => b.damageDealt - a.damageDealt);
  return comps.slice(0, 8);
}

// The geometry of the DAMAGE BOARD's rows (must match drawLeaderboard's layout below).
const LB_X = BOARD_X0 + 12;
const LB_Y = STATUS_H + 12;
const LB_W = 250;
const LB_ROW_H = 26;
const LB_HEAD_H = 30;
const LB_ROW0 = LB_Y + LB_HEAD_H + 6;

// The id of the tower whose DAMAGE BOARD row the pointer is currently over, or null. Computed
// before the board draws so the hovered tower can be spotlighted on the yard (specs/controls.md).
function leaderboardHoverId(game: Game): number | null {
  const top = leaderboardTop(game);
  for (let i = 0; i < top.length; i++) {
    if (inRect(game.pointerX, game.pointerY, LB_X, LB_ROW0 + i * LB_ROW_H, LB_W, LB_ROW_H)) return top[i]!.id;
  }
  return null;
}

// The COMBINATIONS reference book (specs/build.md, specs/towers.md) — every combination tower
// with its exact recipe and stats, so the player can plan combines in-game. A modal panel over
// the board; a background swallow keeps a click behind it from reaching the yard.
function drawCombosBook(ctx: CanvasRenderingContext2D, game: Game, clicks: Clickable[]): void {
  // If a base piece is selected, every combo that consumes it is highlighted in the charge
  // accent — a planning aid for spotting where the selection can go (specs/controls.md).
  const selIng = selectedIngredient(game);
  const x0 = BOARD_X0 + 18;
  const y0 = STATUS_H + 14;
  const x1 = BOARD_X1 - 18;
  const y1 = STAGE_H - 14;
  const w = x1 - x0;
  const h = y1 - y0;
  // Backdrop + swallow (over the whole board so a stray click cannot place a rock).
  ctx.fillStyle = "rgba(4,6,10,0.55)";
  ctx.fillRect(BOARD_X0, STATUS_H, BOARD_X1 - BOARD_X0, STAGE_H - STATUS_H);
  clicks.push({ x: BOARD_X0, y: STATUS_H, w: BOARD_X1 - BOARD_X0, h: STAGE_H - STATUS_H, action: "noop" });
  // Panel.
  roundRect(ctx, x0, y0, w, h, 12);
  ctx.fillStyle = "rgba(12,17,24,0.98)";
  ctx.fill();
  ctx.strokeStyle = hexA(COL.combo, 0.5);
  ctx.lineWidth = 1.5;
  ctx.stroke();
  clicks.push({ x: x0, y: y0, w, h, action: "noop" }); // swallow clicks on the panel body
  text(ctx, "COMBINATION TOWERS", x0 + 18, y0 + 22, 15, COL.combo, "left", "800", 1);
  const subtitle = selIng
    ? `Highlighted combos use your selected ${COMPONENT_LABEL[selIng.type]} ${ROMAN[selIng.tier]}. Hover a combo for what it does.`
    : "Assemble a rock plus the exact ingredients on the board into a terminal tower. Hover a combo for what it does.";
  text(ctx, subtitle, x0 + 18, y0 + 40, 10, selIng ? COL.charge : COL.text2, "left", "500", 0.2);
  // Close button (also re-clickable via the top-bar COMBOS toggle).
  const cb = 26;
  const cx = x1 - cb - 12;
  const cy = y0 + 12;
  roundRect(ctx, cx, cy, cb, cb, 6);
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.lineWidth = 1;
  ctx.stroke();
  text(ctx, "✕", cx + cb / 2, cy + cb / 2 + 1, 14, COL.text2, "center", "700");
  clicks.push({ x: cx, y: cy, w: cb, h: cb, action: "toggleCombos" });

  // 12 combos in a 2×6 grid.
  const gridY = y0 + 56;
  const gap = 12;
  const cols = 2;
  const rows = 6;
  const cellW = (w - 36 - gap) / cols;
  const cellH = (y1 - gridY - 16 - (rows - 1) * gap) / rows;
  let hoverDef: ComboDef | null = null;
  for (let idx = 0; idx < COMBO_ORDER.length; idx++) {
    const combo = COMBO_ORDER[idx]!;
    const def = COMBOS[combo];
    const c = idx % cols;
    const r = Math.floor(idx / cols);
    const cxp = x0 + 18 + c * (cellW + gap);
    const cyp = gridY + r * (cellH + gap);
    // A combo that consumes the selected piece is called out in the charge accent.
    const used = selIng ? comboUsesIngredient(def, selIng) : false;
    roundRect(ctx, cxp, cyp, cellW, cellH, 8);
    ctx.fillStyle = used ? hexA(COL.charge, 0.14) : hexA(def.color, 0.08);
    ctx.fill();
    ctx.strokeStyle = used ? COL.charge : hexA(def.color, 0.45);
    ctx.lineWidth = used ? 1.8 : 1;
    ctx.stroke();
    if (inRect(game.pointerX, game.pointerY, cxp, cyp, cellW, cellH)) hoverDef = def;
    text(ctx, def.name, cxp + 12, cyp + 15, 12, def.color, "left", "800", 0.3);
    if (used) text(ctx, "◂ USES SELECTION", cxp + cellW - 12, cyp + 15, 7, COL.charge, "right", "800", 0.4);
    const tags = abilityTags(def);
    const statLine = `${def.dmg} dmg · ${Math.round(def.range)} r · ${def.fireRate.toFixed(1)}/s${tags ? " · " + tags : ""}`;
    text(ctx, statLine, cxp + 12, cyp + 31, 8, COL.text2, "left", "600", 0.2);
    text(ctx, "RECIPE", cxp + 12, cyp + 45, 7, COL.text3, "left", "700", 0.5);
    wrap(ctx, recipeText(def), cxp + 12, cyp + 57, cellW - 24, 9, COL.text, 12);
  }

  // Hovering a combo floats a card describing what that tower DOES (specs/controls.md) — the
  // stat/keyword line in the cell is a summary; this is the plain-language description.
  if (hoverDef) drawComboTooltip(ctx, hoverDef, game.pointerX, game.pointerY, x0, y0, x1, y1);
}

// A floating description card for a combination tower, shown while its cell is hovered in the
// COMBINATIONS book. Clamped to stay inside the book panel (x0,y0)–(x1,y1).
function drawComboTooltip(ctx: CanvasRenderingContext2D, def: ComboDef, px: number, py: number, x0: number, y0: number, x1: number, y1: number): void {
  const tw = 268;
  const th = 144;
  let cardX = px + 16;
  let cardY = py + 12;
  if (cardX + tw > x1 - 8) cardX = px - 16 - tw;
  cardX = Math.max(x0 + 8, Math.min(cardX, x1 - 8 - tw));
  cardY = Math.max(y0 + 8, Math.min(cardY, y1 - 8 - th));
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 18;
  roundRect(ctx, cardX, cardY, tw, th, 8);
  ctx.fillStyle = "rgba(8,12,18,0.98)";
  ctx.fill();
  ctx.restore();
  roundRect(ctx, cardX, cardY, tw, th, 8);
  ctx.strokeStyle = hexA(def.color, 0.8);
  ctx.lineWidth = 1.5;
  ctx.stroke();
  const tx = cardX + 14;
  text(ctx, def.name, tx, cardY + 18, 13, def.color, "left", "800", 0.4);
  const descY = wrap(ctx, def.desc, tx, cardY + 40, tw - 28, 11, COL.text, 15);
  const tags = abilityTags(def);
  const statLine = `${def.dmg} dmg · ${Math.round(def.range)} r · ${def.fireRate.toFixed(1)}/s${tags ? " · " + tags : ""}`;
  text(ctx, statLine, tx, descY + 8, 9, COL.text2, "left", "600", 0.2);
  text(ctx, "RECIPE", tx, descY + 24, 7, COL.text3, "left", "700", 0.5);
  wrap(ctx, recipeText(def), tx, descY + 36, tw - 28, 9, COL.spark, 12);
}

// The live tower DAMAGE BOARD (specs/controls.md) — a real-time ranking of every firing tower
// by total damage dealt, updated each frame. A compact panel in the board's top-left corner.
function drawLeaderboard(ctx: CanvasRenderingContext2D, game: Game, clicks: Clickable[]): void {
  const top = leaderboardTop(game);
  const x = LB_X;
  const y = LB_Y;
  const w = LB_W;
  const rowH = LB_ROW_H;
  const headH = LB_HEAD_H;
  const h = headH + 8 + Math.max(1, top.length) * rowH + 8;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.5)";
  ctx.shadowBlur = 16;
  roundRect(ctx, x, y, w, h, 10);
  ctx.fillStyle = "rgba(10,15,22,0.94)";
  ctx.fill();
  ctx.restore();
  roundRect(ctx, x, y, w, h, 10);
  ctx.strokeStyle = hexA(COL.spark, 0.35);
  ctx.lineWidth = 1;
  ctx.stroke();
  clicks.push({ x, y, w, h, action: "noop" }); // do not let clicks fall through to the yard
  text(ctx, "DAMAGE BOARD", x + 12, y + 16, 11, COL.spark, "left", "800", 1);
  // Close button.
  const cb = 20;
  const cbx = x + w - cb - 8;
  const cby = y + 6;
  roundRect(ctx, cbx, cby, cb, cb, 5);
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.fill();
  text(ctx, "✕", cbx + cb / 2, cby + cb / 2 + 1, 12, COL.text2, "center", "700");
  clicks.push({ x: cbx, y: cby, w: cb, h: cb, action: "toggleLeaderboard" });

  if (top.length === 0) {
    text(ctx, "No damage dealt yet.", x + 12, y + headH + 14, 10, COL.text3, "left", "500");
    return;
  }
  const maxDmg = top[0]!.damageDealt || 1;
  let ry = y + headH + 6;
  for (let i = 0; i < top.length; i++) {
    const c = top[i]!;
    const accent = c.combo ? COMBOS[c.combo].color : COMPONENT_COLOR[c.type];
    const name = c.combo ? COMBOS[c.combo].name : `${COMPONENT_LABEL[c.type]} ${ROMAN[c.tier]}`;
    // Hovering this row spotlights its tower on the yard (grays out the rest); underline the
    // hovered row so the link between the leaderboard and the highlighted tower is obvious.
    const hovered = c.id === boardFocusId;
    if (hovered) {
      ctx.fillStyle = hexA(accent, 0.14);
      roundRect(ctx, x + 8, ry - 2, w - 16, rowH, 5);
      ctx.fill();
      ctx.strokeStyle = hexA(accent, 0.7);
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    // Damage bar behind the row.
    const barW = (c.damageDealt / maxDmg) * (w - 24);
    ctx.fillStyle = hexA(accent, hovered ? 0.28 : 0.16);
    roundRect(ctx, x + 12, ry, barW, rowH - 4, 4);
    ctx.fill();
    text(ctx, `${i + 1}`, x + 12, ry + (rowH - 4) / 2, 10, COL.text3, "left", "700");
    text(ctx, name, x + 28, ry + (rowH - 4) / 2, 10, accent, "left", "700", 0.2);
    text(ctx, `${Math.round(c.damageDealt).toLocaleString()}`, x + w - 12, ry + (rowH - 4) / 2 - 5, 10, COL.spark, "right", "700");
    text(ctx, `${c.kills} kills`, x + w - 12, ry + (rowH - 4) / 2 + 6, 8, COL.charge, "right", "500");
    ry += rowH;
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
    text(ctx, `BASE ×${d.baseMult.toFixed(2)} · RAMP +${Math.round(d.k * 100)}%/WAVE`, x + cardW / 2, cardY + 182, 13, COL.text2, "center", "600", 1);
    text(ctx, `LATE SURGE ×${d.surchargeR.toFixed(2)}/WAVE`, x + cardW / 2, cardY + 204, 13, COL.alert, "center", "700", 1);
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

function drawHowto(ctx: CanvasRenderingContext2D, game: Game, clicks: Clickable[]): void {
  ctx.fillStyle = COL.void;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
  text(ctx, "HOW TO PLAY", STAGE_W / 2, 68, 30, COL.text, "center", "700", 5);
  text(ctx, "Press scrap into towers, maze the Load, and hold the grid.", STAGE_W / 2, 104, 14, COL.text2, "center", "400", 0.5);

  // Only what you must know to play — heading, accent, body. Everything else (per-type stats,
  // refinement odds, HUD toggles) is discoverable in-game and deliberately left off this screen.
  const cards: [string, string, string][] = [
    ["GOAL", COL.integrity, "The Load spills from the vent and crawls to the collector. Every unit that grounds out drains Grid Integrity — at 0 the grid overloads and you lose. Clear every wave with integrity to spare and you win."],
    ["THE SCRAP-PRESS", COL.charge, "You don't buy towers — you press them. B drops a FREE blank rock; the instant it lands it rolls a random tower type and quality. Place up to 5 rocks a round."],
    ["BUILD THE MAZE", COL.arc, "Every rock, tower, and blocker is a 2×2 WALL. The Load takes the shortest OPEN path through the numbered waypoints, so your walls send it the long way — past your guns. You can never seal a lane shut."],
    ["KEEP & COMBINE", COL.regulator, "Each round you take ONE new tower — and that SENDS the wave: KEEP a roll, MERGE a fresh roll into a matching standing tower, or COMBINE rolls into a stronger tower. Anytime — even mid-wave — a plain COMBINE of your STANDING towers climbs quality and builds elite COMBINATION TOWERS, which you UPGRADE with Charge."],
    ["THE FINALE", COL.combo, "There is no send button — committing your one tower launches the wave. Survive it and the next build phase opens. After the final wave an unkillable OVERLOAD DYNAMO walks your maze once — the damage your towers deal it is your MAZE RATING."],
  ];

  const colX = [150, 682];
  const colW = 448;
  const colY = [162, 162];
  for (let i = 0; i < cards.length; i++) {
    const c = i % 2;
    const [k, accent, body] = cards[i]!;
    const x = colX[c]!;
    let y = colY[c]!;
    ctx.fillStyle = hexA(accent, 0.9);
    ctx.fillRect(x, y - 9, 3, 18);
    text(ctx, k, x + 14, y, 15, accent, "left", "700", 1.5);
    y = wrap(ctx, body, x, y + 26, colW, 14, COL.text2, 20) + 22;
    colY[c] = y;
  }

  // A single controls strip below the taller column — the keys, nothing more.
  const fy = Math.max(colY[0]!, colY[1]!) + 6;
  ctx.strokeStyle = hexA(COL.text3, 0.4);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(150, fy);
  ctx.lineTo(1130, fy);
  ctx.stroke();
  text(ctx, "CONTROLS", 150, fy + 22, 12, COL.text3, "left", "700", 1.5);
  wrap(
    ctx,
    "B press · click place / select · SHIFT-click multi-select · K keep (sends wave) · E merge into tower · C combine · G downgrade · U upgrade · T target · F speed (1/2/4/8×) · SPACE pause · Esc menu · M mute",
    150,
    fy + 44,
    980,
    13,
    COL.text2,
    20,
  );

  const bx = STAGE_W / 2 - 90;
  const onBack = highlighted(game, 0, bx, STAGE_H - 52, 180, 38);
  button(ctx, clicks, bx, STAGE_H - 52, 180, 38, "BACK", "menu:back", onBack ? COL.charge : COL.text, true);
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
    // The run's one end-of-run number is the MAZE RATING: total damage the maze dealt to the
    // post-final invincible Overload Dynamo (specs/flow.md). Integrity is shown but is not scored.
    text(ctx, `ALL ${game.diff.waves} WAVES SURVIVED`, STAGE_W / 2, 322, 16, COL.text, "center", "600", 2);
    text(ctx, "MAZE RATING", STAGE_W / 2, 352, 12, COL.text3, "center", "700", 2);
    text(ctx, `${Math.round(game.mazeRating).toLocaleString()}`, STAGE_W / 2, 380, 30, COL.charge, "center", "800", 1);
    text(ctx, `GRID INTEGRITY ${Math.max(0, Math.floor(game.integrity))} LEFT`, STAGE_W / 2, 410, 13, COL.integrity, "center", "500", 1);
  } else {
    // Overload: no Maze Rating (the finale is never reached). Show how far the run got.
    text(ctx, `REACHED WAVE ${game.wave} / ${game.diff.waves}`, STAGE_W / 2, 352, 20, COL.text, "center", "600", 2);
    text(ctx, "THE GRID OVERLOADED — NO MAZE RATING", STAGE_W / 2, 392, 12, COL.text3, "center", "500", 1);
  }

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
