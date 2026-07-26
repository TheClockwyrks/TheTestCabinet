// Locomotivation — the ¾ yard renderer (specs/world.md, specs/overview.md).
//
// Draws the fixed 1280x720 stage in logical space (game.ts sets the letterbox transform).
// The ¾ draw order (specs/world.md): (1) ground tiles, (2) rails/sleepers (folded into the
// produced track tile sprite, code-drawn as a fallback), (3) upright sprites — buildings,
// dispensers, drop-zone posts, signals, levers, packages, trains, the worker — painted
// back-to-front by base y with contact shadows, then (4) particle VFX (composited by
// particles.ts) and (5) the HUD (hud.ts). Produced sprites are used when present; a missing
// asset falls back to a neutral code drawing so the build never crashes (specs/assets.md).

import {
  FREIGHT_COLOR,
  GRID_COLS,
  GRID_ROWS,
  PALETTE,
  TILE,
  TRAIN_HALF_BAND,
  VIEW_H,
  VIEW_W,
  VIEW_Y,
} from "./constants";
import type { FreightColor, LastTrainCar, SignalState, TrainKind, WeightClass } from "./types";
import type { GameAssets } from "./assets";
import { sprite, animFrames } from "./assets";
import type { GroundPackage, SimState, TrainInstance, Vec2, WorkerState } from "./sim/world";
import { carPieceLength, laneCenter, tileCenter, trainBody, trainLeadingEdge, travelSign } from "./sim/world";
import { computeSignalStates } from "./telegraph";

// ─── Public entry ─────────────────────────────────────────────────────────────────────

/** Draw the yard viewport for the current sim state (specs/world.md draw order). */
export function drawWorld(ctx: CanvasRenderingContext2D, state: SimState, assets: GameAssets): void {
  ctx.save();
  // Clip to the yard viewport so nothing spills under the HUD bar.
  ctx.beginPath();
  ctx.rect(VIEW_X, VIEW_Y, VIEW_W, VIEW_H);
  ctx.clip();

  drawGround(ctx, state, assets);
  drawZonePads(ctx, state);
  drawGrid(ctx);

  const signals = computeSignalStates(state);
  drawUprights(ctx, state, assets, signals);

  ctx.restore();
}

const VIEW_X = 0;

// ─── Ground layer ──────────────────────────────────────────────────────────────────────

function drawGround(ctx: CanvasRenderingContext2D, state: SimState, assets: GameAssets): void {
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const x = col * TILE;
      const y = VIEW_Y + row * TILE;
      drawTileFloor(ctx, assets, state.tiles[row][col], col, row, x, y);
    }
  }
}

function drawTileFloor(
  ctx: CanvasRenderingContext2D,
  assets: GameAssets,
  kind: string,
  col: number,
  row: number,
  x: number,
  y: number,
): void {
  const h = hash(col, row);
  switch (kind) {
    case "ground": {
      const variant = h % 3;
      if (drawImg(ctx, sprite(assets, `tiles/ground-${variant}`), x, y, TILE, TILE)) return;
      ctx.fillStyle = PALETTE.ground;
      ctx.fillRect(x, y, TILE, TILE);
      if (variant === 2) {
        ctx.fillStyle = PALETTE.grass;
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.ellipse(x + 20, y + 22, 12, 8, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      // Subtle gravel speckle for texture.
      ctx.fillStyle = "#00000018";
      ctx.fillRect(x + (h % 30), y + ((h >> 3) % 30), 3, 3);
      return;
    }
    case "track": {
      if (drawImg(ctx, sprite(assets, "tiles/track-h"), x, y, TILE, TILE)) return;
      ctx.fillStyle = PALETTE.ballast;
      ctx.fillRect(x, y, TILE, TILE);
      // Sleepers (timber ties) across the lane.
      ctx.fillStyle = PALETTE.sleeper;
      for (let i = 0; i < 4; i++) ctx.fillRect(x + 2 + i * 10, y + 4, 6, TILE - 8);
      // Two steel rails.
      ctx.fillStyle = PALETTE.rail;
      ctx.fillRect(x, y + 11, TILE, 3);
      ctx.fillRect(x, y + TILE - 14, TILE, 3);
      return;
    }
    case "bridge": {
      if (drawImg(ctx, sprite(assets, "tiles/bridge-h"), x, y, TILE, TILE)) return;
      ctx.fillStyle = PALETTE.bridgeDeck;
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = "#00000022";
      for (let i = 0; i < 5; i++) ctx.fillRect(x, y + 3 + i * 8, TILE, 2);
      ctx.fillStyle = PALETTE.rail;
      ctx.fillRect(x, y + 12, TILE, 3);
      ctx.fillRect(x, y + TILE - 15, TILE, 3);
      return;
    }
    case "refuge": {
      if (drawImg(ctx, sprite(assets, "tiles/refuge"), x, y, TILE, TILE)) return;
      ctx.fillStyle = PALETTE.refuge;
      ctx.fillRect(x + 1, y + 1, TILE - 2, TILE - 2);
      ctx.strokeStyle = "#00000030";
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 3, y + 3, TILE - 6, TILE - 6);
      // Hazard chevrons so it reads as a safe pocket.
      ctx.fillStyle = PALETTE.signalWarning;
      ctx.globalAlpha = 0.5;
      ctx.fillRect(x + 6, y + 18, TILE - 12, 4);
      ctx.globalAlpha = 1;
      return;
    }
    case "gap": {
      const variant = h % 2;
      if (drawImg(ctx, sprite(assets, `tiles/gap-${variant}`), x, y, TILE, TILE)) return;
      ctx.fillStyle = PALETTE.gap;
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = "#ffffff10";
      ctx.fillRect(x + 4, y + 8 + (h % 10), TILE - 8, 2);
      ctx.fillRect(x + 8, y + 24 + (h % 8), TILE - 16, 2);
      return;
    }
    case "wall": {
      if (drawImg(ctx, sprite(assets, "tiles/wall"), x, y, TILE, TILE)) return;
      ctx.fillStyle = PALETTE.wall;
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = PALETTE.roof;
      ctx.fillRect(x + 2, y + 2, TILE - 4, TILE - 12);
      return;
    }
    default:
      ctx.fillStyle = PALETTE.ground;
      ctx.fillRect(x, y, TILE, TILE);
  }
}

/** Flat color-coded pads under each drop zone (the upright post is drawn in the sort). */
function drawZonePads(ctx: CanvasRenderingContext2D, state: SimState): void {
  for (const z of state.level.dropZones) {
    const x = z.at.col * TILE;
    const y = VIEW_Y + z.at.row * TILE;
    const col = FREIGHT_COLOR[z.color];
    ctx.fillStyle = col;
    ctx.globalAlpha = 0.35;
    ctx.fillRect(x + 2, y + 2, TILE - 4, TILE - 4);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(x + 3, y + 3, TILE - 6, TILE - 6);
    ctx.setLineDash([]);
  }
}

function drawGrid(ctx: CanvasRenderingContext2D): void {
  ctx.strokeStyle = PALETTE.gridLine;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let c = 0; c <= GRID_COLS; c++) {
    ctx.moveTo(c * TILE, VIEW_Y);
    ctx.lineTo(c * TILE, VIEW_Y + VIEW_H);
  }
  for (let r = 0; r <= GRID_ROWS; r++) {
    ctx.moveTo(0, VIEW_Y + r * TILE);
    ctx.lineTo(VIEW_W, VIEW_Y + r * TILE);
  }
  ctx.stroke();
}

// ─── Upright sprites, painter-sorted by base y ──────────────────────────────────────────

interface Drawable {
  baseY: number;
  z: number; // tiebreak within the same base row
  draw: () => void;
}

function drawUprights(
  ctx: CanvasRenderingContext2D,
  state: SimState,
  assets: GameAssets,
  signals: Record<string, SignalState>,
): void {
  const items: Drawable[] = [];

  // Dispensers.
  for (const d of state.level.dispensers) {
    const c = tileCenter(d.at);
    items.push({ baseY: c.y, z: 1, draw: () => drawDispenser(ctx, assets, c, d.color) });
  }
  // Drop-zone marker posts.
  for (const zdef of state.level.dropZones) {
    const c = tileCenter(zdef.at);
    items.push({ baseY: c.y, z: 0, draw: () => drawZonePost(ctx, assets, c, zdef.color) });
  }
  // Levers.
  for (const lv of state.level.levers) {
    const c = tileCenter(lv.at);
    const thrown = state.levers[lv.id]?.thrown ?? false;
    items.push({ baseY: c.y, z: 2, draw: () => drawLever(ctx, assets, c, thrown) });
  }
  // Signals.
  for (const s of state.level.signals) {
    const c = tileCenter(s.at);
    const st = signals[s.id] ?? "clear";
    items.push({ baseY: c.y, z: 2, draw: () => drawSignal(ctx, assets, c, st) });
  }
  // Ground packages (uniques, optionals, dropped).
  for (const gp of state.ground) {
    items.push({ baseY: gp.pos.y, z: 3, draw: () => drawGroundPackage(ctx, assets, gp) });
  }
  // Trains.
  for (const t of state.trains) {
    const cy = laneCenter(t.orientation, t.line);
    items.push({ baseY: cy, z: 4, draw: () => drawTrain(ctx, assets, t) });
  }
  // The worker (unless it has ridden off with a boarded train and is far off-screen).
  items.push({ baseY: state.worker.pos.y, z: 5, draw: () => drawWorker(ctx, assets, state) });

  items.sort((a, b) => a.baseY - b.baseY || a.z - b.z);
  for (const it of items) it.draw();

  // Headlight glows are additive and drawn last (over the sorted bodies).
  for (const t of state.trains) drawHeadlight(ctx, t);
}

// ─── Elements ───────────────────────────────────────────────────────────────────────────

function shadow(ctx: CanvasRenderingContext2D, cx: number, baseY: number, rx: number): void {
  ctx.fillStyle = "#00000040";
  ctx.beginPath();
  ctx.ellipse(cx, baseY + 2, rx, rx * 0.4, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawDispenser(ctx: CanvasRenderingContext2D, assets: GameAssets, c: Vec2, color: FreightColor): void {
  shadow(ctx, c.x, c.y + 16, 18);
  if (drawImg(ctx, sprite(assets, `elements/dispenser-${color}`), c.x - 22, c.y - 40, 44, 60)) return;
  const col = FREIGHT_COLOR[color];
  // Body.
  ctx.fillStyle = PALETTE.wall;
  ctx.fillRect(c.x - 16, c.y - 30, 32, 46);
  ctx.fillStyle = PALETTE.roof;
  ctx.fillRect(c.x - 18, c.y - 36, 36, 8);
  // Colored chute.
  ctx.fillStyle = col;
  ctx.fillRect(c.x - 12, c.y - 4, 24, 12);
  ctx.fillStyle = "#0006";
  ctx.fillRect(c.x - 10, c.y + 6, 20, 4);
  // Colored roof stripe (reads as its color).
  ctx.fillStyle = col;
  ctx.fillRect(c.x - 18, c.y - 36, 36, 3);
}

function drawZonePost(ctx: CanvasRenderingContext2D, assets: GameAssets, c: Vec2, color: FreightColor): void {
  if (drawImg(ctx, sprite(assets, `elements/zone-${color}`), c.x - 16, c.y - 34, 32, 44)) return;
  const col = FREIGHT_COLOR[color];
  // A small ¾ marker post at the pad's back edge.
  ctx.fillStyle = "#0006";
  ctx.fillRect(c.x + 8, c.y - 24, 4, 26);
  ctx.fillStyle = col;
  ctx.fillRect(c.x + 2, c.y - 30, 16, 12);
  ctx.strokeStyle = "#00000040";
  ctx.strokeRect(c.x + 2, c.y - 30, 16, 12);
}

function drawLever(ctx: CanvasRenderingContext2D, assets: GameAssets, c: Vec2, thrown: boolean): void {
  shadow(ctx, c.x, c.y + 12, 12);
  const key = thrown ? "elements/lever-thrown" : "elements/lever-default";
  if (drawImg(ctx, sprite(assets, key), c.x - 16, c.y - 30, 32, 44)) return;
  ctx.fillStyle = PALETTE.wall;
  ctx.fillRect(c.x - 4, c.y - 4, 8, 14);
  ctx.strokeStyle = thrown ? PALETTE.signalDanger : PALETTE.signalClear;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(c.x, c.y);
  ctx.lineTo(c.x + (thrown ? 12 : -12), c.y - 20);
  ctx.stroke();
  ctx.fillStyle = thrown ? PALETTE.signalDanger : PALETTE.signalClear;
  ctx.beginPath();
  ctx.arc(c.x + (thrown ? 12 : -12), c.y - 20, 4, 0, Math.PI * 2);
  ctx.fill();
}

function drawSignal(ctx: CanvasRenderingContext2D, assets: GameAssets, c: Vec2, st: SignalState): void {
  shadow(ctx, c.x, c.y + 10, 10);
  const key = st === "danger" ? "elements/signal-danger" : st === "warning" ? "elements/signal-warning" : "elements/signal-clear";
  if (drawImg(ctx, sprite(assets, key), c.x - 12, c.y - 34, 24, 44)) {
    return;
  }
  // Fallback: a post with a lit head.
  ctx.fillStyle = "#20242b";
  ctx.fillRect(c.x - 3, c.y - 20, 6, 28);
  ctx.fillStyle = "#14171c";
  ctx.fillRect(c.x - 8, c.y - 34, 16, 18);
  const col = st === "danger" ? PALETTE.signalDanger : st === "warning" ? PALETTE.signalWarning : PALETTE.signalClear;
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.arc(c.x, c.y - 25, 5, 0, Math.PI * 2);
  ctx.fill();
  // Glow.
  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  ctx.arc(c.x, c.y - 25, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

const CLASS_SIZE: Record<WeightClass, number> = { parcel: 18, crate: 24, load: 30 };

function drawGroundPackage(ctx: CanvasRenderingContext2D, assets: GameAssets, gp: GroundPackage): void {
  const s = CLASS_SIZE[gp.pkg.weightClass];
  shadow(ctx, gp.pos.x, gp.pos.y + s / 2, s * 0.5);
  const isUnique = gp.pkg.archetype === "unique";
  const key = isUnique
    ? `cargo/unique-${gp.pkg.color}-${gp.pkg.weightClass}`
    : `cargo/${gp.pkg.color}-${gp.pkg.weightClass}`;
  if (drawImg(ctx, sprite(assets, key), gp.pos.x - s / 2, gp.pos.y - s, s, s)) return;
  drawPackageFallback(ctx, gp.pos.x, gp.pos.y - s / 2, s, gp.pkg.color, isUnique);
}

function drawPackageFallback(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number, color: FreightColor, unique: boolean): void {
  const col = FREIGHT_COLOR[color];
  ctx.fillStyle = col;
  ctx.fillRect(cx - s / 2, cy - s / 2, s, s);
  ctx.strokeStyle = "#00000055";
  ctx.lineWidth = 2;
  ctx.strokeRect(cx - s / 2, cy - s / 2, s, s);
  // A cross-strap for the crate read.
  ctx.strokeStyle = "#ffffff40";
  ctx.beginPath();
  ctx.moveTo(cx - s / 2, cy);
  ctx.lineTo(cx + s / 2, cy);
  ctx.moveTo(cx, cy - s / 2);
  ctx.lineTo(cx, cy + s / 2);
  ctx.stroke();
  if (unique) {
    // A stamped seal.
    ctx.fillStyle = "#ffffffcc";
    ctx.beginPath();
    ctx.arc(cx, cy, s * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(cx, cy, s * 0.12, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ─── Trains ─────────────────────────────────────────────────────────────────────────────

interface CarSlot {
  x0: number;
  x1: number;
  piece: LastTrainCar | "coach" | "body";
  lead: boolean;
}

/** Enumerate a train's car slots from the leading edge backward (horizontal lanes). */
function trainSlots(t: TrainInstance): CarSlot[] {
  const lead = trainLeadingEdge(t, VIEW_W, VIEW_H);
  const sign = travelSign(t.dir);
  const slots: CarSlot[] = [];
  if (t.isLast && t.consist) {
    let edge = lead;
    let first = true;
    for (const piece of t.consist) {
      const len = carPieceLength(t.kind, piece);
      const b = edge - sign * len;
      slots.push({ x0: Math.min(edge, b), x1: Math.max(edge, b), piece, lead: first });
      edge = b;
      first = false;
    }
    return slots;
  }
  // Regular train: split the fixed length into N equal cars, engine first.
  const unit = t.kind === "freight" ? 80 : t.kind === "commuter" ? 60 : 45;
  const n = Math.max(2, Math.round(t.length / unit));
  const slot = t.length / n;
  let edge = lead;
  for (let i = 0; i < n; i++) {
    const b = edge - sign * slot;
    const piece: CarSlot["piece"] = i === 0 ? "engine" : t.kind === "freight" ? "boxcar" : t.kind === "commuter" ? "coach" : "body";
    slots.push({ x0: Math.min(edge, b), x1: Math.max(edge, b), piece, lead: i === 0 });
    edge = b;
  }
  return slots;
}

function pieceSpriteKey(kind: TrainKind, piece: CarSlot["piece"]): string {
  if (piece === "engine") return kind === "commuter" ? "train/commuter/engine-h" : kind === "bullet" ? "train/bullet/nose-h" : "train/freight/engine-h";
  if (piece === "boxcar") return "train/freight/boxcar-h";
  if (piece === "flat-top") return "train/freight/flat-top-h";
  if (piece === "flat-top-half") return "train/freight/flat-top-half-h";
  if (piece === "coach") return "train/commuter/coach-h";
  return "train/bullet/body-h"; // body
}

function drawTrain(ctx: CanvasRenderingContext2D, assets: GameAssets, t: TrainInstance): void {
  const cy = laneCenter(t.orientation, t.line);
  const bodyH = TRAIN_HALF_BAND * 2 + 14; // visually a touch taller than the lethal band
  const top = cy - bodyH / 2 - 6;
  // Contact shadow spanning the body.
  const body = trainBody(t, VIEW_W, VIEW_H, TRAIN_HALF_BAND);
  ctx.fillStyle = "#00000038";
  ctx.fillRect(body.x0, cy + TRAIN_HALF_BAND - 2, body.x1 - body.x0, 8);

  for (const car of trainSlots(t)) {
    const w = car.x1 - car.x0;
    if (drawImg(ctx, sprite(assets, pieceSpriteKey(t.kind, car.piece)), car.x0, top, w, bodyH)) continue;
    drawCarFallback(ctx, t.kind, car, car.x0, top, w, bodyH);
  }
}

function drawCarFallback(
  ctx: CanvasRenderingContext2D,
  kind: TrainKind,
  car: CarSlot,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const bodyColor = kind === "freight" ? PALETTE.trainFreight : kind === "commuter" ? PALETTE.trainCommuter : PALETTE.trainBullet;
  const rideable = car.piece === "flat-top" || car.piece === "flat-top-half";
  if (rideable) {
    // Open, flat, obviously-boardable deck — unmistakable from lethal cars.
    ctx.fillStyle = "#5a4a38";
    ctx.fillRect(x + 1, y + h * 0.45, w - 2, h * 0.5);
    ctx.strokeStyle = "#8a6f4f";
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + h * 0.45, w - 2, h * 0.5);
    // Deck planks.
    ctx.strokeStyle = "#00000030";
    ctx.beginPath();
    for (let px = x + 6; px < x + w - 4; px += 8) {
      ctx.moveTo(px, y + h * 0.5);
      ctx.lineTo(px, y + h * 0.9);
    }
    ctx.stroke();
    // Low end posts so it reads open, not sealed.
    ctx.fillStyle = "#3c2f26";
    ctx.fillRect(x + 1, y + h * 0.3, 3, h * 0.65);
    ctx.fillRect(x + w - 4, y + h * 0.3, 3, h * 0.65);
    drawWheels(ctx, x, y + h, w);
    return;
  }
  // Sealed, tall, dangerous body.
  ctx.fillStyle = bodyColor;
  ctx.fillRect(x + 1, y, w - 2, h);
  ctx.fillStyle = "#ffffff20";
  ctx.fillRect(x + 1, y, w - 2, 4); // top highlight (the ¾ top face)
  ctx.fillStyle = "#00000030";
  ctx.fillRect(x + 1, y + h - 5, w - 2, 5);
  ctx.strokeStyle = "#00000055";
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 1, y, w - 2, h);
  if (car.piece === "engine") {
    // A cab window band.
    ctx.fillStyle = PALETTE.headlight;
    ctx.globalAlpha = 0.7;
    ctx.fillRect(x + w * 0.25, y + h * 0.28, w * 0.5, h * 0.25);
    ctx.globalAlpha = 1;
  } else if (kind === "commuter") {
    ctx.fillStyle = "#20242b";
    for (let px = x + 6; px < x + w - 8; px += 14) ctx.fillRect(px, y + h * 0.3, 8, h * 0.28);
  } else {
    // Boxcar side ribs.
    ctx.strokeStyle = "#00000030";
    ctx.beginPath();
    for (let px = x + 8; px < x + w - 4; px += 10) {
      ctx.moveTo(px, y + 3);
      ctx.lineTo(px, y + h - 6);
    }
    ctx.stroke();
  }
  drawWheels(ctx, x, y + h, w);
}

function drawWheels(ctx: CanvasRenderingContext2D, x: number, baseY: number, w: number): void {
  ctx.fillStyle = "#15181d";
  const r = 4;
  for (const wx of [x + 8, x + w - 8]) {
    ctx.beginPath();
    ctx.arc(wx, baseY - 1, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawHeadlight(ctx: CanvasRenderingContext2D, t: TrainInstance): void {
  const cy = laneCenter(t.orientation, t.line);
  const lead = trainLeadingEdge(t, VIEW_W, VIEW_H);
  const dir = travelSign(t.dir);
  const gx = t.orientation === "horizontal" ? lead + dir * 30 : cy;
  const gy = t.orientation === "horizontal" ? cy : lead + dir * 30;
  const grad = ctx.createRadialGradient(gx, gy, 2, gx, gy, 48);
  grad.addColorStop(0, "rgba(255,242,196,0.55)");
  grad.addColorStop(1, "rgba(255,242,196,0)");
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(gx, gy, 48, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";
}

// ─── Worker (headline) ───────────────────────────────────────────────────────────────────

const CYCLE_FPS: Record<string, number> = { idle: 4, walk: 10, sprint: 14, carry: 8, drop: 12, squish: 12 };

function drawWorker(ctx: CanvasRenderingContext2D, assets: GameAssets, state: SimState): void {
  const w = state.worker;
  // Hide the worker fully during a unique-lost/out-of-lives freeze is not needed; always draw.
  shadow(ctx, w.pos.x, w.pos.y, 12);

  const frame = pickWorkerFrame(assets, w);
  const dw = 40;
  const dh = 52;
  if (frame && drawImg(ctx, frame, w.pos.x - dw / 2, w.pos.y - dh + 8, dw, dh)) {
    drawCarriedOverlay(ctx, assets, state);
    return;
  }
  drawWorkerFallback(ctx, w);
  drawCarriedOverlay(ctx, assets, state);
}

function pickWorkerFrame(assets: GameAssets, w: WorkerState): HTMLImageElement | null {
  let prefix: string;
  if (w.anim === "squish") prefix = "worker/squish";
  else if (w.anim === "drop") prefix = "worker/drop/down";
  else prefix = `worker/${w.anim}/${w.facing}`;
  const frames = animFrames(assets, prefix);
  if (frames.length === 0) return null;
  const fps = CYCLE_FPS[w.anim] ?? 8;
  let idx = Math.floor(w.animTime * fps);
  if (w.anim === "squish" || w.anim === "drop") idx = Math.min(idx, frames.length - 1);
  else idx = idx % frames.length;
  // Hold frame 0 for a laden idle (carrying but not moving).
  if (w.anim === "carry" && !w.moving) idx = 0;
  return frames[idx] ?? null;
}

function drawWorkerFallback(ctx: CanvasRenderingContext2D, w: WorkerState): void {
  const x = w.pos.x;
  const y = w.pos.y;
  const laden = w.carried.length > 0;
  const bob = w.moving ? Math.sin(w.animTime * 12) * 2 : Math.sin(w.animTime * 3) * 1;
  const squish = w.anim === "squish";
  if (squish) {
    ctx.fillStyle = PALETTE.workerOveralls;
    ctx.fillRect(x - 16, y - 8, 32, 8);
    ctx.fillStyle = PALETTE.workerHiVis;
    ctx.fillRect(x - 16, y - 6, 32, 3);
    return;
  }
  const lean = laden ? 2 : 0;
  // Legs.
  ctx.fillStyle = "#2a2622";
  ctx.fillRect(x - 6, y - 12, 4, 12);
  ctx.fillRect(x + 2, y - 12, 4, 12);
  // Body (overalls).
  ctx.fillStyle = PALETTE.workerOveralls;
  ctx.fillRect(x - 8, y - 26 + bob + lean, 16, 16);
  // Hi-vis vest.
  ctx.fillStyle = PALETTE.workerHiVis;
  ctx.fillRect(x - 8, y - 22 + bob + lean, 16, 7);
  // Head, facing tint.
  ctx.fillStyle = "#e7c39b";
  ctx.fillRect(x - 5, y - 34 + bob + lean, 10, 9);
  // Hard hat.
  ctx.fillStyle = PALETTE.workerHiVis;
  ctx.fillRect(x - 6, y - 36 + bob + lean, 12, 4);
  // Facing cue (a small nose/brim).
  ctx.fillStyle = "#00000030";
  if (w.facing === "left") ctx.fillRect(x - 8, y - 33 + bob + lean, 3, 5);
  else if (w.facing === "right") ctx.fillRect(x + 5, y - 33 + bob + lean, 3, 5);
  else if (w.facing === "up") ctx.fillRect(x - 5, y - 35 + bob + lean, 10, 2);
  else ctx.fillRect(x - 5, y - 26 + bob + lean, 10, 2);
}

function drawCarriedOverlay(ctx: CanvasRenderingContext2D, assets: GameAssets, state: SimState): void {
  const w = state.worker;
  if (w.carried.length === 0) return;
  // Stack carried packages just above the worker's hands.
  let oy = w.pos.y - 30;
  for (let i = 0; i < w.carried.length && i < 4; i++) {
    const pkg = w.carried[i];
    const s = CLASS_SIZE[pkg.weightClass] - 2;
    const key = pkg.archetype === "unique" ? `cargo/unique-${pkg.color}-${pkg.weightClass}` : `cargo/${pkg.color}-${pkg.weightClass}`;
    if (!drawImg(ctx, sprite(assets, key), w.pos.x - s / 2, oy - s, s, s)) {
      drawPackageFallback(ctx, w.pos.x, oy - s / 2, s, pkg.color, pkg.archetype === "unique");
    }
    oy -= s - 4;
  }
}

// ─── Sprite helpers ──────────────────────────────────────────────────────────────────────

/** Draw a loaded image; returns false (drawing nothing) if the sprite is absent/undecoded. */
function drawImg(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | undefined,
  x: number,
  y: number,
  w: number,
  h: number,
): boolean {
  if (!img || !img.naturalWidth) return false;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, x, y, w, h);
  return true;
}

/** A stable per-tile hash for variant selection (deterministic, no RNG). */
function hash(col: number, row: number): number {
  let h = (col * 73856093) ^ (row * 19349663);
  h = (h ^ (h >>> 13)) >>> 0;
  return h;
}
