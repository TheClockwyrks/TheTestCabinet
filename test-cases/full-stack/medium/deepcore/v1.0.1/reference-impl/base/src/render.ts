// Deepcore — the renderer (specs/overview.md, specs/flow.md, specs/assets.md).
//
// Draws the whole game with Canvas 2D in the pinned palette + monospace type: the vertical
// camera over the banded mine (produced band tiles + faint grid, carved tunnels, ore veins,
// material nodes, hazards), the animated miner (produced sprite-sheet cycles, mirrored by
// facing), the surface camp with its four buildings and the assembling rocket, the produced
// particle VFX composited over the world, and — in code — the full status-bar HUD, the
// scanner indicator, the Core Sample countdown, the four building panels, and every menu
// and state screen. Produced sprites are used when present (nearest-neighbor); a missing
// asset falls back to a neutral code drawing so the build never crashes (specs/assets.md).

import {
  BANDS,
  DEPOT_INCREMENT,
  FONT_STACK,
  FUEL_COST_PER_UNIT,
  GRID_MARGIN_X,
  ITEMS,
  LOW_FUEL_FRACTION,
  LOW_HULL_FRACTION,
  MAX_TIER,
  ORES,
  PALETTE,
  REPAIR_COST_PER_POINT,
  ROCKET_COMPONENTS,
  STAGE_HEIGHT,
  STAGE_WIDTH,
  STATUS_BAR_HEIGHT,
  TILE_SIZE,
  UPGRADE_TRACKS,
  VIEWPORT_HEIGHT,
  VIEWPORT_Y,
  WORLD_COLS,
  WORLD_ROWS,
} from "./constants";
import type { ItemId, Material, MinerState, Ore, Tile } from "./types";
import { isMinableKind, tileMaxHealth } from "./world";
import { SURFACE_BUILDINGS } from "./game";
import type { Game } from "./game";
import { MINER_H, MINER_W, SURFACE_FEET_Y, minerCenterX, minerCenterY } from "./physics";
import { cargoValue, fuelCost, fuelDeficit, hullDeficit, nextUpgradePrice, repairCost } from "./economy";
import { hasSave } from "./save";
import { canFabricate, hasMaterial, nextComponent, allInstalled } from "./rocket";
import type { Assets } from "./assets";
import { isReady } from "./assets";
import type { Bursts } from "./particles";

export interface Clickable {
  x: number;
  y: number;
  w: number;
  h: number;
  action: string;
  disabled?: boolean;
}

export interface View {
  time: number;
  menuIndex: number;
  muted: boolean;
  pointer: { x: number; y: number };
}

export interface MenuItem {
  label: string;
  action: string;
}

const P = PALETTE;
const FPS: Record<MinerState, number> = {
  idle: 3,
  walk: 10,
  "drill-down": 12,
  "drill-side": 12,
  jetpack: 14,
  fall: 6,
  hurt: 12,
  "fuel-out": 3,
};

// ---------------------------------------------------------------------------
// Menu content (specs/flow.md, specs/modes.md) — shared with keyboard nav in main.ts
// ---------------------------------------------------------------------------

export function menuItems(game: Game): MenuItem[] {
  switch (game.phase) {
    case "title": {
      // CONTINUE appears only when a saved expedition exists (specs/flow.md).
      const items: MenuItem[] = [];
      if (hasSave()) items.push({ label: "CONTINUE", action: "continue" });
      items.push({ label: "NEW EXPEDITION", action: "nav:mode-select" });
      items.push({ label: "HOW TO PLAY", action: "nav:how-to" });
      return items;
    }
    case "mode-select":
      return [
        { label: "STANDARD", action: "mode:standard" },
        { label: "HARDCORE", action: "mode:hardcore" },
        { label: "BACK", action: "nav:title" },
      ];
    case "how-to-play":
      return [{ label: "BACK", action: "nav:title" }];
    case "paused":
      return [
        { label: "RESUME", action: "resume" },
        { label: "RESTART", action: "restart" },
        { label: "QUIT TO MENU", action: "nav:title" },
      ];
    case "victory":
      return [
        { label: "PLAY AGAIN", action: "again" },
        { label: "MENU", action: "nav:title" },
      ];
    case "game-over":
      // A Standard death keeps the save, so it can be restored; Hardcore consumed it, so
      // the only path on is a fresh expedition (specs/modes.md).
      if (game.mode === "standard" && hasSave()) {
        return [
          { label: "CONTINUE FROM SAVE", action: "continue" },
          { label: "MENU", action: "nav:title" },
        ];
      }
      return [
        { label: "PLAY AGAIN", action: "again" },
        { label: "MENU", action: "nav:title" },
      ];
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Text + primitives
// ---------------------------------------------------------------------------

interface TextOpts {
  size?: number;
  color?: string;
  align?: CanvasTextAlign;
  baseline?: CanvasTextBaseline;
  bold?: boolean;
}

function text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, o: TextOpts = {}): void {
  ctx.font = `${o.bold ? "bold " : ""}${o.size ?? 16}px ${FONT_STACK}`;
  ctx.fillStyle = o.color ?? P.textPrimary;
  ctx.textAlign = o.align ?? "left";
  ctx.textBaseline = o.baseline ?? "alphabetic";
  ctx.fillText(s, x, y);
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

function isHot(view: View, x: number, y: number, w: number, h: number): boolean {
  const p = view.pointer;
  return p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h;
}

function button(
  ctx: CanvasRenderingContext2D,
  cl: Clickable[],
  view: View,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  action: string,
  opts: { disabled?: boolean; selected?: boolean; accent?: string } = {},
): void {
  const hot = !opts.disabled && (opts.selected || isHot(view, x, y, w, h));
  const accent = opts.accent ?? P.hull;
  roundRect(ctx, x, y, w, h, 6);
  ctx.fillStyle = opts.disabled ? "#0e1319" : hot ? "#1e2833" : P.panel;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = opts.disabled ? "#20272f" : hot ? accent : "#2a333d";
  ctx.stroke();
  text(ctx, label, x + w / 2, y + h / 2, {
    size: Math.min(20, h * 0.42),
    color: opts.disabled ? P.textTertiary : hot ? P.textPrimary : P.textSecondary,
    align: "center",
    baseline: "middle",
    bold: true,
  });
  cl.push({ x, y, w, h, action, disabled: opts.disabled });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function render(
  ctx: CanvasRenderingContext2D,
  game: Game,
  assets: Assets,
  bursts: Bursts,
  view: View,
): Clickable[] {
  const cl: Clickable[] = [];
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = P.void;
  ctx.fillRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);

  if (game.phase === "in-mine" || game.phase === "paused") {
    drawMine(ctx, game, assets, bursts, view, cl);
    drawStatusBar(ctx, game, view, cl);
    if (game.phase === "in-mine" && game.panel) drawPanel(ctx, game, view, cl);
    if (game.phase === "paused") drawPauseMenu(ctx, game, view, cl);
    drawNotes(ctx, game);
  } else {
    drawBackdrop(ctx, game, assets, view);
    if (game.phase === "title") drawTitle(ctx, game, view, cl);
    else if (game.phase === "mode-select") drawModeSelect(ctx, game, view, cl);
    else if (game.phase === "how-to-play") drawHowTo(ctx, game, view, cl);
    else if (game.phase === "victory") drawEndScreen(ctx, game, view, cl, true);
    else if (game.phase === "game-over") drawEndScreen(ctx, game, view, cl, false);
  }
  return cl;
}

// ---------------------------------------------------------------------------
// The live mine
// ---------------------------------------------------------------------------

function bandFill(band: Tile["band"]): string {
  return BANDS[band].fill;
}

function drawMine(
  ctx: CanvasRenderingContext2D,
  game: Game,
  assets: Assets,
  bursts: Bursts,
  view: View,
  cl: Clickable[],
): void {
  const cam = game.cameraY;
  const offX = -game.cameraX; // world x → screen x (the mine scrolls horizontally, specs/world.md)
  const offY = VIEWPORT_Y - cam;

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, VIEWPORT_Y, STAGE_WIDTH, VIEWPORT_HEIGHT);
  ctx.clip();

  // Sky above the ground line (world y < SURFACE_FEET_Y).
  const groundY = SURFACE_FEET_Y + offY;
  ctx.fillStyle = P.duskSky;
  ctx.fillRect(0, VIEWPORT_Y, STAGE_WIDTH, Math.max(0, Math.min(STAGE_HEIGHT, groundY) - VIEWPORT_Y));
  // Deep field below the visible world floor.
  ctx.fillStyle = P.void;
  const worldBottom = WORLD_ROWS * TILE_SIZE + offY;
  if (worldBottom < STAGE_HEIGHT) ctx.fillRect(0, worldBottom, STAGE_WIDTH, STAGE_HEIGHT - worldBottom);

  // Visible tile window (both axes). Row 0 is the open surface strip — drawn by drawSurface,
  // not as a mine tile — so the tile loop starts at row 1.
  const rowTop = Math.max(1, Math.floor(cam / TILE_SIZE));
  const rowBot = Math.min(WORLD_ROWS - 1, Math.floor((cam + VIEWPORT_HEIGHT) / TILE_SIZE));
  const colLeft = Math.max(0, Math.floor(game.cameraX / TILE_SIZE));
  const colRight = Math.min(WORLD_COLS - 1, Math.floor((game.cameraX + STAGE_WIDTH) / TILE_SIZE));

  for (let r = rowTop; r <= rowBot; r++) {
    for (let c = colLeft; c <= colRight; c++) {
      drawTile(ctx, assets, game.grid, r, c, GRID_MARGIN_X + c * TILE_SIZE + offX, r * TILE_SIZE + offY, view);
    }
  }

  drawGrid(ctx, offX, offY, rowTop, rowBot, colLeft, colRight);
  drawDrillDamage(ctx, game, assets, offX, offY, rowTop, rowBot, colLeft, colRight);
  drawSurface(ctx, game, assets, offX, offY);
  drawGroundItems(ctx, game, assets, view, offX, offY);
  drawMiner(ctx, game, assets, view, offX, offY);
  bursts.draw(ctx, offX, offY);

  drawScanner(ctx, game, offX, offY);
  ctx.restore();

  drawCoreCountdown(ctx, game, view);

  // Building activation hitboxes (only usable at the surface with no panel open).
  if (game.phase === "in-mine" && !game.panel && game.atSurface()) {
    for (const b of SURFACE_BUILDINGS) {
      const bx = GRID_MARGIN_X + b.col * TILE_SIZE + TILE_SIZE / 2 + offX;
      const by = groundY - BUILDING_H - 6;
      cl.push({
        x: bx - BUILDING_W / 2,
        y: Math.max(VIEWPORT_Y, by),
        w: BUILDING_W,
        h: BUILDING_H + 6,
        action: `open:${b.panel}`,
      });
    }
    const b = game.nearbyBuilding();
    if (b) {
      const bx = GRID_MARGIN_X + b.col * TILE_SIZE + TILE_SIZE / 2 + offX;
      text(ctx, `[E] ${b.label}`, bx, groundY - BUILDING_H - 16, {
        size: 14,
        color: P.credits,
        align: "center",
        bold: true,
      });
    }
  }
}

// Building / rocket draw sizes (scaled to sit naturally among the 80px tiles).
const BUILDING_W = 112;
const BUILDING_H = 132;
const ROCKET_W = 96;
const ROCKET_H = 160;
/** Carved-tunnel dirt lip (px) and rounded-corner radius (px of an 80px tile). */
const CARVE_INSET = 11;
const CARVE_RADIUS = 16;

/**
 * A stable per-cell variant index in `[0, n)` from a cell's (row, col) — a small integer
 * hash so a band's rock does not visibly repeat one texture (specs/world.md). Stable
 * across frames (depends only on the grid position), well-scattered (no diagonal banding).
 */
function tileVariant(row: number, col: number, n: number): number {
  if (n <= 1) return 0;
  let h = (row * 73856093) ^ (col * 19349663);
  h ^= h >>> 13;
  return ((h % n) + n) % n;
}

function drawTile(
  ctx: CanvasRenderingContext2D,
  assets: Assets,
  grid: Tile[][],
  row: number,
  col: number,
  x: number,
  y: number,
  view: View,
): void {
  const s = TILE_SIZE;
  const tile = grid[row]![col]!;
  switch (tile.kind) {
    case "bedrock": {
      const img = assets.tile("bedrock");
      if (isReady(img)) ctx.drawImage(img, x, y, s, s);
      else {
        ctx.fillStyle = P.bedrock;
        ctx.fillRect(x, y, s, s);
      }
      break;
    }
    case "tunnel": {
      // Inset dirt lip + rounded corners, joining open neighbors, in code (specs/world.md).
      drawCarved(ctx, assets, grid, tile, row, col, x, y, cellOpen, (px, py) => {
        const img = assets.tile("tunnel");
        if (isReady(img)) ctx.drawImage(img, px, py, s, s);
        else {
          ctx.fillStyle = P.tunnel;
          ctx.fillRect(px, py, s, s);
        }
      });
      break;
    }
    case "lava": {
      // Dirt-fringed, joining adjacent lava into one pool (specs/world.md, specs/hazards.md).
      drawCarved(ctx, assets, grid, tile, row, col, x, y, cellLava, (px, py) => {
        const img = assets.lava.length ? assets.lava[Math.floor(view.time * 8) % assets.lava.length] : undefined;
        if (isReady(img)) ctx.drawImage(img, px, py, s, s);
        else {
          const pulse = 0.5 + 0.5 * Math.sin(view.time * 6 + px * 0.1);
          ctx.fillStyle = P.lava;
          ctx.fillRect(px, py, s, s);
          ctx.fillStyle = `rgba(255,210,120,${0.25 + 0.3 * pulse})`;
          ctx.fillRect(px + 10, py + 10, s - 20, s - 20);
        }
      });
      break;
    }
    case "stone": {
      // Unbreakable stone — a solid boulder, not inset (specs/world.md).
      const variants = assets.stone();
      const img = variants.length ? variants[tileVariant(row, col, variants.length)] : undefined;
      if (isReady(img)) ctx.drawImage(img, x, y, s, s);
      else drawStoneFallback(ctx, x, y);
      break;
    }
    case "core": {
      const img = assets.material("core");
      if (isReady(img)) ctx.drawImage(img, x, y, s, s);
      else {
        drawBandRock(ctx, assets, tile, x, y, row, col);
        const g = ctx.createRadialGradient(x + s / 2, y + s / 2, 2, x + s / 2, y + s / 2, s / 2);
        g.addColorStop(0, "#fff3d0");
        g.addColorStop(0.5, P.coreSample);
        g.addColorStop(1, "rgba(255,74,42,0)");
        ctx.fillStyle = g;
        ctx.fillRect(x, y, s, s);
      }
      break;
    }
    case "gas": {
      // Hidden: a gas pocket is drawn as ordinary band rock (specs/hazards.md). Its only
      // tell is the subtle gas-seep VFX fired over it (game.emitGasSeeps / specs/assets.md).
      drawBandRock(ctx, assets, tile, x, y, row, col);
      break;
    }
    case "ore": {
      drawBandRock(ctx, assets, tile, x, y, row, col);
      const img = assets.ore(tile.ore!);
      if (isReady(img)) ctx.drawImage(img, x, y, s, s);
      else drawOreFallback(ctx, tile.ore!, x, y);
      break;
    }
    case "material": {
      drawBandRock(ctx, assets, tile, x, y, row, col);
      const img = assets.material(tile.material!);
      if (isReady(img)) ctx.drawImage(img, x, y, s, s);
      else drawMaterialFallback(ctx, tile.material!, x, y);
      break;
    }
    default: {
      drawBandRock(ctx, assets, tile, x, y, row, col);
    }
  }
}

/** Whether a neighbor cell is open tunnel (so a carved hole merges into it). */
function cellOpen(grid: Tile[][], c: number, r: number): boolean {
  if (r < 0 || r >= grid.length) return false;
  const line = grid[r]!;
  if (c < 0 || c >= line.length) return false;
  return line[c]!.kind === "tunnel";
}

/** Whether a neighbor cell is lava (so adjacent lava merges into one pool). */
function cellLava(grid: Tile[][], c: number, r: number): boolean {
  if (r < 0 || r >= grid.length) return false;
  const line = grid[r]!;
  if (c < 0 || c >= line.length) return false;
  return line[c]!.kind === "lava";
}

/**
 * Build a rounded-rect path with per-corner radii (a radius of 0 gives a sharp corner via
 * the degenerate arcTo). Used to shape a carved tunnel / lava pool inside a tile.
 */
function roundedPath(
  ctx: CanvasRenderingContext2D,
  l: number,
  t: number,
  r: number,
  b: number,
  rTL: number,
  rTR: number,
  rBR: number,
  rBL: number,
): void {
  ctx.beginPath();
  ctx.moveTo(l + rTL, t);
  ctx.lineTo(r - rTR, t);
  ctx.arcTo(r, t, r, b, rTR);
  ctx.lineTo(r, b - rBR);
  ctx.arcTo(r, b, l, b, rBR);
  ctx.lineTo(l + rBL, b);
  ctx.arcTo(l, b, l, t, rBL);
  ctx.lineTo(l, t + rTL);
  ctx.arcTo(l, t, r, t, rTL);
  ctx.closePath();
}

/**
 * The carved shape for a tile: inset by CARVE_INSET on any side whose neighbor is solid,
 * extended to the tile edge on any side where `open(neighbor)` holds (so it joins that
 * neighbor). Each corner gets one of three treatments so the dirt lip reads continuous
 * (specs/world.md, specs/assets.md — "which corners are exterior"):
 *
 *  - EXTERIOR corner (both its sides inset, i.e. both orthogonal neighbors solid): the
 *    tunnel wall turns here, rounded by CARVE_RADIUS — so orthogonally adjacent open cells
 *    merge while diagonally-touching ones stay two distinct holes.
 *  - INTERIOR corner (both its sides open BUT the diagonal neighbor is solid): a solid
 *    rock tile pokes into the bend, so a small rounded dirt nub must remain. The carve
 *    rounds the tile corner by CARVE_INSET (the lip width) rather than filling to it, so
 *    the already-drawn band rock shows through as a nub whose tunnel-facing edge lands
 *    flush with the neighbours' lips.
 *  - Otherwise (exactly one side open, or a fully-open 2×2 where the diagonal is also
 *    open): a sharp corner at the tile edge, so the fill runs out seamlessly.
 */
function buildCarvePath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  openL: boolean,
  openR: boolean,
  openU: boolean,
  openD: boolean,
  openUL: boolean,
  openUR: boolean,
  openDR: boolean,
  openDL: boolean,
): void {
  const s = TILE_SIZE;
  const m = CARVE_INSET;
  const rad = CARVE_RADIUS;
  const l = x + (openL ? 0 : m);
  const r = x + s - (openR ? 0 : m);
  const t = y + (openU ? 0 : m);
  const b = y + s - (openD ? 0 : m);
  // Per corner: exterior (both sides solid) → CARVE_RADIUS; interior nub (both sides open
  // but diagonal solid) → CARVE_INSET at the tile corner; else sharp.
  const corner = (a: boolean, bb: boolean, diag: boolean): number =>
    !a && !bb ? rad : a && bb && !diag ? m : 0;
  roundedPath(
    ctx,
    l,
    t,
    r,
    b,
    corner(openU, openL, openUL),
    corner(openU, openR, openUR),
    corner(openD, openR, openDR),
    corner(openD, openL, openDL),
  );
}

/** Paint a carved (inset, rounded, neighbor-joined) region — shared by tunnels and lava. */
function drawCarved(
  ctx: CanvasRenderingContext2D,
  assets: Assets,
  grid: Tile[][],
  tile: Tile,
  row: number,
  col: number,
  x: number,
  y: number,
  open: (grid: Tile[][], c: number, r: number) => boolean,
  fill: (px: number, py: number) => void,
): void {
  // The dirt lip/fringe is the band rock showing through around the carved region.
  drawBandRock(ctx, assets, tile, x, y, row, col);
  const openL = open(grid, col - 1, row);
  const openR = open(grid, col + 1, row);
  const openU = open(grid, col, row - 1);
  const openD = open(grid, col, row + 1);
  // Diagonals decide interior corners: two open sides plus a SOLID diagonal is a rock poke
  // into the bend that must keep its dirt nub (an L-bend keeps one, a T keeps two).
  const openUL = open(grid, col - 1, row - 1);
  const openUR = open(grid, col + 1, row - 1);
  const openDR = open(grid, col + 1, row + 1);
  const openDL = open(grid, col - 1, row + 1);
  ctx.save();
  buildCarvePath(ctx, x, y, openL, openR, openU, openD, openUL, openUR, openDR, openDL);
  ctx.clip();
  fill(x, y);
  ctx.restore();
}

function drawStoneFallback(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  const s = TILE_SIZE;
  ctx.fillStyle = "#3f4652";
  ctx.fillRect(x, y, s, s);
  ctx.fillStyle = "#4c5360";
  roundRect(ctx, x + 6, y + 6, s - 12, s - 12, 14);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.10)";
  roundRect(ctx, x + 12, y + 12, s - 24, 14, 7);
  ctx.fill();
  ctx.fillStyle = "rgba(0,0,0,0.30)";
  roundRect(ctx, x + 10, y + s - 24, s - 20, 14, 7);
  ctx.fill();
}

/**
 * Draw the drill-damage crack overlay on every visible tile that carries accrued damage
 * (specs/character.md, specs/assets.md). The crack frame is a function of the tile's PERSISTED
 * damage fraction `1 − health/maxHealth`, not a transient drill timer — so a tile drilled
 * partway and abandoned still shows its cracks when the miner returns to it, and resuming
 * deepens them from where they were. Undrilled tiles (health undefined) show nothing.
 */
function drawDrillDamage(
  ctx: CanvasRenderingContext2D,
  game: Game,
  assets: Assets,
  offX: number,
  offY: number,
  rowTop: number,
  rowBot: number,
  colLeft: number,
  colRight: number,
): void {
  const frames = assets.crack;
  for (let r = rowTop; r <= rowBot; r++) {
    const line = game.grid[r];
    if (!line) continue;
    for (let c = colLeft; c <= colRight; c++) {
      const tile = line[c]!;
      if (!isMinableKind(tile.kind) || tile.health === undefined) continue;
      const maxH = tileMaxHealth(tile);
      const frac = maxH > 0 ? Math.min(1, Math.max(0, 1 - tile.health / maxH)) : 0;
      if (frac <= 0) continue;
      drawCrackOverlay(ctx, frames, frac, GRID_MARGIN_X + c * TILE_SIZE + offX, r * TILE_SIZE + offY);
    }
  }
}

/** Composite the crack frame (or a code fallback) for a damage fraction over one tile. */
function drawCrackOverlay(
  ctx: CanvasRenderingContext2D,
  frames: HTMLImageElement[],
  frac: number,
  x: number,
  y: number,
): void {
  if (frames.length) {
    // Map (0,1] damage onto frames 0..last so a nearly-broken tile shows the shattered face.
    const idx = Math.min(frames.length - 1, Math.floor(frac * frames.length));
    const img = frames[idx];
    if (isReady(img)) {
      ctx.drawImage(img, x, y, TILE_SIZE, TILE_SIZE);
      return;
    }
  }
  // Fallback code cracks (until the produced sheet is present) so progress still reads.
  const n = 2 + Math.floor(frac * 5);
  ctx.strokeStyle = `rgba(20,16,12,${0.35 + 0.5 * frac})`;
  ctx.lineWidth = 2;
  const cx = x + TILE_SIZE / 2;
  const cy = y + TILE_SIZE / 2;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + frac;
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * TILE_SIZE * 0.42 * frac, cy + Math.sin(a) * TILE_SIZE * 0.42 * frac);
  }
  ctx.stroke();
}

function drawBandRock(
  ctx: CanvasRenderingContext2D,
  assets: Assets,
  tile: Tile,
  x: number,
  y: number,
  row: number,
  col: number,
): void {
  // Pick one of the band's produced tile variants by a stable per-cell hash, so a wall
  // of the same band does not visibly repeat a single texture (specs/world.md).
  const variants = assets.tileVariants(tile.band);
  const img = variants.length ? variants[tileVariant(row, col, variants.length)] : undefined;
  if (isReady(img)) {
    ctx.drawImage(img, x, y, TILE_SIZE, TILE_SIZE);
  } else {
    ctx.fillStyle = bandFill(tile.band);
    ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
    // A little texture so plain rock is not a flat square.
    ctx.fillStyle = "rgba(0,0,0,0.14)";
    ctx.fillRect(x + 6, y + 30, 12, 6);
    ctx.fillRect(x + 28, y + 10, 10, 6);
    if (tile.band === "coreshell") {
      ctx.fillStyle = "rgba(255,106,42,0.16)";
      ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
    }
  }
}

function drawOreFallback(ctx: CanvasRenderingContext2D, ore: Ore, x: number, y: number): void {
  const col = ORES[ore].color;
  // A diagonal smear of overlapping lobes (echoing the produced ore vein) — an embedded
  // streak through the rock, not discrete dots — used only until the sprite decodes.
  ctx.fillStyle = col;
  for (const [dx, dy, r] of [
    [13, 15, 5],
    [20, 20, 6],
    [28, 27, 6],
    [35, 33, 5],
    [33, 16, 3],
    [11, 30, 3],
  ] as const) {
    ctx.beginPath();
    ctx.arc(x + dx, y + dy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // feathered specks bleeding toward the edges so adjacent ore cells read continuous
  for (const [dx, dy] of [
    [7, 12],
    [40, 38],
    [42, 22],
    [9, 38],
    [24, 42],
  ] as const) {
    ctx.fillRect(x + dx, y + dy, 1, 1);
  }
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.beginPath();
  ctx.arc(x + 26, y + 25, 2, 0, Math.PI * 2);
  ctx.fill();
}

function drawMaterialFallback(ctx: CanvasRenderingContext2D, material: Material, x: number, y: number): void {
  const col = material === "resonite" ? P.resonite : P.cryenite;
  const cx = x + TILE_SIZE / 2;
  const cy = y + TILE_SIZE / 2;
  const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, TILE_SIZE / 2);
  g.addColorStop(0, "#ffffff");
  g.addColorStop(0.4, col);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.moveTo(cx, cy - 14);
  ctx.lineTo(cx + 9, cy);
  ctx.lineTo(cx, cy + 14);
  ctx.lineTo(cx - 9, cy);
  ctx.closePath();
  ctx.fill();
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  offX: number,
  offY: number,
  rowTop: number,
  rowBot: number,
  colLeft: number,
  colRight: number,
): void {
  ctx.strokeStyle = P.tileGrid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let c = colLeft; c <= colRight + 1; c++) {
    const x = Math.round(GRID_MARGIN_X + c * TILE_SIZE + offX) + 0.5;
    ctx.moveTo(x, VIEWPORT_Y);
    ctx.lineTo(x, STAGE_HEIGHT);
  }
  const xL = Math.round(GRID_MARGIN_X + colLeft * TILE_SIZE + offX);
  const xR = Math.round(GRID_MARGIN_X + (colRight + 1) * TILE_SIZE + offX);
  for (let r = rowTop; r <= rowBot + 1; r++) {
    const y = Math.round(r * TILE_SIZE + offY) + 0.5;
    ctx.moveTo(xL, y);
    ctx.lineTo(xR, y);
  }
  ctx.stroke();
}

function drawSurface(
  ctx: CanvasRenderingContext2D,
  game: Game,
  assets: Assets,
  offX: number,
  offY: number,
): void {
  const groundY = SURFACE_FEET_Y + offY;
  if (groundY < VIEWPORT_Y - 200 || groundY > STAGE_HEIGHT + 200) return;

  // Camp ground strip on top of row 1 (spanning the whole world width, scrolled by offX).
  ctx.fillStyle = P.surfaceGround;
  ctx.fillRect(GRID_MARGIN_X + offX, groundY - 10, WORLD_COLS * TILE_SIZE, 10);

  // The four buildings, centered on their tiles, resting on the ground line.
  for (const b of SURFACE_BUILDINGS) {
    const cxb = GRID_MARGIN_X + b.col * TILE_SIZE + TILE_SIZE / 2 + offX;
    const bx = cxb - BUILDING_W / 2;
    const img = assets.surface(b.panel);
    if (isReady(img)) {
      ctx.drawImage(img, bx, groundY - BUILDING_H, BUILDING_W, BUILDING_H);
    } else {
      drawBuildingFallback(ctx, b.panel, bx, groundY - BUILDING_H, BUILDING_W, BUILDING_H);
    }
    text(ctx, b.label.toUpperCase(), cxb, groundY - BUILDING_H - 8, {
      size: 11,
      color: P.textSecondary,
      align: "center",
    });
  }

  // The assembling escape rocket on the launch pad (specs/rocket.md).
  drawRocket(ctx, game, assets, offX, offY);

  // Cave mouth at the spawn column.
  const cx = GRID_MARGIN_X + game.spawnCol * TILE_SIZE + offX;
  const cimg = assets.surface("cave-mouth");
  if (isReady(cimg)) ctx.drawImage(cimg, cx, groundY - 8, TILE_SIZE, 30);
}

function drawBuildingFallback(
  ctx: CanvasRenderingContext2D,
  panel: string,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const accent: Record<string, string> = {
    "fuel-depot": P.fuel,
    "ore-market": P.cargo,
    "save-pad": P.resonite,
    "upgrade-shop": P.hull,
    "launch-pad": P.credits,
  };
  ctx.fillStyle = "#20262e";
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = accent[panel] ?? P.hull;
  ctx.fillRect(x, y, w, 8);
  ctx.strokeStyle = "#39424d";
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = "#12161c";
  ctx.fillRect(x + 12, y + 24, w - 24, h - 40);
}

function drawRocket(
  ctx: CanvasRenderingContext2D,
  game: Game,
  assets: Assets,
  offX: number,
  offY: number,
): void {
  const b = SURFACE_BUILDINGS.find((x) => x.panel === "launch-pad")!;
  const cx = GRID_MARGIN_X + b.col * TILE_SIZE + TILE_SIZE / 2 + offX;
  const groundY = SURFACE_FEET_Y + offY;
  const stage = game.installed.size; // 0..5 components installed
  const rise = game.launchAnim !== null ? game.launchAnim * 230 : 0;
  const baseY = groundY - rise;

  const img = assets.rocket[stage];
  const w = ROCKET_W;
  const h = ROCKET_H;
  if (isReady(img)) {
    ctx.drawImage(img, cx - w / 2, baseY - h, w, h);
    return;
  }
  // Fallback: a rocket that visibly grows with each installed component.
  const built = stage;
  const bodyH = 30 + built * 12;
  const bx = cx - 12;
  const by = baseY - bodyH;
  ctx.fillStyle = built >= 1 ? "#c9d3dd" : "#3a444e";
  ctx.fillRect(bx, by, 24, bodyH);
  // Nose
  ctx.fillStyle = built >= 1 ? "#e8eef5" : "#4a545e";
  ctx.beginPath();
  ctx.moveTo(bx, by);
  ctx.lineTo(cx, by - 20);
  ctx.lineTo(bx + 24, by);
  ctx.closePath();
  ctx.fill();
  if (built >= 3) {
    ctx.fillStyle = P.resonite;
    ctx.fillRect(bx + 4, by + 8, 16, 4);
  }
  if (built >= 4) {
    ctx.fillStyle = "#6a747e";
    ctx.fillRect(bx - 6, baseY - 12, 8, 12);
    ctx.fillRect(bx + 22, baseY - 12, 8, 12);
  }
  if (built >= 5) {
    ctx.fillStyle = P.coreSample;
    ctx.beginPath();
    ctx.arc(cx, baseY - 8, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  // Pad
  ctx.fillStyle = "#2a323b";
  ctx.fillRect(cx - 20, groundY - 6, 40, 6);
}

function drawMiner(
  ctx: CanvasRenderingContext2D,
  game: Game,
  assets: Assets,
  view: View,
  offX: number,
  offY: number,
): void {
  const m = game.miner;
  const drawW = TILE_SIZE; // the miner sprite is authored to fill an 80px tile (with headroom)
  const drawH = TILE_SIZE;
  const sx = m.x + MINER_W / 2 - drawW / 2 + offX;
  const sy = m.y + MINER_H - drawH;
  const screenY = sy + offY;

  const frames = assets.miner[m.state];
  const img = frames.length ? frames[Math.floor(view.time * FPS[m.state]) % frames.length] : undefined;

  ctx.save();
  if (m.facing === "west") {
    ctx.translate(sx + drawW, screenY);
    ctx.scale(-1, 1);
    if (isReady(img)) ctx.drawImage(img!, 0, 0, drawW, drawH);
    else drawMinerFallback(ctx, m.state, 0, 0, view);
  } else {
    ctx.translate(sx, screenY);
    if (isReady(img)) ctx.drawImage(img!, 0, 0, drawW, drawH);
    else drawMinerFallback(ctx, m.state, 0, 0, view);
  }
  ctx.restore();
}

/**
 * Draw any ground items on their tiles inside the world (specs/items.md). Today the only
 * ground item is a jettisoned Core Sample: a pulsing red-hot orb (reusing the produced core
 * sprite when present, else a code glow) with the live destabilization countdown floating
 * above it, so the player can see how long they have to clear the blast or come back for it.
 */
function drawGroundItems(
  ctx: CanvasRenderingContext2D,
  game: Game,
  assets: Assets,
  view: View,
  offX: number,
  offY: number,
): void {
  const g = game.coreGround();
  if (!g) return;
  const s = TILE_SIZE;
  const x = GRID_MARGIN_X + g.col * TILE_SIZE + offX;
  const y = g.row * TILE_SIZE + offY;
  const pulse = 0.5 + 0.5 * Math.sin(view.time * 6);
  const img = assets.material("core");
  if (isReady(img)) {
    ctx.globalAlpha = 0.85 + 0.15 * pulse;
    ctx.drawImage(img, x, y, s, s);
    ctx.globalAlpha = 1;
  } else {
    const gr = ctx.createRadialGradient(x + s / 2, y + s / 2, 2, x + s / 2, y + s / 2, s / 2);
    gr.addColorStop(0, "#fff3d0");
    gr.addColorStop(0.5, P.coreSample);
    gr.addColorStop(1, "rgba(255,74,42,0)");
    ctx.fillStyle = gr;
    ctx.fillRect(x, y, s, s);
    ctx.fillStyle = P.coreSample;
    ctx.beginPath();
    ctx.arc(x + s / 2, y + s / 2, 10 + 3 * pulse, 0, Math.PI * 2);
    ctx.fill();
  }
  // The live countdown floats above the dropped Sample.
  if (game.coreTimer !== null) {
    const t = game.coreTimer;
    const mm = Math.floor(t / 60);
    const ss = Math.floor(t % 60);
    text(ctx, `${mm}:${ss.toString().padStart(2, "0")}`, x + s / 2, y - 6, {
      size: 13,
      color: t < 30 ? P.alert : P.coreSample,
      align: "center",
      bold: true,
    });
  }
}

function drawMinerFallback(
  ctx: CanvasRenderingContext2D,
  state: MinerState,
  x: number,
  y: number,
  view: View,
): void {
  const bob = state === "idle" ? Math.sin(view.time * 3) * 1.5 : 0;
  const oy = y + bob + (state === "fuel-out" ? 8 : 0);
  // Jetpack
  ctx.fillStyle = "#4a535d";
  ctx.fillRect(x + 8, oy + 16, 8, 18);
  if (state === "jetpack") {
    ctx.fillStyle = P.jetpackFlame;
    const fl = 8 + Math.sin(view.time * 30) * 4;
    ctx.beginPath();
    ctx.moveTo(x + 9, oy + 34);
    ctx.lineTo(x + 15, oy + 34);
    ctx.lineTo(x + 12, oy + 34 + fl);
    ctx.closePath();
    ctx.fill();
  }
  // Body / suit
  ctx.fillStyle = state === "hurt" ? P.alert : P.minerSuit;
  roundRect(ctx, x + 14, oy + 14, 18, 22, 5);
  ctx.fill();
  // Helmet
  ctx.fillStyle = state === "hurt" ? P.alert : "#ffe6c4";
  ctx.beginPath();
  ctx.arc(x + 24, oy + 12, 9, 0, Math.PI * 2);
  ctx.fill();
  // Visor
  ctx.fillStyle = "#2a5d7a";
  ctx.fillRect(x + 22, oy + 8, 9, 7);
  // Lamp glint
  ctx.fillStyle = "rgba(255,240,200,0.9)";
  ctx.beginPath();
  ctx.arc(x + 30, oy + 9, 2, 0, Math.PI * 2);
  ctx.fill();
  // Drill
  ctx.fillStyle = "#8a949e";
  if (state === "drill-down") {
    const sh = Math.sin(view.time * 40) * 1.5;
    ctx.fillRect(x + 20, oy + 34, 8, 12 + sh);
  } else {
    const sh = state === "drill-side" ? Math.sin(view.time * 40) * 2 : 0;
    ctx.fillRect(x + 30, oy + 22, 12 + sh, 8);
  }
  // Legs
  ctx.fillStyle = "#c9a074";
  if (state === "walk") {
    const sw = Math.sin(view.time * 14) * 4;
    ctx.fillRect(x + 16, oy + 36, 5, 8 + sw);
    ctx.fillRect(x + 25, oy + 36, 5, 8 - sw);
  } else if (state === "fall") {
    ctx.fillRect(x + 15, oy + 34, 5, 10);
    ctx.fillRect(x + 26, oy + 34, 5, 10);
  } else {
    ctx.fillRect(x + 17, oy + 36, 5, 8);
    ctx.fillRect(x + 24, oy + 36, 5, 8);
  }
}

// ---------------------------------------------------------------------------
// Over-world HUD: scanner + core countdown
// ---------------------------------------------------------------------------

function drawScanner(ctx: CanvasRenderingContext2D, game: Game, offX: number, offY: number): void {
  const scan = game.scan;
  if (!scan.needed) return;
  const mx = minerCenterX(game.miner) + offX;
  const my = minerCenterY(game.miner) + offY - 64;
  if (my < VIEWPORT_Y) return;

  ctx.save();
  ctx.translate(mx, my);
  const col = scan.material === "cryenite" ? P.cryenite : P.resonite;
  if (scan.hasSignal) {
    ctx.rotate(scan.angle);
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(20, 0);
    ctx.lineTo(6, -7);
    ctx.lineTo(6, 7);
    ctx.closePath();
    ctx.fill();
    ctx.rotate(-scan.angle);
    text(ctx, `${scan.distTiles.toFixed(0)}m`, 0, -14, { size: 11, color: col, align: "center", bold: true });
  } else {
    ctx.strokeStyle = P.textTertiary;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 10, 0, Math.PI * 2);
    ctx.stroke();
    text(ctx, "NO SIGNAL", 0, -14, { size: 10, color: P.textTertiary, align: "center" });
  }
  ctx.restore();
}

function drawCoreCountdown(ctx: CanvasRenderingContext2D, game: Game, view: View): void {
  if (game.coreTimer === null) return;
  const t = game.coreTimer;
  const danger = t < 30;
  const blink = danger ? 0.5 + 0.5 * Math.sin(view.time * (t < 12 ? 18 : 8)) : 1;
  const w = 260;
  const x = STAGE_WIDTH / 2 - w / 2;
  const y = VIEWPORT_Y + 12;
  ctx.globalAlpha = danger ? 0.55 + 0.45 * blink : 1;
  roundRect(ctx, x, y, w, 46, 8);
  ctx.fillStyle = "rgba(20,10,8,0.85)";
  ctx.fill();
  ctx.strokeStyle = danger ? P.alert : P.coreSample;
  ctx.lineWidth = 2;
  ctx.stroke();
  text(ctx, "CORE SAMPLE DESTABILIZING", x + w / 2, y + 15, {
    size: 12,
    color: P.coreSample,
    align: "center",
    bold: true,
  });
  const mm = Math.floor(t / 60);
  const ss = Math.floor(t % 60);
  text(ctx, `${mm}:${ss.toString().padStart(2, "0")}`, x + w / 2, y + 36, {
    size: 20,
    color: danger ? P.alert : P.textPrimary,
    align: "center",
    bold: true,
  });
  ctx.globalAlpha = 1;
  // Jettison hint — only while the Sample is actually in hand (specs/items.md).
  if (game.satchel.coreSample) {
    text(ctx, "[J] JETTISON", x + w / 2, y + 62, {
      size: 12,
      color: P.textSecondary,
      align: "center",
      bold: true,
    });
  }
}

// ---------------------------------------------------------------------------
// Status bar HUD (specs/flow.md)
// ---------------------------------------------------------------------------

function gauge(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  label: string,
  value: number,
  max: number,
  color: string,
  alert: boolean,
): void {
  const h = 14;
  text(ctx, label, x, y - 4, { size: 10, color: P.textSecondary });
  ctx.fillStyle = "#0c1116";
  roundRect(ctx, x, y, w, h, 4);
  ctx.fill();
  const frac = Math.max(0, Math.min(1, max > 0 ? value / max : 0));
  ctx.fillStyle = alert ? P.alert : color;
  roundRect(ctx, x, y, Math.max(2, w * frac), h, 4);
  ctx.fill();
  text(ctx, `${Math.ceil(value)}/${max}`, x + w - 4, y + h - 3, {
    size: 10,
    color: P.textPrimary,
    align: "right",
  });
}

function drawStatusBar(ctx: CanvasRenderingContext2D, game: Game, view: View, cl: Clickable[]): void {
  ctx.fillStyle = "#0c1015";
  ctx.fillRect(0, 0, STAGE_WIDTH, STATUS_BAR_HEIGHT);
  ctx.strokeStyle = "#20272f";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, STATUS_BAR_HEIGHT + 0.5);
  ctx.lineTo(STAGE_WIDTH, STATUS_BAR_HEIGHT + 0.5);
  ctx.stroke();

  const y = 26;
  const fuelAlert = game.miner.fuel < game.maxFuel() * LOW_FUEL_FRACTION;
  const hullAlert = game.miner.hull < game.maxHull() * LOW_HULL_FRACTION;
  gauge(ctx, 16, y, 150, "FUEL", game.miner.fuel, game.maxFuel(), P.fuel, fuelAlert);
  gauge(ctx, 182, y, 150, "HULL", game.miner.hull, game.maxHull(), P.hull, hullAlert);

  // Cargo as SLOTS used / capacity (specs/mining.md). Reads OVERLOAD (alert color) when the
  // haul's WEIGHT is too heavy for the jetpack to lift (specs/character.md), and turns alert
  // when the bay is full by slot count. The current load in kg rides alongside so the player
  // can see how close to un-liftable a heavy haul is.
  const overloaded = game.overloaded();
  const full = game.cargoUsed() >= game.cargoCap();
  text(ctx, overloaded ? "OVERLOAD" : "CARGO", 340, y - 4, {
    size: 10,
    color: overloaded ? P.alert : P.textSecondary,
  });
  text(ctx, `${game.cargoUsed()}/${game.cargoCap()}`, 340, y + 12, {
    size: 16,
    color: overloaded || full ? P.alert : P.cargo,
    bold: true,
  });
  text(ctx, `${Math.round(game.cargoWeight())}kg`, 340, y + 26, {
    size: 10,
    color: overloaded ? P.alert : P.textTertiary,
  });

  // Credits
  text(ctx, "CREDITS", 452, y - 4, { size: 10, color: P.textSecondary });
  text(ctx, `${game.credits}`, 452, y + 12, { size: 16, color: P.credits, bold: true });

  // Depth
  text(ctx, "DEPTH", 596, y - 4, { size: 10, color: P.textSecondary });
  text(ctx, `${game.depthMeters()} m`, 596, y + 12, { size: 16, color: P.textPrimary, bold: true });

  // Materials satchel
  text(ctx, "SATCHEL", 712, y - 4, { size: 10, color: P.textSecondary });
  const chip = (mx: number, label: string, held: boolean, color: string): void => {
    ctx.globalAlpha = held ? 1 : 0.3;
    ctx.fillStyle = color;
    roundRect(ctx, mx, y - 2, 16, 16, 4);
    ctx.fill();
    ctx.globalAlpha = 1;
    text(ctx, label, mx + 20, y + 10, { size: 11, color: held ? P.textPrimary : P.textTertiary });
  };
  chip(712, "Res", game.satchel.resonite > 0, P.resonite);
  chip(772, "Cry", game.satchel.cryenite > 0, P.cryenite);
  chip(832, "Core", game.satchel.coreSample, P.coreSample);

  // Rocket progress
  text(ctx, "ROCKET", 908, y - 4, { size: 10, color: P.textSecondary });
  for (let i = 0; i < ROCKET_COMPONENTS.length; i++) {
    const on = game.installed.has(ROCKET_COMPONENTS[i]!.id);
    ctx.fillStyle = on ? P.credits : "#2a323b";
    roundRect(ctx, 908 + i * 14, y - 2, 10, 14, 2);
    ctx.fill();
  }

  // Inventory (BAG) + Pause + Mute controls (right).
  button(ctx, cl, view, STAGE_WIDTH - 222, 12, 64, 32, "BAG", "sys:inventory", {
    selected: game.panel === "inventory",
  });
  button(ctx, cl, view, STAGE_WIDTH - 150, 12, 64, 32, "PAUSE", "sys:pause", {});
  button(ctx, cl, view, STAGE_WIDTH - 78, 12, 64, 32, view.muted ? "UNMUTE" : "MUTE", "sys:mute", {});
}

function drawNotes(ctx: CanvasRenderingContext2D, game: Game): void {
  let y = VIEWPORT_Y + 70;
  for (const n of game.notes) {
    const a = Math.min(1, n.t);
    ctx.globalAlpha = a;
    text(ctx, n.text, STAGE_WIDTH / 2, y, { size: 15, color: P.alert, align: "center", bold: true });
    ctx.globalAlpha = 1;
    y += 22;
  }
}

// ---------------------------------------------------------------------------
// Building panels (specs/flow.md, specs/upgrades.md, specs/rocket.md)
// ---------------------------------------------------------------------------

function panelFrame(
  ctx: CanvasRenderingContext2D,
  title: string,
  w = 760,
  h = 480,
): { x: number; y: number; w: number; h: number } {
  ctx.fillStyle = "rgba(5,7,10,0.72)";
  ctx.fillRect(0, VIEWPORT_Y, STAGE_WIDTH, VIEWPORT_HEIGHT);
  const x = STAGE_WIDTH / 2 - w / 2;
  const y = STAGE_HEIGHT / 2 - h / 2 + 20;
  roundRect(ctx, x, y, w, h, 12);
  ctx.fillStyle = P.panel;
  ctx.fill();
  ctx.strokeStyle = "#2a333d";
  ctx.lineWidth = 2;
  ctx.stroke();
  text(ctx, title, x + 28, y + 40, { size: 24, color: P.textPrimary, bold: true });
  return { x, y, w, h };
}

function drawPanel(ctx: CanvasRenderingContext2D, game: Game, view: View, cl: Clickable[]): void {
  switch (game.panel) {
    case "fuel-depot":
      drawFuelDepot(ctx, game, view, cl);
      break;
    case "ore-market":
      drawOreMarket(ctx, game, view, cl);
      break;
    case "upgrade-shop":
      drawUpgradeShop(ctx, game, view, cl);
      break;
    case "launch-pad":
      drawLaunchPad(ctx, game, view, cl);
      break;
    case "save-pad":
      drawSavePad(ctx, game, view, cl);
      break;
    case "inventory":
      drawInventory(ctx, game, view, cl);
      break;
    default:
      break;
  }
}

function closeButton(ctx: CanvasRenderingContext2D, f: { x: number; y: number; w: number; h: number }, view: View, cl: Clickable[]): void {
  button(ctx, cl, view, f.x + f.w - 130, f.y + f.h - 56, 110, 40, "CLOSE", "panel:close", {});
}

function drawFuelDepot(ctx: CanvasRenderingContext2D, game: Game, view: View, cl: Clickable[]): void {
  const f = panelFrame(ctx, "FUEL DEPOT");
  text(ctx, "Buy fuel and hull repair with Credits — nothing refills for free.", f.x + 28, f.y + 74, {
    size: 15,
    color: P.textSecondary,
  });
  text(ctx, `Credits: ${game.credits}`, f.x + f.w - 28, f.y + 40, {
    size: 18,
    color: P.credits,
    align: "right",
    bold: true,
  });

  // ---- Fuel row ----
  const fuelD = fuelDeficit(game);
  const fuelFill = fuelCost(fuelD);
  const fuelFull = fuelD <= 0;
  const cantBuyFuel = fuelFull || game.credits < FUEL_COST_PER_UNIT;
  const fuelY = f.y + 150;
  gauge(ctx, f.x + 28, fuelY, 300, "FUEL", game.miner.fuel, game.maxFuel(), P.fuel, false);
  text(ctx, `${FUEL_COST_PER_UNIT} Cr / unit`, f.x + 28, fuelY + 34, { size: 12, color: P.textTertiary });
  button(ctx, cl, view, f.x + 352, fuelY - 12, 78, 38, `+${DEPOT_INCREMENT}`, "buyfuel:25", {
    disabled: cantBuyFuel,
    accent: P.fuel,
  });
  button(ctx, cl, view, f.x + 442, fuelY - 12, 200, 38, fuelFull ? "FULL" : `FILL ${fuelFill} Cr`, "buyfuel:full", {
    disabled: cantBuyFuel,
    accent: P.fuel,
  });

  // ---- Hull row ----
  const hullD = hullDeficit(game);
  const hullRepair = repairCost(hullD);
  const hullFull = hullD <= 0;
  const cantBuyRepair = hullFull || game.credits < REPAIR_COST_PER_POINT;
  const hullY = f.y + 240;
  gauge(ctx, f.x + 28, hullY, 300, "HULL", game.miner.hull, game.maxHull(), P.hull, false);
  text(ctx, `${REPAIR_COST_PER_POINT} Cr / hull`, f.x + 28, hullY + 34, { size: 12, color: P.textTertiary });
  button(ctx, cl, view, f.x + 352, hullY - 12, 78, 38, `+${DEPOT_INCREMENT}`, "buyrepair:25", {
    disabled: cantBuyRepair,
    accent: P.hull,
  });
  button(ctx, cl, view, f.x + 442, hullY - 12, 200, 38, hullFull ? "FULL" : `REPAIR ${hullRepair} Cr`, "buyrepair:full", {
    disabled: cantBuyRepair,
    accent: P.hull,
  });

  text(
    ctx,
    "Fuel burns whenever the jetpack fires (even above ground); hull is dented by",
    f.x + 28,
    f.y + 340,
    { size: 12, color: P.textTertiary },
  );
  text(ctx, "blasts, lava, and hard landings — none of it comes back on its own.", f.x + 28, f.y + 360, {
    size: 12,
    color: P.textTertiary,
  });
  closeButton(ctx, f, view, cl);
}

function drawOreMarket(ctx: CanvasRenderingContext2D, game: Game, view: View, cl: Clickable[]): void {
  const f = panelFrame(ctx, "ORE MARKET");
  let y = f.y + 90;
  text(ctx, "ORE", f.x + 28, y, { size: 12, color: P.textTertiary });
  text(ctx, "HELD × VALUE", f.x + 260, y, { size: 12, color: P.textTertiary });
  text(ctx, "SUBTOTAL", f.x + f.w - 40, y, { size: 12, color: P.textTertiary, align: "right" });
  y += 22;
  for (const o of Object.keys(ORES) as Ore[]) {
    const n = game.cargo[o];
    const v = ORES[o].value;
    ctx.fillStyle = ORES[o].color;
    ctx.beginPath();
    ctx.arc(f.x + 34, y - 5, 6, 0, Math.PI * 2);
    ctx.fill();
    text(ctx, o.toUpperCase(), f.x + 48, y, { size: 15, color: n > 0 ? P.textPrimary : P.textTertiary });
    text(ctx, `${n} × ${v}`, f.x + 260, y, { size: 15, color: n > 0 ? P.textSecondary : P.textTertiary });
    text(ctx, `${n * v}`, f.x + f.w - 40, y, {
      size: 15,
      color: n > 0 ? P.credits : P.textTertiary,
      align: "right",
    });
    y += 30;
  }
  const total = cargoValue(game.cargo);
  y += 8;
  text(ctx, `TOTAL: ${total} Credits`, f.x + 28, y, { size: 18, color: P.credits, bold: true });
  text(ctx, `Hold ${game.cargoUsed()}/${game.cargoCap()} slots · ${Math.round(game.cargoWeight())} kg`, f.x + f.w - 40, y, {
    size: 14,
    color: P.textSecondary,
    align: "right",
  });
  button(ctx, cl, view, f.x + 28, f.y + f.h - 56, 160, 40, "SELL ALL", "sell", {
    disabled: total <= 0,
    accent: P.credits,
  });
  closeButton(ctx, f, view, cl);
}

function drawUpgradeShop(ctx: CanvasRenderingContext2D, game: Game, view: View, cl: Clickable[]): void {
  // Widened, two-column: the seven upgrade tracks on the left, the single-use FIELD
  // SUPPLIES (specs/items.md) on the right — the fourth Credits sink (specs/flow.md).
  const f = panelFrame(ctx, "UPGRADE SHOP", 980, 540);
  text(ctx, `Credits: ${game.credits}`, f.x + f.w - 28, f.y + 40, {
    size: 18,
    color: P.credits,
    align: "right",
    bold: true,
  });

  const tracks = Object.keys(UPGRADE_TRACKS) as (keyof typeof UPGRADE_TRACKS)[];
  const colL = f.x + 28;
  let y = f.y + 74;
  for (const t of tracks) {
    const def = UPGRADE_TRACKS[t];
    const tier = game.tiers[t];
    const price = nextUpgradePrice(game, t);
    const maxed = price === null;
    // Radiator effectiveness reads best as a percentage; the rest read as their raw value.
    const fmt = (v: number): string => (t === "radiator" ? `${Math.round(v * 100)}%` : `${v}`);
    const curVal = def.values[tier - 1]!;
    const nextVal = maxed ? null : def.values[tier]!;
    text(ctx, def.label.toUpperCase(), colL, y + 6, { size: 15, color: P.textPrimary, bold: true });
    text(ctx, `Tier ${tier}/${MAX_TIER} — ${fmt(curVal)} ${def.unit}`, colL, y + 24, {
      size: 12,
      color: P.textSecondary,
    });
    if (!maxed) {
      text(ctx, `Next: ${fmt(nextVal!)} ${def.unit}`, colL + 240, y + 10, { size: 13, color: P.hull });
      text(ctx, `${price} Cr`, colL + 240, y + 27, {
        size: 13,
        color: game.credits >= price! ? P.credits : P.alert,
      });
    }
    const label = maxed ? "MAX" : "BUY";
    button(ctx, cl, view, colL + 336, y - 4, 96, 36, label, `buy:${t}`, {
      disabled: maxed || game.credits < (price ?? Infinity),
    });
    y += 50;
  }

  drawFieldSupplies(ctx, game, view, cl, f.x + 500, f.y + 62, 452);
  closeButton(ctx, f, view, cl);
}

/**
 * The Upgrade Shop "Field Supplies" section (specs/items.md): the six single-use items,
 * each with a code-drawn icon, its price, the count held, and a BUY button greyed out when
 * unaffordable. `x`/`y` is the section's top-left; `w` its width.
 */
function drawFieldSupplies(
  ctx: CanvasRenderingContext2D,
  game: Game,
  view: View,
  cl: Clickable[],
  x: number,
  y: number,
  w: number,
): void {
  text(ctx, "FIELD SUPPLIES", x, y + 6, { size: 15, color: P.credits, bold: true });
  text(ctx, "Single-use — bought here, used with 1–6 or the bag.", x, y + 24, {
    size: 11,
    color: P.textTertiary,
  });
  let ry = y + 44;
  for (const def of ITEMS) {
    const held = game.items[def.id] ?? 0;
    const afford = game.credits >= def.price;
    drawItemIcon(ctx, def.id, x + 2, ry + 2, 26);
    text(ctx, `${def.hotkey}. ${def.label}`, x + 38, ry + 12, {
      size: 13,
      color: P.textPrimary,
      bold: true,
    });
    text(ctx, def.blurb, x + 38, ry + 28, { size: 10, color: P.textTertiary });
    text(ctx, `×${held}`, x + w - 118, ry + 12, { size: 12, color: P.textSecondary, align: "right" });
    text(ctx, `${def.price} Cr`, x + w - 118, ry + 28, {
      size: 11,
      color: afford ? P.credits : P.alert,
      align: "right",
    });
    button(ctx, cl, view, x + w - 100, ry - 2, 100, 34, "BUY", `buyitem:${def.id}`, {
      disabled: !afford,
      accent: P.credits,
    });
    ry += 46;
  }
}

/**
 * A small, code-drawn item icon (specs/items.md, specs/assets.md — item icons are code-
 * drawn, consistent with the in-code HUD chrome; no produced sprite). Each reads as its
 * item by shape and palette color.
 */
function drawItemIcon(ctx: CanvasRenderingContext2D, id: ItemId, x: number, y: number, s: number): void {
  const cx = x + s / 2;
  const cy = y + s / 2;
  switch (id) {
    case "dynamite":
    case "plastic-explosives": {
      // A charge (red stick / orange block) with a spark fuse — bigger for the 5×5.
      const big = id === "plastic-explosives";
      ctx.fillStyle = big ? P.pyronium : P.alert;
      roundRect(ctx, x + 4, y + 8, s - 8, s - 12, 3);
      ctx.fill();
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(x + 4, cy - 1, s - 8, 2);
      ctx.strokeStyle = P.textTertiary;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx, y + 8);
      ctx.lineTo(cx + 3, y + 2);
      ctx.stroke();
      ctx.fillStyle = P.fuel;
      ctx.beginPath();
      ctx.arc(cx + 3, y + 2, 2, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "quantum-teleporter":
    case "matter-transmitter": {
      // A warp ring — risky blue vs. safe cyan (the premium escape).
      const col = id === "matter-transmitter" ? P.hull : P.voltite;
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, s / 2 - 3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, s / 2 - 7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "nanobots": {
      // A green medical cross (heal).
      ctx.fillStyle = P.gas;
      ctx.fillRect(cx - 3, y + 4, 6, s - 8);
      ctx.fillRect(x + 4, cy - 3, s - 8, 6);
      break;
    }
    case "emergency-fuel": {
      // A yellow fuel can.
      ctx.fillStyle = P.fuel;
      roundRect(ctx, x + 5, y + 6, s - 10, s - 10, 3);
      ctx.fill();
      ctx.fillStyle = "rgba(0,0,0,0.4)";
      ctx.fillRect(cx - 2, y + 3, 4, 4);
      ctx.fillStyle = P.void;
      ctx.font = `bold ${Math.round(s * 0.5)}px ${FONT_STACK}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("F", cx, cy + 1);
      break;
    }
    default:
      break;
  }
}

function drawLaunchPad(ctx: CanvasRenderingContext2D, game: Game, view: View, cl: Clickable[]): void {
  const f = panelFrame(ctx, "LAUNCH PAD");
  let y = f.y + 78;
  const next = nextComponent(game);
  for (const c of ROCKET_COMPONENTS) {
    const installed = game.installed.has(c.id);
    const isNext = next?.id === c.id;
    ctx.fillStyle = installed ? P.credits : isNext ? P.hull : "#2a323b";
    ctx.beginPath();
    ctx.arc(f.x + 36, y, 8, 0, Math.PI * 2);
    ctx.fill();
    if (installed) {
      ctx.strokeStyle = "#0c1116";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(f.x + 32, y);
      ctx.lineTo(f.x + 35, y + 3);
      ctx.lineTo(f.x + 40, y - 4);
      ctx.stroke();
    }
    const col = installed ? P.textSecondary : isNext ? P.textPrimary : P.textTertiary;
    text(ctx, `${c.order}. ${c.label}`, f.x + 56, y + 5, { size: 16, color: col, bold: isNext });
    let req = `${c.credits} Cr`;
    if (c.material) req += ` + 1 ${c.material === "core-sample" ? "Core Sample" : c.material}`;
    text(ctx, installed ? "INSTALLED" : req, f.x + f.w - 40, y + 5, {
      size: 13,
      color: installed ? P.credits : P.textSecondary,
      align: "right",
    });
    y += 46;
  }

  y = f.y + f.h - 108;
  if (allInstalled(game)) {
    text(ctx, "All components installed. Ready for liftoff.", f.x + 28, y, { size: 15, color: P.credits });
    button(ctx, cl, view, f.x + 28, y + 16, 200, 44, "LAUNCH", "launch", { accent: P.credits });
  } else if (next) {
    const ok = canFabricate(game);
    const matOk = hasMaterial(game, next.material);
    const affOk = game.credits >= next.credits;
    let hint = `Next: ${next.label}`;
    if (!affOk) hint += "  — not enough Credits";
    else if (!matOk) hint += `  — need ${next.material === "core-sample" ? "the Core Sample" : next.material}`;
    text(ctx, hint, f.x + 28, y, { size: 14, color: ok ? P.textPrimary : P.alert });
    button(ctx, cl, view, f.x + 28, y + 16, 220, 44, `FABRICATE ${next.label}`, "fabricate", {
      disabled: !ok,
      accent: P.hull,
    });
  }
  closeButton(ctx, f, view, cl);
}

function drawSavePad(ctx: CanvasRenderingContext2D, game: Game, view: View, cl: Clickable[]): void {
  const f = panelFrame(ctx, "SAVE PAD");
  text(ctx, "Bank your expedition. This pad is the ONLY way to save.", f.x + 28, f.y + 74, {
    size: 15,
    color: P.textSecondary,
  });
  const exists = hasSave();
  text(ctx, exists ? "A saved expedition exists — saving overwrites it." : "No expedition saved yet.", f.x + 28, f.y + 118, {
    size: 14,
    color: exists ? P.credits : P.textTertiary,
  });
  const lines = [
    "• You have ONE save slot; saving here overwrites it.",
    "• On the main menu, CONTINUE resumes your saved expedition.",
    "• In Standard, a death lets you restore from your last save.",
    "• In Hardcore, a death deletes the save — the run ends for good.",
  ];
  let y = f.y + 156;
  for (const l of lines) {
    text(ctx, l, f.x + 28, y, { size: 13, color: P.textSecondary });
    y += 26;
  }
  const canSave = game.canSave();
  if (!canSave) {
    text(ctx, "Can't save while the unstable Core Sample is in hand — install it first.", f.x + 28, y + 10, {
      size: 13,
      color: P.alert,
    });
  }
  button(ctx, cl, view, f.x + 28, f.y + f.h - 108, 260, 48, "SAVE EXPEDITION", "save", {
    disabled: !canSave,
    accent: P.credits,
  });
  closeButton(ctx, f, view, cl);
}

function drawInventory(ctx: CanvasRenderingContext2D, game: Game, view: View, cl: Clickable[]): void {
  // Two-column: cargo (ore) + satchel on the left, FIELD SUPPLIES (USE) on the right
  // (specs/items.md, specs/mining.md).
  const f = panelFrame(ctx, "CARGO HOLD", 980, 520);
  text(ctx, "Everything you're carrying. DROP ore to shed weight; USE a field supply.", f.x + 28, f.y + 66, {
    size: 14,
    color: P.textSecondary,
  });

  // ---- Left: ore rows ----
  const colL = f.x + 28;
  let y = f.y + 100;
  text(ctx, "ORE", colL + 20, y, { size: 12, color: P.textTertiary });
  text(ctx, "HELD", colL + 200, y, { size: 12, color: P.textTertiary });
  text(ctx, "WEIGHT", colL + 288, y, { size: 12, color: P.textTertiary });
  y += 22;
  for (const o of Object.keys(ORES) as Ore[]) {
    const n = game.cargo[o];
    const w = ORES[o].weightKg;
    ctx.fillStyle = ORES[o].color;
    ctx.beginPath();
    ctx.arc(colL + 6, y - 5, 6, 0, Math.PI * 2);
    ctx.fill();
    text(ctx, o.toUpperCase(), colL + 20, y, { size: 15, color: n > 0 ? P.textPrimary : P.textTertiary });
    text(ctx, `${n} × ${w}kg`, colL + 200, y, { size: 14, color: n > 0 ? P.textSecondary : P.textTertiary });
    text(ctx, `${n * w} kg`, colL + 288, y, { size: 15, color: n > 0 ? P.textSecondary : P.textTertiary });
    button(ctx, cl, view, colL + 356, y - 19, 90, 30, "DROP", `drop:${o}`, {
      disabled: n <= 0,
      accent: P.alert,
    });
    y += 38;
  }
  y += 6;
  const overloaded = game.overloaded();
  text(ctx, `Slots ${game.cargoUsed()}/${game.cargoCap()}   ·   Load ${Math.round(game.cargoWeight())} kg`, colL, y, {
    size: 15,
    color: overloaded ? P.alert : P.textPrimary,
    bold: true,
  });
  if (overloaded) {
    text(ctx, "OVERLOAD — too heavy for the jetpack. Drop ore to fly out.", colL, y + 20, {
      size: 12,
      color: P.alert,
      bold: true,
    });
  }
  const sat = game.satchel;
  text(
    ctx,
    `Satchel — Resonite ×${sat.resonite}, Cryenite ×${sat.cryenite}${sat.coreSample ? ", Core Sample" : ""} (weightless)`,
    colL,
    overloaded ? y + 42 : y + 22,
    { size: 12, color: P.textSecondary },
  );

  // ---- Right: field supplies (USE) + jettison ----
  const colR = f.x + 500;
  const rw = 452;
  text(ctx, "FIELD SUPPLIES", colR, f.y + 100, { size: 15, color: P.credits, bold: true });
  text(ctx, "Single-use — hotkeys 1–6 or USE.", colR, f.y + 118, { size: 11, color: P.textTertiary });
  let ry = f.y + 134;
  for (const def of ITEMS) {
    const held = game.items[def.id] ?? 0;
    drawItemIcon(ctx, def.id, colR + 2, ry - 8, 24);
    text(ctx, `${def.hotkey}. ${def.label}`, colR + 34, ry, {
      size: 13,
      color: held > 0 ? P.textPrimary : P.textTertiary,
      bold: true,
    });
    text(ctx, `×${held}`, colR + rw - 120, ry, {
      size: 14,
      color: held > 0 ? P.credits : P.textTertiary,
      align: "right",
    });
    button(ctx, cl, view, colR + rw - 100, ry - 19, 100, 30, "USE", `useitem:${def.id}`, {
      disabled: held <= 0,
      accent: P.hull,
    });
    ry += 40;
  }

  // Jettison control — active while carrying the unstable Core Sample (specs/items.md).
  const carryingCore = sat.coreSample;
  text(ctx, "CORE SAMPLE", colR, ry + 6, { size: 13, color: P.coreSample, bold: true });
  text(
    ctx,
    carryingCore ? "Drop it and flee before it detonates, then walk back to re-collect." : "Not carrying the Core Sample.",
    colR,
    ry + 24,
    { size: 11, color: carryingCore ? P.textSecondary : P.textTertiary },
  );
  button(ctx, cl, view, colR, ry + 34, 180, 36, "JETTISON [J]", "jettison", {
    disabled: !carryingCore,
    accent: P.coreSample,
  });

  closeButton(ctx, f, view, cl);
}

// ---------------------------------------------------------------------------
// Menus & state screens
// ---------------------------------------------------------------------------

function drawBackdrop(ctx: CanvasRenderingContext2D, game: Game, assets: Assets, view: View): void {
  // A dim slice of the mine behind the menus (specs/flow.md).
  const g = ctx.createLinearGradient(0, 0, 0, STAGE_HEIGHT);
  g.addColorStop(0, P.duskSky);
  g.addColorStop(0.35, "#141b28");
  g.addColorStop(0.7, P.deepstoneFill);
  g.addColorStop(1, P.coreshellFill);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);
  // faint drifting motes
  ctx.fillStyle = "rgba(255,207,74,0.10)";
  for (let i = 0; i < 40; i++) {
    const x = (i * 137 + view.time * 12) % STAGE_WIDTH;
    const y = (i * 89) % STAGE_HEIGHT;
    ctx.fillRect(x, y, 2, 2);
  }
  void game;
  void assets;
}

function menuColumn(
  ctx: CanvasRenderingContext2D,
  game: Game,
  view: View,
  cl: Clickable[],
  startY: number,
): void {
  const items = menuItems(game);
  const w = 320;
  const x = STAGE_WIDTH / 2 - w / 2;
  let y = startY;
  for (let i = 0; i < items.length; i++) {
    button(ctx, cl, view, x, y, w, 52, items[i]!.label, items[i]!.action, {
      selected: view.menuIndex === i,
      accent: P.credits,
    });
    y += 64;
  }
}

function drawTitle(ctx: CanvasRenderingContext2D, game: Game, view: View, cl: Clickable[]): void {
  text(ctx, "DEEPCORE", STAGE_WIDTH / 2, 200, { size: 88, color: P.credits, align: "center", bold: true });
  text(ctx, "Dig down. Build the rocket. Fly home.", STAGE_WIDTH / 2, 250, {
    size: 20,
    color: P.textSecondary,
    align: "center",
  });
  menuColumn(ctx, game, view, cl, 340);
  text(ctx, "Stranded on Vhera Deep — the only way off the rock is the escape rocket.", STAGE_WIDTH / 2, 560, {
    size: 14,
    color: P.textTertiary,
    align: "center",
  });
}

function drawModeSelect(ctx: CanvasRenderingContext2D, game: Game, view: View, cl: Clickable[]): void {
  text(ctx, "CHOOSE MODE", STAGE_WIDTH / 2, 140, { size: 44, color: P.textPrimary, align: "center", bold: true });
  text(ctx, "Same mine, same rocket — only the price of dying differs. Save at the surface Save Pad.", STAGE_WIDTH / 2, 180, {
    size: 15,
    color: P.textSecondary,
    align: "center",
  });
  // Descriptions beside the buttons.
  const descs = [
    "STANDARD — a death lets you restore from your last save and keep going.",
    "HARDCORE — a death deletes your save and ends the expedition. Permadeath.",
  ];
  let dy = 260;
  for (const d of descs) {
    text(ctx, d, STAGE_WIDTH / 2, dy, { size: 13, color: P.textTertiary, align: "center" });
    dy += 26;
  }
  menuColumn(ctx, game, view, cl, 340);
}

function drawHowTo(ctx: CanvasRenderingContext2D, game: Game, view: View, cl: Clickable[]): void {
  const x = STAGE_WIDTH / 2 - 380;
  text(ctx, "HOW TO PLAY", STAGE_WIDTH / 2, 100, { size: 40, color: P.textPrimary, align: "center", bold: true });
  const lines = [
    "GOAL — Build the five-component escape rocket at the Launch Pad and LAUNCH to win.",
    "",
    "DIG — A/D or ←/→ walk, and drill sideways once you reach a wall; S or ↓ drills down. You drill",
    "      DOWN, LEFT, RIGHT — never UP, and only while standing on solid ground (not while falling).",
    "      W/↑/Space fires the jetpack to climb (it burns FUEL; falling is free). There is no ceiling.",
    "",
    "LOOP — Fill cargo with ore, jetpack up, SELL ore, then BUY fuel & repairs at the Fuel Depot and",
    "       UPGRADES at the shop. Nothing refills free — budget Credits for the climb home, not just the dig.",
    "",
    "CARGO — The bay holds a fixed number of ORE SLOTS; ore also has WEIGHT the jetpack must lift. A",
    "        heavy haul climbs slowly and, past a point, can't lift at all — open the BAG (I) to DROP ore.",
    "",
    "MATERIALS — Resonite (rockbed) and Cryenite (deepstone) are guaranteed but hidden; the SCANNER",
    "            points to the nearest one you still need. The rocket's deep parts need them.",
    "",
    "HAZARDS — Gas pockets detonate when drilled, lava drains hull on contact, a hard landing hurts.",
    "          The Core Sample from the bottom is UNSTABLE: a 90s timer runs until you install it.",
    "",
    "SAVE — The surface SAVE PAD is the only way to save (one slot). Standard lets you restore from",
    "       your save on a death; Hardcore deletes it — a death ends the run.",
    "",
    "SYSTEM — Esc pauses (and closes panels), I opens the bag, M mutes, E/Enter or click activates a building.",
  ];
  let y = 152;
  for (const l of lines) {
    text(ctx, l, x, y, { size: 14, color: l.includes("—") ? P.textPrimary : P.textSecondary });
    y += 21;
  }
  menuColumn(ctx, game, view, cl, 650);
}

function causeLabel(cause?: string): string {
  if (cause === "fuel-out") return "Stranded — out of fuel";
  if (cause === "hull-destroyed") return "Hull destroyed";
  if (cause === "core-detonation") return "The Core Sample detonated";
  return "";
}

function drawEndScreen(
  ctx: CanvasRenderingContext2D,
  game: Game,
  view: View,
  cl: Clickable[],
  victory: boolean,
): void {
  const s = game.summary;
  // A Standard death keeps the save, so the run can be picked back up (specs/modes.md).
  const restorable = !victory && game.mode === "standard" && hasSave();
  text(ctx, victory ? "ESCAPE!" : restorable ? "YOU DIED" : "GAME OVER", STAGE_WIDTH / 2, 160, {
    size: 72,
    color: victory ? P.credits : P.alert,
    align: "center",
    bold: true,
  });
  text(
    ctx,
    victory
      ? "You lifted off Vhera Deep."
      : restorable
        ? "Restore your last save to continue the expedition."
        : "The expedition ends here.",
    STAGE_WIDTH / 2,
    210,
    { size: 20, color: P.textSecondary, align: "center" },
  );

  if (s) {
    const rows: [string, string][] = [
      ["Deepest depth", `${s.deepestDepthMeters} m`],
      ["Credits earned", `${s.creditsEarned}`],
      ["Elapsed time", formatTime(s.elapsedSeconds)],
      ["Mode", s.mode === "hardcore" ? "Hardcore" : "Standard"],
      ["Rocket components", `${s.componentsInstalled}/5`],
    ];
    if (!victory && s.deathCause) rows.push(["Cause", causeLabel(s.deathCause)]);
    const x = STAGE_WIDTH / 2 - 200;
    let y = 280;
    for (const [k, v] of rows) {
      text(ctx, k, x, y, { size: 16, color: P.textSecondary });
      text(ctx, v, x + 400, y, { size: 16, color: P.textPrimary, align: "right", bold: true });
      y += 32;
    }
  }
  menuColumn(ctx, game, view, cl, 500);
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function drawPauseMenu(ctx: CanvasRenderingContext2D, game: Game, view: View, cl: Clickable[]): void {
  ctx.fillStyle = "rgba(5,7,10,0.68)";
  ctx.fillRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);
  text(ctx, "PAUSED", STAGE_WIDTH / 2, 220, { size: 56, color: P.textPrimary, align: "center", bold: true });
  menuColumn(ctx, game, view, cl, 300);
}
