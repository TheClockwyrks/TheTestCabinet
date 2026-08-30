// Deepcore — the renderer (specs/overview.md, specs/ui.md, specs/assets.md).
//
// The engine draws nothing: it hands `render` a 2D context that arrives cleared
// and already carrying the transform that fits the 1280x720 logical stage onto
// the canvas. Everything below draws in those logical units, and nothing here
// ever reads the canvas element's size.
//
// THE CAMERA IS THE GAME'S OWN TRANSFORM. The mine is far wider and far deeper
// than the stage, so the world is drawn under a `translate` this module applies
// and unwinds: the status bar, the panels, and the menus are drawn in stage
// units, and everything between the two `translate` calls is drawn at plain
// WORLD coordinates. The transform is replaced from scratch every frame, so
// nothing carries over.
//
// THE RENDER IS A FUNCTION OF THE STATE. Every cycling animation runs off
// `simTime`, the game's own accumulated time, and every hover runs off the
// pointer the update mirrored, so drawing the same state twice draws the same
// picture and nothing about what is on screen depends on the wall clock.
//
// Produced sprites are used wherever they are present, drawn nearest-neighbor; a
// sprite that did not arrive falls back to a neutral code drawing, so the build
// runs before the assets land. The interface — the status bar, the panels, the
// menus, the scanner indicator, the countdown, the supply icons, the carved
// tunnel shaping, and the screen shake — is drawn in code throughout.

import {
  ANIM_FPS,
  FUEL_PRICE,
  HUD_H,
  HURT_TIME,
  ITEMS,
  LOW_FUEL_FRACTION,
  MAX_TIER,
  LOW_HULL_FRACTION,
  MINER_H,
  MINER_W,
  MINERALS,
  OVERLOAD,
  REPAIR_PRICE,
  ROCKET_COMPONENTS,
  SPAWN_COL,
  STAGE_H,
  STAGE_W,
  SURFACE_Y,
  TILE,
  TITLE_TEXT,
  TRACKS,
  VIEW_H,
  WORLD_COLS,
  WORLD_SIZES,
} from "./constants";
import type { ItemId, MaterialId, OreId } from "./constants";
import { cycleFrame } from "./assets";
import type { Assets, Sprite } from "./assets";
import {
  controlsFor,
  inside,
  NOTICE_CARD,
  panelFrame,
  DEPOT_ROWS,
  INVENTORY,
  SHOP_ROWS,
  SUPPLY_ROWS,
} from "./controls";
import type { Control, PanelFrame } from "./controls";
import { cutProgress } from "./drill";
import { nextUpgradePrice } from "./economy";
import {
  cargoCap,
  cargoValue,
  depthMeters,
  loadKg,
  maxFuel,
  maxHull,
  overloaded,
  slotsUsed,
} from "./figures";
import { drawEffects } from "./effects";
import { nearbyBuilding } from "./flow";
import type { DeepcoreState, Grid, Tile } from "./game";
import { minerCenterX, minerCenterY } from "./physics";
import {
  allInstalled,
  canFabricate,
  hasMaterial,
  nextComponent,
} from "./rocket";
import { BAND_FILL, FONT_STACK, MINERAL_COLOR, PALETTE } from "./theme";
import {
  BUILDING_H,
  BUILDING_W,
  buildingPlace,
  CAMP_ORDER,
  ITEM_BLURB,
  itemHotkey,
  MODE_BLURB,
  LAUNCH_RISE_SPEED,
  SHAKE_FADE,
  SIZE_BLURB,
  TAGLINE_TEXT,
  TRACK_DISPLAY,
  TRACK_LABEL,
} from "./tuning";
import { isMinableKind } from "./world";
import type { DeepReadonly } from "ts-essentials";

const P = PALETTE;

/** The rocket's drawn size on the pad, in world units. */
const ROCKET_W = 96;
const ROCKET_H = 160;

/** The carved-tunnel dirt lip and its rounded-corner radius, in world units. */
const CARVE_INSET = 11;
const CARVE_RADIUS = 16;

// ---- Text and primitives -------------------------------------------------

interface TextOpts {
  size?: number;
  color?: string;
  align?: CanvasTextAlign;
  baseline?: CanvasTextBaseline;
  bold?: boolean;
  /** Cap the drawn width, so a label can never overrun its container. */
  maxWidth?: number;
}

function text(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  o: TextOpts = {},
): void {
  ctx.font = `${o.bold ? "bold " : ""}${o.size ?? 16}px ${FONT_STACK}`;
  ctx.fillStyle = o.color ?? P.textPrimary;
  ctx.textAlign = o.align ?? "left";
  ctx.textBaseline = o.baseline ?? "alphabetic";
  if (o.maxWidth !== undefined) ctx.fillText(s, x, y, o.maxWidth);
  else ctx.fillText(s, x, y);
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

/** A number as whole units. */
function n0(value: number): string {
  return `${Math.round(value)}`;
}

/** A duration as minutes and seconds. */
function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ---- The entry point -----------------------------------------------------

/** Draw the whole game, in logical stage units, from the state alone. */
export function renderGame(
  state: DeepReadonly<DeepcoreState>,
  ctx: CanvasRenderingContext2D,
): void {
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = P.void;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);

  if (state.screen === "in-mine" || state.screen === "paused") {
    drawMine(ctx, state);
    drawStatusBar(ctx, state);
    if (state.screen === "in-mine" && state.panel) drawPanel(ctx, state);
    if (state.screen === "paused") drawPauseOverlay(ctx);
    drawNotes(ctx, state);
    if (state.screen === "in-mine") drawNotice(ctx, state);
  } else {
    drawBackdrop(ctx, state);
    if (state.screen === "title") drawTitle(ctx);
    else if (state.screen === "mode-select") drawModeSelect(ctx);
    else if (state.screen === "size-select") drawSizeSelect(ctx);
    else if (state.screen === "how-to-play") drawHowTo(ctx);
    else if (state.screen === "victory") drawEndScreen(ctx, state, true);
    else if (state.screen === "game-over") drawEndScreen(ctx, state, false);
  }

  // The controls are drawn last, so every button sits over the panel or screen
  // it belongs to and the rectangle drawn is exactly the one a click hits.
  for (const control of controlsFor(state)) {
    if (control.label !== null) drawButton(ctx, state, control);
  }
}

/** One button: its frame, its label, and the accent it takes when it is hot. */
function drawButton(
  ctx: CanvasRenderingContext2D,
  state: DeepReadonly<DeepcoreState>,
  c: Control,
): void {
  const hot =
    !c.disabled && (c.selected || inside(c, state.pointer.x, state.pointer.y));
  roundRect(ctx, c.x, c.y, c.w, c.h, 6);
  ctx.fillStyle = c.disabled ? "#0e1319" : hot ? "#1e2833" : P.panel;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = c.disabled ? "#20272f" : hot ? c.accent : "#2a333d";
  ctx.stroke();
  text(ctx, c.label ?? "", c.x + c.w / 2, c.y + c.h / 2, {
    size: Math.min(20, c.h * 0.42),
    color: c.disabled ? P.textTertiary : hot ? P.textPrimary : P.textSecondary,
    align: "center",
    baseline: "middle",
    bold: true,
    maxWidth: c.w - 20,
  });
}

// ---- The live mine -------------------------------------------------------

/**
 * Draw the world under the camera's own transform.
 *
 * The screen shake is a jitter of that transform alone (specs/assets.md): the
 * tiles, the miner, and the effects all ride it together, and the simulation
 * never sees it.
 */
function drawMine(
  ctx: CanvasRenderingContext2D,
  state: DeepReadonly<DeepcoreState>,
): void {
  let shakeX = 0;
  let shakeY = 0;
  if (state.shakeT > 0) {
    const amp = state.shakeAmp * Math.min(1, state.shakeT / SHAKE_FADE);
    shakeX = Math.sin(state.simTime * 83) * amp;
    shakeY = Math.cos(state.simTime * 71) * amp;
  }
  const offX = -state.camX + shakeX;
  const offY = HUD_H - state.camY + shakeY;

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, HUD_H, STAGE_W, VIEW_H);
  ctx.clip();

  // The sky above the ground line and the deep field below the world's floor,
  // both in stage units so they fill the viewport whatever the camera does.
  const groundY = SURFACE_Y + offY;
  ctx.fillStyle = P.duskSky;
  ctx.fillRect(
    0,
    HUD_H,
    STAGE_W,
    Math.max(0, Math.min(STAGE_H, groundY) - HUD_H),
  );
  ctx.fillStyle = P.void;
  const worldBottom = (state.coreRow + 1) * TILE + offY;
  if (worldBottom < STAGE_H) {
    ctx.fillRect(0, worldBottom, STAGE_W, STAGE_H - worldBottom);
  }

  // Everything from here to the matching `restore` is drawn at world
  // coordinates: this is the camera.
  ctx.save();
  ctx.translate(offX, offY);

  const rowTop = Math.max(1, Math.floor(state.camY / TILE) - 1);
  const rowBot = Math.min(
    state.coreRow,
    Math.floor((state.camY + VIEW_H) / TILE) + 1,
  );
  const colLeft = Math.max(0, Math.floor(state.camX / TILE) - 1);
  const colRight = Math.min(
    WORLD_COLS - 1,
    Math.floor((state.camX + STAGE_W) / TILE) + 1,
  );

  for (let r = rowTop; r <= rowBot; r += 1) {
    for (let c = colLeft; c <= colRight; c += 1) {
      drawTile(ctx, state, r, c);
    }
  }
  drawDrillDamage(ctx, state, rowTop, rowBot, colLeft, colRight);
  drawSurface(ctx, state);
  drawGroundItems(ctx, state);
  drawMiner(ctx, state);
  drawEffects(ctx);

  ctx.restore();

  drawScanner(ctx, state, offX, offY);
  ctx.restore();

  drawCoreCountdown(ctx, state);
  drawBuildingPrompt(ctx, state, offX, offY);
}

/**
 * A stable per-cell variant index in `[0, n)`, from a small integer hash of the
 * cell's row and column, so a wall of one band never repeats a single stamp and
 * the choice does not change from frame to frame.
 */
function tileVariant(row: number, col: number, n: number): number {
  if (n <= 1) return 0;
  let h = (row * 73856093) ^ (col * 19349663);
  h ^= h >>> 13;
  return ((h % n) + n) % n;
}

/** A sprite from a set of variants, or `null` where none were produced. */
function variantSprite(
  variants: readonly Sprite[],
  row: number,
  col: number,
): Sprite {
  const present = variants.filter((sprite): sprite is ImageBitmap => !!sprite);
  if (present.length === 0) return null;
  return present[tileVariant(row, col, present.length)];
}

function drawTile(
  ctx: CanvasRenderingContext2D,
  state: DeepReadonly<DeepcoreState>,
  row: number,
  col: number,
): void {
  const line = state.grid[row];
  if (!line) return;
  const tile = line[col];
  if (!tile) return;
  const s = TILE;
  const x = col * TILE;
  const y = row * TILE;
  const assets = state.assets;

  switch (tile.kind) {
    case "bedrock": {
      if (assets.bedrock) ctx.drawImage(assets.bedrock, x, y, s, s);
      else {
        ctx.fillStyle = P.bedrock;
        ctx.fillRect(x, y, s, s);
      }
      break;
    }
    case "tunnel": {
      drawCarved(ctx, state, tile, row, col, x, y, cellOpen, () => {
        if (assets.tunnel) ctx.drawImage(assets.tunnel, x, y, s, s);
        else {
          ctx.fillStyle = P.tunnel;
          ctx.fillRect(x, y, s, s);
        }
      });
      break;
    }
    case "lava": {
      drawCarved(ctx, state, tile, row, col, x, y, cellLava, () => {
        const frame = cycleFrame(assets.lava, state.simTime, 8);
        if (frame) ctx.drawImage(frame, x, y, s, s);
        else {
          const pulse = 0.5 + 0.5 * Math.sin(state.simTime * 6 + x * 0.1);
          ctx.fillStyle = P.lava;
          ctx.fillRect(x, y, s, s);
          ctx.fillStyle = `rgba(255,210,120,${0.25 + 0.3 * pulse})`;
          ctx.fillRect(x + 10, y + 10, s - 20, s - 20);
        }
      });
      break;
    }
    case "stone": {
      const sprite = variantSprite(assets.stone, row, col);
      if (sprite) ctx.drawImage(sprite, x, y, s, s);
      else drawStoneFallback(ctx, x, y);
      break;
    }
    case "core": {
      const sprite = assets.materials.core;
      if (sprite) ctx.drawImage(sprite, x, y, s, s);
      else {
        drawBandRock(ctx, state, tile, x, y, row, col);
        const glow = ctx.createRadialGradient(
          x + s / 2,
          y + s / 2,
          2,
          x + s / 2,
          y + s / 2,
          s / 2,
        );
        glow.addColorStop(0, "#fff3d0");
        glow.addColorStop(0.5, P.coreSample);
        glow.addColorStop(1, "rgba(255,74,42,0)");
        ctx.fillStyle = glow;
        ctx.fillRect(x, y, s, s);
      }
      break;
    }
    case "gas": {
      // A gas pocket is drawn as ordinary band rock (specs/hazards.md). Its only
      // tell is the faint seep played over it.
      drawBandRock(ctx, state, tile, x, y, row, col);
      break;
    }
    case "ore": {
      drawBandRock(ctx, state, tile, x, y, row, col);
      const id = tile.ore;
      if (id) {
        const sprite = state.assets.ore[id];
        if (sprite) ctx.drawImage(sprite, x, y, s, s);
        else if (isGemstone(id)) drawGemFallback(ctx, id, x, y);
        else drawOreFallback(ctx, id, x, y);
      }
      break;
    }
    case "material": {
      drawBandRock(ctx, state, tile, x, y, row, col);
      const id = tile.material;
      if (id) {
        const sprite = state.assets.materials[id];
        if (sprite) ctx.drawImage(sprite, x, y, s, s);
        else drawMaterialFallback(ctx, id, x, y);
      }
      break;
    }
    default:
      drawBandRock(ctx, state, tile, x, y, row, col);
      break;
  }
}

/** Whether a mineral is one of the three gemstones. */
function isGemstone(id: OreId): boolean {
  return id === "verdite" || id === "roselite" || id === "aurite";
}

/** Whether a neighbor cell is open tunnel, so a carved hole merges into it. */
function cellOpen(grid: Grid, c: number, r: number): boolean {
  return grid[r]?.[c]?.kind === "tunnel";
}

/** Whether a neighbor cell is lava, so adjacent lava merges into one pool. */
function cellLava(grid: Grid, c: number, r: number): boolean {
  return grid[r]?.[c]?.kind === "lava";
}

/**
 * The carved shape for a cell: inset by `CARVE_INSET` on any side whose neighbor
 * is solid, and run out to the cell's edge on any side where the neighbor is
 * open, so orthogonally adjacent open cells join into one passage. Each corner
 * takes one of three treatments, so the dirt lip reads continuous
 * (specs/assets.md):
 *
 *  - EXTERIOR (both its sides inset): the tunnel wall turns here, rounded CONVEX
 *    by `CARVE_RADIUS`, so cells touching only at a corner stay two holes.
 *  - INTERIOR (both its sides open but the diagonal solid): solid rock pokes into
 *    the bend, so the tunnel edge curves CONCAVELY around the cell's corner and
 *    the band rock behind shows through as a convex NUB bulging into the tunnel.
 *    An L-bend keeps one nub, a T-junction two.
 *  - Otherwise: a sharp corner at the cell's edge, so the fill runs out
 *    seamlessly.
 */
function buildCarvePath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  open: {
    l: boolean;
    r: boolean;
    u: boolean;
    d: boolean;
    ul: boolean;
    ur: boolean;
    dr: boolean;
    dl: boolean;
  },
): void {
  const s = TILE;
  const m = CARVE_INSET;
  const rad = CARVE_RADIUS;
  const HALF = Math.PI / 2;
  const l = x + (open.l ? 0 : m);
  const r = x + s - (open.r ? 0 : m);
  const t = y + (open.u ? 0 : m);
  const b = y + s - (open.d ? 0 : m);
  type Corner = "convex" | "concave" | "sharp";
  const kind = (a: boolean, c: boolean, diag: boolean): Corner =>
    !a && !c ? "convex" : a && c && !diag ? "concave" : "sharp";
  const off = (k: Corner): number =>
    k === "convex" ? rad : k === "concave" ? m : 0;
  const kTL = kind(open.u, open.l, open.ul);
  const kTR = kind(open.u, open.r, open.ur);
  const kBR = kind(open.d, open.r, open.dr);
  const kBL = kind(open.d, open.l, open.dl);

  // Trace the boundary clockwise. A convex corner rounds the wall off; a concave
  // corner sweeps an arc around the cell's corner, biting a quarter-disc of dirt
  // out of the tunnel so the band rock behind reads as a nub.
  ctx.beginPath();
  ctx.moveTo(l + off(kTL), t);
  ctx.lineTo(r - off(kTR), t);
  if (kTR === "convex") ctx.arcTo(r, t, r, b, rad);
  else if (kTR === "concave") ctx.arc(r, t, m, Math.PI, HALF, true);
  ctx.lineTo(r, b - off(kBR));
  if (kBR === "convex") ctx.arcTo(r, b, l, b, rad);
  else if (kBR === "concave") ctx.arc(r, b, m, 3 * HALF, Math.PI, true);
  ctx.lineTo(l + off(kBL), b);
  if (kBL === "convex") ctx.arcTo(l, b, l, t, rad);
  else if (kBL === "concave") ctx.arc(l, b, m, 0, 3 * HALF, true);
  ctx.lineTo(l, t + off(kTL));
  if (kTL === "convex") ctx.arcTo(l, t, r, t, rad);
  else if (kTL === "concave") ctx.arc(l, t, m, HALF, 0, true);
  ctx.closePath();
}

/** Paint a carved region, shared by the tunnels and the lava pools. */
function drawCarved(
  ctx: CanvasRenderingContext2D,
  state: DeepReadonly<DeepcoreState>,
  tile: DeepReadonly<Tile>,
  row: number,
  col: number,
  x: number,
  y: number,
  open: (grid: Grid, c: number, r: number) => boolean,
  fill: () => void,
): void {
  // The dirt lip is the band rock showing through around the carved region.
  drawBandRock(ctx, state, tile, x, y, row, col);
  const grid = state.grid;
  ctx.save();
  buildCarvePath(ctx, x, y, {
    l: open(grid, col - 1, row),
    r: open(grid, col + 1, row),
    u: open(grid, col, row - 1),
    d: open(grid, col, row + 1),
    ul: open(grid, col - 1, row - 1),
    ur: open(grid, col + 1, row - 1),
    dr: open(grid, col + 1, row + 1),
    dl: open(grid, col - 1, row + 1),
  });
  ctx.clip();
  fill();
  ctx.restore();
}

function drawBandRock(
  ctx: CanvasRenderingContext2D,
  state: DeepReadonly<DeepcoreState>,
  tile: DeepReadonly<Tile>,
  x: number,
  y: number,
  row: number,
  col: number,
): void {
  const sprite = variantSprite(state.assets.bands[tile.band], row, col);
  if (sprite) {
    ctx.drawImage(sprite, x, y, TILE, TILE);
    return;
  }
  ctx.fillStyle = BAND_FILL[tile.band];
  ctx.fillRect(x, y, TILE, TILE);
  // A little grain, so plain rock is not a flat square.
  ctx.fillStyle = "rgba(0,0,0,0.14)";
  ctx.fillRect(x + 6, y + 30, 12, 6);
  ctx.fillRect(x + 28, y + 10, 10, 6);
  if (tile.band === "coreshell") {
    ctx.fillStyle = "rgba(255,106,42,0.16)";
    ctx.fillRect(x, y, TILE, TILE);
  }
}

/**
 * Draw the crack overlay on every visible cell that carries accrued damage.
 *
 * The frame is a function of the cell's PERSISTED damage, `1 - health/maxHealth`,
 * rather than of a running cut, so a cell drilled partway and abandoned still
 * shows its cracks when the miner comes back and resuming deepens them from
 * where they were.
 */
function drawDrillDamage(
  ctx: CanvasRenderingContext2D,
  state: DeepReadonly<DeepcoreState>,
  rowTop: number,
  rowBot: number,
  colLeft: number,
  colRight: number,
): void {
  for (let r = rowTop; r <= rowBot; r += 1) {
    const line = state.grid[r];
    if (!line) continue;
    for (let c = colLeft; c <= colRight; c += 1) {
      const tile = line[c];
      if (!tile || !isMinableKind(tile.kind) || tile.health === null) continue;
      const damage = cutProgress(tile);
      if (damage <= 0) continue;
      drawCrack(ctx, state.assets, damage, c * TILE, r * TILE);
    }
  }
}

/** The crack frame for a damage fraction, or a code fallback for it. */
function drawCrack(
  ctx: CanvasRenderingContext2D,
  assets: Assets,
  damage: number,
  x: number,
  y: number,
): void {
  const frames = assets.crack.filter((f): f is ImageBitmap => !!f);
  if (frames.length > 0) {
    // A damage fraction in `(0, 1]` maps onto the frames in order, so a nearly
    // broken cell shows the shattered face.
    const at = Math.min(frames.length - 1, Math.floor(damage * frames.length));
    ctx.drawImage(frames[at], x, y, TILE, TILE);
    return;
  }
  const n = 2 + Math.floor(damage * 5);
  ctx.strokeStyle = `rgba(20,16,12,${0.35 + 0.5 * damage})`;
  ctx.lineWidth = 2;
  const cx = x + TILE / 2;
  const cy = y + TILE / 2;
  ctx.beginPath();
  for (let i = 0; i < n; i += 1) {
    const a = (i / n) * Math.PI * 2 + damage;
    ctx.moveTo(cx, cy);
    ctx.lineTo(
      cx + Math.cos(a) * TILE * 0.42 * damage,
      cy + Math.sin(a) * TILE * 0.42 * damage,
    );
  }
  ctx.stroke();
}

function drawStoneFallback(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
): void {
  const s = TILE;
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
 * An ore vein, until its sprite decodes: a diagonal smear of overlapping lobes
 * feathering into the rock, so it reads as an embedded streak rather than as
 * discrete nuggets.
 */
function drawOreFallback(
  ctx: CanvasRenderingContext2D,
  ore: OreId,
  x: number,
  y: number,
): void {
  ctx.fillStyle = MINERAL_COLOR[ore];
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

/**
 * A gemstone, until its sprite decodes: a faceted cut jewel in a dark socket,
 * deliberately unlike the ore's diffuse smear so it reads as the rarer find.
 */
function drawGemFallback(
  ctx: CanvasRenderingContext2D,
  ore: OreId,
  x: number,
  y: number,
): void {
  const base = MINERAL_COLOR[ore];
  const cx = x + 40;
  ctx.fillStyle = "#161a20";
  ctx.beginPath();
  ctx.arc(cx, y + 42, 19, 0, Math.PI * 2);
  ctx.fill();
  const top = y + 22;
  const gird = y + 38;
  const cul = y + 60;
  ctx.beginPath();
  ctx.moveTo(cx - 10, top);
  ctx.lineTo(cx + 10, top);
  ctx.lineTo(cx + 18, gird);
  ctx.lineTo(cx, cul);
  ctx.lineTo(cx - 18, gird);
  ctx.closePath();
  ctx.fillStyle = base;
  ctx.fill();
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  ctx.beginPath();
  ctx.moveTo(cx, top);
  ctx.lineTo(cx - 18, gird);
  ctx.lineTo(cx, cul);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.beginPath();
  ctx.moveTo(cx, top);
  ctx.lineTo(cx + 18, gird);
  ctx.lineTo(cx + 8, gird);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.45)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - 18, gird);
  ctx.lineTo(cx + 18, gird);
  ctx.moveTo(cx, top);
  ctx.lineTo(cx, cul);
  ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.fillRect(cx - 6, top + 2, 5, 2);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x + 62, y + 19, 2, 2);
}

/** A material node, until its sprite decodes: a raw crystal in a lit socket. */
function drawMaterialFallback(
  ctx: CanvasRenderingContext2D,
  material: MaterialId,
  x: number,
  y: number,
): void {
  const color = material === "resonite" ? P.resonite : P.cryenite;
  const cx = x + TILE / 2;
  const cy = y + TILE / 2;
  const glow = ctx.createRadialGradient(cx, cy, 2, cx, cy, TILE / 2);
  glow.addColorStop(0, "#ffffff");
  glow.addColorStop(0.4, color);
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(x, y, TILE, TILE);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(cx, cy - 14);
  ctx.lineTo(cx + 9, cy);
  ctx.lineTo(cx, cy + 14);
  ctx.lineTo(cx - 9, cy);
  ctx.closePath();
  ctx.fill();
}

// ---- The surface camp ----------------------------------------------------

function drawSurface(
  ctx: CanvasRenderingContext2D,
  state: DeepReadonly<DeepcoreState>,
): void {
  // The camp ground strip, on top of row 1, across the whole world width.
  ctx.fillStyle = P.surfaceGround;
  ctx.fillRect(0, SURFACE_Y - 10, WORLD_COLS * TILE, 10);

  for (const id of CAMP_ORDER) {
    const place = buildingPlace(id);
    const cx = place.col * TILE + TILE / 2;
    const x = cx - BUILDING_W / 2;
    const sprite = state.assets.surface[id];
    if (sprite) {
      ctx.drawImage(sprite, x, SURFACE_Y - BUILDING_H, BUILDING_W, BUILDING_H);
    } else {
      drawBuildingFallback(ctx, id, x, SURFACE_Y - BUILDING_H);
    }
    text(ctx, place.name.toUpperCase(), cx, SURFACE_Y - BUILDING_H - 8, {
      size: 11,
      color: P.textSecondary,
      align: "center",
    });
  }

  drawRocket(ctx, state);

  const mouth = state.assets.surface["cave-mouth"];
  if (mouth) {
    ctx.drawImage(mouth, SPAWN_COL * TILE, SURFACE_Y - 8, TILE, 30);
  }
}

function drawBuildingFallback(
  ctx: CanvasRenderingContext2D,
  id: string,
  x: number,
  y: number,
): void {
  const accent: Record<string, string> = {
    "fuel-depot": P.fuel,
    "ore-market": P.cargo,
    "save-pad": P.resonite,
    "upgrade-shop": P.hull,
    "supply-depot": P.pyronium,
    "launch-pad": P.credits,
  };
  ctx.fillStyle = "#20262e";
  ctx.fillRect(x, y, BUILDING_W, BUILDING_H);
  ctx.fillStyle = accent[id] ?? P.hull;
  ctx.fillRect(x, y, BUILDING_W, 8);
  ctx.strokeStyle = "#39424d";
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, BUILDING_W, BUILDING_H);
  ctx.fillStyle = "#12161c";
  ctx.fillRect(x + 12, y + 24, BUILDING_W - 24, BUILDING_H - 40);
}

/** The assembling escape rocket on the launch pad (specs/rocket.md). */
function drawRocket(
  ctx: CanvasRenderingContext2D,
  state: DeepReadonly<DeepcoreState>,
): void {
  const place = buildingPlace("launch-pad");
  const cx = place.col * TILE + TILE / 2;
  const rise =
    state.launchAnim !== null ? state.launchAnim * LAUNCH_RISE_SPEED : 0;
  const baseY = SURFACE_Y - rise;
  const stage = state.installed.length;

  const sprite = state.assets.rocket[stage];
  if (sprite) {
    ctx.drawImage(
      sprite,
      cx - ROCKET_W / 2,
      baseY - ROCKET_H,
      ROCKET_W,
      ROCKET_H,
    );
    return;
  }
  // A rocket that visibly grows with each installed component.
  const bodyH = 30 + stage * 12;
  const bx = cx - 12;
  const by = baseY - bodyH;
  ctx.fillStyle = stage >= 1 ? "#c9d3dd" : "#3a444e";
  ctx.fillRect(bx, by, 24, bodyH);
  ctx.fillStyle = stage >= 1 ? "#e8eef5" : "#4a545e";
  ctx.beginPath();
  ctx.moveTo(bx, by);
  ctx.lineTo(cx, by - 20);
  ctx.lineTo(bx + 24, by);
  ctx.closePath();
  ctx.fill();
  if (stage >= 3) {
    ctx.fillStyle = P.resonite;
    ctx.fillRect(bx + 4, by + 8, 16, 4);
  }
  if (stage >= 4) {
    ctx.fillStyle = "#6a747e";
    ctx.fillRect(bx - 6, baseY - 12, 8, 12);
    ctx.fillRect(bx + 22, baseY - 12, 8, 12);
  }
  if (stage >= 5) {
    ctx.fillStyle = P.coreSample;
    ctx.beginPath();
    ctx.arc(cx, baseY - 8, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "#2a323b";
  ctx.fillRect(cx - 20, SURFACE_Y - 6, 40, 6);
}

/**
 * The miner, drawn from the produced cycle for its state and mirrored by facing.
 *
 * Every cycle advances at `ANIM_FPS` against the game's own accumulated time
 * rather than the wall clock, and every cycle loops but `hurt`, which plays once
 * and holds its last frame until the state gives way (specs/assets.md).
 */
function drawMiner(
  ctx: CanvasRenderingContext2D,
  state: DeepReadonly<DeepcoreState>,
): void {
  // During the launch the miner has boarded the rocket, so only the rocket
  // lifts off (specs/rocket.md).
  if (state.launchAnim !== null) return;

  const m = state.miner;
  const drawW = TILE;
  const drawH = TILE;
  const x = m.x + MINER_W / 2 - drawW / 2;
  const y = m.y + MINER_H - drawH;

  const cycle = state.assets.miner[m.state];
  const sprite =
    m.state === "hurt"
      ? (cycle[
          Math.min(
            Math.max(cycle.length - 1, 0),
            Math.floor((HURT_TIME - state.hurtT) * ANIM_FPS),
          )
        ] ?? null)
      : cycleFrame(cycle, state.simTime, ANIM_FPS);

  ctx.save();
  if (m.facing === "west") {
    ctx.translate(x + drawW, y);
    ctx.scale(-1, 1);
  } else {
    ctx.translate(x, y);
  }
  if (sprite) ctx.drawImage(sprite, 0, 0, drawW, drawH);
  else drawMinerFallback(ctx, state, 0, 0);
  ctx.restore();
}

function drawMinerFallback(
  ctx: CanvasRenderingContext2D,
  state: DeepReadonly<DeepcoreState>,
  x: number,
  y: number,
): void {
  const pose = state.miner.state;
  const t = state.simTime;
  const bob = pose === "idle" ? Math.sin(t * 3) * 1.5 : 0;
  const oy = y + bob + (pose === "fuel-out" ? 8 : 0);
  ctx.fillStyle = "#4a535d";
  ctx.fillRect(x + 8, oy + 16, 8, 18);
  if (pose === "jetpack") {
    ctx.fillStyle = P.jetpackFlame;
    const flame = 8 + Math.sin(t * 30) * 4;
    ctx.beginPath();
    ctx.moveTo(x + 9, oy + 34);
    ctx.lineTo(x + 15, oy + 34);
    ctx.lineTo(x + 12, oy + 34 + flame);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = pose === "hurt" ? P.alert : P.minerSuit;
  roundRect(ctx, x + 14, oy + 14, 18, 22, 5);
  ctx.fill();
  ctx.fillStyle = pose === "hurt" ? P.alert : "#ffe6c4";
  ctx.beginPath();
  ctx.arc(x + 24, oy + 12, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#2a5d7a";
  ctx.fillRect(x + 22, oy + 8, 9, 7);
  ctx.fillStyle = "rgba(255,240,200,0.9)";
  ctx.beginPath();
  ctx.arc(x + 30, oy + 9, 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#8a949e";
  if (pose === "drill-down") {
    ctx.fillRect(x + 20, oy + 34, 8, 12 + Math.sin(t * 40) * 1.5);
  } else {
    const shake = pose === "drill-side" ? Math.sin(t * 40) * 2 : 0;
    ctx.fillRect(x + 30, oy + 22, 12 + shake, 8);
  }
  ctx.fillStyle = "#c9a074";
  if (pose === "walk") {
    const swing = Math.sin(t * 14) * 4;
    ctx.fillRect(x + 16, oy + 36, 5, 8 + swing);
    ctx.fillRect(x + 25, oy + 36, 5, 8 - swing);
  } else if (pose === "fall") {
    ctx.fillRect(x + 15, oy + 34, 5, 10);
    ctx.fillRect(x + 26, oy + 34, 5, 10);
  } else {
    ctx.fillRect(x + 17, oy + 36, 5, 8);
    ctx.fillRect(x + 24, oy + 36, 5, 8);
  }
}

/**
 * The jettisoned Core Sample where it lies, with its live countdown floating
 * above it, so a player sees how long is left to clear the blast.
 */
function drawGroundItems(
  ctx: CanvasRenderingContext2D,
  state: DeepReadonly<DeepcoreState>,
): void {
  const ground = state.groundItems.find((item) => item.kind === "core-sample");
  if (!ground) return;
  const s = TILE;
  const x = ground.col * TILE;
  const y = ground.row * TILE;
  const pulse = 0.5 + 0.5 * Math.sin(state.simTime * 6);
  const sprite = state.assets.materials["core-sample"];
  if (sprite) {
    ctx.globalAlpha = 0.85 + 0.15 * pulse;
    ctx.drawImage(sprite, x, y, s, s);
    ctx.globalAlpha = 1;
  } else {
    const glow = ctx.createRadialGradient(
      x + s / 2,
      y + s / 2,
      2,
      x + s / 2,
      y + s / 2,
      s / 2,
    );
    glow.addColorStop(0, "#fff3d0");
    glow.addColorStop(0.5, P.coreSample);
    glow.addColorStop(1, "rgba(255,74,42,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(x, y, s, s);
    ctx.fillStyle = P.coreSample;
    ctx.beginPath();
    ctx.arc(x + s / 2, y + s / 2, 10 + 3 * pulse, 0, Math.PI * 2);
    ctx.fill();
  }
  if (state.coreTimer !== null) {
    text(ctx, clock(state.coreTimer), x + s / 2, y - 6, {
      size: 13,
      color: state.coreTimer < 30 ? P.alert : P.coreSample,
      align: "center",
      bold: true,
    });
  }
}

// ---- Over-world readouts -------------------------------------------------

/**
 * The scanner indicator, drawn only while the scanner has LOCKED ON to a needed
 * material within range (specs/mining.md). With no lock there is no indicator at
 * all.
 */
function drawScanner(
  ctx: CanvasRenderingContext2D,
  state: DeepReadonly<DeepcoreState>,
  offX: number,
  offY: number,
): void {
  const scan = state.scan;
  if (!scan.locked) return;
  const x = minerCenterX(state.miner) + offX;
  const y = minerCenterY(state.miner) + offY - 64;
  if (y < HUD_H) return;

  ctx.save();
  ctx.translate(x, y);
  const color = scan.target === "cryenite" ? P.cryenite : P.resonite;
  const angle = Math.atan2(scan.dirY, scan.dirX);
  ctx.rotate(angle);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(20, 0);
  ctx.lineTo(6, -7);
  ctx.lineTo(6, 7);
  ctx.closePath();
  ctx.fill();
  ctx.rotate(-angle);
  text(ctx, `${(scan.distanceTiles ?? 0).toFixed(0)}t`, 0, -14, {
    size: 11,
    color,
    align: "center",
    bold: true,
  });
  ctx.restore();
}

/** The prompt over the building the miner is standing at. */
function drawBuildingPrompt(
  ctx: CanvasRenderingContext2D,
  state: DeepReadonly<DeepcoreState>,
  offX: number,
  offY: number,
): void {
  if (state.screen !== "in-mine" || state.panel) return;
  const near = nearbyBuilding(state.miner);
  if (!near) return;
  const place = buildingPlace(near);
  const x = place.col * TILE + TILE / 2 + offX;
  const y = SURFACE_Y + offY - BUILDING_H - 16;
  text(ctx, near === "save-pad" ? "[E] SAVE" : `[E] ${place.name}`, x, y, {
    size: 14,
    color: P.credits,
    align: "center",
    bold: true,
  });
}

/** The Core Sample's countdown, which blinks harder as it runs out. */
function drawCoreCountdown(
  ctx: CanvasRenderingContext2D,
  state: DeepReadonly<DeepcoreState>,
): void {
  if (state.coreTimer === null) return;
  const t = state.coreTimer;
  const danger = t < 30;
  const blink = danger
    ? 0.5 + 0.5 * Math.sin(state.simTime * (t < 12 ? 18 : 8))
    : 1;
  const w = 260;
  const x = STAGE_W / 2 - w / 2;
  const y = HUD_H + 12;
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
  text(ctx, clock(t), x + w / 2, y + 36, {
    size: 20,
    color: danger ? P.alert : P.textPrimary,
    align: "center",
    bold: true,
  });
  ctx.globalAlpha = 1;
  if (state.satchel.coreSample) {
    text(ctx, "[J] JETTISON", x + w / 2, y + 62, {
      size: 12,
      color: P.textSecondary,
      align: "center",
      bold: true,
    });
  }
}

// ---- The status bar (specs/ui.md) ----------------------------------------

function gauge(
  ctx: CanvasRenderingContext2D,
  icon: Sprite,
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
  if (icon) ctx.drawImage(icon, x, y - 22, 16, 16);
  text(ctx, label, x + (icon ? 20 : 0), y - 4, {
    size: 10,
    color: P.textSecondary,
  });
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

function drawStatusBar(
  ctx: CanvasRenderingContext2D,
  state: DeepReadonly<DeepcoreState>,
): void {
  const assets = state.assets;
  ctx.fillStyle = "#0c1015";
  ctx.fillRect(0, 0, STAGE_W, HUD_H);
  ctx.strokeStyle = "#20272f";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, HUD_H + 0.5);
  ctx.lineTo(STAGE_W, HUD_H + 0.5);
  ctx.stroke();

  const y = 26;
  const fuelMax = maxFuel(state.tiers);
  const hullMax = maxHull(state.tiers);
  gauge(
    ctx,
    assets.icons.fuel,
    16,
    y,
    150,
    "FUEL",
    state.miner.fuel,
    fuelMax,
    P.fuel,
    state.miner.fuel < fuelMax * LOW_FUEL_FRACTION,
  );
  gauge(
    ctx,
    assets.icons.hull,
    182,
    y,
    150,
    "HULL",
    state.miner.hull,
    hullMax,
    P.hull,
    state.miner.hull < hullMax * LOW_HULL_FRACTION,
  );

  // The cargo reads in SLOTS used against the capacity, and turns to OVERLOAD
  // once the haul's weight is past what the jetpack lifts.
  const over = overloaded(state.cargo, state.tiers);
  const used = slotsUsed(state.cargo);
  const cap = cargoCap(state.tiers);
  if (assets.icons.cargo)
    ctx.drawImage(assets.icons.cargo, 340, y - 22, 16, 16);
  text(ctx, over ? OVERLOAD : "CARGO", 360, y - 4, {
    size: 10,
    color: over ? P.alert : P.textSecondary,
  });
  text(ctx, `${used}/${cap}`, 340, y + 12, {
    size: 16,
    color: over || used >= cap ? P.alert : P.cargo,
    bold: true,
  });
  text(ctx, `${n0(loadKg(state.cargo))}kg`, 340, y + 26, {
    size: 10,
    color: over ? P.alert : P.textTertiary,
  });

  if (assets.icons.credits) {
    ctx.drawImage(assets.icons.credits, 452, y - 22, 16, 16);
  }
  text(ctx, "CREDITS", 472, y - 4, { size: 10, color: P.textSecondary });
  text(ctx, `${state.credits}`, 452, y + 12, {
    size: 16,
    color: P.credits,
    bold: true,
  });

  if (assets.icons.depth)
    ctx.drawImage(assets.icons.depth, 596, y - 22, 16, 16);
  text(ctx, "DEPTH", 616, y - 4, { size: 10, color: P.textSecondary });
  text(ctx, `${n0(depthMeters(state.miner))} m`, 596, y + 12, {
    size: 16,
    color: P.textPrimary,
    bold: true,
  });

  text(ctx, "SATCHEL", 712, y - 4, { size: 10, color: P.textSecondary });
  const chip = (
    x: number,
    label: string,
    held: boolean,
    color: string,
    icon: Sprite,
  ): void => {
    ctx.globalAlpha = held ? 1 : 0.3;
    if (icon) ctx.drawImage(icon, x, y - 2, 16, 16);
    else {
      ctx.fillStyle = color;
      roundRect(ctx, x, y - 2, 16, 16, 4);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    text(ctx, label, x + 20, y + 10, {
      size: 11,
      color: held ? P.textPrimary : P.textTertiary,
    });
  };
  chip(
    712,
    "Res",
    state.satchel.resonite > 0,
    P.resonite,
    assets.icons.resonite,
  );
  chip(
    772,
    "Cry",
    state.satchel.cryenite > 0,
    P.cryenite,
    assets.icons.cryenite,
  );
  chip(832, "Core", state.satchel.coreSample, P.coreSample, null);

  text(ctx, "ROCKET", 908, y - 4, { size: 10, color: P.textSecondary });
  ROCKET_COMPONENTS.forEach((component, index) => {
    const on = state.installed.includes(component.id);
    ctx.fillStyle = on ? P.credits : "#2a323b";
    roundRect(ctx, 908 + index * 14, y - 2, 10, 14, 2);
    ctx.fill();
  });
}

function drawNotes(
  ctx: CanvasRenderingContext2D,
  state: DeepReadonly<DeepcoreState>,
): void {
  let y = HUD_H + 70;
  for (const note of state.notes) {
    ctx.globalAlpha = Math.min(1, note.t);
    text(ctx, note.text, STAGE_W / 2, y, {
      size: 15,
      color: P.alert,
      align: "center",
      bold: true,
    });
    ctx.globalAlpha = 1;
    y += 22;
  }
}

/**
 * The first-time hazard notice: a non-blocking card explaining the hazard the
 * miner has just met, raised at most once per expedition for gas and once for
 * lava. The mine keeps running behind it and it fades on its own; the whole card
 * is one clickable that dismisses it (specs/hazards.md).
 */
function drawNotice(
  ctx: CanvasRenderingContext2D,
  state: DeepReadonly<DeepcoreState>,
): void {
  const notice = state.notice;
  if (!notice || !notice.shown) return;
  const { x, y, w, h } = NOTICE_CARD;
  ctx.globalAlpha = Math.min(1, notice.t / 0.6);
  roundRect(ctx, x, y, w, h, 12);
  ctx.fillStyle = "rgba(18,10,8,0.93)";
  ctx.fill();
  ctx.strokeStyle = P.alert;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = P.alert;
  roundRect(ctx, x + 22, y + 22, 36, 36, 8);
  ctx.fill();
  text(ctx, "!", x + 40, y + 47, {
    size: 28,
    color: "#1a0d0a",
    align: "center",
    baseline: "middle",
    bold: true,
  });
  text(ctx, notice.hazard === "gas" ? "GAS POCKET" : "LAVA", x + 74, y + 46, {
    size: 22,
    color: P.alert,
    bold: true,
  });
  const lines =
    notice.hazard === "gas"
      ? [
          "Gas pockets hide as ordinary rock — drilling one DETONATES it, and",
          "that blast is the hull hit, deadlier the deeper you are. Watch for the",
          "faint green seep before you dig, and buy HULL to survive it.",
        ]
      : [
          "Lava sears the hull on contact. You CAN drill through it, but boring",
          "a lava tile burns a big chunk of hull — route around it when you can.",
          "A Radiator reduces the burn, drilled or brushed.",
        ];
  let ly = y + 82;
  for (const line of lines) {
    text(ctx, line, x + 28, ly, { size: 15, color: P.textSecondary });
    ly += 24;
  }
  text(ctx, "Click the card to dismiss it", x + w - 28, y + h - 16, {
    size: 12,
    color: P.textTertiary,
    align: "right",
  });
  ctx.globalAlpha = 1;
}

// ---- The building panels (specs/ui.md, specs/upgrades.md, specs/rocket.md) --

/** The frame every panel is drawn in, over a dimmed viewport. */
function drawPanelFrame(
  ctx: CanvasRenderingContext2D,
  frame: PanelFrame,
): void {
  ctx.fillStyle = "rgba(5,7,10,0.72)";
  ctx.fillRect(0, HUD_H, STAGE_W, VIEW_H);
  roundRect(ctx, frame.x, frame.y, frame.w, frame.h, 12);
  ctx.fillStyle = P.panel;
  ctx.fill();
  ctx.strokeStyle = "#2a333d";
  ctx.lineWidth = 2;
  ctx.stroke();
  text(ctx, frame.title, frame.x + 28, frame.y + 40, {
    size: 24,
    color: P.textPrimary,
    bold: true,
  });
}

/** The Credits balance, in a panel's top-right corner. */
function drawBalance(
  ctx: CanvasRenderingContext2D,
  frame: PanelFrame,
  credits: number,
): void {
  text(ctx, `Credits: ${credits}`, frame.x + frame.w - 28, frame.y + 40, {
    size: 18,
    color: P.credits,
    align: "right",
    bold: true,
  });
}

function drawPanel(
  ctx: CanvasRenderingContext2D,
  state: DeepReadonly<DeepcoreState>,
): void {
  if (!state.panel) return;
  const frame = panelFrame(state.panel);
  drawPanelFrame(ctx, frame);
  switch (state.panel) {
    case "fuel-depot":
      drawFuelDepot(ctx, state, frame);
      break;
    case "ore-market":
      drawOreMarket(ctx, state, frame);
      break;
    case "upgrade-shop":
      drawUpgradeShop(ctx, state, frame);
      break;
    case "supply-depot":
      drawSupplyDepot(ctx, state, frame);
      break;
    case "launch-pad":
      drawLaunchPad(ctx, state, frame);
      break;
    case "inventory":
      drawInventory(ctx, state, frame);
      break;
    default:
      break;
  }
}

function drawFuelDepot(
  ctx: CanvasRenderingContext2D,
  state: DeepReadonly<DeepcoreState>,
  frame: PanelFrame,
): void {
  text(
    ctx,
    "Buy fuel and hull repair with Credits — nothing refills for free.",
    frame.x + 28,
    frame.y + 74,
    { size: 15, color: P.textSecondary },
  );
  drawBalance(ctx, frame, state.credits);

  const fuelY = frame.y + DEPOT_ROWS.fuel;
  gauge(
    ctx,
    null,
    frame.x + 28,
    fuelY,
    300,
    "FUEL",
    state.miner.fuel,
    maxFuel(state.tiers),
    P.fuel,
    false,
  );
  text(ctx, `${FUEL_PRICE} Cr / unit`, frame.x + 28, fuelY + 34, {
    size: 12,
    color: P.textTertiary,
  });

  const hullY = frame.y + DEPOT_ROWS.hull;
  gauge(
    ctx,
    null,
    frame.x + 28,
    hullY,
    300,
    "HULL",
    state.miner.hull,
    maxHull(state.tiers),
    P.hull,
    false,
  );
  text(ctx, `${REPAIR_PRICE} Cr / hull`, frame.x + 28, hullY + 34, {
    size: 12,
    color: P.textTertiary,
  });

  text(
    ctx,
    "Fuel burns whenever the jetpack fires, above ground as well as below;",
    frame.x + 28,
    frame.y + 340,
    { size: 12, color: P.textTertiary },
  );
  text(
    ctx,
    "hull is dented by blasts, lava, and hard landings, and mends only here.",
    frame.x + 28,
    frame.y + 360,
    { size: 12, color: P.textTertiary },
  );
}

function drawOreMarket(
  ctx: CanvasRenderingContext2D,
  state: DeepReadonly<DeepcoreState>,
  frame: PanelFrame,
): void {
  let y = frame.y + 90;
  text(ctx, "ORE", frame.x + 28, y, { size: 12, color: P.textTertiary });
  text(ctx, "HELD × VALUE", frame.x + 260, y, {
    size: 12,
    color: P.textTertiary,
  });
  text(ctx, "SUBTOTAL", frame.x + frame.w - 40, y, {
    size: 12,
    color: P.textTertiary,
    align: "right",
  });
  y += 22;
  let listed = 0;
  for (const entry of MINERALS) {
    const held = state.cargo[entry.id];
    if (held <= 0) continue;
    listed += 1;
    ctx.fillStyle = MINERAL_COLOR[entry.id];
    ctx.beginPath();
    ctx.arc(frame.x + 34, y - 5, 6, 0, Math.PI * 2);
    ctx.fill();
    text(ctx, entry.name.toUpperCase(), frame.x + 48, y, {
      size: 15,
      color: P.textPrimary,
    });
    text(ctx, `${held} × ${entry.value}`, frame.x + 260, y, {
      size: 15,
      color: P.textSecondary,
    });
    text(ctx, `${held * entry.value}`, frame.x + frame.w - 40, y, {
      size: 15,
      color: P.credits,
      align: "right",
    });
    y += 28;
  }
  if (listed === 0) {
    text(
      ctx,
      "Cargo bay empty — drill ore veins below to fill it.",
      frame.x + 28,
      y + 2,
      { size: 14, color: P.textTertiary },
    );
    y += 28;
  }
  y += 8;
  text(ctx, `TOTAL: ${cargoValue(state.cargo)} Credits`, frame.x + 28, y, {
    size: 18,
    color: P.credits,
    bold: true,
  });
  text(
    ctx,
    `Hold ${slotsUsed(state.cargo)}/${cargoCap(state.tiers)} slots · ${n0(loadKg(state.cargo))} kg`,
    frame.x + frame.w - 40,
    y,
    { size: 14, color: P.textSecondary, align: "right" },
  );
}

function drawUpgradeShop(
  ctx: CanvasRenderingContext2D,
  state: DeepReadonly<DeepcoreState>,
  frame: PanelFrame,
): void {
  drawBalance(ctx, frame, state.credits);
  const left = frame.x + 28;
  TRACKS.forEach((track, index) => {
    const y = frame.y + SHOP_ROWS.top + index * SHOP_ROWS.gap;
    const display = TRACK_DISPLAY[track];
    const tier = state.tiers[track];
    const price = nextUpgradePrice(state.tiers, track);
    const maxed = price === null;
    // The radiator reads best as a percentage and the scanner as its range, with
    // its first tier reading as no scanner at all; the rest read as their value.
    const show = (value: number): string =>
      track === "radiator"
        ? `${Math.round(value * 100)}%`
        : track === "scanner" && value === 0
          ? "no scanner"
          : `${value}`;
    const unit = (value: number): string =>
      track === "scanner" && value === 0 ? "" : ` ${display.unit}`;
    const current = display.values[tier - 1] ?? 0;
    const next = maxed ? null : (display.values[tier] ?? 0);
    text(ctx, TRACK_LABEL[track], left, y + 4, {
      size: 15,
      color: P.textPrimary,
      bold: true,
    });
    text(
      ctx,
      `Tier ${tier}/${MAX_TIER[track]} — ${show(current)}${unit(current)}`,
      left,
      y + 22,
      { size: 12, color: P.textSecondary },
    );
    if (!maxed && next !== null) {
      text(ctx, `Next: ${show(next)}${unit(next)}`, left + 380, y + 4, {
        size: 13,
        color: P.hull,
      });
      text(ctx, `${price} Cr`, left + 380, y + 22, {
        size: 13,
        color: state.credits >= price ? P.credits : P.alert,
      });
    }
  });
}

/**
 * The Supply Depot: the six single-use field supplies, each with a code-drawn
 * icon, its one line, the count held, and its price (specs/items.md).
 */
function drawSupplyDepot(
  ctx: CanvasRenderingContext2D,
  state: DeepReadonly<DeepcoreState>,
  frame: PanelFrame,
): void {
  text(
    ctx,
    "Single-use field supplies — used in the mine with 1–6 or the bag.",
    frame.x + 28,
    frame.y + 74,
    { size: 14, color: P.textSecondary },
  );
  drawBalance(ctx, frame, state.credits);
  ITEMS.forEach((item, index) => {
    const y = frame.y + SUPPLY_ROWS.top + index * SUPPLY_ROWS.gap;
    const held = state.items[item.id];
    const afford = state.credits >= item.price;
    drawItemIcon(ctx, item.id, frame.x + 28, y - 4, 30);
    text(ctx, `${itemHotkey(item.id)}. ${item.name}`, frame.x + 72, y + 6, {
      size: 15,
      color: P.textPrimary,
      bold: true,
    });
    text(ctx, ITEM_BLURB[item.id], frame.x + 72, y + 26, {
      size: 12,
      color: P.textTertiary,
    });
    text(ctx, `${item.price} Cr`, frame.x + frame.w - 132, y + 4, {
      size: 13,
      color: afford ? P.credits : P.alert,
      align: "right",
    });
    text(ctx, `Held ×${held}`, frame.x + frame.w - 132, y + 24, {
      size: 12,
      color: held > 0 ? P.textSecondary : P.textTertiary,
      align: "right",
    });
  });
}

/**
 * A small code-drawn supply icon. `specs/assets.md` names no produced sprite for
 * these, so each reads as its supply by shape and color alone.
 */
function drawItemIcon(
  ctx: CanvasRenderingContext2D,
  id: ItemId,
  x: number,
  y: number,
  s: number,
): void {
  const cx = x + s / 2;
  const cy = y + s / 2;
  switch (id) {
    case "dynamite":
    case "plastic-explosives": {
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
      const color = id === "matter-transmitter" ? P.hull : P.voltite;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, s / 2 - 3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, s / 2 - 7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "nanobots": {
      ctx.fillStyle = P.gas;
      ctx.fillRect(cx - 3, y + 4, 6, s - 8);
      ctx.fillRect(x + 4, cy - 3, s - 8, 6);
      break;
    }
    case "emergency-fuel": {
      ctx.fillStyle = P.fuel;
      roundRect(ctx, x + 5, y + 6, s - 10, s - 10, 3);
      ctx.fill();
      ctx.fillStyle = "rgba(0,0,0,0.4)";
      ctx.fillRect(cx - 2, y + 3, 4, 4);
      text(ctx, "F", cx, cy + 1, {
        size: Math.round(s * 0.5),
        color: P.void,
        align: "center",
        baseline: "middle",
        bold: true,
      });
      break;
    }
    default:
      break;
  }
}

function drawLaunchPad(
  ctx: CanvasRenderingContext2D,
  state: DeepReadonly<DeepcoreState>,
  frame: PanelFrame,
): void {
  let y = frame.y + 78;
  const next = nextComponent(state.installed);
  ROCKET_COMPONENTS.forEach((component, index) => {
    const installed = state.installed.includes(component.id);
    const isNext = next?.id === component.id;
    ctx.fillStyle = installed ? P.credits : isNext ? P.hull : "#2a323b";
    ctx.beginPath();
    ctx.arc(frame.x + 36, y, 8, 0, Math.PI * 2);
    ctx.fill();
    if (installed) {
      ctx.strokeStyle = "#0c1116";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(frame.x + 32, y);
      ctx.lineTo(frame.x + 35, y + 3);
      ctx.lineTo(frame.x + 40, y - 4);
      ctx.stroke();
    }
    text(ctx, `${index + 1}. ${component.name}`, frame.x + 56, y + 5, {
      size: 16,
      color: installed
        ? P.textSecondary
        : isNext
          ? P.textPrimary
          : P.textTertiary,
      bold: isNext,
    });
    let need = `${component.credits} Cr`;
    if (component.material) need += ` + 1 ${materialLabel(component.material)}`;
    text(ctx, installed ? "INSTALLED" : need, frame.x + frame.w - 40, y + 5, {
      size: 13,
      color: installed ? P.credits : P.textSecondary,
      align: "right",
    });
    y += 46;
  });

  const hintY = frame.y + frame.h - 108;
  if (allInstalled(state.installed)) {
    text(
      ctx,
      "All components installed. Ready for liftoff.",
      frame.x + 28,
      hintY,
      { size: 15, color: P.credits },
    );
  } else if (next) {
    const ok = canFabricate(state);
    let hint = `Next: ${next.name}`;
    if (state.credits < next.credits) hint += "  — not enough Credits";
    else if (!hasMaterial(state.satchel, next.material)) {
      hint += `  — need ${
        next.material === "core-sample"
          ? "the Core Sample"
          : materialLabel(next.material)
      }`;
    }
    text(ctx, hint, frame.x + 28, hintY, {
      size: 14,
      color: ok ? P.textPrimary : P.alert,
    });
  }
}

/** An exotic material's name, as the specification writes it. */
function materialLabel(material: MaterialId | "core-sample" | null): string {
  if (material === "resonite") return "Resonite";
  if (material === "cryenite") return "Cryenite";
  if (material === "core-sample") return "Core Sample";
  return "";
}

/**
 * The inventory: the cargo and the satchel on the left, the field supplies and
 * the jettison control on the right (specs/items.md, specs/mining.md).
 */
function drawInventory(
  ctx: CanvasRenderingContext2D,
  state: DeepReadonly<DeepcoreState>,
  frame: PanelFrame,
): void {
  text(
    ctx,
    "Everything you're carrying. DROP ore to shed weight; USE a field supply.",
    frame.x + 28,
    frame.y + 66,
    { size: 14, color: P.textSecondary },
  );

  const left = frame.x + 28;
  let y = frame.y + 100;
  text(ctx, "ORE", left + 20, y, { size: 12, color: P.textTertiary });
  text(ctx, "HELD", left + 200, y, { size: 12, color: P.textTertiary });
  text(ctx, "WEIGHT", left + 288, y, { size: 12, color: P.textTertiary });
  y = frame.y + INVENTORY.oreTop;
  let listed = 0;
  for (const entry of MINERALS) {
    const held = state.cargo[entry.id];
    if (held <= 0) continue;
    listed += 1;
    ctx.fillStyle = MINERAL_COLOR[entry.id];
    ctx.beginPath();
    ctx.arc(left + 6, y - 5, 6, 0, Math.PI * 2);
    ctx.fill();
    text(ctx, entry.name.toUpperCase(), left + 20, y, {
      size: 15,
      color: P.textPrimary,
    });
    text(ctx, `${held} × ${entry.weightKg}kg`, left + 200, y, {
      size: 14,
      color: P.textSecondary,
    });
    text(ctx, `${held * entry.weightKg} kg`, left + 288, y, {
      size: 15,
      color: P.textSecondary,
    });
    y += INVENTORY.oreGap;
  }
  if (listed === 0) {
    text(ctx, "Bay empty — nothing to carry yet.", left + 20, y + 2, {
      size: 14,
      color: P.textTertiary,
    });
    y += INVENTORY.oreGap;
  }
  y += 6;
  const over = overloaded(state.cargo, state.tiers);
  text(
    ctx,
    `Slots ${slotsUsed(state.cargo)}/${cargoCap(state.tiers)}   ·   Load ${n0(loadKg(state.cargo))} kg`,
    left,
    y,
    { size: 15, color: over ? P.alert : P.textPrimary, bold: true },
  );
  if (over) {
    text(
      ctx,
      "OVERLOAD — too heavy for the jetpack. Drop ore to fly out.",
      left,
      y + 20,
      { size: 12, color: P.alert, bold: true },
    );
  }
  const satchel = state.satchel;
  text(
    ctx,
    `Satchel — Resonite ×${satchel.resonite}, Cryenite ×${satchel.cryenite}` +
      `${satchel.coreSample ? ", Core Sample" : ""} (weightless)`,
    left,
    over ? y + 42 : y + 22,
    { size: 12, color: P.textSecondary },
  );

  const right = frame.x + INVENTORY.rightOffset;
  const width = INVENTORY.rightWidth;
  text(ctx, "FIELD SUPPLIES", right, frame.y + 100, {
    size: 15,
    color: P.credits,
    bold: true,
  });
  text(ctx, "Single-use — hotkeys 1–6 or USE.", right, frame.y + 118, {
    size: 11,
    color: P.textTertiary,
  });
  ITEMS.forEach((item, index) => {
    const ry = frame.y + INVENTORY.supplyTop + index * INVENTORY.supplyGap;
    const held = state.items[item.id];
    drawItemIcon(ctx, item.id, right + 2, ry - 8, 24);
    text(ctx, `${itemHotkey(item.id)}. ${item.name}`, right + 34, ry, {
      size: 13,
      color: held > 0 ? P.textPrimary : P.textTertiary,
      bold: true,
    });
    text(ctx, `×${held}`, right + width - 120, ry, {
      size: 14,
      color: held > 0 ? P.credits : P.textTertiary,
      align: "right",
    });
  });

  const afterSupplies =
    frame.y + INVENTORY.supplyTop + ITEMS.length * INVENTORY.supplyGap;
  text(ctx, "CORE SAMPLE", right, afterSupplies + 6, {
    size: 13,
    color: P.coreSample,
    bold: true,
  });
  text(
    ctx,
    satchel.coreSample
      ? "Drop it and flee before it detonates — you can't pick it back up."
      : "Not carrying the Core Sample.",
    right,
    afterSupplies + 24,
    {
      size: 11,
      color: satchel.coreSample ? P.textSecondary : P.textTertiary,
    },
  );
}

// ---- The menus and state screens -----------------------------------------

/** A dim slice of the mine behind the menus (specs/ui.md). */
function drawBackdrop(
  ctx: CanvasRenderingContext2D,
  state: DeepReadonly<DeepcoreState>,
): void {
  const wash = ctx.createLinearGradient(0, 0, 0, STAGE_H);
  wash.addColorStop(0, P.duskSky);
  wash.addColorStop(0.35, "#141b28");
  wash.addColorStop(0.7, P.deepstoneFill);
  wash.addColorStop(1, P.coreshellFill);
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
  ctx.fillStyle = "rgba(255,207,74,0.10)";
  for (let i = 0; i < 40; i += 1) {
    const x = (i * 137 + state.simTime * 12) % STAGE_W;
    const y = (i * 89) % STAGE_H;
    ctx.fillRect(x, y, 2, 2);
  }
}

function drawTitle(ctx: CanvasRenderingContext2D): void {
  text(ctx, TITLE_TEXT, STAGE_W / 2, 200, {
    size: 88,
    color: P.credits,
    align: "center",
    bold: true,
  });
  text(ctx, TAGLINE_TEXT, STAGE_W / 2, 250, {
    size: 20,
    color: P.textSecondary,
    align: "center",
  });
  text(
    ctx,
    "Stranded on Vhera Deep — the only way off the rock is the escape rocket.",
    STAGE_W / 2,
    560,
    { size: 14, color: P.textTertiary, align: "center" },
  );
}

function drawModeSelect(ctx: CanvasRenderingContext2D): void {
  text(ctx, "CHOOSE MODE", STAGE_W / 2, 140, {
    size: 44,
    color: P.textPrimary,
    align: "center",
    bold: true,
  });
  text(
    ctx,
    "Same mine, same rocket — only the price of dying differs. Save at the surface Save Pad.",
    STAGE_W / 2,
    180,
    { size: 15, color: P.textSecondary, align: "center" },
  );
  let y = 260;
  for (const mode of ["standard", "hardcore"] as const) {
    text(ctx, MODE_BLURB[mode], STAGE_W / 2, y, {
      size: 13,
      color: P.textTertiary,
      align: "center",
    });
    y += 26;
  }
  text(ctx, "Next: choose how DEEP the mine goes.", STAGE_W / 2, y + 4, {
    size: 13,
    color: P.textSecondary,
    align: "center",
  });
}

function drawSizeSelect(ctx: CanvasRenderingContext2D): void {
  text(ctx, "WORLD SIZE", STAGE_W / 2, 140, {
    size: 44,
    color: P.textPrimary,
    align: "center",
    bold: true,
  });
  text(
    ctx,
    "How deep is the mine? The same bands and the same hazards, over a shorter or longer descent.",
    STAGE_W / 2,
    180,
    { size: 15, color: P.textSecondary, align: "center" },
  );
  let y = 250;
  for (const size of WORLD_SIZES) {
    text(ctx, SIZE_BLURB[size], STAGE_W / 2, y, {
      size: 13,
      color: P.textTertiary,
      align: "center",
    });
    y += 26;
  }
}

function drawHowTo(ctx: CanvasRenderingContext2D): void {
  const cx = STAGE_W / 2;
  text(ctx, "HOW TO PLAY", cx, 110, {
    size: 40,
    color: P.textPrimary,
    align: "center",
    bold: true,
  });
  const rows: readonly (readonly [string, string])[] = [
    ["GOAL", "Build the 5-part escape rocket at the Launch Pad, then LAUNCH."],
    ["DIG", "A/D move · S/↓ drills down · drill sideways at a wall. Never up."],
    [
      "CLIMB",
      "W/↑/Space jetpacks up (burns fuel); falling is free. No ceiling.",
    ],
    [
      "TRADE",
      "Haul ore up, SELL it, then buy fuel, upgrades & supplies. Nothing's free.",
    ],
    [
      "CARGO",
      "Limited slots, and ore has weight — a heavy load won't lift. Bag (I) drops it.",
    ],
    [
      "FIND",
      "Buy a SCANNER to point you to the buried materials the rocket needs.",
    ],
    [
      "DANGER",
      "Gas, lava, and hard falls hurt. The Core Sample's 90s timer detonates.",
    ],
    ["SAVE", "Stand on the Save Pad and press E. There is no autosave."],
    [
      "MODES",
      "Standard restores from your last save; Hardcore deletes it and ends the run.",
    ],
  ];
  let y = 196;
  for (const [label, line] of rows) {
    text(ctx, label, cx - 430, y, { size: 15, color: P.credits, bold: true });
    text(ctx, line, cx - 300, y, { size: 15, color: P.textSecondary });
    y += 40;
  }
  text(
    ctx,
    "Esc pauses · M mutes · E/Enter or click uses a building.",
    cx,
    y + 6,
    { size: 13, color: P.textTertiary, align: "center" },
  );
}

function causeLabel(cause: string | null): string {
  if (cause === "fuel-out") return "Stranded — out of fuel";
  if (cause === "hull-destroyed") return "Hull destroyed";
  if (cause === "core-detonation") return "The Core Sample detonated";
  return "";
}

function drawEndScreen(
  ctx: CanvasRenderingContext2D,
  state: DeepReadonly<DeepcoreState>,
  victory: boolean,
): void {
  const summary = state.summary;
  // A Standard death keeps the save, so the expedition can be picked back up.
  const restorable = !victory && state.mode === "standard" && state.hasSave;
  text(
    ctx,
    victory ? "ESCAPE!" : restorable ? "YOU DIED" : "GAME OVER",
    STAGE_W / 2,
    160,
    {
      size: 72,
      color: victory ? P.credits : P.alert,
      align: "center",
      bold: true,
    },
  );
  text(
    ctx,
    victory
      ? "You lifted off Vhera Deep."
      : restorable
        ? "Restore your last save to continue the expedition."
        : "The expedition ends here.",
    STAGE_W / 2,
    210,
    { size: 20, color: P.textSecondary, align: "center" },
  );

  if (!summary) return;
  const rows: [string, string][] = [
    ["Deepest depth", `${n0(summary.deepestDepthMeters)} m`],
    ["Credits earned", `${summary.creditsEarned}`],
    ["Elapsed time", clock(summary.elapsedSeconds)],
    ["Mode", summary.mode === "hardcore" ? "Hardcore" : "Standard"],
    ["Rocket components", `${summary.componentsInstalled}/5`],
  ];
  if (!victory && summary.deathCause) {
    rows.push(["Cause", causeLabel(summary.deathCause)]);
  }
  const x = STAGE_W / 2 - 200;
  let y = 280;
  for (const [label, value] of rows) {
    text(ctx, label, x, y, { size: 16, color: P.textSecondary });
    text(ctx, value, x + 400, y, {
      size: 16,
      color: P.textPrimary,
      align: "right",
      bold: true,
    });
    y += 32;
  }
}

/** The pause overlay: the mine dimmed, with the pause menu drawn over it. */
function drawPauseOverlay(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = "rgba(5,7,10,0.68)";
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
  text(ctx, "PAUSED", STAGE_W / 2, 220, {
    size: 56,
    color: P.textPrimary,
    align: "center",
    bold: true,
  });
}
