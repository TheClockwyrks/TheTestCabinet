// Midway — rendering (specs/overview.md, specs/park.md, specs/flow.md; DESIGN.md §5).
//
// Draws the whole fixed 1280x720 stage: the three bands are the top HUD (park vitals),
// the park view (a pannable/zoomable camera over the tile grid — ground, paths, rides +
// stalls with their produced motion frames, scenery, the animated guest + staff crowd, the
// live particle overlays, queue reads, and the tool ghost), and the bottom HUD (the tool
// bar + build palette + a context panel/inspector). Over the park it layers every menu and
// state screen (title, how-to, pause, game-over). It only READS the simulation — never
// mutates it — and returns the frame's clickable regions so the input layer can route
// pointer events against exactly what was drawn (the same contract as valence's render.ts).

import {
  BOTTOM_HUD_H,
  COL,
  COLS,
  FONT,
  PARK_Y0,
  PARK_Y1,
  RIDES,
  RIDE_ORDER,
  ROWS,
  SCENERY,
  SCENERY_ORDER,
  STAGE_H,
  STAGE_W,
  STALLS,
  STALL_ORDER,
  STAFF,
  STAFF_ORDER,
  TILE,
  TOOL_ORDER,
  TOP_HUD_H,
  TUNE,
  type DesireKey,
  type RideKind,
  type StallKind,
  type ToolKind,
} from "./constants";
import { canPlaceFootprint, canPlacePath, idx, screenToWorld, tileAt, tileCenter } from "./park";
import { throughputOf } from "./rides";
import type { Assets } from "./assets";
import type { Particles } from "./particles";
import type { Attraction, Camera, Cell, Clickable } from "./types";
import type { Game } from "./sim";
import { menuItems, type MenuItem } from "./menus";

// ---- module state (fed by main.ts each frame, like valence's setters) -------------
let time = 0;
let menuIndex = 0;
let muted = false;
let dragCells: Cell[] | null = null; // the path tool's live drag run (for the preview + cost)

export function setRenderTime(t: number): void {
  time = t;
}
export function setMenuIndex(i: number): void {
  menuIndex = i;
}
export function setMuted(m: boolean): void {
  muted = m;
}
export function setDragCells(cells: Cell[] | null): void {
  dragCells = cells;
}

const PARK_VIEW_H = PARK_Y1 - PARK_Y0;

// Path-tile 4-neighbour bit mask (for choosing straight / corner / junction + rotation).
const N = 1;
const E = 2;
const S = 4;
const W = 8;

// ---- tiny drawing helpers (shape of valence's) ------------------------------------
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

// Blit a produced sprite centred at (cx,cy), optionally rotated / horizontally flipped.
function blit(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  cx: number,
  cy: number,
  w: number,
  h: number,
  ang = 0,
  flip = false,
): void {
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.translate(cx, cy);
  if (ang) ctx.rotate(ang);
  if (flip) ctx.scale(-1, 1);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  ctx.restore();
}

function hexA(hex: string, a: number): string {
  const h = hex.replace("#", "");
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}

function inRect(px: number, py: number, x: number, y: number, w: number, h: number): boolean {
  return px >= x && px <= x + w && py >= y && py <= y + h;
}

function frameOf(animT: number, count: number, fps: number): number {
  if (count <= 0) return 0;
  return Math.floor(animT * fps) % count;
}

function wrap(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, maxW: number, size: number, color: string, lineHeight = 20): void {
  ctx.font = `400 ${size}px ${FONT}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  let line = "";
  let yy = y;
  for (const w of s.split(" ")) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW) {
      ctx.fillText(line, x, yy);
      line = w;
      yy += lineHeight;
    } else line = test;
  }
  ctx.fillText(line, x, yy);
}

function lineCount(ctx: CanvasRenderingContext2D, s: string, maxW: number, size: number): number {
  ctx.font = `400 ${size}px ${FONT}`;
  let line = "";
  let n = 1;
  for (const w of s.split(" ")) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW) {
      n++;
      line = w;
    } else line = test;
  }
  return n;
}

// ---- entry ------------------------------------------------------------------------
export function render(ctx: CanvasRenderingContext2D, game: Game, A: Assets, particles: Particles): Clickable[] {
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = COL.void;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);

  const clicks: Clickable[] = [];

  if (game.state === "title") {
    drawTitle(ctx, game, A, clicks);
    return clicks;
  }
  if (game.state === "howto") {
    drawHowto(ctx, game, clicks);
    return clicks;
  }

  // playing / paused / gameover all show the live park under the HUD.
  drawParkView(ctx, game, A, particles);
  drawTopHud(ctx, game, A, clicks);
  drawBottomHud(ctx, game, A, clicks);
  drawInspector(ctx, game, A);
  drawNotifications(ctx, game);

  if (game.state === "paused") drawPause(ctx, game, clicks);
  if (game.state === "gameover") drawGameOver(ctx, game, clicks);

  return clicks;
}

// ---- park view (camera over the tile grid) ----------------------------------------
function drawParkView(ctx: CanvasRenderingContext2D, game: Game, A: Assets, particles: Particles): void {
  const cam = game.world.camera;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, PARK_Y0, STAGE_W, PARK_VIEW_H);
  ctx.clip();
  // Camera transform: worldToScreen(cam) = translate(0,PARK_Y0) · scale(zoom) · translate(-cam).
  ctx.translate(0, PARK_Y0);
  ctx.scale(cam.zoom, cam.zoom);
  ctx.translate(-cam.x, -cam.y);

  drawGround(ctx, game, A, cam);
  drawAttractions(ctx, game, A);
  drawScenery(ctx, game, A);
  drawActors(ctx, game, A);
  drawQueueBadges(ctx, game);
  drawSelectionRing(ctx, game);
  particles.draw(ctx); // one-shots (fireworks, cleanup) + loops (steam, sparkle), at world px
  drawToolGhost(ctx, game, A, cam);

  ctx.restore();

  // The path-drag running-cost label rides the pointer in screen space (drawn unclipped).
  drawDragCost(ctx, game);
}

// Ground + paths in one culled pass, then per-path-tile litter + unconnected overlays.
function drawGround(ctx: CanvasRenderingContext2D, game: Game, A: Assets, cam: Camera): void {
  const w = game.world;
  const viewW = STAGE_W / cam.zoom;
  const viewH = PARK_VIEW_H / cam.zoom;
  const c0 = Math.max(0, Math.floor(cam.x / TILE) - 1);
  const c1 = Math.min(COLS - 1, Math.floor((cam.x + viewW) / TILE) + 1);
  const r0 = Math.max(0, Math.floor(cam.y / TILE) - 1);
  const r1 = Math.min(ROWS - 1, Math.floor((cam.y + viewH) / TILE) + 1);

  const grass = A.sprite("tiles/grass");
  const water = A.sprite("tiles/water");
  const fence = A.sprite("tiles/fence");
  const gate = A.sprite("tiles/gate");

  for (let row = r0; row <= r1; row++) {
    for (let col = c0; col <= c1; col++) {
      const t = w.tiles[idx(col, row)]!;
      const cx = col * TILE + TILE / 2;
      const cy = row * TILE + TILE / 2;
      // Grass underlays every non-fence tile so paths/water/gate sit on a seamless field.
      if (t.kind !== "fence") blit(ctx, grass, cx, cy, TILE, TILE);
      switch (t.kind) {
        case "water":
          blit(ctx, water, cx, cy, TILE, TILE);
          break;
        case "fence":
          blit(ctx, fence, cx, cy, TILE, TILE);
          break;
        case "gate":
          blit(ctx, gate, cx, cy, TILE, TILE);
          break;
        case "path": {
          const { img, ang } = pathPiece(game, A, col, row);
          blit(ctx, img, cx, cy, TILE, TILE, ang);
          if (!t.connected) {
            // An unconnected stub reads faintly greyed (no guests can reach it).
            ctx.fillStyle = hexA(COL.void, 0.35);
            ctx.fillRect(col * TILE, row * TILE, TILE, TILE);
          }
          if (t.litter > 0.02) drawLitter(ctx, col, row, t.litter);
          if (t.appeal > 0.05) {
            ctx.fillStyle = hexA(COL.grassDark, Math.min(0.28, t.appeal * 0.3));
            ctx.fillRect(col * TILE, row * TILE, TILE, TILE);
          }
          break;
        }
        case "grass":
          break; // already laid
      }
    }
  }
}

function isPathish(game: Game, col: number, row: number): boolean {
  const t = tileAt(game.world, col, row);
  return !!t && (t.kind === "path" || t.kind === "gate");
}

// Pick the produced path sprite (straight / corner / junction) + rotation from the tile's
// 4-neighbour path mask, so laid runs bend and join cleanly (ASSETS.md tiles/path*).
function pathPiece(game: Game, A: Assets, col: number, row: number): { img: HTMLImageElement; ang: number } {
  let m = 0;
  if (isPathish(game, col, row - 1)) m |= N;
  if (isPathish(game, col + 1, row)) m |= E;
  if (isPathish(game, col, row + 1)) m |= S;
  if (isPathish(game, col - 1, row)) m |= W;
  const count = (m & N ? 1 : 0) + (m & E ? 1 : 0) + (m & S ? 1 : 0) + (m & W ? 1 : 0);
  const straight = A.sprite("tiles/path");
  const corner = A.sprite("tiles/path_corner");
  const junction = A.sprite("tiles/path_junction");
  const HALF = Math.PI / 2;

  if (count >= 3) {
    // Junction: default connects E+S+W (gap toward N); rotate CW by the missing side.
    if (count === 4) return { img: junction, ang: 0 };
    if (!(m & N)) return { img: junction, ang: 0 };
    if (!(m & E)) return { img: junction, ang: HALF };
    if (!(m & S)) return { img: junction, ang: Math.PI };
    return { img: junction, ang: -HALF }; // missing W
  }
  if (count === 2) {
    const vertical = m === (N | S);
    const horizontal = m === (E | W);
    if (vertical) return { img: straight, ang: HALF };
    if (horizontal) return { img: straight, ang: 0 };
    // Corner: default connects E+S; rotate CW through S+W, W+N, N+E.
    if (m === (E | S)) return { img: corner, ang: 0 };
    if (m === (S | W)) return { img: corner, ang: HALF };
    if (m === (W | N)) return { img: corner, ang: Math.PI };
    return { img: corner, ang: -HALF }; // N+E
  }
  // 0 or 1 neighbour: a straight stub oriented along the single neighbour.
  const vertical = (m & N) !== 0 || (m & S) !== 0;
  return { img: straight, ang: vertical ? HALF : 0 };
}

function drawLitter(ctx: CanvasRenderingContext2D, col: number, row: number, amt: number): void {
  const n = Math.min(5, 1 + Math.floor(amt * 5));
  ctx.fillStyle = hexA(COL.structureDark, 0.85);
  for (let i = 0; i < n; i++) {
    // Deterministic scatter from the tile coords so litter does not jitter frame-to-frame.
    const h = (col * 73856093) ^ (row * 19349663) ^ (i * 83492791);
    const px = col * TILE + 3 + (Math.abs(h) % (TILE - 6));
    const py = row * TILE + 3 + (Math.abs(h >> 4) % (TILE - 6));
    ctx.fillRect(px, py, 2, 2);
  }
}

// ---- attractions (rides + stalls) -------------------------------------------------
function drawAttractions(ctx: CanvasRenderingContext2D, game: Game, A: Assets): void {
  for (const a of game.attractions) {
    const cx = (a.col + a.w / 2) * TILE;
    const cy = (a.row + a.h / 2) * TILE;
    const pw = a.w * TILE;
    const ph = a.h * TILE;

    if (a.category === "ride") {
      const def = RIDES[a.kind as RideKind];
      blit(ctx, A.sprite(def.sprite), cx, cy, pw, ph);
      // Overlay the produced motion frames only while the ride is alive; freeze on frame 0
      // when idle/broken (ASSETS.md §2c).
      const frames = A.ride[a.kind as RideKind];
      const playing = a.state === "running" || a.state === "loading";
      if (frames.length) blit(ctx, frames[playing ? frameOf(a.animT, frames.length, 8) : 0]!, cx, cy, pw, ph);
      if (a.state === "broken") drawBroken(ctx, A, cx, cy, a);
    } else {
      blit(ctx, A.sprite(STALLS[a.kind as StallKind].sprite), cx, cy, pw, ph);
    }

    if (!a.connected) drawNoPathFlag(ctx, A, cx, a.row * TILE);
  }
}

function drawBroken(ctx: CanvasRenderingContext2D, A: Assets, cx: number, cy: number, a: Attraction): void {
  const pulse = 0.28 + 0.18 * Math.sin(time * 9 + a.id);
  ctx.fillStyle = hexA(COL.alert, pulse);
  ctx.fillRect((a.col) * TILE, a.row * TILE, a.w * TILE, a.h * TILE);
  blit(ctx, A.sprite("icons/alert"), cx, cy - a.h * TILE * 0.5 - 2, 16, 16);
}

function drawNoPathFlag(ctx: CanvasRenderingContext2D, A: Assets, cx: number, top: number): void {
  blit(ctx, A.sprite("icons/alert"), cx, top - 8, 14, 14);
  text(ctx, "NO PATH", cx, top - 20, 8, COL.alert, "center", "700", 0.5);
}

// ---- scenery ----------------------------------------------------------------------
function drawScenery(ctx: CanvasRenderingContext2D, game: Game, A: Assets): void {
  for (const s of game.scenery) {
    blit(ctx, A.sprite(SCENERY[s.kind].sprite), (s.col + s.w / 2) * TILE, (s.row + s.h / 2) * TILE, s.w * TILE, s.h * TILE);
  }
}

// ---- guests + staff (one y-sorted crowd, produced sheets, flipped by facing) -------
interface DrawActor {
  x: number;
  y: number;
  facing: 1 | -1;
  frame: HTMLImageElement | undefined;
  size: number;
}

function drawActors(ctx: CanvasRenderingContext2D, game: Game, A: Assets): void {
  const actors: DrawActor[] = [];
  for (const g of game.guests) {
    if (g.state === "riding") continue; // aboard a ride — hidden until unload
    const frames = A.guest[g.mood];
    actors.push({ x: g.x, y: g.y, facing: g.facing, frame: frames[frameOf(g.animT, frames.length, 8)], size: 16 });
  }
  for (const s of game.staff) {
    const frames = A.staff[s.kind];
    actors.push({ x: s.x, y: s.y, facing: s.facing, frame: frames[frameOf(s.animT, frames.length, 8)], size: 18 });
  }
  actors.sort((a, b) => a.y - b.y);
  for (const a of actors) {
    if (!a.frame) continue;
    blit(ctx, a.frame, a.x, a.y - a.size * 0.25, a.size, a.size, 0, a.facing === -1);
  }
}

// A short read of each attraction's line: a count badge at its entrance tile.
function drawQueueBadges(ctx: CanvasRenderingContext2D, game: Game): void {
  for (const a of game.attractions) {
    const n = a.queue.length + a.riders.length;
    if (n === 0) continue;
    const c = tileCenter(a.entrance);
    ctx.fillStyle = hexA(COL.void, 0.82);
    roundRect(ctx, c.x - 9, c.y - TILE * 0.5 - 8, 18, 12, 4);
    ctx.fill();
    text(ctx, `${n}`, c.x, c.y - TILE * 0.5 - 2, 9, COL.text, "center", "700");
  }
}

function drawSelectionRing(ctx: CanvasRenderingContext2D, game: Game): void {
  const a = game.selectedAttraction;
  if (a) {
    ctx.strokeStyle = COL.text;
    ctx.lineWidth = 2;
    roundRect(ctx, a.col * TILE - 1, a.row * TILE - 1, a.w * TILE + 2, a.h * TILE + 2, 4);
    ctx.stroke();
    return;
  }
  const ent = game.selectedGuest ?? game.selectedStaff;
  if (ent) {
    ctx.strokeStyle = COL.text;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(ent.x, ent.y - 3, 12, 0, Math.PI * 2);
    ctx.stroke();
  }
}

// ---- tool ghost (path / build / staff / demolish preview in the park) --------------
function drawToolGhost(ctx: CanvasRenderingContext2D, game: Game, A: Assets, cam: Camera): void {
  if (game.state !== "playing") return;
  const px = game.pointerX;
  const py = game.pointerY;
  if (py < PARK_Y0 || py > PARK_Y1) return; // pointer is over a HUD strip, not the park
  const wpt = screenToWorld(cam, px, py);
  const col = Math.floor(wpt.x / TILE);
  const row = Math.floor(wpt.y / TILE);

  const tool = game.tool;
  if (tool.kind === "path") {
    if (dragCells && dragCells.length) {
      for (const c of dragCells) ghostTile(ctx, c.col, c.row, canPlacePath(game.world, c.col, c.row));
    } else {
      ghostTile(ctx, col, row, canPlacePath(game.world, col, row));
    }
    return;
  }
  if (tool.kind === "demolish") {
    const t = tileAt(game.world, col, row);
    const legal = !!t && (t.kind === "path" || t.occupantId >= 0);
    ghostTile(ctx, col, row, legal, true);
    return;
  }
  if (tool.kind === "staff") {
    ghostTile(ctx, col, row, isPathish(game, col, row));
    return;
  }
  if (tool.kind === "build") {
    const b = activeBuild(game);
    if (!b) return;
    const legal = canPlaceFootprint(game.world, col, row, b.w, b.h);
    ctx.globalAlpha = legal ? 0.7 : 0.35;
    blit(ctx, A.sprite(b.sprite), (col + b.w / 2) * TILE, (row + b.h / 2) * TILE, b.w * TILE, b.h * TILE);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = legal ? COL.cash : COL.alert;
    ctx.lineWidth = 2;
    roundRect(ctx, col * TILE, row * TILE, b.w * TILE, b.h * TILE, 3);
    ctx.stroke();
  }
}

function ghostTile(ctx: CanvasRenderingContext2D, col: number, row: number, legal: boolean, demolish = false): void {
  const c = demolish ? COL.alert : legal ? COL.cash : COL.alert;
  ctx.fillStyle = hexA(c, 0.2);
  ctx.fillRect(col * TILE, row * TILE, TILE, TILE);
  ctx.strokeStyle = hexA(c, 0.9);
  ctx.lineWidth = 2;
  ctx.strokeRect(col * TILE + 1, row * TILE + 1, TILE - 2, TILE - 2);
}

interface BuildInfo {
  sprite: string;
  w: number;
  h: number;
}
function activeBuild(game: Game): BuildInfo | null {
  const t = game.tool;
  if (t.buildRide) return { sprite: RIDES[t.buildRide].sprite, w: RIDES[t.buildRide].w, h: RIDES[t.buildRide].h };
  if (t.buildStall) return { sprite: STALLS[t.buildStall].sprite, w: STALLS[t.buildStall].w, h: STALLS[t.buildStall].h };
  if (t.buildScenery) return { sprite: SCENERY[t.buildScenery].sprite, w: SCENERY[t.buildScenery].w, h: SCENERY[t.buildScenery].h };
  return null;
}

function drawDragCost(ctx: CanvasRenderingContext2D, game: Game): void {
  if (game.state !== "playing" || game.tool.kind !== "path" || !dragCells || dragCells.length === 0) return;
  let n = 0;
  for (const c of dragCells) if (canPlacePath(game.world, c.col, c.row)) n++;
  if (n === 0) return;
  const cost = n * TUNE.economy.pathCost;
  const label = `${n} · $${cost}`;
  const x = Math.min(STAGE_W - 70, game.pointerX + 16);
  const y = Math.max(PARK_Y0 + 14, game.pointerY - 14);
  ctx.fillStyle = hexA(COL.void, 0.85);
  roundRect(ctx, x - 6, y - 10, 64, 20, 5);
  ctx.fill();
  text(ctx, label, x, y, 12, COL.cash, "left", "700");
}

// ---- top HUD (park vitals) --------------------------------------------------------
function drawTopHud(ctx: CanvasRenderingContext2D, game: Game, A: Assets, clicks: Clickable[]): void {
  ctx.fillStyle = COL.panel;
  ctx.fillRect(0, 0, STAGE_W, TOP_HUD_H);
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.beginPath();
  ctx.moveTo(0, TOP_HUD_H - 0.5);
  ctx.lineTo(STAGE_W, TOP_HUD_H - 0.5);
  ctx.stroke();

  // Cash — signed figure + a trend arrow from the last day's net rate.
  const cash = Math.floor(game.ledger.cash);
  const cashColor = cash >= 0 ? COL.cash : COL.cashDown;
  blit(ctx, A.sprite("icons/cash"), 26, 30, 18, 18);
  text(ctx, "CASH", 42, 20, 10, COL.text3, "left", "600", 1);
  text(ctx, `${cash < 0 ? "-$" : "$"}${Math.abs(cash)}`, 42, 37, 18, cashColor, "left", "700");
  drawTrend(ctx, 130, 37, game.ledger.incomeRate - game.ledger.expenseRate);

  // Guests count.
  blit(ctx, A.sprite("icons/guest"), 186, 30, 18, 18);
  text(ctx, "GUESTS", 202, 20, 10, COL.text3, "left", "600", 1);
  text(ctx, `${game.guestCount}`, 202, 37, 18, COL.guest, "left", "700");

  // Rating — a five-star row filled from the live rating.
  text(ctx, "RATING", 300, 20, 10, COL.text3, "left", "600", 1);
  drawStars(ctx, A, 300, 40, 15, game.ratingStars);

  // Happiness — mood face + worded band.
  const hap = game.avgHappiness;
  const band = hap < 40 ? "GRIM" : hap < 70 ? "OK" : "HAPPY";
  const bandColor = hap < 40 ? COL.alert : hap < 70 ? COL.happiness : COL.cash;
  blit(ctx, A.sprite("icons/happiness"), 442, 30, 18, 18);
  text(ctx, "HAPPINESS", 458, 20, 10, COL.text3, "left", "600", 1);
  text(ctx, band, 458, 37, 16, bandColor, "left", "700", 0.5);

  // Day counter.
  text(ctx, "DAY", 590, 20, 10, COL.text3, "left", "600", 1);
  text(ctx, `${game.day}`, 590, 37, 18, COL.text, "left", "700");
  const dayFrac = Math.max(0, Math.min(1, game.dayT / TUNE.daySeconds));
  ctx.fillStyle = "rgba(255,255,255,0.10)";
  ctx.fillRect(590, 48, 46, 3);
  ctx.fillStyle = COL.rating;
  ctx.fillRect(590, 48, 46 * dayFrac, 3);

  // Right edge: alert chips, then speed / pause / mute controls.
  ctrl(ctx, clicks, 1232, muted ? "♪̸" : "♪", "mute", muted ? COL.text3 : COL.text, 36);
  ctrl(ctx, clicks, 1184, game.paused ? "▶" : "❚❚", "pause", game.paused ? COL.rating : COL.text, 40);
  ctrl(ctx, clicks, 1116, speedGlyph(game), "speed", COL.text, 60);
  drawAlerts(ctx, game, A, 1100);
}

function speedGlyph(game: Game): string {
  return game.speed === 1 ? "▶" : game.speed === 2 ? "▶▶" : "▶▶▶";
}

function drawTrend(ctx: CanvasRenderingContext2D, x: number, y: number, net: number): void {
  const up = net > 0.5;
  const down = net < -0.5;
  const c = up ? COL.cash : down ? COL.cashDown : COL.text3;
  ctx.fillStyle = c;
  ctx.beginPath();
  if (up) {
    ctx.moveTo(x, y - 5);
    ctx.lineTo(x + 6, y + 3);
    ctx.lineTo(x - 6, y + 3);
  } else if (down) {
    ctx.moveTo(x, y + 5);
    ctx.lineTo(x + 6, y - 3);
    ctx.lineTo(x - 6, y - 3);
  } else {
    ctx.rect(x - 6, y - 1.5, 12, 3);
  }
  ctx.closePath();
  ctx.fill();
}

function drawStars(ctx: CanvasRenderingContext2D, A: Assets, x: number, y: number, size: number, stars: number): void {
  const star = A.sprite("icons/star");
  const gap = size + 3;
  for (let i = 0; i < 5; i++) {
    const sx = x + i * gap;
    ctx.globalAlpha = 0.22;
    blit(ctx, star, sx + size / 2, y, size, size); // empty backing
    ctx.globalAlpha = 1;
    const fill = Math.max(0, Math.min(1, stars - i));
    if (fill <= 0) continue;
    ctx.save();
    ctx.beginPath();
    ctx.rect(sx, y - size / 2, size * fill, size);
    ctx.clip();
    blit(ctx, star, sx + size / 2, y, size, size);
    ctx.restore();
  }
}

function drawAlerts(ctx: CanvasRenderingContext2D, game: Game, A: Assets, rightX: number): void {
  const chips: string[] = [];
  if (game.brokenCount > 0) chips.push(`${game.brokenCount} BROKEN`);
  if (game.avgLitter > 0.35) chips.push("LITTER");
  if (game.ledger.cash < 0) chips.push("LOW CASH");
  let x = rightX;
  const pulse = 0.6 + 0.4 * Math.sin(time * 6);
  for (const label of chips) {
    const w = 20 + label.length * 7;
    x -= w + 8;
    ctx.globalAlpha = pulse;
    roundRect(ctx, x, 16, w, 30, 6);
    ctx.fillStyle = hexA(COL.alert, 0.16);
    ctx.fill();
    ctx.strokeStyle = COL.alert;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.globalAlpha = 1;
    blit(ctx, A.sprite("icons/alert"), x + 12, 31, 12, 12);
    text(ctx, label, x + 22, 32, 10, COL.alert, "left", "700", 0.5);
  }
}

function ctrl(ctx: CanvasRenderingContext2D, clicks: Clickable[], x: number, label: string, action: string, color: string, w: number): void {
  const y = 14;
  const h = 34;
  roundRect(ctx, x, y, w, h, 6);
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  ctx.lineWidth = 1;
  ctx.stroke();
  text(ctx, label, x + w / 2, y + h / 2 + 1, 14, color, "center", "600");
  clicks.push({ x, y, w, h, action });
}

// ---- bottom HUD (tool bar + build palette + context panel) ------------------------
const TOOLBAR_X = 8;
const TOOL_W = 54;
const TOOL_GAP = 4;
const CHIPS_X = TOOLBAR_X + TOOL_ORDER.length * (TOOL_W + TOOL_GAP) + 8; // 308
const PANEL_X = 838;

const TOOL_LABEL: Record<ToolKind, string> = {
  path: "PATH",
  build: "BUILD",
  staff: "STAFF",
  price: "PRICE",
  demolish: "CLEAR",
};

function drawBottomHud(ctx: CanvasRenderingContext2D, game: Game, A: Assets, clicks: Clickable[]): void {
  const y0 = PARK_Y1;
  ctx.fillStyle = COL.panel;
  ctx.fillRect(0, y0, STAGE_W, BOTTOM_HUD_H);
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.beginPath();
  ctx.moveTo(0, y0 + 0.5);
  ctx.lineTo(STAGE_W, y0 + 0.5);
  ctx.stroke();

  drawToolbar(ctx, game, A, clicks);
  drawChips(ctx, game, A, clicks);

  // Divider before the context panel.
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.beginPath();
  ctx.moveTo(PANEL_X - 8.5, y0 + 8);
  ctx.lineTo(PANEL_X - 8.5, STAGE_H - 8);
  ctx.stroke();
  drawContextPanel(ctx, game, clicks);
}

function drawToolbar(ctx: CanvasRenderingContext2D, game: Game, A: Assets, clicks: Clickable[]): void {
  const y = PARK_Y1 + 8;
  const h = BOTTOM_HUD_H - 16;
  TOOL_ORDER.forEach((kind, i) => {
    const x = TOOLBAR_X + i * (TOOL_W + TOOL_GAP);
    const active = game.tool.kind === kind;
    roundRect(ctx, x, y, TOOL_W, h, 6);
    ctx.fillStyle = active ? hexA(COL.rating, 0.16) : "rgba(255,255,255,0.03)";
    ctx.fill();
    ctx.strokeStyle = active ? COL.rating : "rgba(255,255,255,0.08)";
    ctx.lineWidth = active ? 2 : 1;
    ctx.stroke();
    blit(ctx, A.sprite(`icons/tool_${kind}`), x + TOOL_W / 2, y + 16, 18, 18);
    text(ctx, TOOL_LABEL[kind], x + TOOL_W / 2, y + h - 9, 9, active ? COL.text : COL.text3, "center", "700", 0.5);
    clicks.push({ x, y, w: TOOL_W, h, action: `tool:${kind}` });
  });
}

// The palette that the active tool expands: build items (rides+stalls+scenery) or the
// staff roster; the passive tools show a one-line instruction instead.
function drawChips(ctx: CanvasRenderingContext2D, game: Game, A: Assets, clicks: Clickable[]): void {
  const y = PARK_Y1 + 8;
  const h = BOTTOM_HUD_H - 16;
  if (game.tool.kind === "build") {
    const chipW = 40;
    let x = CHIPS_X;
    for (const kind of RIDE_ORDER) x = buildChip(ctx, game, A, clicks, x, y, chipW, h, `buildRide:${kind}`, RIDES[kind].sprite, RIDES[kind].cost, game.tool.buildRide === kind, COL.thrill);
    for (const kind of STALL_ORDER) x = buildChip(ctx, game, A, clicks, x, y, chipW, h, `buildStall:${kind}`, STALLS[kind].sprite, STALLS[kind].cost, game.tool.buildStall === kind, COL.roof);
    for (const kind of SCENERY_ORDER) x = buildChip(ctx, game, A, clicks, x, y, chipW, h, `buildScenery:${kind}`, SCENERY[kind].sprite, SCENERY[kind].cost, game.tool.buildScenery === kind, COL.grass);
    return;
  }
  if (game.tool.kind === "staff") {
    const chipW = 96;
    let x = CHIPS_X;
    for (const kind of STAFF_ORDER) {
      const def = STAFF[kind];
      const active = game.tool.staffKind === kind;
      roundRect(ctx, x, y, chipW, h, 6);
      ctx.fillStyle = active ? hexA(COL.guest, 0.18) : "rgba(255,255,255,0.03)";
      ctx.fill();
      ctx.strokeStyle = active ? COL.guest : "rgba(255,255,255,0.08)";
      ctx.lineWidth = active ? 2 : 1;
      ctx.stroke();
      const sframes = A.staff[kind];
      if (sframes[0]) blit(ctx, sframes[0], x + 18, y + h / 2, 20, 20);
      text(ctx, def.label, x + 34, y + 18, 10, active ? COL.text : COL.text2, "left", "700", 0.3);
      text(ctx, `$${def.wage}/day`, x + 34, y + 34, 9, COL.text3, "left", "500");
      clicks.push({ x, y, w: chipW, h, action: `staff:${kind}` });
      x += chipW + 6;
    }
    return;
  }
  // Passive tools: an instruction line.
  const hint =
    game.tool.kind === "path"
      ? `DRAG TO LAY PATH  ·  $${TUNE.economy.pathCost}/TILE`
      : game.tool.kind === "price"
        ? "CLICK AN ATTRACTION TO SET ITS PRICE"
        : "CLICK A TILE OR OBJECT TO CLEAR IT  ·  50% REFUND";
  text(ctx, hint, CHIPS_X, PARK_Y1 + BOTTOM_HUD_H / 2, 12, COL.text2, "left", "500", 0.5);
}

function buildChip(
  ctx: CanvasRenderingContext2D,
  game: Game,
  A: Assets,
  clicks: Clickable[],
  x: number,
  y: number,
  w: number,
  h: number,
  action: string,
  sprite: string,
  cost: number,
  active: boolean,
  accent: string,
): number {
  const afford = game.ledger.cash >= cost;
  roundRect(ctx, x, y, w, h, 5);
  ctx.fillStyle = active ? hexA(accent, 0.2) : "rgba(255,255,255,0.03)";
  ctx.fill();
  ctx.strokeStyle = active ? accent : "rgba(255,255,255,0.08)";
  ctx.lineWidth = active ? 2 : 1;
  ctx.stroke();
  ctx.globalAlpha = afford ? 1 : 0.4;
  blit(ctx, A.sprite(sprite), x + w / 2, y + 18, 24, 24);
  ctx.globalAlpha = 1;
  text(ctx, `$${cost}`, x + w / 2, y + h - 9, 9, afford ? COL.cash : COL.text3, "center", "700");
  clicks.push({ x, y, w, h, action, disabled: !afford });
  return x + w + 3;
}

// The context panel: the selected object's details (attraction / staff) or, with nothing
// selected, the park's daily cash-flow summary. (A selected guest gets a floating inspector.)
function drawContextPanel(ctx: CanvasRenderingContext2D, game: Game, clicks: Clickable[]): void {
  const x = PANEL_X;
  const yTop = PARK_Y1 + 8;
  const a = game.selectedAttraction;
  if (a) {
    const def = a.category === "ride" ? RIDES[a.kind as RideKind] : STALLS[a.kind as StallKind];
    text(ctx, def.label, x, yTop + 8, 13, COL.text, "left", "700", 0.5);
    text(ctx, a.category === "ride" ? stateLabel(a) : a.connected ? "OPEN" : "NO PATH", x, yTop + 8, 10, a.connected ? COL.text3 : COL.alert, "right", "600", 0.5);

    // Price with steppers.
    text(ctx, "PRICE", x, yTop + 32, 9, COL.text3, "left", "600", 0.5);
    text(ctx, `$${a.price}`, x + 44, yTop + 32, 15, COL.cash, "left", "700");
    stepper(ctx, clicks, x + 90, yTop + 22, "-", "priceDown");
    stepper(ctx, clicks, x + 116, yTop + 22, "+", "priceUp");

    const recent = a.takingsWindow.reduce((s, v) => s + v, 0);
    text(ctx, `QUEUE ${a.queue.length}`, x + 160, yTop + 20, 11, COL.text2, "left", "600");
    text(ctx, `TAKINGS $${a.takings}`, x + 160, yTop + 38, 11, COL.text2, "left", "600");
    text(ctx, `RECENT $${recent}`, x + 290, yTop + 20, 11, COL.text3, "left", "500");
    text(ctx, `THRU ${Math.round(throughputOf(a))}/min`, x + 290, yTop + 38, 11, COL.text3, "left", "500");
    return;
  }

  const s = game.selectedStaff;
  if (s) {
    const def = STAFF[s.kind];
    text(ctx, def.label, x, yTop + 8, 13, COL.guest, "left", "700", 0.5);
    text(ctx, s.state.toUpperCase(), x, yTop + 8, 10, COL.text3, "right", "600", 0.5);
    text(ctx, `WAGE $${s.wage}/day`, x, yTop + 32, 12, COL.text2, "left", "600");
    const counts = STAFF_ORDER.map((k) => `${game.staff.filter((m) => m.kind === k).length} ${STAFF[k].label[0]}`).join("  ");
    text(ctx, `ROSTER ${counts}`, x + 170, yTop + 20, 11, COL.text3, "left", "500");
    text(ctx, `TOTAL WAGES $${game.wageBillTotal}/day`, x + 170, yTop + 38, 11, COL.text3, "left", "500");
    return;
  }

  // Nothing selected: the daily books.
  const l = game.ledger;
  text(ctx, "DAILY BOOKS", x, yTop + 8, 11, COL.text3, "left", "700", 1);
  text(ctx, `INCOME  $${Math.round(l.incomeRate)}/day`, x, yTop + 30, 12, COL.cash, "left", "600");
  text(ctx, `EXPENSE $${Math.round(l.expenseRate)}/day`, x, yTop + 48, 12, COL.cashDown, "left", "600");
  text(ctx, `UPKEEP $${game.upkeepTotal}`, x + 210, yTop + 20, 11, COL.text2, "left", "500");
  text(ctx, `WAGES $${game.wageBillTotal}`, x + 210, yTop + 38, 11, COL.text2, "left", "500");
  text(ctx, `PROFIT $${Math.round(l.totalProfit)}`, x + 330, yTop + 20, 11, COL.text3, "left", "500");
  text(ctx, `PEAK ${game.peakGuests}`, x + 330, yTop + 38, 11, COL.text3, "left", "500");
}

function stateLabel(a: Attraction): string {
  return a.state === "broken" ? "BROKEN" : a.state === "running" ? "RUNNING" : a.state === "loading" ? "LOADING" : a.connected ? "READY" : "NO PATH";
}

function stepper(ctx: CanvasRenderingContext2D, clicks: Clickable[], x: number, y: number, label: string, action: string): void {
  const w = 22;
  const h = 22;
  roundRect(ctx, x, y, w, h, 4);
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.lineWidth = 1;
  ctx.stroke();
  text(ctx, label, x + w / 2, y + h / 2 + 1, 15, COL.text, "center", "700");
  clicks.push({ x, y, w, h, action });
}

// ---- floating guest inspector (desire bars + mood + wallet) ------------------------
const DESIRE_ORDER: DesireKey[] = ["thrill", "hunger", "thirst", "bladder", "energy"];
const DESIRE_ICON: Record<DesireKey, string> = {
  thrill: "icons/thrill",
  hunger: "icons/hunger",
  thirst: "icons/thirst",
  bladder: "icons/bladder",
  energy: "icons/energy",
};
const DESIRE_COLOR: Record<DesireKey, string> = {
  thrill: COL.thrill,
  hunger: COL.hunger,
  thirst: COL.thirst,
  bladder: COL.thirst,
  energy: COL.happiness,
};

function drawInspector(ctx: CanvasRenderingContext2D, game: Game, A: Assets): void {
  const g = game.selectedGuest;
  if (!g) return;
  const w = 244;
  const h = 168;
  const x = STAGE_W - w - 12;
  const y = PARK_Y1 - h - 10;

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.5)";
  ctx.shadowBlur = 24;
  roundRect(ctx, x, y, w, h, 12);
  ctx.fillStyle = COL.panel;
  ctx.fill();
  ctx.restore();
  roundRect(ctx, x, y, w, h, 12);
  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  ctx.lineWidth = 1;
  ctx.stroke();

  blit(ctx, A.sprite("icons/guest"), x + 20, y + 22, 18, 18);
  text(ctx, "GUEST", x + 36, y + 16, 12, COL.guest, "left", "700", 0.5);
  text(ctx, g.state.toUpperCase(), x + 36, y + 30, 9, COL.text3, "left", "500", 0.5);
  text(ctx, `$${g.wallet.toFixed(0)}`, x + w - 12, y + 22, 14, COL.cash, "right", "700");

  // Happiness bar (the value everything moves).
  const hy = y + 44;
  text(ctx, "HAPPY", x + 12, hy, 9, COL.text3, "left", "600", 0.5);
  bar(ctx, x + 58, hy - 4, w - 70, 8, g.happiness / 100, g.happiness < 30 ? COL.alert : g.happiness > 70 ? COL.cash : COL.happiness);

  // Desire bars (needs read high = pressing; energy reads a reserve).
  let by = y + 62;
  for (const k of DESIRE_ORDER) {
    blit(ctx, A.sprite(DESIRE_ICON[k]), x + 18, by + 4, 14, 14);
    text(ctx, k.toUpperCase(), x + 30, by + 4, 8, COL.text3, "left", "500", 0.3);
    bar(ctx, x + 92, by, w - 104, 8, g.desires[k] / 100, DESIRE_COLOR[k]);
    by += 19;
  }
}

function bar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, frac: number, color: string): void {
  const f = Math.max(0, Math.min(1, frac));
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fill();
  if (f > 0) {
    ctx.fillStyle = color;
    roundRect(ctx, x, y, Math.max(h, w * f), h, h / 2);
    ctx.fill();
  }
}

// ---- notifications (milestone / warning toasts) -----------------------------------
function drawNotifications(ctx: CanvasRenderingContext2D, game: Game): void {
  let y = PARK_Y0 + 24;
  for (const n of game.notifications) {
    const alpha = Math.max(0, Math.min(1, n.ttl / 1.5));
    const wdt = 30 + n.text.length * 9;
    const x = STAGE_W / 2 - wdt / 2;
    ctx.globalAlpha = alpha;
    roundRect(ctx, x, y, wdt, 30, 8);
    ctx.fillStyle = hexA(n.good ? COL.rating : COL.alert, 0.16);
    ctx.fill();
    ctx.strokeStyle = n.good ? COL.rating : COL.alert;
    ctx.lineWidth = 1;
    ctx.stroke();
    text(ctx, n.text, STAGE_W / 2, y + 16, 13, n.good ? COL.rating : COL.alert, "center", "700", 1);
    ctx.globalAlpha = 1;
    y += 38;
  }

  // In-place (Space) pause marker — the board is frozen but still interactive.
  if (game.paused && game.state === "playing") {
    text(ctx, "PAUSED", STAGE_W / 2, PARK_Y1 - 18, 14, COL.rating, "center", "800", 4);
  }
}

// ---- title ------------------------------------------------------------------------
function drawTitle(ctx: CanvasRenderingContext2D, game: Game, A: Assets, clicks: Clickable[]): void {
  // A dim, slowly-panning slice of a lively park behind the menu.
  ctx.save();
  ctx.globalAlpha = 0.5;
  const grass = A.sprite("tiles/grass");
  const pan = (time * 10) % TILE;
  for (let row = -1; row * TILE < STAGE_H; row++) {
    for (let col = -1; col * TILE < STAGE_W + TILE; col++) {
      blit(ctx, grass, col * TILE + TILE / 2 - pan, row * TILE + TILE / 2, TILE, TILE);
    }
  }
  ctx.globalAlpha = 0.7;
  const strip = A.sprite("tiles/path");
  const py = STAGE_H - 120;
  for (let col = -1; col * TILE < STAGE_W + TILE; col++) blit(ctx, strip, col * TILE + TILE / 2 - pan, py, TILE, TILE);
  blit(ctx, A.sprite(RIDES.carousel.sprite), 250 - pan, py - 48, 72, 72);
  blit(ctx, A.sprite(STALLS.food.sprite), 470 - pan, py - 24, 48, 24);
  blit(ctx, A.sprite(RIDES.drop_tower.sprite), 980 - pan, py - 36, 48, 48);
  ctx.globalAlpha = 1;
  ctx.restore();

  // A veil so the menu reads clearly over the park.
  ctx.fillStyle = hexA(COL.void, 0.55);
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);

  const grad = ctx.createLinearGradient(430, 0, 850, 0);
  grad.addColorStop(0, COL.rating);
  grad.addColorStop(0.5, COL.roof);
  grad.addColorStop(1, COL.thrill);
  ctx.save();
  ctx.shadowColor = COL.roof;
  ctx.shadowBlur = 22;
  ctx.font = `800 88px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = grad;
  drawSpaced(ctx, "MIDWAY", STAGE_W / 2, 232, 88, 12);
  ctx.restore();
  text(ctx, game.mode.tagline, STAGE_W / 2, 300, 15, COL.text2, "center", "500", 4);

  const items = menuItems("title", game);
  items.forEach((it, i) => {
    const y = 400 + i * 62;
    const on = highlighted(game, i, STAGE_W / 2 - 200, y - 26, 400, 52);
    text(ctx, it.label, STAGE_W / 2, y, 30, on ? COL.rating : COL.text, "center", "700", 6);
    if (on) {
      text(ctx, "▶", STAGE_W / 2 - 190, y, 20, COL.rating, "center", "700");
      text(ctx, "◀", STAGE_W / 2 + 190, y, 20, COL.rating, "center", "700");
    }
    clicks.push({ x: STAGE_W / 2 - 200, y: y - 26, w: 400, h: 52, action: it.action });
  });
  text(ctx, "↑↓ SELECT    ENTER CONFIRM    MOUSE OK", STAGE_W / 2, 640, 13, COL.text3, "center", "500", 3);
}

function drawSpaced(ctx: CanvasRenderingContext2D, s: string, cx: number, y: number, size: number, letter: number): void {
  const chars = [...s];
  const adv = size * 0.62 + letter;
  let x = cx - (chars.length * adv) / 2 + adv / 2;
  ctx.textAlign = "center";
  for (const c of chars) {
    ctx.fillText(c, x, y);
    x += adv;
  }
}

// ---- how-to -----------------------------------------------------------------------
function drawHowto(ctx: CanvasRenderingContext2D, game: Game, clicks: Clickable[]): void {
  ctx.fillStyle = COL.void;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
  text(ctx, "HOW TO PLAY", STAGE_W / 2, 56, 32, COL.text, "center", "700", 4);
  const lines: [string, string][] = [
    ["THE LOOP", "Happy guests lift your park RATING; a higher rating brings MORE guests through the gate; more guests spend more money; that funds a bigger, better park. Run it in reverse and the park spirals into the red."],
    ["BUILD", "Pick the PATH tool and drag walkways out from the gate. Use BUILD to place rides, stalls, and scenery beside the path — each snaps a queue ENTRANCE onto an adjacent connected path, or it shows NO PATH and stays shut."],
    ["GUESTS", "Every guest arrives with DESIRES (thrill, hunger, thirst, bladder) that grow over time, an energy reserve that drains as they walk, and a wallet. They seek the rides and stalls that meet their strongest need — if they can reach and afford them."],
    ["PRICE", "Set fair prices with the PRICE tool. Overprice and guests balk at the gate and sour in your park; a bench, tidy paths, and scenery keep them happy. STAFF: janitors clear litter, mechanics fix + inspect rides, entertainers lift the mood."],
    ["GOAL", "There is no win screen — a solvent park runs forever. You lose only if cash sits below the bankruptcy floor past a short grace period. Grow the park as long and as well as you can."],
    ["CONTROLS", "Click a tool (or an item chip) then click the park. SPACE pauses in place; 1/2/3 (or F) set speed; ARROWS/WASD pan, drag to pan, wheel to zoom; M mutes; ESC opens the pause menu."],
  ];
  let y = 104;
  for (const [k, v] of lines) {
    text(ctx, k, 140, y, 14, COL.rating, "left", "700", 1);
    wrap(ctx, v, 320, y, 820, 14, COL.text2);
    y += lineCount(ctx, v, 820, 14) * 20 + 14;
  }
  const bx = STAGE_W / 2 - 90;
  const byy = STAGE_H - 64;
  const onBack = highlighted(game, 0, bx, byy, 180, 42);
  button(ctx, clicks, bx, byy, 180, 42, "BACK", "menu:back", onBack ? COL.rating : COL.text, true);
}

// ---- pause / game-over overlays ---------------------------------------------------
function drawPause(ctx: CanvasRenderingContext2D, game: Game, clicks: Clickable[]): void {
  dim(ctx);
  panelBox(ctx, STAGE_W / 2 - 200, 200, 400, 320);
  text(ctx, "PAUSED", STAGE_W / 2, 252, 30, COL.text, "center", "700", 4);
  menuButtons(ctx, game, menuItems("paused", game), 322, 58, 260, clicks);
}

function drawGameOver(ctx: CanvasRenderingContext2D, game: Game, clicks: Clickable[]): void {
  dim(ctx);
  panelBox(ctx, STAGE_W / 2 - 240, 150, 480, 400);
  text(ctx, "PARK CLOSED", STAGE_W / 2, 208, 15, COL.alert, "center", "700", 3);
  text(ctx, "BANKRUPT", STAGE_W / 2, 250, 40, COL.cashDown, "center", "800", 2);

  text(ctx, `${game.day}`, STAGE_W / 2, 322, 64, COL.text, "center", "800");
  text(ctx, "DAYS OPERATED", STAGE_W / 2, 366, 13, COL.text3, "center", "600", 3);

  const stats: [string, string][] = [
    ["PEAK GUESTS", `${game.peakGuests}`],
    ["FINAL RATING", `${(game.ratingStars).toFixed(1)}★`],
    ["TOTAL PROFIT", `$${Math.round(game.ledger.totalProfit)}`],
  ];
  let sx = STAGE_W / 2 - 180;
  for (const [k, v] of stats) {
    text(ctx, v, sx + 60, 408, 18, COL.text, "center", "700");
    text(ctx, k, sx + 60, 430, 9, COL.text3, "center", "600", 1);
    sx += 120;
  }

  const items = menuItems("gameover", game);
  const xs = [STAGE_W / 2 - 170, STAGE_W / 2 + 10];
  items.forEach((it, i) => {
    const on = highlighted(game, i, xs[i]!, 470, 160, 46);
    button(ctx, clicks, xs[i]!, 470, 160, 46, it.label, it.action, on ? COL.rating : COL.text, true);
  });
}

function menuButtons(ctx: CanvasRenderingContext2D, game: Game, items: MenuItem[], y0: number, gap: number, w: number, clicks: Clickable[]): void {
  const x = STAGE_W / 2 - w / 2;
  items.forEach((it, i) => {
    const y = y0 + i * gap;
    const on = highlighted(game, i, x, y, w, 44);
    button(ctx, clicks, x, y, w, 44, it.label, it.action, on ? COL.rating : COL.text, true);
  });
}

function button(ctx: CanvasRenderingContext2D, clicks: Clickable[], x: number, y: number, w: number, h: number, label: string, action: string, color: string, enabled: boolean): void {
  roundRect(ctx, x, y, w, h, 6);
  ctx.fillStyle = enabled ? hexA(color, 0.12) : "rgba(255,255,255,0.03)";
  ctx.fill();
  ctx.strokeStyle = enabled ? color : "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  text(ctx, label, x + w / 2, y + h / 2 + 1, 13, enabled ? color : COL.text3, "center", "700", 0.5);
  if (enabled) clicks.push({ x, y, w, h, action });
}

function highlighted(game: Game, i: number, x: number, y: number, w: number, h: number): boolean {
  return menuIndex === i || inRect(game.pointerX, game.pointerY, x, y, w, h);
}

function dim(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = "rgba(8,11,20,0.72)";
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
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  ctx.stroke();
}
