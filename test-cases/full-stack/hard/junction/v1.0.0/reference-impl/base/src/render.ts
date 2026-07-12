// Junction — the frame (specs/overview.md, specs/map.md, specs/flow.md, DESIGN §4, §5).
//
// Draws the whole 1280×720 stage in logical space. The city view (y∈[64,656]) is drawn under
// a camera WORLD transform so terrain, zoned lots, developed building sprites, roads/rail/
// stations, wire/pipe, the 2×2 plant/source, the live pollution haze, interpolated vehicles,
// animated junction signals, and the milestone/dust bursts all draw in world coordinates and
// track the camera for free. Over that go the toggleable data overlays (overlays.ts) and the
// selection / tool-ghost / refusal feedback. The two HUD strips (hud.ts) and the menu / state
// screens (title / how-to / pause / bankruptcy) are drawn in screen space on top. The sim is
// only READ here — never mutated. Returns the frame's clickable regions so the input layer
// routes pointer events without re-deriving the layout. Mirrors valence's render.ts.

import {
  COL,
  FONT,
  NET_PIPE,
  NET_RAIL,
  NET_ROAD,
  NET_SPAN,
  NET_STATION,
  NET_WIRE,
  STAGE_H,
  STAGE_W,
  TERRAIN_ORDER,
  TILE,
  TOOL_BY_KIND,
  VIEW_Y0,
  VIEW_Y1,
  ZONE_COLOR,
} from "./constants";
import { roadSprite, zoneSprite, type Assets } from "./assets";
import { drawHud, blit, hexA, inRect, lineCount, roundRect, text, wrap } from "./hud";
import { drawOverlay } from "./overlays";
import { colOf, idx, inBounds, rowOf } from "./grid";
import type { Bursts, Haze, HazePatch } from "./particles";
import type { Clickable, Tool } from "./types";
import type { Game, MenuItem } from "./sim";

// The particle players the frame draws (updated by main.ts, only drawn here).
export interface RenderFx {
  haze: Haze;
  bursts: Bursts;
}

// ---- Module render state (set each frame by main.ts, valence pattern) ----------
let time = 0;
let menuIndex = 0;
let muted = false;
let pointerX = -1;
let pointerY = -1;
let dragAnchor = -1; // tile the current tool-drag started on (-1 = not dragging)

export function setRenderTime(t: number): void {
  time = t;
}
export function setMenuIndex(i: number): void {
  menuIndex = i;
}
export function setMuted(m: boolean): void {
  muted = m;
}
export function setPointer(x: number, y: number): void {
  pointerX = x;
  pointerY = y;
}
export function setDragAnchor(tile: number): void {
  dragAnchor = tile;
}

const VIEW_CY = (VIEW_Y0 + VIEW_Y1) / 2;
const TERRAIN_COL = TERRAIN_ORDER.map((t) => COL[t]);

// ---- Entry ---------------------------------------------------------------------
export function render(ctx: CanvasRenderingContext2D, game: Game, assets: Assets, fx: RenderFx): Clickable[] {
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = COL.bg;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);

  const clicks: Clickable[] = [];

  if (game.state === "title") {
    drawCityScene(ctx, game, assets, fx, true);
    drawTitle(ctx, game, clicks);
    return clicks;
  }
  if (game.state === "howto") {
    drawHowto(ctx, clicks);
    return clicks;
  }

  // playing / paused / bankrupt all show the live board + HUD underneath.
  drawCityScene(ctx, game, assets, fx, false);
  drawCursorFeedback(ctx, game); // refusal / cost text in screen space, over the board
  drawInspector(ctx, game);
  drawHud(ctx, game, assets, clicks, pointerX, pointerY, muted);
  drawNotifications(ctx, game);

  if (game.state === "paused") drawPause(ctx, game, clicks);
  if (game.state === "bankrupt") drawBankrupt(ctx, game, clicks);

  return clicks;
}

// ---- City view (drawn under the camera world transform) ------------------------
function drawCityScene(ctx: CanvasRenderingContext2D, game: Game, assets: Assets, fx: RenderFx, dim: boolean): void {
  const cam = game.camera;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, VIEW_Y0, STAGE_W, VIEW_Y1 - VIEW_Y0);
  ctx.clip();
  ctx.fillStyle = COL.bg;
  ctx.fillRect(0, VIEW_Y0, STAGE_W, VIEW_Y1 - VIEW_Y0);

  ctx.save();
  ctx.translate(STAGE_W / 2, VIEW_CY);
  const s = cam.scale;
  ctx.scale(s, s);
  ctx.translate(-cam.cx, -cam.cy);
  ctx.imageSmoothingEnabled = false;

  const range = cam.visibleTileRange();
  drawTerrain(ctx, game, range);
  drawLotsAndBuildings(ctx, game, assets, range);
  drawCarriers(ctx, game, assets, range);
  drawSources(ctx, game, assets);
  fx.haze.draw(ctx, hazePatches(game, range));
  drawVehicles(ctx, game, assets);
  drawSignals(ctx, game, assets);
  fx.bursts.draw(ctx);
  drawOverlay(ctx, game, cam, game.overlay);
  if (!dim) drawToolCells(ctx, game, assets);
  if (!dim) drawTileHighlight(ctx, game);

  ctx.restore();

  if (dim) {
    ctx.fillStyle = "rgba(10,13,18,0.62)";
    ctx.fillRect(0, VIEW_Y0, STAGE_W, VIEW_Y1 - VIEW_Y0);
  }
  ctx.restore();
}

interface TileRange {
  c0: number;
  r0: number;
  c1: number;
  r1: number;
}

function drawTerrain(ctx: CanvasRenderingContext2D, game: Game, range: TileRange): void {
  const w = game.world;
  const t = time;
  for (let row = range.r0; row <= range.r1; row++) {
    for (let col = range.c0; col <= range.c1; col++) {
      const i = idx(col, row);
      const code = w.terrain[i]!;
      ctx.fillStyle = TERRAIN_COL[code]!;
      ctx.fillRect(col * TILE, row * TILE, TILE + 0.6, TILE + 0.6);
      // Water shimmers faintly so the river reads as a live amenity.
      if (code === 2) {
        ctx.fillStyle = hexA("#3d7f9c", 0.12 + 0.08 * Math.sin(t * 1.6 + col * 0.7 + row));
        ctx.fillRect(col * TILE, row * TILE, TILE + 0.6, TILE + 0.6);
      }
    }
  }
}

// Empty zoned lots (code-drawn hatch, ASSETS.md §1.1) and developed building sprites, with
// the construction sheet playing while a lot builds or upgrades.
function drawLotsAndBuildings(ctx: CanvasRenderingContext2D, game: Game, assets: Assets, range: TileRange): void {
  const w = game.world;
  const cframes = assets.anim.construction;
  const cf = cframes.length ? cframes[Math.floor(time * 8) % cframes.length]! : null;
  for (let row = range.r0; row <= range.r1; row++) {
    for (let col = range.c0; col <= range.c1; col++) {
      const i = idx(col, row);
      const zk = w.zoneAt(i);
      if (!zk) continue;
      const tier = w.tier[i]!;
      const cx = (col + 0.5) * TILE;
      const drawW = TILE * 1.08;
      const drawH = TILE * 1.2;
      const cy = (row + 1) * TILE - drawH / 2 + 1.5;
      if (tier > 0) {
        blit(ctx, assets.sprite(zoneSprite(zk, tier)), cx, cy, drawW, drawH, 0);
      } else {
        drawEmptyLot(ctx, col, row, ZONE_COLOR[zk]);
      }
      // Construction sheet over a lot that is building (tier 0) or upgrading (build>0).
      if (cf && w.build[i]! > 0) {
        ctx.save();
        ctx.globalAlpha = 0.9;
        blit(ctx, cf, cx, cy, drawW, drawH, 0);
        ctx.restore();
      }
      // Dilapidation read — a decaying developed tile darkens.
      if (tier > 0 && w.decay[i]! > 0) {
        ctx.fillStyle = hexA("#12161c", 0.5 * Math.min(1, w.decay[i]!));
        ctx.fillRect(col * TILE, row * TILE, TILE + 0.6, TILE + 0.6);
      }
    }
  }
}

function drawEmptyLot(ctx: CanvasRenderingContext2D, col: number, row: number, color: string): void {
  const x = col * TILE + 1;
  const y = row * TILE + 1;
  const sz = TILE - 2;
  ctx.fillStyle = hexA(color, 0.14);
  ctx.fillRect(x, y, sz, sz);
  ctx.strokeStyle = hexA(color, 0.5);
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.strokeRect(x + 0.5, y + 0.5, sz - 1, sz - 1);
  ctx.setLineDash([]);
}

// Road (shape-selected), rail, station, then wire/pipe (DESIGN §5.1 draw order), plus a small
// bridge/tunnel mark on span tiles.
function drawCarriers(ctx: CanvasRenderingContext2D, game: Game, assets: Assets, range: TileRange): void {
  const w = game.world;
  for (let row = range.r0; row <= range.r1; row++) {
    for (let col = range.c0; col <= range.c1; col++) {
      const i = idx(col, row);
      const n = w.net[i]!;
      if (n === 0) continue;
      const cx = (col + 0.5) * TILE;
      const cy = (row + 0.5) * TILE;
      if (n & NET_ROAD) {
        const { sprite, rot } = roadSprite(roadMask(w, col, row));
        blit(ctx, assets.sprite(sprite), cx, cy, TILE + 0.6, TILE + 0.6, rot);
      }
      if (n & (NET_RAIL | NET_STATION)) {
        blit(ctx, assets.sprite("transit/rail"), cx, cy, TILE + 0.6, TILE + 0.6, runAngle(w, col, row, NET_RAIL | NET_STATION));
      }
      if (n & NET_STATION) {
        blit(ctx, assets.sprite("transit/station"), cx, cy, TILE + 0.6, TILE + 0.6, 0);
      }
      if (n & NET_WIRE) {
        blit(ctx, assets.sprite("utility/wire"), cx, cy, TILE, TILE, runAngle(w, col, row, NET_WIRE));
      }
      if (n & NET_PIPE) {
        blit(ctx, assets.sprite("utility/pipe"), cx, cy, TILE, TILE, runAngle(w, col, row, NET_PIPE));
      }
      if (n & NET_SPAN) {
        ctx.strokeStyle = hexA(COL.text3, 0.6);
        ctx.lineWidth = 1;
        ctx.strokeRect(col * TILE + 1.5, row * TILE + 1.5, TILE - 3, TILE - 3);
      }
    }
  }
}

// Road-connection bitmask (N=1,E=2,S=4,W=8) from road/station neighbours, for roadSprite.
function roadMask(w: Game["world"], col: number, row: number): number {
  let m = 0;
  if (hasNetAt(w, col, row - 1, NET_ROAD | NET_STATION)) m |= 1;
  if (hasNetAt(w, col + 1, row, NET_ROAD | NET_STATION)) m |= 2;
  if (hasNetAt(w, col, row + 1, NET_ROAD | NET_STATION)) m |= 4;
  if (hasNetAt(w, col - 1, row, NET_ROAD | NET_STATION)) m |= 8;
  return m;
}

// Rail/wire/pipe art is authored vertical; rotate a quarter-turn for a horizontal run.
function runAngle(w: Game["world"], col: number, row: number, bit: number): number {
  const h = hasNetAt(w, col - 1, row, bit) || hasNetAt(w, col + 1, row, bit);
  const v = hasNetAt(w, col, row - 1, bit) || hasNetAt(w, col, row + 1, bit);
  return h && !v ? Math.PI / 2 : 0;
}

function hasNetAt(w: Game["world"], col: number, row: number, bit: number): boolean {
  return inBounds(col, row) && (w.net[idx(col, row)]! & bit) !== 0;
}

// The 2×2 power plants and water sources (ASSETS.md §1.3), anchored at their top-left tile.
function drawSources(ctx: CanvasRenderingContext2D, game: Game, assets: Assets): void {
  for (const src of game.world.sources) {
    const cx = (src.col + 1) * TILE;
    const cy = (src.row + 1) * TILE;
    const sprite = src.kind === "plant" ? "utility/plant" : "utility/source";
    ctx.save();
    ctx.shadowColor = src.kind === "plant" ? COL.power : COL.pipe;
    ctx.shadowBlur = 8;
    blit(ctx, assets.sprite(sprite), cx, cy, TILE * 2 + 0.6, TILE * 2 + 0.6, 0);
    ctx.restore();
    // Over-draw read: an amber ring when the source is drawn to capacity.
    if (src.supplied >= src.capacity - 0.01) {
      ctx.strokeStyle = hexA(COL.alert, 0.6);
      ctx.lineWidth = 1.5;
      ctx.strokeRect(src.col * TILE + 1, src.row * TILE + 1, TILE * 2 - 2, TILE * 2 - 2);
    }
  }
}

// Sample the pollution field over the visible range into haze patches (thick over industry
// and jammed corridors), which particles.ts stamps its one simulated smog field across.
function hazePatches(game: Game, range: TileRange): HazePatch[] {
  const w = game.world;
  const patches: HazePatch[] = [];
  const STEP = 3;
  for (let row = range.r0; row <= range.r1; row += STEP) {
    for (let col = range.c0; col <= range.c1; col += STEP) {
      let sum = 0;
      let peak = 0;
      for (let dr = 0; dr < STEP; dr++) {
        for (let dc = 0; dc < STEP; dc++) {
          if (!inBounds(col + dc, row + dr)) continue;
          const p = w.pollution[idx(col + dc, row + dr)]!;
          sum += p;
          if (p > peak) peak = p;
        }
      }
      if (peak < 4) continue;
      patches.push({
        x: (col + STEP / 2) * TILE,
        y: (row + STEP / 2) * TILE,
        size: TILE * (STEP + 1),
        alpha: Math.min(0.72, sum / (STEP * STEP * 26)),
      });
      if (patches.length >= 160) return patches;
    }
  }
  return patches;
}

function drawVehicles(ctx: CanvasRenderingContext2D, game: Game, assets: Assets): void {
  const tramFrames = assets.anim.tram;
  for (const v of game.vehicles) {
    const p = { x: v.x, y: v.y }; // the core resolves the interpolated world position
    const ang = v.angle + Math.PI / 2; // art faces "up"; align to the heading
    if (v.kind === "tram") {
      const img = tramFrames.length ? tramFrames[Math.floor(v.animT * 10) % tramFrames.length]! : assets.sprite("vehicles/tram");
      blit(ctx, img, p.x, p.y, 11, 16, ang);
    } else {
      blit(ctx, assets.sprite(v.kind === "truck" ? "vehicles/truck" : "vehicles/car"), p.x, p.y, 12, 12, ang);
    }
  }
}

// Animated traffic signals at road junctions (ASSETS.md §2), on a 4-frame timer + per-signal
// phase so they are not all in lock-step.
function drawSignals(ctx: CanvasRenderingContext2D, game: Game, assets: Assets): void {
  const frames = assets.anim.signal;
  if (!frames.length) return;
  for (const sig of game.signals) {
    const f = Math.floor(time * 3 + sig.phase * frames.length) % frames.length;
    blit(ctx, frames[f]!, (sig.col + 0.5) * TILE, (sig.row + 0.5) * TILE - TILE * 0.28, 9, 9, 0);
  }
}

// ---- Selection & tool feedback (world space) -----------------------------------
function drawTileHighlight(ctx: CanvasRenderingContext2D, game: Game): void {
  if (game.selectedTile >= 0) cellOutline(ctx, game.selectedTile, COL.text, 2);
  if (game.hoverTile >= 0 && game.hoverTile !== game.selectedTile && !game.activeTool) cellOutline(ctx, game.hoverTile, hexA(COL.text, 0.55), 1);
}

function cellOutline(ctx: CanvasRenderingContext2D, tile: number, color: string, lw: number): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.strokeRect(colOf(tile) * TILE + 0.5, rowOf(tile) * TILE + 0.5, TILE - 1, TILE - 1);
}

interface ToolPreview {
  tool: Tool;
  cells: { i: number; ok: boolean }[];
  cost: number;
  refusal: string | null;
}

function computeToolPreview(game: Game): ToolPreview | null {
  const tool = game.activeTool;
  if (!tool || game.state !== "playing" || game.hoverTile < 0) return null;
  // The core computes the placement legality, span-aware cost, and refusal reason; the
  // renderer only draws the ghost. `dragAnchor` (the tile a drag began on) is passed so the
  // preview spans the whole in-progress run/rectangle (specs/simulation.md).
  const preview = game.toolPreview(dragAnchor, game.hoverTile);
  return { tool, cells: preview.cells, cost: preview.cost, refusal: preview.refusal };
}

function drawToolCells(ctx: CanvasRenderingContext2D, game: Game, assets: Assets): void {
  const preview = computeToolPreview(game);
  if (!preview) return;
  for (const cell of preview.cells) {
    const col = colOf(cell.i);
    const row = rowOf(cell.i);
    ctx.fillStyle = hexA(cell.ok ? COL.money : COL.alert, 0.22);
    ctx.fillRect(col * TILE, row * TILE, TILE, TILE);
    ctx.strokeStyle = hexA(cell.ok ? COL.money : COL.alert, 0.9);
    ctx.lineWidth = 1;
    ctx.strokeRect(col * TILE + 0.5, row * TILE + 0.5, TILE - 1, TILE - 1);
  }
  // Ghost sprite of a stamp tool at the hover tile, so the placement reads before the click.
  const tool = preview.tool;
  if (tool === "plant" || tool === "source") {
    const c0 = colOf(game.hoverTile);
    const r0 = rowOf(game.hoverTile);
    ctx.save();
    ctx.globalAlpha = 0.55;
    blit(ctx, assets.sprite(tool === "plant" ? "utility/plant" : "utility/source"), (c0 + 1) * TILE, (r0 + 1) * TILE, TILE * 2, TILE * 2, 0);
    ctx.restore();
  }
}

// The refusal reason / running cost, drawn in SCREEN space beside the pointer so it stays
// legible at any zoom (a red reason when illegal, a cost tally otherwise).
function drawCursorFeedback(ctx: CanvasRenderingContext2D, game: Game): void {
  if (pointerY < VIEW_Y0 || pointerY > VIEW_Y1) return;
  const preview = computeToolPreview(game);
  if (!preview) return;
  const label = preview.refusal ?? (preview.tool === "bulldoze" ? "BULLDOZE" : `${TOOL_BY_KIND[preview.tool].name} · $${preview.cost}`);
  const color = preview.refusal ? COL.alert : COL.text;
  ctx.font = `700 12px ${FONT}`;
  const tw = ctx.measureText(label).width;
  const bx = Math.min(STAGE_W - tw - 22, pointerX + 16);
  const by = Math.max(VIEW_Y0 + 8, pointerY - 30);
  roundRect(ctx, bx, by, tw + 16, 24, 6);
  ctx.fillStyle = hexA("#0a0d12", 0.82);
  ctx.fill();
  ctx.strokeStyle = hexA(color, 0.7);
  ctx.lineWidth = 1;
  ctx.stroke();
  text(ctx, label, bx + 8, by + 13, 12, color, "left", "700", 0.3);
}

// A compact inspector for the selected tile (screen space, top-left of the view).
function drawInspector(ctx: CanvasRenderingContext2D, game: Game): void {
  const i = game.selectedTile;
  if (i < 0) return;
  const w = game.world;
  const zk = w.zoneAt(i);
  const n = w.net[i]!;
  const src = game.sourceCovering(i);
  const x = 14;
  const y = VIEW_Y0 + 12;
  const bw = 188;
  const rows: [string, string, string][] = [];
  rows.push(["TILE", `${colOf(i)}, ${rowOf(i)}`, COL.text]);
  rows.push(["TERRAIN", TERRAIN_ORDER[w.terrain[i]!]!.toUpperCase(), COL.text2]);
  if (src) rows.push([src.kind === "plant" ? "POWER PLANT" : "WATER SOURCE", `${Math.round(src.supplied)}/${src.capacity}`, src.kind === "plant" ? COL.power : COL.pipe]);
  if (zk) rows.push(["ZONE", `${zk.toUpperCase()} · TIER ${w.tier[i]!}`, ZONE_COLOR[zk]]);
  if (n !== 0) rows.push(["NETWORK", carrierNames(n), COL.text2]);
  rows.push(["LAND VALUE", `${Math.round(w.land[i]! * 100)}%`, landTone(w.land[i]!)]);
  if (w.pollution[i]! > 1) rows.push(["POLLUTION", `${Math.round(w.pollution[i]!)}`, COL.pollution]);
  const svc = `${w.powered[i]! ? "P" : "·"} ${w.watered[i]! ? "W" : "·"} ${w.access[i]! ? "A" : "·"}`;
  rows.push(["SERVICE", svc, w.powered[i]! && w.watered[i]! && w.access[i]! ? COL.money : COL.text3]);

  const bh = 14 + rows.length * 16 + 8;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.5)";
  ctx.shadowBlur = 16;
  roundRect(ctx, x, y, bw, bh, 8);
  ctx.fillStyle = hexA(COL.panel, 0.94);
  ctx.fill();
  ctx.restore();
  roundRect(ctx, x, y, bw, bh, 8);
  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  ctx.lineWidth = 1;
  ctx.stroke();
  let ry = y + 16;
  for (const [k, v, c] of rows) {
    text(ctx, k, x + 12, ry, 9, COL.text3, "left", "600", 0.5);
    text(ctx, v, x + bw - 12, ry, 11, c, "right", "700");
    ry += 16;
  }
}

function carrierNames(n: number): string {
  const parts: string[] = [];
  if (n & NET_ROAD) parts.push("ROAD");
  if (n & NET_RAIL) parts.push("RAIL");
  if (n & NET_STATION) parts.push("STATION");
  if (n & NET_WIRE) parts.push("WIRE");
  if (n & NET_PIPE) parts.push("PIPE");
  if (n & NET_SPAN) parts.push("SPAN");
  return parts.join(" ") || "—";
}
function landTone(v: number): string {
  return v < 0.4 ? COL.alert : v < 0.65 ? COL.ind : COL.money;
}

// ---- Notifications (brief HUD toasts) ------------------------------------------
function drawNotifications(ctx: CanvasRenderingContext2D, game: Game): void {
  const toneColor = { info: COL.text, good: COL.money, alert: COL.alert };
  let y = VIEW_Y0 + 14;
  for (const note of game.notifications) {
    const fade = Math.max(0, Math.min(1, (note.ttl - note.age) / 1.2));
    ctx.font = `700 12px ${FONT}`;
    const tw = ctx.measureText(note.text).width;
    const bw = tw + 24;
    const x = STAGE_W / 2 - bw / 2;
    ctx.globalAlpha = fade;
    roundRect(ctx, x, y, bw, 26, 8);
    ctx.fillStyle = hexA(COL.panel, 0.92);
    ctx.fill();
    ctx.strokeStyle = hexA(toneColor[note.tone], 0.6);
    ctx.lineWidth = 1;
    ctx.stroke();
    text(ctx, note.text, STAGE_W / 2, y + 14, 12, toneColor[note.tone], "center", "700", 0.5);
    ctx.globalAlpha = 1;
    y += 32;
  }
}

// ---- Title / how-to / pause / bankruptcy (screen space) ------------------------
function drawTitle(ctx: CanvasRenderingContext2D, game: Game, clicks: Clickable[]): void {
  const grad = ctx.createLinearGradient(440, 0, 840, 0);
  grad.addColorStop(0, COL.res);
  grad.addColorStop(0.5, COL.com);
  grad.addColorStop(1, COL.ind);
  ctx.save();
  ctx.shadowColor = COL.com;
  ctx.shadowBlur = 22;
  ctx.font = `800 92px ${FONT}`;
  ctx.textBaseline = "middle";
  ctx.fillStyle = grad;
  drawSpaced(ctx, "JUNCTION", STAGE_W / 2, 234, 92, 12);
  ctx.restore();
  text(ctx, game.mode.tagline, STAGE_W / 2, 306, 16, COL.text2, "center", "600", 6);

  const items = game.menuItems();
  items.forEach((it, i) => {
    const y = 410 + i * 62;
    const on = highlighted(i, STAGE_W / 2 - 200, y - 26, 400, 52);
    text(ctx, it.label, STAGE_W / 2, y, 28, on ? COL.money : COL.text, "center", "700", 6);
    if (on) {
      text(ctx, "▶", STAGE_W / 2 - 186, y, 18, COL.money, "center", "700");
      text(ctx, "◀", STAGE_W / 2 + 186, y, 18, COL.money, "center", "700");
    }
    clicks.push({ x: STAGE_W / 2 - 200, y: y - 26, w: 400, h: 52, action: it.action });
  });
  text(ctx, "↑↓ SELECT     ENTER CONFIRM     MOUSE OK", STAGE_W / 2, 660, 12, COL.text3, "center", "500", 4);
}

function drawHowto(ctx: CanvasRenderingContext2D, clicks: Clickable[]): void {
  text(ctx, "HOW TO PLAY", STAGE_W / 2, 58, 32, COL.text, "center", "700", 4);
  const lines: [string, string][] = [
    ["GOAL", "Grow a solvent city. There is no win — the score is your PEAK POPULATION and the MONTHS you survive solvent. Go past the debt limit while still losing money and the city goes bankrupt."],
    ["ZONE", "Paint land Residential, Commercial, or Industrial. A zoned lot develops itself — but ONLY where it has road access, power, water, and demand — growing through three density tiers, then abandoning when a precondition is lost."],
    ["CONNECT", "Lay ROADS so lots are within reach of the network; add a RAIL line with STATIONS along a busy corridor to pull through-traffic off jammed roads. Roads/rail crossing water or a hill cost extra as a span."],
    ["SERVE", "Place a POWER PLANT + WIRES and a WATER SOURCE + PIPES; a source must sit beside water. A network past its capacity starves its farthest tiles first."],
    ["BALANCE", "Every month settles tax income vs. upkeep. Raise TAX for revenue, but too high suppresses demand. Industry and jams emit POLLUTION that lowers land value and suppresses growth."],
    ["CONTROLS", "Pick a tool from the bottom palette (or click it) and click / drag on the map to build. Select a tile to inspect it; RAZE to bulldoze (partial refund). Drag or arrows to pan, wheel to zoom. SPACE pauses in place, TAB cycles overlays, 1/2/3 sets speed, M mutes, ESC opens the menu."],
  ];
  let y = 104;
  for (const [k, v] of lines) {
    text(ctx, k, 150, y, 14, COL.res, "left", "700", 1);
    wrap(ctx, v, 330, y, 810, 14, COL.text2, 20);
    y += lineCount(ctx, v, 810, 14) * 20 + 14;
  }
  const bx = STAGE_W / 2 - 90;
  const by = STAGE_H - 64;
  const on = highlighted(0, bx, by, 180, 42);
  panelButton(ctx, clicks, bx, by, 180, 42, "BACK", "menu:back", on);
}

function drawPause(ctx: CanvasRenderingContext2D, game: Game, clicks: Clickable[]): void {
  dim(ctx);
  panelBox(ctx, 440, 210, 400, 300);
  text(ctx, "PAUSED", STAGE_W / 2, 262, 30, COL.text, "center", "700", 4);
  menuButtons(ctx, game.menuItems(), 316, 58, 260, clicks);
}

function drawBankrupt(ctx: CanvasRenderingContext2D, game: Game, clicks: Clickable[]): void {
  dim(ctx);
  panelBox(ctx, 400, 168, 480, 384);
  text(ctx, "CITY BANKRUPT", STAGE_W / 2, 214, 14, COL.alert, "center", "700", 3);
  text(ctx, "INSOLVENT", STAGE_W / 2, 258, 40, COL.alert, "center", "800", 2);
  const stat = (label: string, value: string, y: number, c: string): void => {
    text(ctx, label, STAGE_W / 2, y, 12, COL.text3, "center", "600", 2);
    text(ctx, value, STAGE_W / 2, y + 24, 24, c, "center", "700", 1);
  };
  stat("PEAK POPULATION", game.stats.peakPopulation.toLocaleString("en-US"), 316, COL.text);
  stat("SURVIVED", `${game.stats.monthsSurvived} MONTHS`, 372, COL.text);
  const debt = Math.round(Math.min(0, game.budget.treasury));
  stat("FINAL DEBT", `-$${Math.abs(debt).toLocaleString("en-US")}`, 428, COL.alert);
  const items = game.menuItems();
  const xs = [STAGE_W / 2 - 170, STAGE_W / 2 + 10];
  items.forEach((it, i) => {
    const on = highlighted(i, xs[i]!, 496, 160, 44);
    panelButton(ctx, clicks, xs[i]!, 496, 160, 44, it.label, it.action, on);
  });
}

// ---- menu / panel helpers ------------------------------------------------------
function menuButtons(ctx: CanvasRenderingContext2D, items: MenuItem[], y0: number, gap: number, w: number, clicks: Clickable[]): void {
  const x = STAGE_W / 2 - w / 2;
  items.forEach((it, i) => {
    const y = y0 + i * gap;
    const on = highlighted(i, x, y, w, 44);
    panelButton(ctx, clicks, x, y, w, 44, it.label, it.action, on);
  });
}

function panelButton(ctx: CanvasRenderingContext2D, clicks: Clickable[], x: number, y: number, w: number, h: number, label: string, action: string, on: boolean): void {
  roundRect(ctx, x, y, w, h, 8);
  ctx.fillStyle = on ? hexA(COL.money, 0.16) : "rgba(255,255,255,0.04)";
  ctx.fill();
  ctx.strokeStyle = on ? COL.money : "rgba(255,255,255,0.12)";
  ctx.lineWidth = on ? 2 : 1;
  ctx.stroke();
  text(ctx, label, x + w / 2, y + h / 2 + 1, 15, on ? COL.money : COL.text, "center", "700", 1);
  clicks.push({ x, y, w, h, action });
}

function highlighted(i: number, x: number, y: number, w: number, h: number): boolean {
  return menuIndex === i || inRect(pointerX, pointerY, x, y, w, h);
}

function dim(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = "rgba(8,11,16,0.72)";
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
  roundRect(ctx, x, y, w, h, 14);
  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  ctx.lineWidth = 1;
  ctx.stroke();
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
