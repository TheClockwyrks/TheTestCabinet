// Holdfast — rendering (DESIGN §5, specs/overview.md, specs/world.md, specs/flow.md).
//
// Draws the whole 1280x720 stage: the camera view of the tile world (produced terrain,
// node, and structure sprites, nearest-neighbour), the designation overlays and build
// ghosts, the animated settlers and raiders (produced draw-sheet cycles, facing by mirror),
// the tracers, the live particle bursts, and the day/night lighting overlay — then it
// dispatches to hud.ts (the in-code top/bottom dashboard + work grid) and screens.ts (the
// title / how-to / pause / colony-lost screens). It only READS the simulation state; it
// never mutates it. Every frame it returns the Clickable[] the input layer routes against,
// so the hit-test geometry is derived exactly once, here, where it is drawn.
//
// The module owns the small pieces of PRESENTATION state that are not part of the sim: the
// render clock (animation timer), the pointer position, the current designation drag rect,
// the muted flag, the menu cursor index, and whether the work-priority grid panel is open.
// main.ts pushes those in through the setters below before each render call. The low-level
// canvas primitives (text / roundRect / blit / bars / buttons) are exported for hud.ts and
// screens.ts, which draw the chrome this file composes over the board.

import {
  COL,
  COLS,
  FONT,
  NIGHT_DARKEN,
  PHASE_DAWN_END,
  PHASE_DAY_END,
  PHASE_DUSK_END,
  ROWS,
  STAGE_H,
  STAGE_W,
  TILE,
  TRACER_LIFE,
  TURRET_RANGE,
  VIEW_H,
  VIEW_W,
  VIEW_X0,
  VIEW_X1,
  VIEW_Y0,
  VIEW_Y1,
  type Activity,
  type ResourceKind,
  type StructureKind,
  type TerrainKind,
} from "./constants";
import { screenToTile, tileCenterX, tileCenterY } from "./world";
import type { Assets } from "./assets";
import type { Bursts } from "./particles";
import type { Clickable, Raider, Settler, Structure } from "./types";
import type { Game } from "./sim";
import { drawBottomHud, drawTopHud, drawWorkGrid } from "./hud";
import { drawGameOver, drawHowto, drawPause, drawTitle } from "./screens";

// ---- presentation state (pushed in by main.ts each frame) ---------------------
let time = 0; // seconds, drives animation cycles and pulses
let menuIndex = 0; // keyboard cursor in the active menu
let muted = false;
let pointerX = -1;
let pointerY = -1;
let drag: { x0: number; y0: number; x1: number; y1: number } | null = null;
let workGridOpen = false;

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
// The in-flight designation/build drag rectangle (logical screen coords), or null. Drawn as
// the multi-tile designation preview; input.ts sets it while a drag is live.
export function setDrag(d: { x0: number; y0: number; x1: number; y1: number } | null): void {
  drag = d;
}
export function setWorkGrid(open: boolean): void {
  workGridOpen = open;
}
export function isWorkGridOpen(): boolean {
  return workGridOpen;
}

// Getters the chrome modules read (so hud/screens see the same presentation state).
export function ptr(): { x: number; y: number } {
  return { x: pointerX, y: pointerY };
}
export function renderTime(): number {
  return time;
}
export function isMuted(): boolean {
  return muted;
}
export function menuIndexNow(): number {
  return menuIndex;
}

// ---- produced-asset key maps --------------------------------------------------
const TERRAIN_KEY: Record<TerrainKind, string> = {
  soil: "terrain/soil",
  grass: "terrain/grass",
  rock: "terrain/rock",
};
const STOCK_ICON: Record<ResourceKind, string> = {
  wood: "icons/wood",
  ore: "icons/ore",
  crops: "icons/crops",
  meals: "icons/meal",
};
const ITEM_ICON: Record<ResourceKind, string> = {
  wood: "items/wood",
  ore: "items/ore",
  crops: "items/crops",
  meals: "items/meal",
};
const BUILD_ICON: Record<StructureKind, string> = {
  wall: "icons/build_wall",
  door: "icons/build_door",
  floor: "icons/build_floor",
  bed: "icons/build_bed",
  stove: "icons/build_stove",
  farm: "icons/build_farm",
  turret: "icons/build_turret",
};
export { STOCK_ICON, ITEM_ICON, BUILD_ICON };

// The produced structure sprite for a structure's current state (idle/on, crop stage, etc.).
function structureSprite(s: Structure): string {
  switch (s.kind) {
    case "wall":
      return "structures/wall";
    case "door":
      return "structures/door";
    case "bed":
      return "structures/bed";
    case "floor":
      return "terrain/floor";
    case "stove":
      return s.active ? "structures/stove_on" : "structures/stove_idle";
    case "farm":
      return s.cropStage === 2 ? "structures/farm_ripe" : s.cropStage === 1 ? "structures/farm_growing" : "structures/farm_empty";
    case "turret":
      return s.active ? "structures/turret_firing" : "structures/turret_idle";
  }
}

// ---- entry --------------------------------------------------------------------
export function render(ctx: CanvasRenderingContext2D, game: Game, A: Assets, bursts: Bursts): Clickable[] {
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = COL.void;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);

  const clicks: Clickable[] = [];

  if (game.state === "title") {
    drawTitle(ctx, game, clicks);
    return clicks;
  }
  if (game.state === "howto") {
    drawHowto(ctx, clicks);
    return clicks;
  }

  // playing / paused / gameover all show the live colony (frozen behind an overlay when
  // the sim is not advancing).
  drawColony(ctx, game, A, bursts);
  drawToasts(ctx, game);
  drawTopHud(ctx, game, A, clicks);
  drawBottomHud(ctx, game, A, clicks);
  if (workGridOpen) drawWorkGrid(ctx, game, clicks);

  if (game.state === "paused") drawPause(ctx, game, clicks);
  if (game.state === "gameover") drawGameOver(ctx, game, clicks);

  return clicks;
}

// ---- the colony view (the camera on the 60×44 tile world) ---------------------
function drawColony(ctx: CanvasRenderingContext2D, game: Game, A: Assets, bursts: Bursts): void {
  const zoom = game.zoom;
  const camX = game.camX;
  const camY = game.camY;
  const sxOf = (wx: number): number => VIEW_X0 + (wx - camX) * zoom;
  const syOf = (wy: number): number => VIEW_Y0 + (wy - camY) * zoom;

  ctx.save();
  ctx.beginPath();
  ctx.rect(VIEW_X0, VIEW_Y0, VIEW_W, VIEW_H);
  ctx.clip();
  ctx.imageSmoothingEnabled = false;

  // Visible tile window (a small margin so partial edge tiles still draw).
  const tx0 = Math.max(0, Math.floor(camX / TILE));
  const ty0 = Math.max(0, Math.floor(camY / TILE));
  const tx1 = Math.min(COLS - 1, Math.ceil((camX + VIEW_W / zoom) / TILE));
  const ty1 = Math.min(ROWS - 1, Math.ceil((camY + VIEW_H / zoom) / TILE));
  const cell = TILE * zoom;

  // Terrain, nodes, designations, structures — one pass, back to front within a tile.
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const t = game.world.tileAt(tx, ty)!;
      const dx = Math.floor(sxOf(tx * TILE));
      const dy = Math.floor(syOf(ty * TILE));
      const dw = Math.ceil(cell) + 1; // +1 avoids hairline seams from sub-pixel rounding
      const dh = Math.ceil(cell) + 1;
      ctx.drawImage(A.sprite(TERRAIN_KEY[t.terrain]), dx, dy, dw, dh);

      const cx = sxOf(tileCenterX(tx));
      const cy = syOf(tileCenterY(ty));
      if (t.node) {
        blit(ctx, A.sprite(t.node.kind === "tree" ? "nodes/tree" : "nodes/ore"), cx, cy, cell, cell);
        if (t.designated) drawDesignation(ctx, dx, dy, cell, t.designated === "chop" ? COL.food : COL.ore);
      }
      if (t.structure) drawStructure(ctx, A, t.structure, cx, cy, cell);
    }
  }

  // Dropped resource piles (a gather result awaiting a haul).
  for (const d of game.drops) {
    if (d.tx < tx0 || d.tx > tx1 || d.ty < ty0 || d.ty > ty1) continue;
    blit(ctx, A.sprite(ITEM_ICON[d.res]), sxOf(tileCenterX(d.tx)), syOf(tileCenterY(d.ty)) + cell * 0.18, 15 * zoom, 15 * zoom);
  }

  // Settlers and raiders (produced sheet cycles).
  for (const s of game.settlers) drawSettler(ctx, A, game, s, sxOf(s.x), syOf(s.y), zoom);
  for (const r of game.raiders) {
    if (r.dead) continue;
    drawRaider(ctx, A, r, sxOf(r.x), syOf(r.y), zoom);
  }

  // Tracers (a shot drawn as a brief line, warm for friendly, alert for hostile).
  for (const tr of game.tracers) {
    const a = Math.max(0, Math.min(1, tr.life / TRACER_LIFE));
    ctx.save();
    ctx.globalAlpha = a;
    ctx.strokeStyle = tr.hostile ? COL.alert : "#ffcf6a";
    ctx.lineWidth = Math.max(1, 1.4 * zoom);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(sxOf(tr.x0), syOf(tr.y0));
    ctx.lineTo(sxOf(tr.x1), syOf(tr.y1));
    ctx.stroke();
    ctx.restore();
  }

  // Day/night lighting: a cool multiply whose alpha follows the clock (never black-out).
  const dk = darkness(game.time);
  if (dk > 0.002) {
    ctx.fillStyle = `rgba(20,28,58,${dk})`;
    ctx.fillRect(VIEW_X0, VIEW_Y0, VIEW_W, VIEW_H);
  }

  // Particle bursts composite over the darkened board (muzzle flashes read through).
  bursts.draw(ctx, { camX, camY, zoom });

  // Selection / tool cursor.
  drawCursor(ctx, game, A, zoom, sxOf, syOf);

  ctx.restore();
}

function drawDesignation(ctx: CanvasRenderingContext2D, dx: number, dy: number, cell: number, color: string): void {
  const len = Math.max(4, cell * 0.28);
  const p = 2;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  // four corner brackets
  const L = dx + p;
  const R = dx + cell - p;
  const T = dy + p;
  const B = dy + cell - p;
  ctx.moveTo(L, T + len); ctx.lineTo(L, T); ctx.lineTo(L + len, T);
  ctx.moveTo(R - len, T); ctx.lineTo(R, T); ctx.lineTo(R, T + len);
  ctx.moveTo(L, B - len); ctx.lineTo(L, B); ctx.lineTo(L + len, B);
  ctx.moveTo(R - len, B); ctx.lineTo(R, B); ctx.lineTo(R, B - len);
  ctx.stroke();
  ctx.restore();
}

function drawStructure(ctx: CanvasRenderingContext2D, A: Assets, s: Structure, cx: number, cy: number, cell: number): void {
  const ang = s.kind === "turret" ? s.aim : 0;
  if (!s.built) {
    // Ghost / blueprint awaiting construction — translucent, with a build-progress bar.
    ctx.save();
    ctx.globalAlpha = 0.42;
    blit(ctx, A.sprite(structureSprite(s)), cx, cy, cell, cell, ang);
    ctx.restore();
    entityBar(ctx, cx, cy + cell / 2 + 2, s.progress, cell, COL.built);
    return;
  }
  blit(ctx, A.sprite(structureSprite(s)), cx, cy, cell, cell, ang);
  // Integrity bar for a damaged, damageable structure (turret takes raider fire in base).
  if (s.maxHp > 0 && s.hp < s.maxHp) {
    entityBar(ctx, cx, cy - cell / 2 - 5, Math.max(0, s.hp) / s.maxHp, cell, COL.alert);
  }
}

// Which produced cycle + frame rate a settler shows for its current activity.
function settlerCycle(A: Assets, activity: Activity): { imgs: HTMLImageElement[]; fps: number } {
  switch (activity) {
    case "walk":
    case "haul":
    case "flee":
      return { imgs: A.frames("settler/walk", 4), fps: 8 };
    case "chop":
    case "mine":
    case "build":
    case "farm":
    case "cook":
    case "tend":
      return { imgs: A.frames("settler/work", 4), fps: 6 };
    case "fight":
      return { imgs: A.frames("settler/fight", 4), fps: 10 };
    case "downed":
      return { imgs: A.frames("settler/downed", 2), fps: 2 };
    default: // idle / eat / sleep — stand on the first walk frame
      return { imgs: A.frames("settler/walk", 4), fps: 0 };
  }
}

function drawSettler(ctx: CanvasRenderingContext2D, A: Assets, game: Game, s: Settler, cx: number, cy: number, zoom: number): void {
  const size = 22 * zoom;
  const { imgs, fps } = s.dead ? { imgs: A.frames("settler/downed", 2), fps: 0 } : settlerCycle(A, s.activity);
  const img = imgs.length ? imgs[fps > 0 ? frameOf(s.animT, imgs.length, fps) : 0]! : null;
  const flip = Math.cos(s.facing) < 0;

  if (game.selectedSettlerId === s.id && !s.dead) {
    ctx.save();
    ctx.strokeStyle = COL.text;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.72, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  if (img) {
    ctx.save();
    if (s.dead) ctx.globalAlpha = 0.35;
    else if (s.downed) ctx.globalAlpha = 0.85;
    blit(ctx, img, cx, cy, size, size, 0, flip);
    ctx.restore();
  }

  if (!s.dead && (s.downed || s.health < s.maxHealth)) {
    entityBar(ctx, cx, cy - size / 2 - 5, Math.max(0, s.health) / s.maxHealth, size, s.downed ? COL.alert : COL.health);
  }
  if (!s.dead && s.carrying) {
    blit(ctx, A.sprite(ITEM_ICON[s.carrying.res]), cx + size * 0.42, cy - size * 0.5, 11 * zoom, 11 * zoom);
  }
}

function drawRaider(ctx: CanvasRenderingContext2D, A: Assets, r: Raider, cx: number, cy: number, zoom: number): void {
  const size = 22 * zoom;
  const holding = r.targetId !== null && r.path.length === 0 && !r.fleeing;
  const imgs = holding ? A.frames("raider/fight", 4) : A.frames("raider/walk", 4);
  const img = imgs.length ? imgs[frameOf(r.animT, imgs.length, holding ? 10 : 8)]! : null;
  const flip = Math.cos(r.facing) < 0;
  if (img) blit(ctx, img, cx, cy, size, size, 0, flip);
  if (r.health < r.maxHealth) entityBar(ctx, cx, cy - size / 2 - 5, Math.max(0, r.health) / r.maxHealth, size, COL.raider);
}

// ---- tool / selection cursor --------------------------------------------------
function drawCursor(
  ctx: CanvasRenderingContext2D,
  game: Game,
  A: Assets,
  zoom: number,
  sxOf: (wx: number) => number,
  syOf: (wy: number) => number,
): void {
  if (game.state !== "playing") return;
  const p = ptr();
  if (p.x < VIEW_X0 || p.x > VIEW_X1 || p.y < VIEW_Y0 || p.y > VIEW_Y1) return;
  const cell = TILE * zoom;
  const rectOf = (tx: number, ty: number): { x: number; y: number } => ({ x: sxOf(tx * TILE), y: syOf(ty * TILE) });

  // A live designation drag: highlight every node in the rectangle by what it would become.
  if (game.tool === "designate" && drag) {
    const a = screenToTile(game.camX, game.camY, zoom, drag.x0, drag.y0);
    const b = screenToTile(game.camX, game.camY, zoom, drag.x1, drag.y1);
    const x0 = Math.min(a.tx, b.tx);
    const x1 = Math.max(a.tx, b.tx);
    const y0 = Math.min(a.ty, b.ty);
    const y1 = Math.max(a.ty, b.ty);
    ctx.save();
    ctx.strokeStyle = hexA(COL.text, 0.4);
    ctx.lineWidth = 1;
    ctx.strokeRect(sxOf(x0 * TILE), syOf(y0 * TILE), (x1 - x0 + 1) * cell, (y1 - y0 + 1) * cell);
    ctx.restore();
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const t = game.world.tileAt(tx, ty);
        if (!t || !t.node) continue;
        const r = rectOf(tx, ty);
        drawDesignation(ctx, Math.floor(r.x), Math.floor(r.y), cell, t.node.kind === "tree" ? COL.food : COL.ore);
      }
    }
    return;
  }

  const tile = screenToTile(game.camX, game.camY, zoom, p.x, p.y);
  const r = rectOf(tile.tx, tile.ty);

  if (game.tool === "build" && game.buildKind) {
    const kind = game.buildKind;
    const legal = game.canPlace(kind, tile.tx, tile.ty) && game.canAfford(kind);
    const cx = sxOf(tileCenterX(tile.tx));
    const cy = syOf(tileCenterY(tile.ty));
    if (kind === "turret") {
      ctx.save();
      ctx.strokeStyle = hexA(legal ? COL.food : COL.alert, 0.8);
      ctx.fillStyle = hexA(legal ? COL.food : COL.alert, 0.07);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, TURRET_RANGE * zoom, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    ctx.save();
    ctx.globalAlpha = legal ? 0.7 : 0.4;
    blit(ctx, A.sprite(BUILD_GHOST(kind)), cx, cy, cell, cell);
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = legal ? COL.food : COL.alert;
    ctx.lineWidth = 2;
    ctx.strokeRect(Math.floor(r.x) + 0.5, Math.floor(r.y) + 0.5, cell, cell);
    ctx.restore();
    return;
  }

  // Designate (no drag yet) reads the node under the cursor; cancel is a red mark; the bare
  // cursor is a subtle hovered-tile outline.
  if (game.tool === "designate") {
    const t = game.world.tileAt(tile.tx, tile.ty);
    if (t && t.node) drawDesignation(ctx, Math.floor(r.x), Math.floor(r.y), cell, t.node.kind === "tree" ? COL.food : COL.ore);
    hoverRect(ctx, r.x, r.y, cell, hexA(COL.text, 0.4));
    return;
  }
  if (game.tool === "cancel") {
    hoverRect(ctx, r.x, r.y, cell, COL.alert);
    ctx.save();
    ctx.strokeStyle = COL.alert;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(r.x + cell * 0.3, r.y + cell * 0.3);
    ctx.lineTo(r.x + cell * 0.7, r.y + cell * 0.7);
    ctx.moveTo(r.x + cell * 0.7, r.y + cell * 0.3);
    ctx.lineTo(r.x + cell * 0.3, r.y + cell * 0.7);
    ctx.stroke();
    ctx.restore();
    return;
  }
  hoverRect(ctx, r.x, r.y, cell, hexA(COL.text, 0.28));
}

// The produced palette glyph doubles as the build ghost (a 16×16 mark scaled to the cell).
function BUILD_GHOST(kind: StructureKind): string {
  return BUILD_ICON[kind];
}

function hoverRect(ctx: CanvasRenderingContext2D, x: number, y: number, cell: number, color: string): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(Math.floor(x) + 0.5, Math.floor(y) + 0.5, cell, cell);
  ctx.restore();
}

// ---- milestone / event toasts -------------------------------------------------
function drawToasts(ctx: CanvasRenderingContext2D, game: Game): void {
  let y = VIEW_Y0 + 26;
  for (const t of game.toasts) {
    const a = Math.max(0, Math.min(1, t.life / 1.5));
    ctx.save();
    ctx.globalAlpha = a;
    ctx.font = `600 13px ${FONT}`;
    const w = ctx.measureText(t.text).width + 32;
    const x = STAGE_W / 2 - w / 2;
    roundRect(ctx, x, y - 13, w, 26, 13);
    ctx.fillStyle = hexA(COL.panel, 0.92);
    ctx.fill();
    ctx.strokeStyle = hexA(COL.wood, 0.5);
    ctx.lineWidth = 1;
    ctx.stroke();
    text(ctx, t.text, STAGE_W / 2, y, 13, COL.text, "center", "600", 0.5);
    ctx.restore();
    y += 32;
  }
}

// ---- day/night lighting curve -------------------------------------------------
// Alpha of the darkening overlay across the day clock: fully lit through the day, ramping
// down through dawn, up through dusk, peaking (but never black) in the deep of night.
function darkness(t0: number): number {
  const t = t0 - Math.floor(t0);
  if (t < PHASE_DAWN_END) return lerp(0.45, 0, t / PHASE_DAWN_END);
  if (t < PHASE_DAY_END) return 0;
  if (t < PHASE_DUSK_END) return lerp(0, 0.45, (t - PHASE_DAY_END) / (PHASE_DUSK_END - PHASE_DAY_END));
  const nt = (t - PHASE_DUSK_END) / (1 - PHASE_DUSK_END); // 0..1 across the night
  return 0.45 + (NIGHT_DARKEN - 0.45) * Math.sin(nt * Math.PI); // peaks at mid-night
}

// ==== exported canvas primitives (used by hud.ts and screens.ts) ================
export function frameOf(anim: number, count: number, fps: number): number {
  if (count <= 0) return 0;
  return Math.floor(anim * fps) % count;
}

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
    let cx = align === "center" ? x - total / 2 + adv / 2 : align === "right" ? x - total : x;
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

export function blit(ctx: CanvasRenderingContext2D, img: HTMLImageElement, cx: number, cy: number, w: number, h: number, ang = 0, flip = false): void {
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.translate(cx, cy);
  if (ang) ctx.rotate(ang);
  if (flip) ctx.scale(-1, 1);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  ctx.restore();
}

// A rounded fill/track bar (HUD need/stat meters). `frac` is clamped to [0,1].
export function bar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, frac: number, color: string): void {
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = "rgba(255,255,255,0.09)";
  ctx.fill();
  const f = Math.max(0, Math.min(1, frac));
  if (f > 0) {
    roundRect(ctx, x, y, Math.max(h, w * f), h, h / 2);
    ctx.fillStyle = color;
    ctx.fill();
  }
}

// A tiny entity-anchored bar (health / build progress) drawn centered above a sprite.
function entityBar(ctx: CanvasRenderingContext2D, cx: number, topY: number, frac: number, w: number, color: string): void {
  const bw = Math.max(12, w * 0.86);
  const bh = 3;
  const x = cx - bw / 2;
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillRect(x, topY, bw, bh);
  ctx.fillStyle = color;
  ctx.fillRect(x, topY, bw * Math.max(0, Math.min(1, frac)), bh);
}

// A pushed-clickable button; greys out (and does not register a click) when disabled.
export function button(
  ctx: CanvasRenderingContext2D,
  clicks: Clickable[],
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  action: string,
  color: string,
  enabled: boolean,
): void {
  roundRect(ctx, x, y, w, h, 6);
  ctx.fillStyle = enabled ? hexA(color, 0.12) : "rgba(255,255,255,0.03)";
  ctx.fill();
  ctx.strokeStyle = enabled ? color : "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  text(ctx, label, x + w / 2, y + h / 2 + 1, 12, enabled ? color : COL.text3, "center", "700");
  if (enabled) clicks.push({ x, y, w, h, action });
}

export function wrap(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, maxW: number, size: number, color: string, lineHeight = 20): void {
  ctx.font = `400 ${size}px ${FONT}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  const words = s.split(" ");
  let line = "";
  let yy = y;
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW) {
      ctx.fillText(line, x, yy);
      line = w;
      yy += lineHeight;
    } else line = test;
  }
  ctx.fillText(line, x, yy);
}

export function lineCount(ctx: CanvasRenderingContext2D, s: string, maxW: number, size: number): number {
  ctx.font = `400 ${size}px ${FONT}`;
  const words = s.split(" ");
  let line = "";
  let n = 1;
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW) {
      n++;
      line = w;
    } else line = test;
  }
  return n;
}

export function inRect(px: number, py: number, x: number, y: number, w: number, h: number): boolean {
  return px >= x && px <= x + w && py >= y && py <= y + h;
}

export function hexA(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}
