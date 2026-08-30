// Arc Foundry — the renderer (specs/overview.md, specs/yard.md, specs/hud.md,
// specs/ui.md, specs/assets.md).
//
// Nothing the engine's declarative pipeline states could draw this stage, so the whole
// picture is drawn directly, through the two `DrawComponent`s the yard actor carries
// (`src/yard.ts`). Each is handed a context that arrives cleared and already carrying
// the world-to-device transform, and the game leaves the camera at rest, so everything
// below is in `STAGE_W x STAGE_H` units that are world and logical units at once. The
// yard substrate and its grid, each map's platforms and its entry and collector, the
// flow toward the sink, the maze of produced component, candidate, and blocker sprites
// with the quality ladder escalating rung by rung, the Load with its health bars and
// idle cycles, the shots in flight, the produced particle bursts, and the whole
// heads-up display and every menu.
//
// IT ONLY READS. Every function here takes the live state and returns nothing, and none
// of them writes a field of it, so a frame's drawing never moves the simulation. Where
// a control sits is `src/layout.ts`, which the pointer and the debug surface read too,
// so what is drawn and what a press activates can never drift apart.
//
// EVERY PRODUCED SPRITE HAS A CODE FALLBACK, in the piece's own accent. A file that did
// not arrive costs that file and nothing else, and the yard stays fully readable.

import {
  BAR_H,
  BOARD_W,
  BOARD_X,
  BOARD_Y,
  COMBO_MAX_LEVEL,
  COMPONENT_INFO,
  DIFFICULTIES,
  GRID_COLS,
  GRID_ROWS,
  HARVEST_PROMPT_SEND,
  HARVEST_PROMPT_START,
  INTEGRITY_ALERT,
  MAPS,
  MAX_QUALITY,
  PANEL_X,
  REFINEMENT_ODDS,
  STAGE_H,
  STAGE_W,
  STAMPS_PER_LEVEL,
  TAGLINE_TEXT,
  TILE,
  TITLE_TEXT,
  type ComboId,
  type ComponentType,
  type FoundryMap,
  type LoadType,
} from "./constants";
import {
  BLOCKER_SPRITE,
  CHARGE_ICON,
  INTEGRITY_ICON,
  YARD_COLLECTOR,
  YARD_ENTRY,
  YARD_HOUSING,
  YARD_SUBSTRATE,
  YARD_WAYPOINT,
  loadStill,
  type Sprite,
} from "./assets";
import { boardOf, platformTiles } from "./board";
import {
  BOARD_PANEL,
  BOARD_ROW0,
  BOOK,
  DIFF_CARD_Y,
  INFO_H,
  INFO_Y,
  INSPECT_W,
  INSPECT_X,
  INSPECT_Y,
  MAP_CARD_Y,
  MAZE_READOUT,
  ODDS_BAR_H,
  ODDS_Y,
  PANEL_COL_W,
  PANEL_COL_X,
  PANEL_PROMPT_Y,
  controls,
  inRect,
  isHighlighted,
  leaderboardHoverId,
  leaderboardTop,
  type Control,
} from "./layout";
import { drawBursts } from "./particles";
import {
  canPlaceAt,
  combinablePieces,
  combineHighlight,
  difficulty,
  nextWavePreview,
  refineCost,
  selected,
  stampsLeft,
  statsOf,
  waveProgress,
} from "./sim";
import {
  COMBO_BY_ID,
  LOAD_BY_TYPE,
  abilityTags,
  baseStats,
  comboStats,
  footprintCenter,
  milestoneWaves,
  tileCenter,
  GRID_X0,
  GRID_Y0,
  FOOTPRINT_PX,
} from "./tables";
import {
  COL,
  COMBO_COLOR,
  DIFFICULTY_COLOR,
  FONT,
  MAP_BLURB,
  MAP_STYLE,
  QUALITY_COLOR,
  QUALITY_LABEL,
  QUALITY_ROMAN,
  TARGETING_LABEL,
  TYPE_COLOR,
  TYPE_LABEL,
  qualityIndex,
} from "./theme";
import type { Candidate, Component, Structure, Unit } from "./types";
import type { FoundryState } from "./state";

/** The right panel's width, and the yard's extent, as the drawing uses them. */
const BOARD_X1 = BOARD_X + BOARD_W;
const BOARD_Y1 = STAGE_H;

/**
 * What one frame accumulates while it draws.
 *
 * The tooltip a hovered row raises is drawn last, over everything, so it is collected
 * here as the panel is laid out rather than drawn where it was raised. It lives for one
 * frame and belongs to no one afterward.
 */
interface Frame {
  tooltip: { title: string; body: string; color: string; y: number } | null;
  /** The structure a hovered leaderboard row spotlights, or `null`. */
  focusId: number | null;
}

/**
 * The tiled substrate, built once per context.
 *
 * A pattern belongs to the context that made it, so it is rebuilt if the context ever
 * changes. It is a cache of a produced file and not state: nothing about the game
 * depends on whether it has been built yet.
 */
let substrate: {
  ctx: CanvasRenderingContext2D;
  pattern: CanvasPattern | null;
} | null = null;

// ---- Drawing helpers -----------------------------------------------------

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
    let cx =
      align === "center" ? x - total / 2 : align === "right" ? x - total : x;
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

/** The width `text` lays a string out at, mirroring both of its paths. */
function textWidth(
  ctx: CanvasRenderingContext2D,
  s: string,
  size: number,
  weight: string,
  letter: number,
): number {
  if (letter > 0) return [...s].length * (size * 0.6 + letter);
  ctx.font = `${weight} ${size}px ${FONT}`;
  return ctx.measureText(s).width;
}

/** Draw text, shrinking it just enough to fit, so a long line stays inside its box. */
function fitText(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  size: number,
  color: string,
  maxW: number,
  weight = "400",
  letter = 0,
  min = 6,
): void {
  let fs = size;
  while (fs > min && textWidth(ctx, s, fs, weight, letter) > maxW) fs -= 0.5;
  text(ctx, s, x, y, fs, color, "left", weight, letter);
}

function blit(
  ctx: CanvasRenderingContext2D,
  img: Sprite,
  cx: number,
  cy: number,
  w: number,
  h: number,
  angle = 0,
): void {
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.translate(cx, cy);
  if (angle) ctx.rotate(angle);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  ctx.restore();
}

/** A hex color at an alpha. */
function hexA(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

function ring(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  c: string,
  a: number,
  lw = 1.5,
): void {
  ctx.save();
  ctx.strokeStyle = hexA(c, a);
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function glow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  c: string,
  a: number,
): void {
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

/** Draw wrapped text and return the y just below the last line. */
function wrap(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  maxW: number,
  size: number,
  color: string,
  lineHeight = 18,
): number {
  ctx.font = `400 ${size}px ${FONT}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  let line = "";
  let yy = y;
  for (const word of s.split(" ")) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, yy);
      line = word;
      yy += lineHeight;
    } else line = test;
  }
  ctx.fillText(line, x, yy);
  return yy + lineHeight;
}

/** The lines a string wraps into, for measuring a card before drawing it. */
function wrapLines(
  ctx: CanvasRenderingContext2D,
  s: string,
  maxW: number,
  size: number,
): string[] {
  ctx.font = `400 ${size}px ${FONT}`;
  const lines: string[] = [];
  let line = "";
  for (const word of s.split(" ")) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = word;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

/** Letter-spaced text about a center, for the headings. */
function drawSpaced(
  ctx: CanvasRenderingContext2D,
  s: string,
  cx: number,
  y: number,
  size: number,
  letter: number,
): void {
  const chars = [...s];
  const adv = size * 0.62 + letter;
  let x = cx - (chars.length * adv) / 2 + adv / 2;
  ctx.textAlign = "center";
  for (const c of chars) {
    ctx.fillText(c, x, y);
    x += adv;
  }
}

/** A control's box and label, in one accent, drawn inert when it is disabled. */
function drawButton(
  ctx: CanvasRenderingContext2D,
  c: Control,
  color: string,
  size = 12,
): void {
  const enabled = !c.disabled;
  roundRect(ctx, c.x, c.y, c.w, c.h, 6);
  ctx.fillStyle = enabled ? hexA(color, 0.14) : "rgba(255,255,255,0.03)";
  ctx.fill();
  ctx.strokeStyle = enabled ? color : "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  text(
    ctx,
    c.label,
    c.x + c.w / 2,
    c.y + c.h / 2 + 1,
    size,
    enabled ? color : COL.text3,
    "center",
    "700",
  );
}

/** The controls of one kind, in draw order. */
function byKind(list: readonly Control[], kind: Control["kind"]): Control[] {
  return list.filter((c) => c.kind === kind);
}

/** The one control committing an action, or `undefined`. */
function byAction(
  list: readonly Control[],
  action: string,
): Control | undefined {
  return list.find((c) => c.action === action);
}

// ---- The two layers `src/yard.ts` draws ----------------------------------
//
// The split is the engine's rendering order made explicit: the yard and everything
// standing on it below, the heads-up display and every screen above. A screen that is
// not the yard draws nothing in the lower layer, which is what leaves the menus over
// the stage background the engine cleared to rather than over a half-drawn field.
//
// Both layers draw from the same `controls(g)` list `src/layout.ts` builds, which is
// what the pointer resolves a press against, so a control is drawn exactly where it is
// activated.

/** Whether this screen shows the yard behind whatever the upper layer draws. */
function onTheYard(g: FoundryState): boolean {
  return (
    g.screen === "playing" ||
    g.screen === "paused" ||
    g.screen === "victory" ||
    g.screen === "overload"
  );
}

/**
 * The lower layer: the yard, the Load walking it, the shots in flight, the produced
 * bursts, and the rock on the cursor.
 *
 * The waypoint numbers are drawn last, so a structure or a unit can never cover the
 * ordered chain.
 */
export function renderYardLayer(
  g: FoundryState,
  ctx: CanvasRenderingContext2D,
): void {
  ctx.imageSmoothingEnabled = true;
  if (!onTheYard(g)) return;

  const frame: Frame = { tooltip: null, focusId: leaderboardHoverId(g) };
  drawYard(g, ctx, frame);
  drawUnits(g, ctx);
  drawProjectiles(g, ctx);
  drawBursts(ctx, g.bursts);
  drawBuildCursor(g, ctx);
  drawWaypointNumbers(g, ctx);
}

/**
 * The upper layer: the current screen's chrome, its menus, and its overlays.
 *
 * The tooltip a hovered row raises is collected while the panel is drawn and floated
 * last, over everything, so the row it belongs to is never what covers it.
 */
export function renderUiLayer(
  g: FoundryState,
  ctx: CanvasRenderingContext2D,
): void {
  ctx.imageSmoothingEnabled = true;
  const list = controls(g);

  switch (g.screen) {
    case "title":
      drawTitle(g, ctx, list);
      return;
    case "mapselect":
      drawMapSelect(g, ctx, list);
      return;
    case "difficultyselect":
      drawDifficultySelect(g, ctx, list);
      return;
    case "howto":
      drawHowto(g, ctx, list);
      return;
    default:
      break;
  }

  const frame: Frame = { tooltip: null, focusId: leaderboardHoverId(g) };
  drawStatusBar(g, ctx, list);
  drawPanel(g, ctx, list, frame);
  drawTooltip(ctx, frame);

  if (g.screen === "playing" && g.showCombos) drawRecipeBook(g, ctx, list);
  if (g.screen === "playing" && g.showDamage)
    drawLeaderboard(g, ctx, list, frame);

  if (g.screen === "paused") drawPauseMenu(g, ctx, list);
  if (g.screen === "victory") drawEnd(g, ctx, list, true);
  if (g.screen === "overload") drawEnd(g, ctx, list, false);
}

// ---- The yard ------------------------------------------------------------

function drawYard(
  g: FoundryState,
  ctx: CanvasRenderingContext2D,
  frame: Frame,
): void {
  const board = boardOf(g.mapId);
  const A = g.assets;

  ctx.fillStyle = COL.substrate;
  ctx.fillRect(BOARD_X, BOARD_Y, BOARD_W, BOARD_Y1 - BOARD_Y);
  const tile = A.sprite(YARD_SUBSTRATE);
  if (tile) {
    if (!substrate || substrate.ctx !== ctx) {
      ctx.imageSmoothingEnabled = false;
      substrate = { ctx, pattern: ctx.createPattern(tile, "repeat") };
    }
    if (substrate.pattern) {
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = substrate.pattern;
      ctx.fillRect(BOARD_X, BOARD_Y, BOARD_W, BOARD_Y1 - BOARD_Y);
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

  const housing = A.sprite(YARD_HOUSING);
  for (const h of board.map.housings) {
    const x = GRID_X0 + h.minCol * TILE;
    const y = GRID_Y0 + h.minRow * TILE;
    const w = (h.maxCol - h.minCol + 1) * TILE;
    const hh = (h.maxRow - h.minRow + 1) * TILE;
    if (housing) {
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(housing, x, y, w, hh);
      ctx.restore();
    } else {
      ctx.fillStyle = COL.housing;
      ctx.fillRect(x, y, w, hh);
    }
    ctx.strokeStyle = hexA("#000000", 0.5);
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, w - 2, hh - 2);
  }

  drawFlow(g, ctx);
  drawPlatforms(g, ctx);
  drawWaypoints(g, ctx);

  // The range rings sit under the pieces so the pieces stay legible. A placed piece
  // whose roll is known previews its reach; a blocker has none.
  const sel = selected(g);
  if (sel && sel.kind === "component") {
    const at = footprintCenter(sel.col, sel.row);
    const st = statsOf(sel);
    const accent = sel.combo ? COMBO_COLOR[sel.combo] : TYPE_COLOR[sel.type];
    if (st.fires && st.range > 0) drawRange(ctx, at.x, at.y, st.range, accent);
    if (st.auraRadius > 0) drawAuraRange(ctx, at.x, at.y, st.auraRadius);
  } else if (sel && sel.kind === "candidate") {
    const at = footprintCenter(sel.col, sel.row);
    const st = baseStats(sel.type, sel.quality);
    if (st.range > 0)
      drawRange(ctx, at.x, at.y, st.range, TYPE_COLOR[sel.type]);
    if (st.auraRadius > 0) drawAuraRange(ctx, at.x, at.y, st.auraRadius);
  }

  // Every structure is a wall. While a leaderboard row is hovered, every piece but the
  // ranked one is drawn desaturated so the ranked one is unmistakable.
  for (const s of g.structures) {
    const dim = frame.focusId !== null && s.id !== frame.focusId;
    if (dim) {
      ctx.save();
      ctx.filter = "grayscale(1) brightness(0.72)";
    }
    if (s.kind === "component") drawComponent(g, ctx, s);
    else if (s.kind === "candidate") drawCandidate(g, ctx, s);
    else drawBlocker(g, ctx, s);
    if (dim) ctx.restore();
  }

  drawCombineMarks(g, ctx);
}

/**
 * The marks on the pieces that can fold.
 *
 * The ambient layer breathes softly on every piece that could fold into some combine
 * right now, so a player is told which pieces can fold without having to ask. The
 * focused layer marks the exact set the current selection would fold, brighter and on
 * top, in the combo accent once the set is explicit.
 */
function drawCombineMarks(g: FoundryState, ctx: CanvasRenderingContext2D): void {
  const byId = new Map<number, Structure>();
  for (const s of g.structures) byId.set(s.id, s);

  const mark = (
    id: number,
    accent: string,
    primary: boolean,
    ambient: boolean,
  ): void => {
    const s = byId.get(id);
    if (!s) return;
    const at = footprintCenter(s.col, s.row);
    const half = FOOTPRINT_PX / 2;
    const pulse = ambient
      ? 0.5 + 0.5 * Math.sin(g.clockTime * 3)
      : 0.5 + 0.5 * Math.sin(g.clockTime * 6);
    const grow = (primary ? 4 : 3) + 3 * pulse;
    ctx.save();
    glow(
      ctx,
      at.x,
      at.y,
      half + 12 + 6 * pulse,
      accent,
      (ambient ? 0.05 : 0.12) + (ambient ? 0.07 : 0.14) * pulse,
    );
    roundRect(
      ctx,
      at.x - half - grow,
      at.y - half - grow,
      (half + grow) * 2,
      (half + grow) * 2,
      6,
    );
    ctx.strokeStyle = hexA(
      accent,
      (ambient ? 0.22 : 0.5) + (ambient ? 0.22 : 0.45) * pulse,
    );
    ctx.lineWidth = ambient ? 1.5 : primary ? 2.5 : 2;
    ctx.setLineDash(ambient ? [5, 4] : []);
    ctx.stroke();
    ctx.restore();
  };

  const highlight = combineHighlight(g);
  const focused = new Set<number>(highlight.partnerIds);
  if (highlight.primaryId !== null) focused.add(highlight.primaryId);
  for (const id of combinablePieces(g)) {
    if (!focused.has(id)) mark(id, COL.charge, false, true);
  }
  if (highlight.primaryId === null && highlight.partnerIds.size === 0) return;
  const accent = highlight.committed ? COL.combo : COL.charge;
  if (highlight.primaryId !== null)
    mark(highlight.primaryId, accent, true, false);
  for (const id of highlight.partnerIds) mark(id, accent, false, false);
}

/** Each waypoint's platform: walkable plating a footprint may never cover. */
function drawPlatforms(g: FoundryState, ctx: CanvasRenderingContext2D): void {
  const board = boardOf(g.mapId);
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

/** The ordered chain, as a guide line with chevrons marching toward the collector. */
function drawFlow(g: FoundryState, ctx: CanvasRenderingContext2D): void {
  const pts = boardOf(g.mapId).chain.map((t) => tileCenter(t.col, t.row));
  ctx.save();
  ctx.strokeStyle = hexA(COL.flow, 0.35);
  ctx.lineWidth = 3;
  ctx.setLineDash([2, 10]);
  ctx.lineCap = "round";
  ctx.beginPath();
  pts.forEach((p, i) =>
    i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y),
  );
  ctx.stroke();
  ctx.restore();

  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    const angle = Math.atan2(uy, ux);
    const march = (g.clockTime * 40) % 40;
    for (let d = march; d < len; d += 40) {
      ctx.save();
      ctx.translate(a.x + ux * d, a.y + uy * d);
      ctx.rotate(angle);
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

/** The entry vent, the collector sink, and the studs on each waypoint platform. */
function drawWaypoints(g: FoundryState, ctx: CanvasRenderingContext2D): void {
  const chain = boardOf(g.mapId).chain;
  const A = g.assets;
  for (let i = 0; i < chain.length; i++) {
    const node = chain[i]!;
    const p = tileCenter(node.col, node.row);
    if (i === 0) {
      glow(
        ctx,
        p.x,
        p.y,
        26,
        COL.entry,
        0.28 + 0.06 * Math.sin(g.clockTime * 4),
      );
      const sprite = A.sprite(YARD_ENTRY);
      if (sprite) blit(ctx, sprite, p.x, p.y, FOOTPRINT_PX, FOOTPRINT_PX);
    } else if (i === chain.length - 1) {
      glow(
        ctx,
        p.x,
        p.y,
        28,
        COL.collector,
        0.26 + 0.06 * Math.sin(g.clockTime * 5),
      );
      const sprite = A.sprite(YARD_COLLECTOR);
      if (sprite) blit(ctx, sprite, p.x, p.y, FOOTPRINT_PX, FOOTPRINT_PX);
    } else {
      const sprite = A.sprite(YARD_WAYPOINT);
      if (sprite) {
        for (const t of platformTiles(node.col, node.row)) {
          const c = tileCenter(t.col, t.row);
          blit(ctx, sprite, c.x, c.y, TILE, TILE);
        }
      } else ring(ctx, p.x, p.y, 8, COL.flow, 0.8);
    }
  }
}

/** The order numbers, drawn over everything else on the yard. */
function drawWaypointNumbers(
  g: FoundryState,
  ctx: CanvasRenderingContext2D,
): void {
  if (g.screen === "title" || g.screen === "mapselect") return;
  const chain = boardOf(g.mapId).chain;
  for (let i = 1; i < chain.length - 1; i++) {
    const p = tileCenter(chain[i]!.col, chain[i]!.row);
    const by = p.y - 15;
    ctx.save();
    roundRect(ctx, p.x - 8, by - 7, 16, 14, 4);
    ctx.fillStyle = "rgba(5,8,12,0.82)";
    ctx.fill();
    ctx.strokeStyle = hexA(COL.integrity, 0.7);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
    text(ctx, `${i}`, p.x, by + 0.5, 10, COL.integrity, "center", "800");
  }
}

function drawRange(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  c: string,
): void {
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

/** The aura's own reach, shown while an aura structure is selected. */
function drawAuraRange(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
): void {
  ctx.save();
  ctx.strokeStyle = hexA(TYPE_COLOR.regulator, 0.7);
  ctx.fillStyle = hexA(TYPE_COLOR.regulator, 0.05);
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** The ground route, drawn while the maze readout is hovered. */
function drawMazePath(g: FoundryState, ctx: CanvasRenderingContext2D): void {
  const pts = g.mazePath;
  if (pts.length < 2) return;
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(5,8,12,0.7)";
  ctx.lineWidth = 6;
  ctx.beginPath();
  pts.forEach((p, i) =>
    i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y),
  );
  ctx.stroke();
  ctx.strokeStyle = hexA(COL.arc, 0.9);
  ctx.lineWidth = 2.5;
  ctx.setLineDash([9, 6]);
  ctx.lineDashOffset = -(g.clockTime * 40) % 15;
  ctx.beginPath();
  pts.forEach((p, i) =>
    i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y),
  );
  ctx.stroke();
  ctx.restore();
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  glow(ctx, first.x, first.y, 12, COL.legal, 0.5);
  glow(ctx, last.x, last.y, 12, COL.collector, 0.5);
}

// ---- Code-drawn stand-ins ------------------------------------------------

/** A mount plate in the piece's accent, under a code head. */
function codeBasePlate(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  color: string,
): void {
  ctx.save();
  ctx.fillStyle = hexA(color, 0.16);
  roundRect(ctx, cx - size / 2 + 3, cy - size / 2 + 3, size - 6, size - 6, 5);
  ctx.fill();
  ctx.strokeStyle = hexA(color, 0.5);
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}

/** A rotating head: a core and a barrel. Angle `0` points right, as the sprites do. */
function codeHead(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  angle: number,
  color: string,
): void {
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

/** The Regulator's read: a pulsing core with no barrel, so it never looks like it fires. */
function supportCore(
  g: FoundryState,
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  color: string,
): void {
  const pulse = 0.5 + 0.5 * Math.sin(g.clockTime * 4);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
    const r = size * 0.28;
    const px = Math.cos(a) * r;
    const py = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
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

/** A faint pulse around an aura source, so its support role reads on the yard. */
function auraPulse(
  g: FoundryState,
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
): void {
  const pulse = 0.5 + 0.5 * Math.sin(g.clockTime * 3);
  ring(
    ctx,
    cx,
    cy,
    size / 2 + 4 + pulse * 2,
    TYPE_COLOR.regulator,
    0.3 + 0.25 * pulse,
    1.5,
  );
}

/** The badge that marks a combination tower, so it never reads as a tiered component. */
function comboBadge(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  initial: string,
): void {
  const bx = cx - size / 2 + 9;
  const by = cy - size / 2 + 9;
  ctx.save();
  ctx.translate(bx, by);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = hexA(COL.combo, 0.95);
  roundRect(ctx, -7, -7, 14, 14, 2);
  ctx.fill();
  ctx.strokeStyle = hexA(COL.void, 0.6);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
  text(ctx, initial, bx, by + 0.5, 9, COL.void, "center", "800");
}

/** The quality badge: a ring at the footprint's edge and a numeral in its corner. */
function qualityBadge(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  quality: number,
  alpha: number,
): void {
  const q = qualityIndex(quality);
  const accent = QUALITY_COLOR[q]!;
  const roman = QUALITY_ROMAN[q]!;
  ring(ctx, cx, cy, size / 2 - 1, accent, alpha, 1.5);
  const bx = cx - size / 2 + 2;
  const by = cy - size / 2 + 2;
  const bw = 6 + roman.length * 5;
  roundRect(ctx, bx, by, bw, 11, 3);
  ctx.fillStyle = hexA(COL.void, 0.75);
  ctx.fill();
  text(ctx, roman, bx + bw / 2, by + 6, 8, accent, "center", "800");
}

/** The outline on the primary selection. */
function selectionOutline(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  color: string,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  roundRect(ctx, cx - size / 2, cy - size / 2, size, size, 5);
  ctx.stroke();
}

// ---- Structures ----------------------------------------------------------

/**
 * One firing structure: a fixed mount, a rotating head at its quality's finish, the
 * firing cycle just after a shot, and the quality read. A combination tower is drawn
 * distinctly, and the Regulator draws a support core rather than a head.
 */
function drawComponent(
  g: FoundryState,
  ctx: CanvasRenderingContext2D,
  c: Component,
): void {
  const at = footprintCenter(c.col, c.row);
  const size = FOOTPRINT_PX;
  if (c.combo) {
    drawComboTower(g, ctx, c, at.x, at.y, size);
    return;
  }
  const A = g.assets;
  const q = qualityIndex(c.quality);
  const qualityC = QUALITY_COLOR[q]!;
  const typeC = TYPE_COLOR[c.type];
  const nonFiring = c.type === "regulator";

  ring(ctx, at.x, at.y, size / 2 - 2, typeC, 0.5, 2);
  glow(ctx, at.x, at.y, 12 + c.quality * 4, qualityC, 0.12 + 0.05 * c.quality);

  const base = A.componentBase(c.type);
  if (base) blit(ctx, base, at.x, at.y, size, size, 0);
  else codeBasePlate(ctx, at.x, at.y, size, typeC);

  // The top rungs arc continuously at rest, so a Primed or Tesla-Prime piece reads as
  // wreathed in current even between shots.
  if (c.quality >= 4) {
    const n = c.quality >= 5 ? 5 : 3;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = hexA(COL.arc, c.quality >= 5 ? 0.5 : 0.32);
    ctx.lineWidth = 1;
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * Math.PI * 2 + g.clockTime * 3;
      ctx.beginPath();
      ctx.moveTo(at.x + Math.cos(a0) * 6, at.y + Math.sin(a0) * 6);
      ctx.lineTo(
        at.x + Math.cos(a0 + 1.2) * (size / 2 - 3),
        at.y + Math.sin(a0 + 1.2) * (size / 2 - 3),
      );
      ctx.stroke();
    }
    ctx.restore();
  }

  if (nonFiring) {
    supportCore(g, ctx, at.x, at.y, size, typeC);
    auraPulse(g, ctx, at.x, at.y, size);
  } else {
    const head = A.componentHead(c.type, c.quality);
    if (head) blit(ctx, head, at.x, at.y, size, size, c.aimAngle);
    else codeHead(ctx, at.x, at.y, size, c.aimAngle, typeC);
    if (c.type === "choke") {
      ring(
        ctx,
        at.x,
        at.y,
        size / 2 - 4,
        TYPE_COLOR.choke,
        0.35 + 0.2 * Math.sin(g.clockTime * 3 + c.id),
        1,
      );
    } else if (c.type === "rectifier") {
      glow(
        ctx,
        at.x,
        at.y,
        10,
        TYPE_COLOR.rectifier,
        0.16 + 0.12 * (0.5 + 0.5 * Math.sin(g.clockTime * 9 + c.id)),
      );
    }
    drawFireCycle(
      ctx,
      A.componentFire(c.type),
      c.fireAnim,
      at.x,
      at.y,
      size,
      c.aimAngle,
    );
  }

  if (g.selectedId === c.id) selectionOutline(ctx, at.x, at.y, size, COL.text);
  qualityBadge(ctx, at.x, at.y, size, c.quality, 0.85);
}

/** The frames a structure plays just after it fires. */
function drawFireCycle(
  ctx: CanvasRenderingContext2D,
  frames: readonly Sprite[],
  since: number,
  cx: number,
  cy: number,
  size: number,
  angle: number,
): void {
  if (frames.length === 0 || since >= 0.22) return;
  const idx = Math.min(
    frames.length - 1,
    Math.floor((since / 0.22) * frames.length),
  );
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = 0.9;
  blit(ctx, frames[idx]!, cx, cy, size, size, angle);
  ctx.restore();
}

/** A combination tower: a single-grade keystone with its own accent and badge. */
function drawComboTower(
  g: FoundryState,
  ctx: CanvasRenderingContext2D,
  c: Component,
  cx: number,
  cy: number,
  size: number,
): void {
  const combo = c.combo as ComboId;
  const def = COMBO_BY_ID[combo];
  const accent = COMBO_COLOR[combo];
  const A = g.assets;

  ring(ctx, cx, cy, size / 2 - 2, accent, 0.6, 2.5);
  glow(ctx, cx, cy, 18, accent, 0.2);
  glow(
    ctx,
    cx,
    cy,
    12,
    COL.combo,
    0.12 + 0.06 * (0.5 + 0.5 * Math.sin(g.clockTime * 3 + c.id)),
  );

  const base = A.comboBase(combo);
  if (base) blit(ctx, base, cx, cy, size, size, 0);
  else {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const r = size / 2 - 3;
      if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fillStyle = hexA(accent, 0.22);
    ctx.fill();
    ctx.strokeStyle = hexA(accent, 0.7);
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.strokeStyle = hexA(COL.combo, 0.4);
  ctx.lineWidth = 1;
  for (let k = 0; k < 3; k++) {
    const a0 = (k / 3) * Math.PI * 2 + g.clockTime * 2.2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a0) * 6, cy + Math.sin(a0) * 6);
    ctx.lineTo(
      cx + Math.cos(a0 + 1.1) * (size / 2 - 3),
      cy + Math.sin(a0 + 1.1) * (size / 2 - 3),
    );
    ctx.stroke();
  }
  ctx.restore();

  const head = A.comboHead(combo);
  if (head) blit(ctx, head, cx, cy, size, size, c.aimAngle);
  else codeHead(ctx, cx, cy, size, c.aimAngle, accent);
  drawFireCycle(ctx, A.comboFire(combo), c.fireAnim, cx, cy, size, c.aimAngle);

  if (statsOf(c).auraRadius > 0) auraPulse(g, ctx, cx, cy, size);
  if (g.selectedId === c.id) selectionOutline(ctx, cx, cy, size, COL.text);
  comboBadge(ctx, cx, cy, size, def.name.charAt(0));
}

/** An inert blocker: a hardened rock with no head, unmistakably dead. */
function drawBlocker(
  g: FoundryState,
  ctx: CanvasRenderingContext2D,
  s: Structure,
): void {
  const at = footprintCenter(s.col, s.row);
  const size = FOOTPRINT_PX;
  const sprite = g.assets.sprite(BLOCKER_SPRITE);
  if (sprite) blit(ctx, sprite, at.x, at.y, size, size, 0);
  else {
    ctx.fillStyle = COL.blocker;
    roundRect(
      ctx,
      at.x - size / 2 + 2,
      at.y - size / 2 + 2,
      size - 4,
      size - 4,
      4,
    );
    ctx.fill();
  }
  if (g.selectedId === s.id) {
    selectionOutline(ctx, at.x, at.y, size, hexA(COL.text, 0.7));
  }
}

/**
 * A candidate: the component it rolled, drawn uncommitted.
 *
 * Dimmed, inside a pulsing dashed outline and under a fresh-roll tag, so it never reads
 * as a settled firing structure, while its type and quality still read at a glance.
 */
function drawCandidate(
  g: FoundryState,
  ctx: CanvasRenderingContext2D,
  c: Candidate,
): void {
  const at = footprintCenter(c.col, c.row);
  const size = FOOTPRINT_PX;
  const q = qualityIndex(c.quality);
  const qualityC = QUALITY_COLOR[q]!;
  const typeC = TYPE_COLOR[c.type];
  const pulse = 0.5 + 0.5 * Math.sin(g.clockTime * 5);
  const A = g.assets;

  glow(ctx, at.x, at.y, 10 + c.quality * 3, qualityC, 0.08 + 0.03 * c.quality);

  ctx.save();
  ctx.globalAlpha = 0.6;
  const base = A.componentBase(c.type);
  if (base) blit(ctx, base, at.x, at.y, size, size, 0);
  else codeBasePlate(ctx, at.x, at.y, size, typeC);
  if (c.type === "regulator") supportCore(g, ctx, at.x, at.y, size, typeC);
  else {
    const head = A.componentHead(c.type, c.quality);
    if (head) blit(ctx, head, at.x, at.y, size, size, 0);
    else codeHead(ctx, at.x, at.y, size, 0, typeC);
  }
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = hexA(typeC, 0.35 + 0.45 * pulse);
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 3]);
  roundRect(ctx, at.x - size / 2, at.y - size / 2, size, size, 5);
  ctx.stroke();
  ctx.restore();

  qualityBadge(ctx, at.x, at.y, size, c.quality, 0.7);

  roundRect(ctx, at.x - 12, at.y + size / 2 - 11, 24, 11, 3);
  ctx.fillStyle = hexA(typeC, 0.85);
  ctx.fill();
  text(
    ctx,
    "NEW",
    at.x,
    at.y + size / 2 - 5,
    7,
    COL.void,
    "center",
    "800",
    0.5,
  );

  if (g.selectedId === c.id) selectionOutline(ctx, at.x, at.y, size, COL.text);
}

// ---- Shots and the Load --------------------------------------------------

/** Every shot in flight, drawn between where it stood and where it stands. */
function drawProjectiles(g: FoundryState, ctx: CanvasRenderingContext2D): void {
  const alpha = g.renderAlpha;
  for (const p of g.projectiles) {
    const px = p.prevX + (p.x - p.prevX) * alpha;
    const py = p.prevY + (p.y - p.prevY) * alpha;
    const accent = TYPE_COLOR[p.type];
    const sprite = g.assets.projectile(p.type);
    ctx.save();
    ctx.shadowColor = accent;
    ctx.shadowBlur = 8;
    if (sprite) blit(ctx, sprite, px, py, 16, 16, p.angle);
    else {
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = hexA(accent, 0.95);
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(px - Math.cos(p.angle) * 7, py - Math.sin(p.angle) * 7);
      ctx.lineTo(px + Math.cos(p.angle) * 7, py + Math.sin(p.angle) * 7);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function drawUnits(g: FoundryState, ctx: CanvasRenderingContext2D): void {
  for (const u of g.units) {
    if (u.dead) continue;
    drawUnit(g, ctx, u);
    drawHealthBar(g, ctx, u);
  }
}

function drawUnit(
  g: FoundryState,
  ctx: CanvasRenderingContext2D,
  u: Unit,
): void {
  const alpha = g.renderAlpha;
  const ux = u.prevX + (u.x - u.prevX) * alpha;
  const uy = u.prevY + (u.y - u.prevY) * alpha;
  const frames = g.assets.loadFrames(u.invincible ? "overload" : u.type);
  const size = u.radius * 2.4;
  const boss = u.type === "dynamo";

  // A flyer casts a shadow and rides above it, so it reads as airborne.
  if (u.flies) {
    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = "#000000";
    ctx.beginPath();
    ctx.ellipse(ux, uy + 8, u.radius, u.radius * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  const seethe = boss
    ? 1 + (u.invincible ? 0.1 : 0.06) * Math.sin(g.clockTime * 9 + u.id)
    : 1;
  glow(
    ctx,
    ux,
    uy,
    u.radius + (boss ? 12 : 4),
    boss ? COL.boss : COL.arc,
    boss ? 0.3 : 0.14,
  );
  if (u.invincible) {
    glow(
      ctx,
      ux,
      uy,
      u.radius + 22 + 6 * Math.sin(g.clockTime * 5),
      COL.boss,
      0.22,
    );
    ring(
      ctx,
      ux,
      uy,
      u.radius + 10 + 3 * Math.sin(g.clockTime * 4),
      COL.spark,
      0.5,
      2,
    );
  }

  if (frames.length > 0) {
    const idx = Math.floor((u.animT * 10 + u.id) % frames.length);
    blit(ctx, frames[idx]!, ux, uy, size * seethe, size * seethe, 0);
  } else {
    ctx.fillStyle = boss ? COL.boss : COL.text2;
    ctx.beginPath();
    ctx.arc(ux, uy, u.radius, 0, Math.PI * 2);
    ctx.fill();
  }

  if (u.slowFactor < 1) {
    ring(ctx, ux, uy, u.radius + 3, TYPE_COLOR.choke, 0.75, 1.5);
    glow(ctx, ux, uy, u.radius + 2, TYPE_COLOR.choke, 0.16);
  }
  if (u.burnDps > 0) {
    const flare = 0.22 + 0.18 * (0.5 + 0.5 * Math.sin(g.clockTime * 22 + u.id));
    glow(ctx, ux, uy, u.radius + 4, TYPE_COLOR.rectifier, flare);
  }
  if (u.hitFlash < 0.09) {
    glow(ctx, ux, uy, u.radius + 6, COL.spark, 0.5 * (1 - u.hitFlash / 0.09));
  }
}

function drawHealthBar(
  g: FoundryState,
  ctx: CanvasRenderingContext2D,
  u: Unit,
): void {
  const alpha = g.renderAlpha;
  const ux = u.prevX + (u.x - u.prevX) * alpha;
  const uy = u.prevY + (u.y - u.prevY) * alpha;
  // The finale's boss has no depleting health, so it carries a banner rather than a bar.
  if (u.invincible) {
    text(
      ctx,
      "OVERLOAD DYNAMO",
      ux,
      uy - u.radius - 14,
      10,
      COL.boss,
      "center",
      "800",
      0.5,
    );
    return;
  }
  const frac = u.maxHp > 0 ? Math.max(0, u.hp) / u.maxHp : 0;
  const w = Math.max(16, u.radius * 2.2);
  const h = u.type === "dynamo" ? 5 : 3;
  const x = ux - w / 2;
  const y = uy - u.radius - (u.flies ? 12 : 8);
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  ctx.fillStyle = frac > 0.5 ? COL.legal : frac > 0.25 ? COL.charge : COL.alert;
  ctx.fillRect(x, y, w * frac, h);
}

/**
 * The held rock, snapped to the grid with its legal read.
 *
 * A blank lump and a question mark: the type and the quality only roll when it lands, so
 * there is no head and no range ring to draw.
 */
function drawBuildCursor(g: FoundryState, ctx: CanvasRenderingContext2D): void {
  if (g.screen !== "playing" || !g.holding) return;
  const px = g.pointerX;
  const py = g.pointerY;
  if (px < BOARD_X || px > BOARD_X1 || py < BOARD_Y || py > BOARD_Y1) return;

  const anchor = boardOf(g.mapId).pixelToAnchor(px, py);
  const legal = canPlaceAt(g, anchor.col, anchor.row);
  const at = footprintCenter(anchor.col, anchor.row);
  const cue = legal ? COL.legal : COL.illegal;

  const x0 = GRID_X0 + anchor.col * TILE;
  const y0 = GRID_Y0 + anchor.row * TILE;
  ctx.save();
  ctx.fillStyle = hexA(cue, 0.28);
  ctx.fillRect(x0, y0, FOOTPRINT_PX, FOOTPRINT_PX);
  ctx.strokeStyle = cue;
  ctx.lineWidth = 2;
  ctx.strokeRect(x0 + 1, y0 + 1, FOOTPRINT_PX - 2, FOOTPRINT_PX - 2);
  ctx.restore();

  const blocker = g.assets.sprite(BLOCKER_SPRITE);
  ctx.save();
  ctx.globalAlpha = legal ? 0.8 : 0.4;
  if (blocker)
    blit(ctx, blocker, at.x, at.y, FOOTPRINT_PX - 4, FOOTPRINT_PX - 4, 0);
  ctx.restore();
  text(
    ctx,
    "?",
    at.x,
    at.y,
    18,
    legal ? COL.spark : COL.illegal,
    "center",
    "800",
  );
}

// ---- The status bar ------------------------------------------------------

function drawStatusBar(
  g: FoundryState,
  ctx: CanvasRenderingContext2D,
  list: readonly Control[],
): void {
  const A = g.assets;
  ctx.fillStyle = COL.panel;
  ctx.fillRect(0, 0, STAGE_W, BAR_H);
  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  ctx.beginPath();
  ctx.moveTo(0, BAR_H - 0.5);
  ctx.lineTo(STAGE_W, BAR_H - 0.5);
  ctx.stroke();

  const chargeIcon = A.sprite(CHARGE_ICON);
  if (chargeIcon) blit(ctx, chargeIcon, 26, 28, 18, 18);
  text(ctx, "CHARGE", 42, 20, 10, COL.text3, "left", "600", 1);
  text(ctx, `${Math.floor(g.charge)}`, 42, 36, 18, COL.charge, "left", "700");

  const low = g.integrity <= INTEGRITY_ALERT;
  const integrityIcon = A.sprite(INTEGRITY_ICON);
  if (integrityIcon) blit(ctx, integrityIcon, 176, 28, 18, 18);
  text(ctx, "GRID INTEGRITY", 192, 20, 10, COL.text3, "left", "600", 1);
  text(
    ctx,
    `${Math.max(0, Math.floor(g.integrity))}`,
    192,
    36,
    18,
    low ? COL.alert : COL.integrity,
    "left",
    "700",
  );

  const total = difficulty(g).waves;
  text(ctx, "WAVE", 380, 20, 10, COL.text3, "left", "600", 1);
  text(
    ctx,
    `${g.wave === 0 ? 1 : g.wave}`,
    380,
    36,
    18,
    COL.text,
    "left",
    "700",
  );
  text(ctx, `/ ${total}`, 412, 37, 13, COL.text2, "left", "500");

  let sub: string;
  let subColor: string;
  if (g.paused) {
    sub = "PAUSED";
    subColor = COL.alert;
  } else if (g.finale) {
    sub = "OVERLOAD";
    subColor = COL.boss;
  } else if (g.runPhase === "build") {
    sub = "BUILD";
    subColor = COL.integrity;
  } else {
    sub = `${Math.round(waveProgress(g) * 100)}%`;
    subColor = COL.text2;
  }
  text(ctx, sub, 470, 37, 12, subColor, "left", "600", 1);

  // The run keeps no running score. During the finale this slot carries the Maze Rating
  // as it accrues on the invincible boss.
  if (g.finale) {
    text(ctx, "OVERLOAD", 560, 20, 10, COL.boss, "left", "800", 1);
    text(
      ctx,
      `${Math.round(g.mazeRating).toLocaleString()}`,
      560,
      37,
      16,
      COL.spark,
      "left",
      "800",
    );
  }

  const mz = MAZE_READOUT;
  const hoverMaze = inRect(g.pointerX, g.pointerY, mz.x, mz.y, mz.w, mz.h);
  roundRect(ctx, mz.x, mz.y, mz.w, mz.h, 6);
  ctx.fillStyle = hoverMaze ? hexA(COL.flow, 0.22) : "rgba(255,255,255,0.05)";
  ctx.fill();
  ctx.strokeStyle = hoverMaze ? COL.arc : "rgba(255,255,255,0.10)";
  ctx.lineWidth = 1;
  ctx.stroke();
  text(ctx, "MAZE", mz.x + 10, mz.y + 12, 9, COL.text3, "left", "700", 1);
  text(
    ctx,
    hoverMaze ? "▸ PATH" : "hover ▸",
    mz.x + mz.w - 9,
    mz.y + 12,
    8,
    hoverMaze ? COL.arc : COL.text3,
    "right",
    "600",
  );
  const tiles = `${Math.round(g.mazeLength)}`;
  text(ctx, tiles, mz.x + 10, mz.y + 28, 16, COL.arc, "left", "700");
  text(
    ctx,
    "tiles",
    mz.x + 10 + tiles.length * 10 + 6,
    mz.y + 30,
    10,
    COL.text3,
    "left",
    "500",
  );
  if (hoverMaze) drawMazePath(g, ctx);

  for (const c of byKind(list, "bar")) {
    const on =
      (c.action === "combos" && g.showCombos) ||
      (c.action === "damage" && g.showDamage);
    if (c.action === "combos" || c.action === "damage") {
      roundRect(ctx, c.x, c.y, c.w, c.h, 6);
      ctx.fillStyle = on ? hexA(COL.integrity, 0.2) : "rgba(255,255,255,0.06)";
      ctx.fill();
      ctx.strokeStyle = on ? COL.integrity : "rgba(255,255,255,0.10)";
      ctx.lineWidth = on ? 1.5 : 1;
      ctx.stroke();
      text(
        ctx,
        c.label,
        c.x + c.w / 2,
        c.y + c.h / 2 + 1,
        11,
        on ? COL.integrity : COL.text2,
        "center",
        "700",
        0.3,
      );
      continue;
    }
    const accent =
      c.action === "pause" && g.paused
        ? COL.alert
        : c.action === "mute" && g.muted
          ? COL.text3
          : COL.text;
    roundRect(ctx, c.x, c.y, c.w, c.h, 6);
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.lineWidth = 1;
    ctx.stroke();
    text(
      ctx,
      c.label,
      c.x + c.w / 2,
      c.y + c.h / 2 + 1,
      14,
      accent,
      "center",
      "600",
    );
  }
}

// ---- The build panel -----------------------------------------------------

function drawPanel(
  g: FoundryState,
  ctx: CanvasRenderingContext2D,
  list: readonly Control[],
  frame: Frame,
): void {
  const A = g.assets;
  ctx.fillStyle = COL.panel;
  ctx.fillRect(PANEL_X, BAR_H, STAGE_W - PANEL_X, STAGE_H - BAR_H);
  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  ctx.beginPath();
  ctx.moveTo(PANEL_X + 0.5, BAR_H);
  ctx.lineTo(PANEL_X + 0.5, STAGE_H);
  ctx.stroke();

  const x = PANEL_COL_X;
  const w = PANEL_COL_W;

  drawQualityOdds(g, ctx, x, ODDS_Y, w);

  // The refinement control.
  const refine = byAction(list, "upgrade");
  const cost = refineCost(g);
  const atMax = cost === null;
  if (refine && refine.kind === "press") {
    const enabled = !refine.disabled;
    roundRect(ctx, refine.x, refine.y, refine.w, refine.h, 8);
    ctx.fillStyle = enabled
      ? hexA(COL.integrity, 0.14)
      : "rgba(255,255,255,0.03)";
    ctx.fill();
    ctx.strokeStyle = enabled ? COL.integrity : "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    text(
      ctx,
      refine.label,
      refine.x + 12,
      refine.y + 16,
      13,
      enabled ? COL.text : COL.text3,
      "left",
      "800",
      0.5,
    );
    text(
      ctx,
      atMax
        ? `R${g.refinement} · MAX`
        : `R${g.refinement} → R${g.refinement + 1}`,
      refine.x + 12,
      refine.y + 33,
      9,
      enabled ? COL.integrity : COL.text3,
      "left",
      "600",
      0.5,
    );
    if (atMax) {
      text(
        ctx,
        "MAX",
        refine.x + refine.w - 12,
        refine.y + 22,
        14,
        COL.text3,
        "right",
        "700",
      );
    } else {
      text(
        ctx,
        `${cost}`,
        refine.x + refine.w - 12,
        refine.y + 22,
        15,
        enabled ? COL.charge : COL.text3,
        "right",
        "700",
      );
      const icon = A.sprite(CHARGE_ICON);
      if (icon)
        blit(ctx, icon, refine.x + refine.w - 40, refine.y + 36, 12, 12);
    }
  }

  // The press control.
  const stamp = byAction(list, "stamp");
  if (stamp) {
    const enabled = !stamp.disabled;
    roundRect(ctx, stamp.x, stamp.y, stamp.w, stamp.h, 8);
    ctx.fillStyle = enabled ? hexA(COL.charge, 0.16) : "rgba(255,255,255,0.03)";
    ctx.fill();
    ctx.strokeStyle = enabled ? COL.charge : "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    text(
      ctx,
      stamp.label,
      stamp.x + 12,
      stamp.y + 17,
      15,
      enabled ? COL.text : COL.text3,
      "left",
      "800",
      1,
    );
    text(
      ctx,
      `${stampsLeft(g)} / ${STAMPS_PER_LEVEL} ROCKS LEFT`,
      stamp.x + 12,
      stamp.y + 34,
      9,
      COL.text3,
      "left",
      "500",
      0.5,
    );
  }

  // The inspector's frame.
  roundRect(ctx, x, INFO_Y, w, INFO_H, 8);
  ctx.fillStyle = "rgba(255,255,255,0.02)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 1;
  ctx.stroke();

  const sel = selected(g);
  if (g.holding) drawHeldInfo(g, ctx, INSPECT_X, INSPECT_Y, INSPECT_W);
  else if (sel) drawInspector(g, ctx, sel, list);
  else drawNextWave(g, ctx, INSPECT_X, INSPECT_Y, INSPECT_W, frame);

  // The harvest prompt: the panel's last line, and not a control.
  text(
    ctx,
    g.wave >= 1 ? HARVEST_PROMPT_SEND : HARVEST_PROMPT_START,
    x + w / 2,
    PANEL_PROMPT_Y + 12,
    9,
    COL.text3,
    "center",
    "700",
    0.5,
  );
}

/** The quality-roll odds at the live refinement level, as a stacked bar and a legend. */
function drawQualityOdds(
  g: FoundryState,
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
): void {
  const odds = REFINEMENT_ODDS[g.refinement]!;
  text(ctx, "QUALITY ODDS", x, y + 5, 9, COL.text3, "left", "700", 0.5);
  text(
    ctx,
    `R${g.refinement}`,
    x + w,
    y + 5,
    9,
    COL.integrity,
    "right",
    "700",
    0.5,
  );
  const barY = y + 14;
  const barH = ODDS_BAR_H;
  let cx = x;
  for (let q = 1; q <= MAX_QUALITY; q++) {
    const frac = odds[q - 1]!;
    const segW = frac * w;
    if (segW > 0.5) {
      ctx.fillStyle = hexA(QUALITY_COLOR[q - 1]!, 0.9);
      ctx.fillRect(cx, barY, Math.max(1, segW - 1), barH);
      if (segW >= 30) {
        text(
          ctx,
          `${Math.round(frac * 100)}%`,
          cx + segW / 2,
          barY + barH / 2 + 1,
          8,
          COL.void,
          "center",
          "800",
        );
      }
    }
    cx += segW;
  }
  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, barY + 0.5, w - 1, barH - 1);
  const parts: string[] = [];
  for (let q = 1; q <= MAX_QUALITY; q++) {
    if (odds[q - 1]! > 0) {
      parts.push(`${QUALITY_ROMAN[q - 1]} ${Math.round(odds[q - 1]! * 100)}%`);
    }
  }
  text(
    ctx,
    parts.join("  ·  "),
    x,
    barY + barH + 9,
    8,
    COL.text2,
    "left",
    "500",
    0.2,
  );
}

/** While a rock is on the cursor: no type and no quality, because it has not rolled. */
function drawHeldInfo(
  g: FoundryState,
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
): void {
  text(ctx, "PLACING ROCK", x, y + 6, 11, COL.charge, "left", "700", 1);
  const blocker = g.assets.sprite(BLOCKER_SPRITE);
  if (blocker) {
    ctx.save();
    ctx.globalAlpha = 0.8;
    blit(ctx, blocker, x + 24, y + 44, 40, 40, 0);
    ctx.restore();
  }
  text(ctx, "?", x + 24, y + 44, 20, COL.spark, "center", "800");
  wrap(
    ctx,
    "Drop it on a legal spot. It rolls a random component type and quality the instant it lands, and putting it away costs nothing.",
    x,
    y + 82,
    w,
    11,
    COL.text2,
    15,
  );
  text(
    ctx,
    `${stampsLeft(g)} / ${STAMPS_PER_LEVEL} ROCKS LEFT`,
    x,
    y + 148,
    10,
    COL.text3,
    "left",
    "500",
    0.5,
  );
  drawQualityOdds(g, ctx, x, y + 162, w);
}

/** The selected structure: what it is, what it does, and the actions it offers. */
function drawInspector(
  g: FoundryState,
  ctx: CanvasRenderingContext2D,
  s: Structure,
  list: readonly Control[],
): void {
  const x = INSPECT_X;
  const y = INSPECT_Y;
  const w = INSPECT_W;
  const A = g.assets;
  const actions = byKind(list, "panel");

  if (s.kind === "blocker") {
    text(ctx, "INERT BLOCKER", x, y + 6, 14, COL.text2, "left", "700", 0.5);
    wrap(
      ctx,
      "A hardened scrap rock. It walls the Load's route and never fires. Drop a fresh rock onto it to roll a new component in its place.",
      x,
      y + 32,
      w,
      11,
      COL.text2,
      15,
    );
    for (const c of actions) drawButton(ctx, c, COL.alert);
    return;
  }

  const comp = s.kind === "component" ? s : null;
  const combo = comp?.combo;
  const stats = comp ? statsOf(comp) : baseStats(s.type, s.quality);

  if (combo) {
    const def = COMBO_BY_ID[combo];
    const accent = COMBO_COLOR[combo];
    const head = A.comboHead(combo);
    if (head) blit(ctx, head, x + 18, y + 20, 40, 40, 0);
    else codeHead(ctx, x + 18, y + 20, 40, 0, accent);
    comboBadge(ctx, x + 18, y + 20, 40, def.name.charAt(0));
    text(ctx, def.name, x + 44, y + 12, 13, accent, "left", "700", 0.3);
    text(
      ctx,
      `COMBINATION · LEVEL ${comp!.comboLevel}/${COMBO_MAX_LEVEL}`,
      x + 44,
      y + 28,
      9,
      COL.combo,
      "left",
      "700",
      0.3,
    );
    text(
      ctx,
      "UPGRADE ANYTIME · HITS GROUND & AIR",
      x + 44,
      y + 42,
      8,
      COL.text3,
      "left",
      "500",
      0.3,
    );
  } else {
    const typeC = TYPE_COLOR[s.type];
    const q = qualityIndex(s.quality);
    const head = A.componentHead(s.type, s.quality);
    if (head) blit(ctx, head, x + 18, y + 20, 40, 40, 0);
    else if (s.type === "regulator")
      supportCore(g, ctx, x + 18, y + 20, 40, typeC);
    else codeHead(ctx, x + 18, y + 20, 40, 0, typeC);
    text(
      ctx,
      TYPE_LABEL[s.type],
      x + 44,
      y + 12,
      13,
      typeC,
      "left",
      "700",
      0.5,
    );
    text(
      ctx,
      `${QUALITY_LABEL[q]} · ${QUALITY_ROMAN[q]}`,
      x + 44,
      y + 28,
      11,
      QUALITY_COLOR[q]!,
      "left",
      "600",
      0.5,
    );
    const sub =
      s.kind === "candidate"
        ? "UNCOMMITTED ROLL"
        : !stats.fires
          ? "SUPPORT · DOES NOT FIRE"
          : "HITS GROUND & AIR";
    const subC =
      s.kind === "candidate"
        ? COL.charge
        : !stats.fires
          ? TYPE_COLOR.regulator
          : COL.text3;
    text(ctx, sub, x + 44, y + 42, 8, subC, "left", "500", 0.5);
  }

  const description = combo
    ? COMBO_BY_ID[combo].description
    : COMPONENT_INFO[s.type].description;
  let row = wrap(ctx, description, x, y + 68, w, 10, COL.text2, 14) + 4;
  const line = (k: string, v: string, color: string = COL.text): void => {
    text(ctx, k, x, row, 11, COL.text3, "left", "500", 0.5);
    text(ctx, v, x + w, row, 12, color, "right", "700");
    row += 18;
  };
  if (!stats.fires) {
    line(
      "AURA RADIUS",
      `${Math.round(stats.auraRadius)}`,
      TYPE_COLOR.regulator,
    );
    line(
      "DMG BONUS",
      `+${Math.round(stats.auraBonus * 100)}%`,
      TYPE_COLOR.regulator,
    );
  } else {
    line("DAMAGE", `${Math.round(stats.dmg)}`);
    line("RANGE", `${Math.round(stats.range)}`);
    line("FIRE RATE", `${stats.fireRate.toFixed(1)}/s`);
    if (stats.splash > 0)
      line("SPLASH", `${Math.round(stats.splash)}`, TYPE_COLOR.arcnode);
    if (stats.chainLeaps > 0)
      line("CHAIN", `+${stats.chainLeaps} leaps`, TYPE_COLOR.coil);
    if (stats.slowAmt > 0) {
      line(
        "SLOW",
        `-${Math.round(stats.slowAmt * 100)}% · ${stats.slowDur.toFixed(1)}s`,
        TYPE_COLOR.choke,
      );
    }
    if (stats.burnFrac > 0) {
      line(
        "BURN",
        `${Math.round(stats.burnFrac * 100)}%/s · ${stats.burnDur.toFixed(1)}s`,
        TYPE_COLOR.rectifier,
      );
    }
    if (stats.critChance > 0) {
      line(
        "CRIT",
        `${Math.round(stats.critChance * 100)}% · ×${stats.critMult.toFixed(1)}`,
        COL.combo,
      );
    }
    if (stats.multishot > 1)
      line("MULTISHOT", `${stats.multishot} targets`, TYPE_COLOR.emitter);
    if (stats.auraRadius > 0) {
      line(
        "AURA",
        `+${Math.round(stats.auraBonus * 100)}% · r${Math.round(stats.auraRadius)}`,
        TYPE_COLOR.regulator,
      );
    }
    if (comp && comp.auraBonus > 0) {
      line(
        "AURA BUFF",
        `+${Math.round(comp.auraBonus * 100)}%`,
        TYPE_COLOR.regulator,
      );
    }
  }
  if (comp) {
    if (stats.fires)
      line("TARGET", TARGETING_LABEL[comp.targeting], COL.integrity);
    line("KILLS", `${comp.kills}`, COL.charge);
    line(
      "DMG DEALT",
      `${Math.round(comp.damageDealt).toLocaleString()}`,
      COL.spark,
    );
  }

  // The action controls, each at the slot `src/layout.ts` fixed for it.
  for (const c of actions) {
    if (c.action === "combine-special") {
      drawRecipeRow(g, ctx, c);
      continue;
    }
    drawButton(ctx, c, actionAccent(c.action, s));
  }
  const specials = actions.filter((c) => c.action === "combine-special");
  if (specials.length > 0) {
    const top = specials[specials.length - 1]!;
    text(
      ctx,
      "COMBINE SPECIAL",
      x,
      top.y - 26,
      9,
      COL.combo,
      "left",
      "700",
      0.5,
    );
  }
}

/** The accent an inspector action is drawn in. */
function actionAccent(action: string, s: Structure): string {
  switch (action) {
    case "dismantle":
      return COL.alert;
    case "targeting":
      return COL.integrity;
    case "keep":
      return COL.charge;
    case "downgrade":
      return COL.text2;
    case "upgrade":
      return COL.combo;
    case "combine": {
      const quality = s.kind === "blocker" ? 1 : s.quality;
      return QUALITY_COLOR[qualityIndex(Math.min(MAX_QUALITY, quality + 1))]!;
    }
    default:
      return COL.text;
  }
}

/**
 * One reachable recipe's row: the tower it would build and the block it would land at.
 *
 * Each row paints its own opaque backing, so a long stats block above it is covered
 * rather than showing through.
 */
function drawRecipeRow(
  g: FoundryState,
  ctx: CanvasRenderingContext2D,
  c: Control,
): void {
  void g;
  const combo = c.payload as ComboId;
  const def = COMBO_BY_ID[combo];
  const accent = COMBO_COLOR[combo];
  const landing = comboStats(combo, 0);
  roundRect(ctx, c.x, c.y, c.w, c.h, 5);
  ctx.fillStyle = COL.panel;
  ctx.fill();
  ctx.fillStyle = hexA(accent, 0.1);
  ctx.fill();
  ctx.strokeStyle = hexA(accent, 0.5);
  ctx.lineWidth = 1;
  ctx.stroke();
  text(ctx, def.name, c.x + 8, c.y + 10, 10, accent, "left", "700", 0.3);
  const tags = abilityTags(landing).join("·");
  const preview = `${Math.round(landing.dmg)} dmg (Lv0) · ${Math.round(landing.range)} r${tags ? ` · ${tags}` : ""}`;
  fitText(ctx, preview, c.x + 8, c.y + 22, 8, COL.text2, c.w - 16, "500", 0.2);
}

/** With nothing selected, the coming wave's types and counts. */
function drawNextWave(
  g: FoundryState,
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  frame: Frame,
): void {
  const wave = nextWavePreview(g);
  const A = g.assets;
  text(ctx, "NEXT WAVE", x, y + 6, 11, COL.text3, "left", "700", 1);
  text(
    ctx,
    "HOVER A NAME FOR INTEL",
    x + w,
    y + 6,
    8,
    COL.text3,
    "right",
    "500",
    0.5,
  );
  text(
    ctx,
    wave.hasBoss ? `WAVE ${wave.wave} · BOSS` : `WAVE ${wave.wave}`,
    x,
    y + 26,
    15,
    wave.hasBoss ? COL.boss : COL.text,
    "left",
    "700",
    0.5,
  );

  const counts = new Map<LoadType, number>();
  for (const e of wave.events)
    counts.set(e.type, (counts.get(e.type) ?? 0) + 1);

  const rowH = 22;
  let row = y + 48;
  for (const type of wave.types) {
    const def = LOAD_BY_TYPE[type];
    const hover = inRect(g.pointerX, g.pointerY, x - 4, row - 2, w + 8, rowH);
    if (hover) {
      roundRect(ctx, x - 4, row - 2, w + 8, rowH - 2, 4);
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      ctx.fill();
    }
    const icon = A.sprite(loadStill(type));
    if (icon) blit(ctx, icon, x + 9, row + 7, 18, 18);
    text(
      ctx,
      def.name.toUpperCase(),
      x + 24,
      row + 7,
      11,
      type === "dynamo" ? COL.boss : hover ? COL.text : COL.text2,
      "left",
      "600",
      0.5,
    );
    const n = counts.get(type) ?? 0;
    text(
      ctx,
      n > 1 ? `×${n}` : def.flies ? "FLYER" : "",
      x + w,
      row + 7,
      10,
      COL.text3,
      "right",
      "500",
    );
    if (hover) {
      frame.tooltip = {
        title: def.name.toUpperCase(),
        body: def.description,
        color: type === "dynamo" ? COL.boss : COL.integrity,
        y: row + 7,
      };
    }
    row += rowH;
  }
}

/** The hovered row's tooltip, floated beside the panel and clamped to the stage. */
function drawTooltip(ctx: CanvasRenderingContext2D, frame: Frame): void {
  const tip = frame.tooltip;
  if (!tip) return;
  const boxW = 250;
  const pad = 12;
  const lines = wrapLines(ctx, tip.body, boxW - pad * 2, 11);
  const h = pad + 16 + 6 + lines.length * 15 + pad - 4;
  const bx = PANEL_X - boxW - 14;
  const by = Math.max(BAR_H + 8, Math.min(STAGE_H - h - 8, tip.y - h / 2));
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 18;
  roundRect(ctx, bx, by, boxW, h, 10);
  ctx.fillStyle = "rgba(12,17,24,0.97)";
  ctx.fill();
  ctx.restore();
  roundRect(ctx, bx, by, boxW, h, 10);
  ctx.strokeStyle = hexA(tip.color, 0.6);
  ctx.lineWidth = 1.5;
  ctx.stroke();
  text(
    ctx,
    tip.title,
    bx + pad,
    by + pad + 6,
    13,
    tip.color,
    "left",
    "800",
    0.5,
  );
  let yy = by + pad + 24;
  for (const ln of lines) {
    text(ctx, ln, bx + pad, yy, 11, COL.text2, "left", "400");
    yy += 15;
  }
}

// ---- The recipe book -----------------------------------------------------

/** The three states an ingredient reads in, against the yard as it stands. */
type IngredientState = "selected" | "owned" | "missing";

/**
 * Each of a recipe's ingredients, resolved to its state.
 *
 * Ownership is a multiset, so a recipe calling for two ingredients at the same type and
 * quality reads as covered only when the yard holds two: the pool is decremented as it
 * is spent, and the selection covers exactly one slot.
 */
function recipeStates(
  combo: ComboId,
  held: { type: ComponentType; quality: number } | null,
  owned: ReadonlyMap<string, number>,
): IngredientState[] {
  const pool = new Map(owned);
  let spent = false;
  return COMBO_BY_ID[combo].recipe.map((r) => {
    if (
      !spent &&
      held !== null &&
      r.type === held.type &&
      r.tier === held.quality
    ) {
      spent = true;
      return "selected";
    }
    const key = `${r.type}@${r.tier}`;
    const have = pool.get(key) ?? 0;
    if (have > 0) {
      pool.set(key, have - 1);
      return "owned";
    }
    return "missing";
  });
}

/** The selection's own ingredient, when it is one, for the book to fold against. */
function selectedIngredient(
  g: FoundryState,
): { type: ComponentType; quality: number } | null {
  const sel = selected(g);
  if (!sel) return null;
  if (sel.kind === "candidate") return { type: sel.type, quality: sel.quality };
  if (sel.kind === "component" && !sel.combo) {
    return { type: sel.type, quality: sel.quality };
  }
  return null;
}

/** The yard's ingredient pool, as counts, excluding the current selection. */
function ownedIngredients(g: FoundryState): Map<string, number> {
  const selectedId = selected(g)?.id ?? null;
  const out = new Map<string, number>();
  for (const s of g.structures) {
    if (s.id === selectedId) continue;
    if (s.kind === "blocker") continue;
    if (s.kind === "component" && s.combo) continue;
    const key = `${s.type}@${s.quality}`;
    out.set(key, (out.get(key) ?? 0) + 1);
  }
  return out;
}

/** A recipe as its ingredient list, each token in the state the yard puts it in. */
function drawRecipe(
  g: FoundryState,
  ctx: CanvasRenderingContext2D,
  combo: ComboId,
  states: readonly IngredientState[],
  x: number,
  y: number,
  maxW: number,
  size: number,
): void {
  const recipe = COMBO_BY_ID[combo].recipe;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const sep = " + ";
  ctx.font = `400 ${size}px ${FONT}`;
  const sepW = ctx.measureText(sep).width;
  const pulse = 0.5 + 0.5 * Math.sin(g.clockTime * 3);
  let cx = x;
  let cy = y;
  for (let i = 0; i < recipe.length; i++) {
    const r = recipe[i]!;
    const state = states[i]!;
    const token = `${TYPE_LABEL[r.type]} ${QUALITY_ROMAN[qualityIndex(r.tier)]}`;
    const weight =
      state === "selected" ? "800" : state === "owned" ? "700" : "400";
    ctx.font = `${weight} ${size}px ${FONT}`;
    const tokenW = ctx.measureText(token).width;
    if (cx > x && cx + tokenW > x + maxW) {
      cx = x;
      cy += size + 3;
    }
    ctx.fillStyle =
      state === "selected"
        ? hexA(COL.charge, 0.55 + 0.45 * pulse)
        : state === "owned"
          ? COL.legal
          : COL.text2;
    ctx.fillText(token, cx, cy);
    cx += tokenW;
    if (i < recipe.length - 1) {
      ctx.font = `400 ${size}px ${FONT}`;
      ctx.fillStyle = COL.text3;
      ctx.fillText(sep, cx, cy);
      cx += sepW;
    }
  }
}

/** The read-only reference of all twelve towers, their recipes, and their stats. */
function drawRecipeBook(
  g: FoundryState,
  ctx: CanvasRenderingContext2D,
  list: readonly Control[],
): void {
  const held = selectedIngredient(g);
  const owned = ownedIngredients(g);
  const { x0, y0, x1, y1 } = BOOK;
  const w = x1 - x0;
  const h = y1 - y0;

  ctx.fillStyle = "rgba(4,6,10,0.55)";
  ctx.fillRect(BOARD_X, BAR_H, BOARD_W, STAGE_H - BAR_H);
  roundRect(ctx, x0, y0, w, h, 12);
  ctx.fillStyle = "rgba(12,17,24,0.98)";
  ctx.fill();
  ctx.strokeStyle = hexA(COL.combo, 0.5);
  ctx.lineWidth = 1.5;
  ctx.stroke();
  text(
    ctx,
    "COMBINATION TOWERS",
    x0 + 18,
    y0 + 22,
    15,
    COL.combo,
    "left",
    "800",
    1,
  );
  text(
    ctx,
    "Assemble a rock plus the exact ingredients on the yard into a terminal tower. Hover a tower for what it does.",
    x0 + 18,
    y0 + 40,
    10,
    COL.text2,
    "left",
    "500",
    0.2,
  );

  const close = byAction(list, "combos");
  if (close && close.kind === "overlay") {
    roundRect(ctx, close.x, close.y, close.w, close.h, 6);
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.14)";
    ctx.lineWidth = 1;
    ctx.stroke();
    text(
      ctx,
      close.label,
      close.x + close.w / 2,
      close.y + close.h / 2 + 1,
      14,
      COL.text2,
      "center",
      "700",
    );
  }

  const gridY = y0 + 56;
  const gap = 12;
  const cols = 2;
  const rows = 6;
  const cellW = (w - 36 - gap) / cols;
  const cellH = (y1 - gridY - 16 - (rows - 1) * gap) / rows;
  let hovered: ComboId | null = null;
  const ids = COMBO_BY_ID;
  const order = Object.keys(ids) as ComboId[];
  for (let i = 0; i < order.length; i++) {
    const combo = order[i]!;
    const def = ids[combo];
    const accent = COMBO_COLOR[combo];
    const cx = x0 + 18 + (i % cols) * (cellW + gap);
    const cy = gridY + Math.floor(i / cols) * (cellH + gap);
    const uses =
      held !== null &&
      def.recipe.some((r) => r.type === held.type && r.tier === held.quality);
    roundRect(ctx, cx, cy, cellW, cellH, 8);
    ctx.fillStyle = uses ? hexA(COL.charge, 0.14) : hexA(accent, 0.08);
    ctx.fill();
    ctx.strokeStyle = uses ? COL.charge : hexA(accent, 0.45);
    ctx.lineWidth = uses ? 1.8 : 1;
    ctx.stroke();
    if (inRect(g.pointerX, g.pointerY, cx, cy, cellW, cellH)) hovered = combo;
    text(ctx, def.name, cx + 12, cy + 15, 12, accent, "left", "800", 0.3);
    const reference = comboStats(combo, COMBO_MAX_LEVEL);
    const tags = abilityTags(reference).join("·");
    text(
      ctx,
      `${def.damage} dmg · ${Math.round(def.range)} r · ${def.fireRate.toFixed(1)}/s${tags ? ` · ${tags}` : ""}`,
      cx + 12,
      cy + 31,
      8,
      COL.text2,
      "left",
      "600",
      0.2,
    );
    const states = recipeStates(combo, held, owned);
    const have = states.filter((st) => st !== "missing").length;
    text(
      ctx,
      `RECIPE · ${have}/${states.length} ON YARD`,
      cx + 12,
      cy + 45,
      7,
      have === states.length ? COL.legal : COL.text3,
      "left",
      "700",
      0.5,
    );
    drawRecipe(g, ctx, combo, states, cx + 12, cy + 57, cellW - 24, 9);
  }

  if (hovered) drawComboTooltip(g, ctx, hovered);
}

/** A card describing what a hovered tower does, clamped inside the book. */
function drawComboTooltip(
  g: FoundryState,
  ctx: CanvasRenderingContext2D,
  combo: ComboId,
): void {
  const def = COMBO_BY_ID[combo];
  const accent = COMBO_COLOR[combo];
  const tw = 268;
  const lines = wrapLines(ctx, def.description, tw - 28, 11);
  const th = 46 + lines.length * 15;
  let cardX = g.pointerX + 16;
  if (cardX + tw > BOOK.x1 - 8) cardX = g.pointerX - 16 - tw;
  cardX = Math.max(BOOK.x0 + 8, Math.min(cardX, BOOK.x1 - 8 - tw));
  const cardY = Math.max(
    BOOK.y0 + 8,
    Math.min(g.pointerY + 12, BOOK.y1 - 8 - th),
  );
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 18;
  roundRect(ctx, cardX, cardY, tw, th, 8);
  ctx.fillStyle = "rgba(8,12,18,0.98)";
  ctx.fill();
  ctx.restore();
  roundRect(ctx, cardX, cardY, tw, th, 8);
  ctx.strokeStyle = hexA(accent, 0.8);
  ctx.lineWidth = 1.5;
  ctx.stroke();
  text(ctx, def.name, cardX + 14, cardY + 18, 13, accent, "left", "800", 0.4);
  wrap(ctx, def.description, cardX + 14, cardY + 40, tw - 28, 11, COL.text, 15);
}

// ---- The damage leaderboard ----------------------------------------------

function drawLeaderboard(
  g: FoundryState,
  ctx: CanvasRenderingContext2D,
  list: readonly Control[],
  frame: Frame,
): void {
  const top = leaderboardTop(g);
  const { x, y, w, rowH, headH } = BOARD_PANEL;
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
  text(ctx, "DAMAGE BOARD", x + 12, y + 16, 11, COL.spark, "left", "800", 1);

  const close = byAction(list, "damage");
  if (close && close.kind === "overlay") {
    roundRect(ctx, close.x, close.y, close.w, close.h, 5);
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fill();
    text(
      ctx,
      close.label,
      close.x + close.w / 2,
      close.y + close.h / 2 + 1,
      12,
      COL.text2,
      "center",
      "700",
    );
  }

  if (top.length === 0) {
    text(
      ctx,
      "No damage dealt yet.",
      x + 12,
      y + headH + 14,
      10,
      COL.text3,
      "left",
      "500",
    );
    return;
  }
  const most = top[0]!.damageDealt || 1;
  let ry = BOARD_ROW0;
  for (let i = 0; i < top.length; i++) {
    const c = top[i]!;
    const accent = c.combo ? COMBO_COLOR[c.combo] : TYPE_COLOR[c.type];
    const name = c.combo
      ? COMBO_BY_ID[c.combo].name
      : `${TYPE_LABEL[c.type]} ${QUALITY_ROMAN[qualityIndex(c.quality)]}`;
    const hovered = c.id === frame.focusId;
    if (hovered) {
      ctx.fillStyle = hexA(accent, 0.14);
      roundRect(ctx, x + 8, ry - 2, w - 16, rowH, 5);
      ctx.fill();
      ctx.strokeStyle = hexA(accent, 0.7);
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.fillStyle = hexA(accent, hovered ? 0.28 : 0.16);
    roundRect(ctx, x + 12, ry, (c.damageDealt / most) * (w - 24), rowH - 4, 4);
    ctx.fill();
    text(
      ctx,
      `${i + 1}`,
      x + 12,
      ry + (rowH - 4) / 2,
      10,
      COL.text3,
      "left",
      "700",
    );
    text(
      ctx,
      name,
      x + 28,
      ry + (rowH - 4) / 2,
      10,
      accent,
      "left",
      "700",
      0.2,
    );
    text(
      ctx,
      `${Math.round(c.damageDealt).toLocaleString()}`,
      x + w - 12,
      ry + (rowH - 4) / 2 - 5,
      10,
      COL.spark,
      "right",
      "700",
    );
    text(
      ctx,
      `${c.kills} kills`,
      x + w - 12,
      ry + (rowH - 4) / 2 + 6,
      8,
      COL.charge,
      "right",
      "500",
    );
    ry += rowH;
  }
}

// ---- The menu screens ----------------------------------------------------

/** A dim slice of yard behind a menu, for atmosphere. */
function drawSubstrateWash(
  g: FoundryState,
  ctx: CanvasRenderingContext2D,
): void {
  const tile = g.assets.sprite(YARD_SUBSTRATE);
  if (!tile) return;
  if (!substrate || substrate.ctx !== ctx) {
    ctx.imageSmoothingEnabled = false;
    substrate = { ctx, pattern: ctx.createPattern(tile, "repeat") };
  }
  if (!substrate.pattern) return;
  ctx.save();
  ctx.globalAlpha = 0.25;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = substrate.pattern;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
  ctx.restore();
}

function drawTitle(
  g: FoundryState,
  ctx: CanvasRenderingContext2D,
  list: readonly Control[],
): void {
  drawSubstrateWash(g, ctx);

  const grad = ctx.createLinearGradient(360, 0, 920, 0);
  grad.addColorStop(0, TYPE_COLOR.capacitor);
  grad.addColorStop(0.4, TYPE_COLOR.coil);
  grad.addColorStop(0.7, TYPE_COLOR.arcnode);
  grad.addColorStop(1, COL.charge);
  ctx.save();
  ctx.shadowColor = COL.arc;
  ctx.shadowBlur = 26;
  ctx.font = `800 88px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = grad;
  drawSpaced(ctx, TITLE_TEXT, STAGE_W / 2, 230, 88, 12);
  ctx.restore();
  text(ctx, TAGLINE_TEXT, STAGE_W / 2, 300, 15, COL.text2, "center", "500", 6);

  byKind(list, "menu").forEach((c, i) => {
    const on = isHighlighted(g, i);
    const cy = c.y + c.h / 2;
    text(
      ctx,
      c.label,
      STAGE_W / 2,
      cy,
      28,
      on ? COL.charge : COL.text,
      "center",
      "700",
      6,
    );
    if (on) {
      text(ctx, "▶", STAGE_W / 2 - 190, cy, 20, COL.charge, "center", "700");
      text(ctx, "◀", STAGE_W / 2 + 190, cy, 20, COL.charge, "center", "700");
    }
  });
  text(
    ctx,
    "↑↓ SELECT   ENTER CONFIRM   POINTER OK",
    STAGE_W / 2,
    660,
    13,
    COL.text3,
    "center",
    "500",
    4,
  );
}

/** A map's topology, drawn small on its card. */
function drawMapPreview(
  ctx: CanvasRenderingContext2D,
  map: FoundryMap,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  ctx.save();
  roundRect(ctx, x, y, w, h, 8);
  ctx.fillStyle = COL.substrate;
  ctx.fill();
  ctx.clip();
  const sx = (c: number): number => x + ((c + 0.5) / GRID_COLS) * w;
  const sy = (r: number): number => y + ((r + 0.5) / GRID_ROWS) * h;

  for (const housing of map.housings) {
    ctx.fillStyle = hexA(COL.housing, 0.9);
    ctx.fillRect(
      sx(housing.minCol) - 2,
      sy(housing.minRow) - 2,
      (housing.maxCol - housing.minCol + 1) * (w / GRID_COLS),
      (housing.maxRow - housing.minRow + 1) * (h / GRID_ROWS),
    );
  }

  const chain = [map.entry, ...map.waypoints, map.collector];
  ctx.strokeStyle = hexA(COL.flow, 0.9);
  ctx.lineWidth = 2.5;
  ctx.lineJoin = "round";
  ctx.beginPath();
  chain.forEach((t, i) =>
    i === 0
      ? ctx.moveTo(sx(t.col), sy(t.row))
      : ctx.lineTo(sx(t.col), sy(t.row)),
  );
  ctx.stroke();

  chain.forEach((t, i) => {
    const end = i === 0 || i === chain.length - 1;
    ctx.fillStyle =
      i === 0
        ? COL.entry
        : i === chain.length - 1
          ? COL.collector
          : COL.integrity;
    ctx.beginPath();
    ctx.arc(sx(t.col), sy(t.row), end ? 4 : 3, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();

  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  roundRect(ctx, x, y, w, h, 8);
  ctx.stroke();
}

function drawMapSelect(
  g: FoundryState,
  ctx: CanvasRenderingContext2D,
  list: readonly Control[],
): void {
  ctx.fillStyle = COL.void;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
  text(ctx, "SELECT MAP", STAGE_W / 2, 66, 32, COL.text, "center", "700", 6);
  text(
    ctx,
    "EVERY MAP PLAYS THE SAME CAMPAIGN — ONLY THE TOPOLOGY DIFFERS",
    STAGE_W / 2,
    104,
    12,
    COL.text3,
    "center",
    "500",
    2,
  );

  const items = byKind(list, "menu");
  MAPS.forEach((map, i) => {
    const c = items[i]!;
    const on = isHighlighted(g, i);
    roundRect(ctx, c.x, c.y, c.w, c.h, 12);
    ctx.fillStyle = on ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.02)";
    ctx.fill();
    ctx.strokeStyle = on ? COL.charge : "rgba(255,255,255,0.10)";
    ctx.lineWidth = on ? 2.5 : 1;
    ctx.stroke();
    drawMapPreview(ctx, map, c.x + 18, MAP_CARD_Y + 18, c.w - 36, 210);
    text(
      ctx,
      map.name,
      c.x + 20,
      MAP_CARD_Y + 254,
      22,
      on ? COL.charge : COL.text,
      "left",
      "800",
      1,
    );
    text(
      ctx,
      MAP_STYLE[map.id],
      c.x + 20,
      MAP_CARD_Y + 282,
      11,
      COL.integrity,
      "left",
      "700",
      2,
    );
    wrap(
      ctx,
      MAP_BLURB[map.id],
      c.x + 20,
      MAP_CARD_Y + 308,
      c.w - 40,
      12,
      COL.text3,
      17,
    );
  });

  const back = items[MAPS.length]!;
  drawButton(ctx, back, isHighlighted(g, MAPS.length) ? COL.charge : COL.text);
  text(
    ctx,
    "↑↓ SELECT   ENTER CONFIRM   POINTER OK",
    STAGE_W / 2,
    STAGE_H - 22,
    12,
    COL.text3,
    "center",
    "500",
    2,
  );
}

function drawDifficultySelect(
  g: FoundryState,
  ctx: CanvasRenderingContext2D,
  list: readonly Control[],
): void {
  ctx.fillStyle = COL.void;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
  text(
    ctx,
    "SELECT DIFFICULTY",
    STAGE_W / 2,
    66,
    32,
    COL.text,
    "center",
    "700",
    6,
  );
  text(
    ctx,
    "DIFFICULTY CHANGES ONLY THE WAVE COUNT AND ENEMY TOUGHNESS",
    STAGE_W / 2,
    104,
    12,
    COL.text3,
    "center",
    "500",
    2,
  );

  const items = byKind(list, "menu");
  DIFFICULTIES.forEach((d, i) => {
    const c = items[i]!;
    const on = isHighlighted(g, i);
    const accent = DIFFICULTY_COLOR[d.id];
    roundRect(ctx, c.x, c.y, c.w, c.h, 12);
    ctx.fillStyle = on ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.02)";
    ctx.fill();
    ctx.strokeStyle = on ? accent : "rgba(255,255,255,0.10)";
    ctx.lineWidth = on ? 2.5 : 1;
    ctx.stroke();
    const mid = c.x + c.w / 2;
    text(
      ctx,
      c.label,
      mid,
      DIFF_CARD_Y + 54,
      34,
      on ? accent : COL.text,
      "center",
      "800",
      4,
    );
    text(
      ctx,
      `${d.waves} WAVES`,
      mid,
      DIFF_CARD_Y + 110,
      20,
      COL.text,
      "center",
      "700",
      2,
    );
    text(
      ctx,
      "ENEMY TOUGHNESS",
      mid,
      DIFF_CARD_Y + 156,
      10,
      COL.text3,
      "center",
      "600",
      1,
    );
    text(
      ctx,
      `BASE ×${d.baseMult.toFixed(2)} · RAMP +${Math.round(d.k * 100)}%/WAVE`,
      mid,
      DIFF_CARD_Y + 182,
      13,
      COL.text2,
      "center",
      "600",
      1,
    );
    text(
      ctx,
      `LATE SURGE ×${d.r.toFixed(2)}/WAVE`,
      mid,
      DIFF_CARD_Y + 204,
      13,
      COL.alert,
      "center",
      "700",
      1,
    );
    text(
      ctx,
      `BOSS WAVES ${milestoneWaves(d).join(" · ")}`,
      mid,
      DIFF_CARD_Y + 236,
      11,
      COL.boss,
      "center",
      "600",
      1,
    );
    wrap(
      ctx,
      d.description,
      c.x + 22,
      DIFF_CARD_Y + 272,
      c.w - 44,
      12,
      COL.text3,
      17,
    );
  });

  const back = items[DIFFICULTIES.length]!;
  drawButton(
    ctx,
    back,
    isHighlighted(g, DIFFICULTIES.length) ? COL.charge : COL.text,
  );
  text(
    ctx,
    "↑↓ SELECT   ENTER CONFIRM   POINTER OK",
    STAGE_W / 2,
    STAGE_H - 22,
    12,
    COL.text3,
    "center",
    "500",
    2,
  );
}

/** The rules, in a player's words. */
function drawHowto(
  g: FoundryState,
  ctx: CanvasRenderingContext2D,
  list: readonly Control[],
): void {
  ctx.fillStyle = COL.void;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
  text(ctx, "HOW TO PLAY", STAGE_W / 2, 68, 30, COL.text, "center", "700", 5);
  text(
    ctx,
    "Press scrap into towers, maze the Load, and hold the grid.",
    STAGE_W / 2,
    104,
    14,
    COL.text2,
    "center",
    "400",
    0.5,
  );

  const cards: readonly [string, string, string][] = [
    [
      "GOAL",
      COL.integrity,
      "The Load spills from the vent and crawls to the collector. Every unit that grounds out drains Grid Integrity, and at zero the grid overloads and the run is lost. Clear every wave with integrity to spare and you win.",
    ],
    [
      "THE SCRAP-PRESS",
      COL.charge,
      "You do not buy towers, you press them. The press drops a free blank rock, and the instant it lands it rolls a random component type and quality. Place up to five rocks a level.",
    ],
    [
      "BUILD THE MAZE",
      COL.arc,
      "Every rock, component, and blocker is a wall. The Load takes the shortest open route through the numbered waypoints, so your walls send it the long way, past your guns. You can never seal a route shut.",
    ],
    [
      "KEEP AND COMBINE",
      TYPE_COLOR.regulator,
      "Each level you take one new component, and taking it sends the wave: keep a roll, downgrade it a rung, or combine rolls into something stronger. At any time, even mid-wave, a combine of your standing structures climbs the quality ladder and assembles combination towers, which you upgrade with Charge.",
    ],
    [
      "THE FINALE",
      COL.combo,
      "There is no send control. Committing your one harvest launches the wave. Survive it and the next build phase opens. After the final wave an unkillable Overload Dynamo walks your maze once, and the damage your structures deal it is your Maze Rating.",
    ],
  ];

  const colX = [150, 682];
  const colW = 448;
  const colY = [162, 162];
  for (let i = 0; i < cards.length; i++) {
    const column = i % 2;
    const [heading, accent, body] = cards[i]!;
    const x = colX[column]!;
    let y = colY[column]!;
    ctx.fillStyle = hexA(accent, 0.9);
    ctx.fillRect(x, y - 9, 3, 18);
    text(ctx, heading, x + 14, y, 15, accent, "left", "700", 1.5);
    y = wrap(ctx, body, x, y + 26, colW, 14, COL.text2, 20) + 22;
    colY[column] = y;
  }

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
    "B press · press to place and select · SHIFT-press to add to a combine set · K keep · G downgrade · C combine · U upgrade · T target · X dismantle · F speed · SPACE pause · V recipes · L damage · M mute · ↑ ↓ move · Enter confirm · Esc back",
    150,
    fy + 44,
    980,
    13,
    COL.text2,
    20,
  );

  const back = byKind(list, "menu")[0];
  if (back) drawButton(ctx, back, isHighlighted(g, 0) ? COL.charge : COL.text);
}

/** A wash over the frozen yard, under a modal panel. */
function dim(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = "rgba(5,8,12,0.72)";
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
}

function panelBox(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
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

function drawPauseMenu(
  g: FoundryState,
  ctx: CanvasRenderingContext2D,
  list: readonly Control[],
): void {
  dim(ctx);
  panelBox(ctx, 440, 200, 400, 320);
  text(ctx, "PAUSED", STAGE_W / 2, 252, 30, COL.text, "center", "700", 4);
  byKind(list, "menu").forEach((c, i) => {
    drawButton(ctx, c, isHighlighted(g, i) ? COL.charge : COL.text);
  });
}

function drawEnd(
  g: FoundryState,
  ctx: CanvasRenderingContext2D,
  list: readonly Control[],
  won: boolean,
): void {
  dim(ctx);
  panelBox(ctx, 400, 170, 480, 380);
  text(
    ctx,
    won ? "CONTAINMENT HELD" : "GRID OVERLOAD",
    STAGE_W / 2,
    222,
    14,
    won ? COL.integrity : COL.alert,
    "center",
    "700",
    3,
  );
  text(
    ctx,
    won ? "VICTORY" : "OVERLOAD",
    STAGE_W / 2,
    272,
    42,
    won ? COL.charge : COL.alert,
    "center",
    "800",
    4,
  );
  if (won) {
    text(
      ctx,
      `ALL ${difficulty(g).waves} WAVES SURVIVED`,
      STAGE_W / 2,
      322,
      16,
      COL.text,
      "center",
      "600",
      2,
    );
    text(
      ctx,
      "MAZE RATING",
      STAGE_W / 2,
      352,
      12,
      COL.text3,
      "center",
      "700",
      2,
    );
    text(
      ctx,
      `${Math.round(g.mazeRating).toLocaleString()}`,
      STAGE_W / 2,
      380,
      30,
      COL.charge,
      "center",
      "800",
      1,
    );
    text(
      ctx,
      `GRID INTEGRITY ${Math.max(0, Math.floor(g.integrity))} LEFT`,
      STAGE_W / 2,
      410,
      13,
      COL.integrity,
      "center",
      "500",
      1,
    );
  } else {
    text(
      ctx,
      `REACHED WAVE ${g.wave} / ${difficulty(g).waves}`,
      STAGE_W / 2,
      352,
      20,
      COL.text,
      "center",
      "600",
      2,
    );
    text(
      ctx,
      "THE GRID OVERLOADED — NO MAZE RATING",
      STAGE_W / 2,
      392,
      12,
      COL.text3,
      "center",
      "500",
      1,
    );
  }
  byKind(list, "menu").forEach((c, i) => {
    drawButton(ctx, c, isHighlighted(g, i) ? COL.charge : COL.text, 14);
  });
}
