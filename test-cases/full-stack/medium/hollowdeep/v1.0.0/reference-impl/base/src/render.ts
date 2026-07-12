// Hollowdeep — all drawing (specs/overview.md, specs/world.md, specs/flow.md, DESIGN §6).
//
// Draws the whole fixed 1280x720 stage in logical space and returns the frame's clickable
// regions so the input layer routes pointer events without re-deriving the layout. Nothing
// here mutates the simulation — render READS the Game and its World and composes:
//
//  - the camera'd tile world from the PRODUCED tile/machine sprites (flush, nearest-neighbor,
//    open tiles backed so dug space reads as a lit interior), dig designations, build ghosts,
//    priority marks, and a glow on running machines / ripe farms;
//  - the live gas overlay (GasOverlay) composited over the open tiles, then the delvers from
//    the PRODUCED sheets (the Anim matching each delver's act, advanced on a timer, mirrored
//    by facing), then the one-shot dust / looping machine steam (Bursts);
//  - the tool/selection feedback (hovered-tile cursor, dig-drag rectangle, build ghost);
//  - the ENTIRE in-code HUD: the top vitals strip (oxygen / CO2 / power / stocks / cycle /
//    speed / alert) and the bottom strip (delver roster + build palette / tool bar);
//  - the milestone toasts and every menu / state screen (title, how-to, pause, colony-lost).
//
// Mirrors valence's render.ts approach (module-level view state pushed in by the loop; a
// small set of drawing primitives; one entry that returns Clickable[]).

import {
  BUILD_COST,
  COL,
  CYCLE_SECONDS,
  FONT,
  HEALTH_MAX,
  HUNGER_MAX,
  STAGE_H,
  STAGE_W,
  STAMINA_MAX,
  TILE,
  TOP_HUD_H,
  BOTTOM_HUD_Y,
  VIEW_H,
  VIEW_W,
  VIEW_X0,
  VIEW_Y0,
  O2_BREATHE_MIN,
  canDig,
  isMachine,
  isSolid,
} from "./constants";
import type { Anim, BuildKind, Clickable, Delver, Tool } from "./types";
import { tileAt, worldToScreen } from "./world";
import { breathableAt } from "./gas";
import { canPlace, farmAt, machineAt } from "./economy";
import type { Game } from "./sim";
import type { Assets } from "./assets";
import type { Bursts, GasOverlay } from "./particles";
import { menuItems, type MenuItem } from "./menus";

// ---- module-level view state (pushed in by the loop, like valence) --------------
let time = 0;
let menuIndex = 0;
let muted = false;
let pointerX = -1;
let pointerY = -1;
// The active dig-drag rectangle preview (tile coords), tracked by the input layer while the
// pointer is dragging with the dig tool; null when not dragging.
let dragRect: { tx0: number; ty0: number; tx1: number; ty1: number } | null = null;

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
export function setDragRect(r: { tx0: number; ty0: number; tx1: number; ty1: number } | null): void {
  dragRect = r;
}

// Frames-per-second each produced delver sheet plays at.
const ANIM_FPS: Record<Anim, number> = { walk: 10, dig: 12, carry: 9, idle: 5 };

// ---- drawing primitives ---------------------------------------------------------
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

// Blit a produced pixel-art sprite crisply (nearest-neighbor) into an integer box.
function blitRect(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number): void {
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, x, y, w, h);
}

// Blit a produced sprite centered at (cx, cy), optionally mirrored horizontally (facing).
function blitCentered(ctx: CanvasRenderingContext2D, img: HTMLImageElement, cx: number, cy: number, w: number, h: number, flip = false): void {
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.translate(cx, cy);
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

function wrap(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, maxW: number, size: number, color: string, lineHeight = 20): void {
  ctx.font = `400 ${size}px ${FONT}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  let line = "";
  let yy = y;
  for (const word of s.split(" ")) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxW) {
      ctx.fillText(line, x, yy);
      line = word;
      yy += lineHeight;
    } else line = test;
  }
  ctx.fillText(line, x, yy);
}

function lineCount(ctx: CanvasRenderingContext2D, s: string, maxW: number, size: number): number {
  ctx.font = `400 ${size}px ${FONT}`;
  let line = "";
  let n = 1;
  for (const word of s.split(" ")) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxW) {
      n++;
      line = word;
    } else line = test;
  }
  return n;
}

// ---- camera / tile helpers ------------------------------------------------------
// The integer screen box a tile occupies (floored so flush tiles never show seams).
function tileScreen(game: Game, tx: number, ty: number): { x: number; y: number } {
  const s = worldToScreen(game.world.camera, tx * TILE, ty * TILE);
  return { x: Math.floor(s.x), y: Math.floor(s.y) };
}

// The produced sprite key a build ghost / placed structure uses as its glyph.
function structureSprite(kind: BuildKind): string {
  if (kind === "wall" || kind === "floor" || kind === "ladder" || kind === "wire") return `tiles/${kind}`;
  return `machines/${kind}`;
}

// ---- entry ----------------------------------------------------------------------
export function render(ctx: CanvasRenderingContext2D, game: Game, A: Assets, gas: GasOverlay, bursts: Bursts): Clickable[] {
  const clicks: Clickable[] = [];

  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = COL.void;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);

  if (game.state === "title") {
    drawTitle(ctx, game, A, clicks);
    return clicks;
  }
  if (game.state === "howto") {
    drawHowto(ctx, clicks);
    return clicks;
  }

  // playing / paused / gameover all show the colony behind (frozen under an overlay).
  drawWorld(ctx, game, A);
  gas.draw(ctx, game.world);
  drawDelvers(ctx, game, A);
  bursts.draw(ctx, game.world);
  drawToolCursor(ctx, game, A);

  drawTopHud(ctx, game, A, clicks);
  drawBottomHud(ctx, game, A, clicks);
  drawMilestones(ctx, game);

  if (game.state === "paused") drawPause(ctx, game, clicks);
  if (game.state === "gameover") drawGameOver(ctx, game, clicks);

  return clicks;
}

// ---- the tile world -------------------------------------------------------------
// Lay every visible tile from its produced sprite, flush against neighbors. Solid natural
// tiles draw their own sprite; every open-to-gas tile draws the interior BACKING first
// (so dug space reads as a lit room, not a hole) and then any built structure / machine on
// top. Dig designations, build ghosts, running-machine glow, and priority marks overlay.
function drawWorld(ctx: CanvasRenderingContext2D, game: Game, A: Assets): void {
  const world = game.world;
  const cam = world.camera;
  const zoom = cam.zoom;
  const size = TILE * zoom;
  const draw = Math.ceil(size) + 1; // slight overlap kills sub-pixel seams

  const txMin = Math.max(0, Math.floor(cam.x / TILE) - 1);
  const tyMin = Math.max(0, Math.floor(cam.y / TILE) - 1);
  const txMax = Math.min(world.w - 1, Math.ceil((cam.x + VIEW_W / zoom) / TILE) + 1);
  const tyMax = Math.min(world.h - 1, Math.ceil((cam.y + VIEW_H / zoom) / TILE) + 1);

  ctx.save();
  ctx.beginPath();
  ctx.rect(VIEW_X0, VIEW_Y0, VIEW_W, VIEW_H);
  ctx.clip();
  ctx.imageSmoothingEnabled = false;

  const backing = A.sprite("tiles/open");
  for (let ty = tyMin; ty <= tyMax; ty++) {
    for (let tx = txMin; tx <= txMax; tx++) {
      const t = world.tiles[ty * world.w + tx]!;
      const s = tileScreen(game, tx, ty);

      if (isSolid(t.kind)) {
        blitRect(ctx, A.sprite(`tiles/${t.kind}`), s.x, s.y, draw, draw);
      } else {
        blitRect(ctx, backing, s.x, s.y, draw, draw);
        if (t.kind === "wall" || t.kind === "floor" || t.kind === "ladder" || t.kind === "wire") {
          blitRect(ctx, A.sprite(`tiles/${t.kind}`), s.x, s.y, draw, draw);
        } else if (isMachine(t.kind)) {
          if (t.kind === "farm") {
            const f = farmAt(world, tx, ty);
            blitRect(ctx, A.sprite(f && f.ripe ? "machines/farm_ripe" : "machines/farm"), s.x, s.y, draw, draw);
            if (f && f.ripe) machineGlow(ctx, s.x + size / 2, s.y + size / 2, size * 0.7, COL.food);
          } else {
            blitRect(ctx, A.sprite(`machines/${t.kind}`), s.x, s.y, draw, draw);
            const m = machineAt(world, tx, ty);
            if (m && m.running) {
              const glow = t.kind === "diffuser" ? COL.oxygen : t.kind === "generator" ? COL.power : COL.ladderWire;
              machineGlow(ctx, s.x + size / 2, s.y + size / 2, size * 0.8, glow);
            }
          }
        }
      }

      if (t.designated) drawDesignation(ctx, s.x, s.y, size);
      if (t.ghost !== null) drawGhost(ctx, A, t.ghost, s.x, s.y, size, game.stocks.material >= BUILD_COST[t.ghost]);
    }
  }

  // Priority marks: a "do this now" designation shows a bright double-chevron.
  for (const j of game.jobs.list) {
    if (!j.priorityBoost) continue;
    const s = tileScreen(game, j.tx, j.ty);
    drawChevron(ctx, s.x + size / 2, s.y + 5, size * 0.28);
  }

  ctx.restore();
}

function machineGlow(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0, hexA(color, 0.35 + 0.12 * Math.sin(time * 6)));
  g.addColorStop(1, hexA(color, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawDesignation(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  ctx.save();
  ctx.fillStyle = hexA(COL.ladderWire, 0.14);
  ctx.fillRect(x, y, size, size);
  ctx.strokeStyle = hexA(COL.ladderWire, 0.7);
  ctx.setLineDash([4, 3]);
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x + 1.5, y + 1.5, size - 3, size - 3);
  ctx.restore();
}

function drawGhost(ctx: CanvasRenderingContext2D, A: Assets, kind: BuildKind, x: number, y: number, size: number, affordable: boolean): void {
  const draw = Math.ceil(size) + 1;
  ctx.save();
  ctx.globalAlpha = 0.42;
  blitRect(ctx, A.sprite(structureSprite(kind)), x, y, draw, draw);
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = affordable ? hexA(COL.oxygen, 0.75) : hexA(COL.text2, 0.55);
  ctx.setLineDash([3, 3]);
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x + 1.5, y + 1.5, size - 3, size - 3);
  ctx.restore();
}

function drawChevron(ctx: CanvasRenderingContext2D, cx: number, topY: number, s: number): void {
  ctx.save();
  ctx.strokeStyle = COL.power;
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  for (let i = 0; i < 2; i++) {
    const oy = topY + i * s * 0.7;
    ctx.beginPath();
    ctx.moveTo(cx - s, oy + s * 0.6);
    ctx.lineTo(cx, oy);
    ctx.lineTo(cx + s, oy + s * 0.6);
    ctx.stroke();
  }
  ctx.restore();
}

// ---- delvers --------------------------------------------------------------------
// Each living delver draws from the produced sheet matching its Anim, advancing frames on a
// timer and mirroring by `facing`. A delver fleeing bad air flags a pulsing alert.
function drawDelvers(ctx: CanvasRenderingContext2D, game: Game, A: Assets): void {
  const cam = game.world.camera;
  const zoom = cam.zoom;
  const dsz = TILE * zoom * 1.45;

  ctx.save();
  ctx.beginPath();
  ctx.rect(VIEW_X0, VIEW_Y0, VIEW_W, VIEW_H);
  ctx.clip();

  for (const d of game.delvers) {
    if (d.dead) continue;
    const frames = A.delver[d.anim];
    if (!frames || frames.length === 0) continue;
    const frame = frames[Math.floor(d.animT * ANIM_FPS[d.anim]) % frames.length]!;
    const s = worldToScreen(cam, d.px, d.py);

    // Danger tint: a suffocating / low-health delver reads red beneath the sprite.
    const tile = tileAt(game.world, d.tx, d.ty);
    const inDanger = d.act === "flee" || (tile ? !breathableAt(tile) : true) || d.health < HEALTH_MAX * 0.3;
    if (inDanger) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, dsz * 0.5);
      g.addColorStop(0, hexA(COL.alert, 0.35 + 0.15 * Math.sin(time * 10)));
      g.addColorStop(1, hexA(COL.alert, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(s.x, s.y, dsz * 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    blitCentered(ctx, frame, s.x, s.y - dsz * 0.12, dsz, dsz, d.facing === -1);

    if (d.act === "flee") {
      text(ctx, "!", s.x, s.y - dsz * 0.72 + Math.sin(time * 12) * 2, 18, COL.alert, "center", "800");
    }
  }

  ctx.restore();
}

// ---- tool / selection feedback --------------------------------------------------
// The hovered-tile cursor (or the dig-drag rectangle) cues the active tool: dig previews
// legal targets, build previews the held ghost with a legal(green)/illegal(red) ring, cancel
// marks a clearable tile. Only shown while actually playing.
function drawToolCursor(ctx: CanvasRenderingContext2D, game: Game, A: Assets): void {
  if (game.state !== "playing") return;
  const world = game.world;
  const size = TILE * world.camera.zoom;
  const draw = Math.ceil(size) + 1;

  ctx.save();
  ctx.beginPath();
  ctx.rect(VIEW_X0, VIEW_Y0, VIEW_W, VIEW_H);
  ctx.clip();

  if (game.tool === "dig" && dragRect) {
    const x0 = Math.min(dragRect.tx0, dragRect.tx1);
    const x1 = Math.max(dragRect.tx0, dragRect.tx1);
    const y0 = Math.min(dragRect.ty0, dragRect.ty1);
    const y1 = Math.max(dragRect.ty0, dragRect.ty1);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const t = tileAt(world, tx, ty);
        const ok = !!t && canDig(t.kind);
        const s = tileScreen(game, tx, ty);
        ctx.fillStyle = hexA(ok ? COL.oxygen : COL.alert, 0.16);
        ctx.fillRect(s.x, s.y, size, size);
      }
    }
    const a = tileScreen(game, x0, y0);
    const b = tileScreen(game, x1 + 1, y1 + 1);
    ctx.strokeStyle = COL.oxygen;
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
  } else if (game.hoverTx >= 0 && game.hoverTy >= 0) {
    const tx = game.hoverTx;
    const ty = game.hoverTy;
    const s = tileScreen(game, tx, ty);
    const t = tileAt(world, tx, ty);
    if (game.tool === "build" && game.buildKind) {
      const legal = canPlace(world, tx, ty, game.buildKind);
      ctx.save();
      ctx.globalAlpha = legal ? 0.6 : 0.3;
      blitRect(ctx, A.sprite(structureSprite(game.buildKind)), s.x, s.y, draw, draw);
      ctx.restore();
      ctx.strokeStyle = legal ? COL.oxygen : COL.alert;
      ctx.lineWidth = 2;
      ctx.strokeRect(s.x + 1, s.y + 1, size - 2, size - 2);
    } else if (game.tool === "cancel") {
      const has = !!t && (t.designated || t.ghost !== null);
      ctx.strokeStyle = has ? COL.alert : hexA(COL.text3, 0.6);
      ctx.lineWidth = 2;
      ctx.strokeRect(s.x + 1, s.y + 1, size - 2, size - 2);
      ctx.beginPath();
      ctx.moveTo(s.x + 5, s.y + 5);
      ctx.lineTo(s.x + size - 5, s.y + size - 5);
      ctx.moveTo(s.x + size - 5, s.y + 5);
      ctx.lineTo(s.x + 5, s.y + size - 5);
      ctx.stroke();
    } else {
      // dig (single tile)
      const ok = !!t && canDig(t.kind);
      ctx.fillStyle = hexA(ok ? COL.oxygen : COL.text3, 0.14);
      ctx.fillRect(s.x, s.y, size, size);
      ctx.strokeStyle = ok ? COL.oxygen : hexA(COL.text3, 0.6);
      ctx.lineWidth = 2;
      ctx.strokeRect(s.x + 1, s.y + 1, size - 2, size - 2);
    }
  }

  ctx.restore();
}

// ---- top vitals strip -----------------------------------------------------------
function drawTopHud(ctx: CanvasRenderingContext2D, game: Game, A: Assets, clicks: Clickable[]): void {
  ctx.fillStyle = COL.panel;
  ctx.fillRect(0, 0, STAGE_W, TOP_HUD_H);
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, TOP_HUD_H - 0.5);
  ctx.lineTo(STAGE_W, TOP_HUD_H - 0.5);
  ctx.stroke();

  // Alert conditions mirror sim.stepAlarm: a delver in unbreathable air, or a starving crew.
  const suffocating = game.living.some((d) => {
    const t = tileAt(game.world, d.tx, d.ty);
    return !t || !breathableAt(t);
  });
  const starving = game.stocks.food <= 0 && game.living.some((d) => d.hunger >= HUNGER_MAX * 0.999);

  // OXYGEN — average % + lowest %, tinted, red when a delver can't breathe.
  const o2 = Math.round(game.oxygenAvg());
  const lowO2 = Math.round(game.oxygenLow());
  blitRect(ctx, A.sprite("icons/oxygen"), 16, 16, 18, 18);
  text(ctx, "OXYGEN", 40, 15, 9, COL.text3, "left", "700", 1);
  text(ctx, `${o2}%`, 40, 35, 20, suffocating ? COL.alert : COL.oxygen, "left", "700");
  text(ctx, `LOW ${lowO2}%`, 40, 52, 9, lowO2 <= O2_BREATHE_MIN ? COL.alert : COL.text2, "left", "500");

  // CO2 — average.
  blitRect(ctx, A.sprite("icons/co2"), 132, 16, 18, 18);
  text(ctx, "CO2", 156, 15, 9, COL.text3, "left", "700", 1);
  text(ctx, `${Math.round(game.co2Avg())}`, 156, 35, 20, COL.co2, "left", "700");

  // POWER — total supply vs demand across networks + a BROWNOUT flag.
  let supply = 0;
  let demand = 0;
  for (const n of game.networks) {
    supply += n.supply;
    demand += n.demand;
  }
  blitRect(ctx, A.sprite("icons/power"), 232, 16, 18, 18);
  text(ctx, "POWER", 256, 15, 9, COL.text3, "left", "700", 1);
  const barX = 256;
  const barY = 30;
  const barW = 150;
  const barH = 10;
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  roundRect(ctx, barX, barY, barW, barH, 3);
  ctx.fill();
  const frac = supply > 0 ? Math.min(1, demand / supply) : demand > 0 ? 1 : 0;
  ctx.fillStyle = game.brownout ? COL.alert : COL.power;
  roundRect(ctx, barX, barY, Math.max(0, barW * frac), barH, 3);
  ctx.fill();
  text(ctx, `${Math.round(demand)} / ${Math.round(supply)} W`, barX, 52, 9, COL.text2, "left", "500");
  if (game.brownout) text(ctx, "BROWNOUT", barX + barW + 10, 35, 12, COL.alert, "left", "800", 1);

  // STOCKS — ore / material / food icons + counts.
  text(ctx, "STOCKS", 452, 15, 9, COL.text3, "left", "700", 1);
  stock(ctx, A, "items/ore", game.stocks.ore, 452, COL.oreVein);
  stock(ctx, A, "items/material", game.stocks.material, 540, COL.built);
  stock(ctx, A, "items/fungus", game.stocks.food, 628, COL.food);

  // CYCLE — clock (progress through the day) + cycle number.
  text(ctx, "CYCLE", 724, 15, 9, COL.text3, "left", "700", 1);
  clock(ctx, 734, 42, 11, game.cycleClock / CYCLE_SECONDS);
  text(ctx, `${game.cycle}`, 754, 40, 20, COL.text, "left", "700");

  // ALERT chip — prominent when oxygen is critical or the crew is starving.
  if (suffocating || starving) {
    const on = Math.sin(time * 8) > -0.2;
    const ax = 840;
    const aw = 150;
    roundRect(ctx, ax, 14, aw, 36, 8);
    ctx.fillStyle = hexA(COL.alert, on ? 0.28 : 0.12);
    ctx.fill();
    ctx.strokeStyle = COL.alert;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    blitRect(ctx, A.sprite("icons/alert"), ax + 12, 23, 18, 18);
    text(ctx, suffocating ? "LOW OXYGEN" : "STARVING", ax + 38, 33, 12, COL.alert, "left", "800", 0.5);
  }

  // Right-side controls: speed (cycles), in-place pause, mute.
  ctrl(ctx, clicks, 1100, `${game.speed}x`, "speed", COL.text, 52);
  ctrl(ctx, clicks, 1160, game.paused ? "▶" : "❚❚", "pause", game.paused ? COL.alert : COL.text, 44);
  ctrl(ctx, clicks, 1212, muted ? "♪̸" : "♪", "mute", muted ? COL.text3 : COL.text, 44);
}

function stock(ctx: CanvasRenderingContext2D, A: Assets, sprite: string, count: number, x: number, color: string): void {
  blitRect(ctx, A.sprite(sprite), x, 32, 18, 18);
  text(ctx, `${count}`, x + 24, 42, 18, color, "left", "700");
}

// A small clock face whose filled arc shows progress through the current cycle.
function clock(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, frac: number): void {
  ctx.save();
  ctx.strokeStyle = hexA(COL.text3, 0.8);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = hexA(COL.power, 0.85);
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, r - 2, -Math.PI / 2, -Math.PI / 2 + Math.min(1, Math.max(0, frac)) * Math.PI * 2);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function ctrl(ctx: CanvasRenderingContext2D, clicks: Clickable[], x: number, label: string, action: string, color: string, w: number): void {
  const y = 14;
  const h = 36;
  roundRect(ctx, x, y, w, h, 6);
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  ctx.lineWidth = 1;
  ctx.stroke();
  text(ctx, label, x + w / 2, y + h / 2 + 1, 14, color, "center", "600");
  clicks.push({ x, y, w, h, action });
}

// ---- bottom strip: delver roster + build palette --------------------------------
function drawBottomHud(ctx: CanvasRenderingContext2D, game: Game, A: Assets, clicks: Clickable[]): void {
  ctx.fillStyle = COL.panel;
  ctx.fillRect(0, BOTTOM_HUD_Y, STAGE_W, STAGE_H - BOTTOM_HUD_Y);
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, BOTTOM_HUD_Y + 0.5);
  ctx.lineTo(STAGE_W, BOTTOM_HUD_Y + 0.5);
  ctx.stroke();

  drawRoster(ctx, game);
  // Divider between roster and palette.
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.beginPath();
  ctx.moveTo(502.5, BOTTOM_HUD_Y + 8);
  ctx.lineTo(502.5, STAGE_H - 8);
  ctx.stroke();
  drawPalette(ctx, game, A, clicks);
}

function drawRoster(ctx: CanvasRenderingContext2D, game: Game): void {
  const living = game.living;
  const cardW = 158;
  const gap = 6;
  const y = BOTTOM_HUD_Y + 5;
  const h = STAGE_H - BOTTOM_HUD_Y - 10;
  for (let i = 0; i < living.length && i < 3; i++) {
    const d = living[i]!;
    const x = 8 + i * (cardW + gap);
    roundRect(ctx, x, y, cardW, h, 6);
    ctx.fillStyle = "rgba(255,255,255,0.03)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.stroke();

    text(ctx, d.name, x + 8, y + 11, 11, COL.text, "left", "700", 0.5);
    text(ctx, actLabel(d), x + cardW - 8, y + 11, 9, COL.text3, "right", "600", 0.5);

    const bx = x + 34;
    const bw = cardW - 42;
    miniBar(ctx, "HLT", x + 8, bx, y + 22, bw, d.health / HEALTH_MAX, d.health < HEALTH_MAX * 0.3 ? COL.alert : COL.oxygen);
    miniBar(ctx, "STM", x + 8, bx, y + 31, bw, d.stamina / STAMINA_MAX, COL.power);
    // Hunger fills as the delver gets hungrier (full = starving), so it reads worse when full.
    const hf = d.hunger / HUNGER_MAX;
    miniBar(ctx, "FED", x + 8, bx, y + 40, bw, hf, hf > 0.8 ? COL.alert : COL.food);
  }
}

function actLabel(d: Delver): string {
  return d.act.toUpperCase();
}

function miniBar(ctx: CanvasRenderingContext2D, label: string, labelX: number, x: number, y: number, w: number, frac: number, color: string): void {
  text(ctx, label, labelX, y + 3, 7, COL.text3, "left", "600", 0.5);
  const h = 6;
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  roundRect(ctx, x, y, w, h, 2);
  ctx.fill();
  ctx.fillStyle = color;
  roundRect(ctx, x, y, Math.max(0, Math.min(1, frac)) * w, h, 2);
  ctx.fill();
}

// The build palette / tool bar: DIG tool, a button per buildable (produced sprite glyph +
// material cost), the CANCEL tool, and the "builds before digs" PRIORITY toggle. Exactly one
// tool is active; its button is highlighted so the active mode is obvious.
type PaletteEntry =
  | { t: "tool"; tool: Tool; sprite: string; label: string }
  | { t: "build"; kind: BuildKind; sprite: string; label: string }
  | { t: "toggle"; sprite: string; label: string };

const PALETTE: PaletteEntry[] = [
  { t: "tool", tool: "dig", sprite: "icons/dig", label: "DIG" },
  { t: "build", kind: "wall", sprite: "tiles/wall", label: "WALL" },
  { t: "build", kind: "floor", sprite: "tiles/floor", label: "FLOOR" },
  { t: "build", kind: "ladder", sprite: "tiles/ladder", label: "LADDER" },
  { t: "build", kind: "wire", sprite: "tiles/wire", label: "WIRE" },
  { t: "build", kind: "generator", sprite: "machines/generator", label: "GEN" },
  { t: "build", kind: "diffuser", sprite: "machines/diffuser", label: "O2" },
  { t: "build", kind: "pump", sprite: "machines/pump", label: "PUMP" },
  { t: "build", kind: "refinery", sprite: "machines/refinery", label: "REFINE" },
  { t: "build", kind: "farm", sprite: "machines/farm", label: "FARM" },
  { t: "tool", tool: "cancel", sprite: "icons/cancel", label: "CANCEL" },
  { t: "toggle", sprite: "icons/priority", label: "PRIO" },
];

function drawPalette(ctx: CanvasRenderingContext2D, game: Game, A: Assets, clicks: Clickable[]): void {
  const x0 = 512;
  const x1 = STAGE_W - 8;
  const y = BOTTOM_HUD_Y + 5;
  const h = STAGE_H - BOTTOM_HUD_Y - 10;
  const n = PALETTE.length;
  const gap = 5;
  const bw = (x1 - x0 - gap * (n - 1)) / n;

  for (let i = 0; i < n; i++) {
    const e = PALETTE[i]!;
    const x = x0 + i * (bw + gap);
    let active = false;
    let action = "";
    if (e.t === "tool") {
      active = game.tool === e.tool;
      action = `tool:${e.tool}`;
    } else if (e.t === "build") {
      active = game.tool === "build" && game.buildKind === e.kind;
      action = `build:${e.kind}`;
    } else {
      active = game.buildsFirst;
      action = "priority";
    }
    const hover = inRect(pointerX, pointerY, x, y, bw, h);

    roundRect(ctx, x, y, bw, h, 6);
    ctx.fillStyle = active ? hexA(COL.oxygen, 0.16) : hover ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.03)";
    ctx.fill();
    ctx.strokeStyle = active ? COL.oxygen : "rgba(255,255,255,0.10)";
    ctx.lineWidth = active ? 2 : 1;
    ctx.stroke();

    const glyph = A.sprite(e.sprite);
    blitCentered(ctx, glyph, x + bw / 2, y + 20, 26, 26);

    if (e.t === "build") {
      const cost = BUILD_COST[e.kind];
      const afford = game.stocks.material >= cost;
      text(ctx, e.label, x + bw / 2, y + 40, 8, active ? COL.oxygen : COL.text2, "center", "700", 0.3);
      text(ctx, `${cost}`, x + bw / 2, y + 50, 9, afford ? COL.built : COL.alert, "center", "700");
    } else {
      const color = e.t === "toggle" ? (active ? COL.power : COL.text2) : active ? COL.oxygen : COL.text2;
      text(ctx, e.label, x + bw / 2, y + 42, 8, color, "center", "700", 0.3);
      if (e.t === "toggle") text(ctx, active ? "ON" : "OFF", x + bw / 2, y + 50, 8, active ? COL.power : COL.text3, "center", "700");
    }

    clicks.push({ x, y, w: bw, h, action });
  }
}

// ---- milestone toasts -----------------------------------------------------------
function drawMilestones(ctx: CanvasRenderingContext2D, game: Game): void {
  let row = 0;
  for (const m of game.milestones) {
    const alpha = Math.min(1, m.life / 1.2);
    const y = TOP_HUD_H + 24 + row * 34;
    const w = 8 + m.text.length * 9 + 8;
    const x = STAGE_W / 2 - w / 2;
    ctx.save();
    ctx.globalAlpha = alpha;
    roundRect(ctx, x, y - 14, w, 28, 8);
    ctx.fillStyle = hexA(COL.panel, 0.92);
    ctx.fill();
    ctx.strokeStyle = hexA(COL.power, 0.6);
    ctx.lineWidth = 1;
    ctx.stroke();
    text(ctx, m.text, STAGE_W / 2, y, 12, COL.power, "center", "700", 1);
    ctx.restore();
    row++;
  }
}

// ---- title / how-to / overlays --------------------------------------------------
function drawTitle(ctx: CanvasRenderingContext2D, game: Game, A: Assets, clicks: Clickable[]): void {
  // Atmospheric strata band along the bottom from the produced tile sprites.
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.imageSmoothingEnabled = false;
  const kinds = ["dirt", "rock", "ore", "dirt", "rock", "ore", "dirt"];
  const cols = Math.ceil(STAGE_W / 40) + 1;
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < cols; c++) {
      const k = kinds[(r * 3 + c) % kinds.length]!;
      blitRect(ctx, A.sprite(`tiles/${k}`), c * 40, STAGE_H - (4 - r) * 40, 41, 41);
    }
  }
  ctx.restore();
  ctx.fillStyle = "rgba(18,16,12,0.55)";
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);

  const grad = ctx.createLinearGradient(360, 0, 920, 0);
  grad.addColorStop(0, COL.suit);
  grad.addColorStop(0.5, COL.oreVein);
  grad.addColorStop(1, COL.oxygen);
  ctx.save();
  ctx.shadowColor = COL.oxygen;
  ctx.shadowBlur = 24;
  ctx.font = `800 88px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = grad;
  drawSpaced(ctx, "HOLLOWDEEP", STAGE_W / 2, 236, 88, 10);
  ctx.restore();
  text(ctx, game.mode.tagline, STAGE_W / 2, 306, 15, COL.text2, "center", "500", 5);

  const items = menuItems("title", game);
  items.forEach((it, i) => {
    const y = 412 + i * 60;
    const on = highlighted(i, STAGE_W / 2 - 200, y - 26, 400, 52);
    text(ctx, it.label, STAGE_W / 2, y, 28, on ? COL.oxygen : COL.text, "center", "700", 5);
    if (on) {
      text(ctx, "▶", STAGE_W / 2 - 190, y, 18, COL.oxygen, "center", "700");
      text(ctx, "◀", STAGE_W / 2 + 190, y, 18, COL.oxygen, "center", "700");
    }
    clicks.push({ x: STAGE_W / 2 - 200, y: y - 26, w: 400, h: 52, action: it.action });
  });
  text(ctx, "↑↓ SELECT    ENTER CONFIRM    MOUSE OK", STAGE_W / 2, 648, 13, COL.text3, "center", "500", 3);
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

function drawHowto(ctx: CanvasRenderingContext2D, clicks: Clickable[]): void {
  ctx.fillStyle = COL.void;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
  text(ctx, "HOW TO PLAY", STAGE_W / 2, 58, 32, COL.text, "center", "700", 4);
  const lines: [string, string][] = [
    ["GOAL", "Keep a sealed underground crew alive. There is no win screen — survival is open-ended and measured in CYCLES. The colony is LOST when the last delver dies."],
    ["AIR", "The opening cavern holds a finite pocket of breathable OXYGEN. Every delver breathes it and exhales CO2; both diffuse through open space (CO2 sinks, oxygen rises). Left alone the pocket sours and the crew suffocates."],
    ["DIG & REFINE", "Mark DIRT / ORE / ROCK to DIG open (bedrock is indestructible). Mined ore banks to stock; build a REFINERY and a delver operates it to turn ore into MATERIAL — the build currency."],
    ["POWER & OXYGEN", "Build a GENERATOR (burns ore), run WIRE to a DIFFUSER, and the diffuser emits oxygen while powered. Overdraw a network and it BROWNS OUT — every machine on it stops. A PUMP moves gas to clear a soured pocket."],
    ["FOOD", "Delvers get hungry and starve. Build a FUNGUS FARM; it ripens and a delver harvests it for food."],
    ["CONTROLS", "Pick DIG or a building from the bottom palette and click / drag in the colony to place orders — delvers do the labor. CANCEL clears an order; PRIORITY runs builds before digs. Scroll to zoom, drag to pan. 1/2/3 set speed, SPACE pauses in place, ESC opens the menu, M mutes."],
  ];
  let y = 108;
  for (const [k, v] of lines) {
    text(ctx, k, 150, y, 14, COL.oxygen, "left", "700", 1);
    wrap(ctx, v, 330, y, 820, 14, COL.text2);
    y += lineCount(ctx, v, 820, 14) * 20 + 16;
  }
  const bx = STAGE_W / 2 - 90;
  const byy = STAGE_H - 66;
  const on = highlighted(0, bx, byy, 180, 42);
  menuButton(ctx, bx, byy, 180, 42, "BACK", "menu:back", on, clicks);
}

function drawPause(ctx: CanvasRenderingContext2D, game: Game, clicks: Clickable[]): void {
  dim(ctx);
  panelBox(ctx, 440, 200, 400, 320);
  text(ctx, "PAUSED", STAGE_W / 2, 252, 30, COL.text, "center", "700", 4);
  text(ctx, `CYCLE ${game.cycle}`, STAGE_W / 2, 296, 14, COL.text2, "center", "500", 2);
  menuButtons(ctx, menuItems("paused", game), 330, 56, 260, clicks);
}

function drawGameOver(ctx: CanvasRenderingContext2D, game: Game, clicks: Clickable[]): void {
  dim(ctx);
  panelBox(ctx, 400, 176, 480, 372);
  text(ctx, "THE DEEP RECLAIMS THE COLONY", STAGE_W / 2, 224, 14, COL.alert, "center", "700", 2);
  text(ctx, "COLONY LOST", STAGE_W / 2, 272, 42, COL.alert, "center", "800", 2);
  text(ctx, "CYCLES SURVIVED", STAGE_W / 2, 330, 12, COL.text3, "center", "600", 2);
  text(ctx, `${game.score}`, STAGE_W / 2, 366, 48, COL.oxygen, "center", "800");
  text(ctx, `TILES DUG ${game.tilesDug}   ·   MATERIAL BANKED ${game.stocks.material}`, STAGE_W / 2, 416, 13, COL.text2, "center", "500", 1);

  const items = menuItems("gameover", game);
  const xs = [STAGE_W / 2 - 170, STAGE_W / 2 + 10];
  items.forEach((it, i) => {
    const on = highlighted(i, xs[i]!, 460, 160, 46);
    menuButton(ctx, xs[i]!, 460, 160, 46, it.label, it.action, on, clicks);
  });
}

function menuButtons(ctx: CanvasRenderingContext2D, items: MenuItem[], y0: number, gap: number, w: number, clicks: Clickable[]): void {
  const x = STAGE_W / 2 - w / 2;
  items.forEach((it, i) => {
    const y = y0 + i * gap;
    const on = highlighted(i, x, y, w, 44);
    menuButton(ctx, x, y, w, 44, it.label, it.action, on, clicks);
  });
}

function menuButton(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, label: string, action: string, on: boolean, clicks: Clickable[]): void {
  const color = on ? COL.oxygen : COL.text;
  roundRect(ctx, x, y, w, h, 6);
  ctx.fillStyle = on ? hexA(color, 0.14) : "rgba(255,255,255,0.03)";
  ctx.fill();
  ctx.strokeStyle = on ? color : "rgba(255,255,255,0.10)";
  ctx.lineWidth = on ? 2 : 1;
  ctx.stroke();
  text(ctx, label, x + w / 2, y + h / 2 + 1, 14, color, "center", "700", 1);
  clicks.push({ x, y, w, h, action });
}

function highlighted(i: number, x: number, y: number, w: number, h: number): boolean {
  return menuIndex === i || inRect(pointerX, pointerY, x, y, w, h);
}

function dim(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = "rgba(10,8,6,0.72)";
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
