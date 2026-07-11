// Meltdown — all canvas drawing. Reads the Game's public state and paints the
// reactor floor, the towers (glowing along the heat ramp), the surge, the build
// panel/HUD, and the menu overlays, in the palette and type of specs/overview.md
// and the reference mockups. Drawing happens in logical 1280x720 space (main.ts
// installs the fit/letterbox transform).

import { heatColor, rgba } from "./colors";
import {
  C,
  CASING,
  COLS,
  FLOOR_H,
  FLOOR_W,
  FLOOR_X0,
  FLOOR_X1,
  FLOOR_Y0,
  FLOOR_Y1,
  MONO,
  PANEL_W,
  PANEL_X,
  REACTOR_W,
  REDLINE,
  ROWS,
  STAGE_H,
  STAGE_W,
  TILE,
} from "./constants";
import { isEmitterDef, SURGE_DEFS, TOWER_DEFS, type EmitterDef, type TowerDef } from "./defs";
import type { Game, MenuHit } from "./game";
import { END_ITEMS, PAUSE_ITEMS, TITLE_ITEMS } from "./game";
import { DIFFICULTIES, MODE_ENTRIES, type MenuEntry } from "./modes";
import type { Tower } from "./towers";
import type { Side, SurgeType, TowerType } from "./types";
import { rotateSide, TOWER_ORDER } from "./types";
import {
  ctlRect,
  INSPECTOR,
  PANEL_INNER_R,
  PANEL_INNER_W,
  PANEL_INNER_X,
  READOUTS_Y,
  sellBtnRect,
  sendBtnRect,
  SHOP_TITLE_Y,
  shopItemRect,
  upgradeBtnRect,
  type Rect,
} from "./ui";
import { isBossWave, onslaughtPreview, wavePreview } from "./waves";

const TYPE_COLOR: Record<TowerType, string> = {
  arc: C.warm,
  stutter: C.hot,
  lance: C.cold,
  bloom: C.hot,
  rime: C.rime,
  flak: C.warm,
  forge: C.forge,
  sink: C.sink,
};

const ROMAN = ["", "I", "II", "III"];

type Ctx = CanvasRenderingContext2D;

// ---- Text helpers ---------------------------------------------------------

function setFont(ctx: Ctx, size: number, weight = 400): void {
  ctx.font = `${weight} ${size}px ${MONO}`;
}

function text(
  ctx: Ctx,
  str: string,
  x: number,
  y: number,
  size: number,
  color: string,
  align: CanvasTextAlign = "left",
  weight = 400,
): void {
  setFont(ctx, size, weight);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(str, x, y);
}

// Draw letter-spaced text centred at cx; returns total width for hit-testing.
function spaced(
  ctx: Ctx,
  str: string,
  cx: number,
  y: number,
  size: number,
  color: string,
  spacing: number,
  weight = 400,
): number {
  setFont(ctx, size, weight);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  let total = 0;
  for (const ch of str) total += ctx.measureText(ch).width + spacing;
  total -= spacing;
  let x = cx - total / 2;
  ctx.fillStyle = color;
  for (const ch of str) {
    ctx.fillText(ch, x, y);
    x += ctx.measureText(ch).width + spacing;
  }
  return total;
}

function rr(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

// ---- Entry point ----------------------------------------------------------

export function render(ctx: Ctx, game: Game): void {
  ctx.clearRect(0, 0, STAGE_W, STAGE_H);
  ctx.fillStyle = C.steel;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);

  game.menuHits = [];

  const menuScreen =
    game.state === "title" ||
    game.state === "howto" ||
    game.state === "modeselect" ||
    game.state === "difficulty";
  if (menuScreen) {
    // The menu screens have no build panel, so extend the reactor field across
    // the whole stage — a full-screen field reads as one continuous floor behind
    // the menu instead of stopping short where the (absent) HUD would sit.
    drawFloorBase(ctx, true);
    // The title shows a dim slice of reactor floor with glowing towers behind
    // the menu; the other menus keep a clean floor so the text stays legible.
    if (game.state === "title") for (const t of game.towers) drawTower(ctx, game, t);
    ctx.fillStyle = rgba(C.steel, game.state === "title" ? 0.6 : 0.82);
    ctx.fillRect(0, 0, STAGE_W, STAGE_H);
    if (game.state === "title") drawTitle(ctx, game);
    else if (game.state === "howto") drawHowTo(ctx);
    else if (game.state === "modeselect") drawModeSelect(ctx, game);
    else drawDifficulty(ctx, game);
    return;
  }

  // In-match (also frozen behind pause / end overlays).
  drawFloorBase(ctx);
  drawOpenings(ctx, game);
  drawBuildZone(ctx, game);
  for (const t of game.towers) drawTower(ctx, game, t);
  drawRangeRings(ctx, game);
  drawPreview(ctx, game);
  for (const u of game.surge) drawSurge(ctx, u);
  drawShots(ctx, game);
  drawPanel(ctx, game);

  if (game.state === "paused") drawPauseCard(ctx, game);
  else if (game.state === "victory") drawEndCard(ctx, game, true);
  else if (game.state === "gameover") drawEndCard(ctx, game, false);
}

// ---- Reactor: casing wall, floor, and openings ----------------------------

// The reactor floor is inset within an 18-px casing wall (specs/playfield.md):
// a heavy steel shell around the dark tile floor, with a lit inner rim. During
// play the field fills only the reactor region (the build panel owns the right
// strip); on the panel-less menu, `fullStage` extends the field across the whole
// stage so it reads as one continuous floor.
function drawFloorBase(ctx: Ctx, fullStage = false): void {
  const regionW = fullStage ? STAGE_W : REACTOR_W;
  const floorW = fullStage ? STAGE_W - 2 * CASING : FLOOR_W;
  const floorX1 = FLOOR_X0 + floorW;

  // Casing wall fills the region; the floor is inset inside it.
  ctx.fillStyle = C.casing;
  ctx.fillRect(0, 0, regionW, STAGE_H);

  // The dark tile floor.
  ctx.fillStyle = C.steel;
  ctx.fillRect(FLOOR_X0, FLOOR_Y0, floorW, FLOOR_H);

  // Faint tile grid, clipped to the floor.
  ctx.save();
  ctx.beginPath();
  ctx.rect(FLOOR_X0, FLOOR_Y0, floorW, FLOOR_H);
  ctx.clip();
  ctx.strokeStyle = C.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  const cols = Math.ceil(floorW / TILE);
  for (let c = 0; c <= cols; c++) {
    const x = FLOOR_X0 + c * TILE;
    ctx.moveTo(x + 0.5, FLOOR_Y0);
    ctx.lineTo(x + 0.5, FLOOR_Y1);
  }
  for (let r = 0; r <= ROWS; r++) {
    const y = FLOOR_Y0 + r * TILE;
    ctx.moveTo(FLOOR_X0, y + 0.5);
    ctx.lineTo(floorX1, y + 0.5);
  }
  ctx.stroke();
  ctx.restore();

  // Lit inner rim where the casing meets the floor.
  ctx.strokeStyle = C.casingRim;
  ctx.lineWidth = 2;
  ctx.strokeRect(FLOOR_X0 - 1, FLOOR_Y0 - 1, floorW + 2, FLOOR_H + 2);
}

// The four openings cut into the casing wall — two vents (cool blue) and two
// exhausts (hazard-striped) — sized from their tile counts (specs/playfield.md).
function drawOpenings(ctx: Ctx, game: Game): void {
  const vent = (x: number, y: number, w: number, h: number) => {
    // A gap in the casing: floor-dark, glowing cool blue.
    ctx.fillStyle = C.steel;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = rgba(C.vent, 0.35);
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = C.vent;
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
  };
  const exhaust = (x: number, y: number, w: number, h: number) => {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.fillStyle = C.steel;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = rgba(C.exhaust, 0.2);
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = rgba(C.hazard, 0.6);
    ctx.lineWidth = 5;
    ctx.beginPath();
    for (let d = -h; d < w + h; d += 12) {
      ctx.moveTo(x + d, y);
      ctx.lineTo(x + d + h, y + h);
    }
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = C.exhaust;
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
  };
  // Positions and widths from the grid's edge tiles, drawn in the casing band
  // on that side (specs/playfield.md): each opening spans its own tile count —
  // the side vents four tiles, the wider top/bottom openings eight.
  const g = game.grid;
  const rowOf = (i: number) => Math.floor(i / COLS);
  const colOf = (i: number) => i % COLS;
  const spanOf = (tiles: number[]) => tiles.length * TILE;
  vent(0, FLOOR_Y0 + rowOf(g.leftVent.tiles[0]) * TILE, CASING, spanOf(g.leftVent.tiles));
  vent(FLOOR_X0 + colOf(g.topVent.tiles[0]) * TILE, 0, spanOf(g.topVent.tiles), CASING);
  exhaust(FLOOR_X1, FLOOR_Y0 + rowOf(g.rightExhaust.tiles[0]) * TILE, CASING, spanOf(g.rightExhaust.tiles));
  exhaust(FLOOR_X0 + colOf(g.bottomExhaust.tiles[0]) * TILE, FLOOR_Y1, spanOf(g.bottomExhaust.tiles), CASING);
}

// Bottleneck (specs/modes.md): only the marked core zone is buildable. Dim the
// off-limits floor and outline the zone with a hazard-dashed border so the player
// can read where they may build.
function drawBuildZone(ctx: Ctx, game: Game): void {
  const z = game.cfg.buildZone;
  if (!z) return;
  const zx = FLOOR_X0 + z.c0 * TILE;
  const zy = FLOOR_Y0 + z.r0 * TILE;
  const zw = (z.c1 - z.c0 + 1) * TILE;
  const zh = (z.r1 - z.r0 + 1) * TILE;

  // Dim the off-limits area (the whole floor minus the zone), via even-odd fill.
  ctx.save();
  ctx.beginPath();
  ctx.rect(FLOOR_X0, FLOOR_Y0, FLOOR_W, FLOOR_H);
  ctx.rect(zx, zy, zw, zh);
  ctx.fillStyle = rgba("#0a0c10", 0.5);
  ctx.fill("evenodd");
  ctx.restore();

  // Zone border.
  ctx.save();
  ctx.setLineDash([8, 6]);
  ctx.strokeStyle = rgba(C.ok, 0.7);
  ctx.lineWidth = 2;
  ctx.strokeRect(zx + 1, zy + 1, zw - 2, zh - 2);
  ctx.restore();
  text(ctx, "BUILD ZONE", zx + 6, zy + 15, 10, rgba(C.ok, 0.85), "left", 700);
}

// ---- Towers ---------------------------------------------------------------

function towerFill(game: Game, t: Tower): string {
  if (t.type === "forge") return C.forge;
  if (t.type === "sink") return "#3a444f";
  if (t.type === "rime") return C.rime;
  if (t.tripped) {
    // Strobing red while offline.
    return Math.floor(game.simTime * 12) % 2 === 0 ? C.trip : "#5a0d0d";
  }
  return heatColor(t.heat);
}

// Draw the radiator "fin" markers along a tower's world radiator faces — the
// cool edges through which it sheds heat (specs/heat.md). Aiming these at open
// air is how the player controls cooling.
function drawRadiatorFaces(ctx: Ctx, rad: Set<Side>, x0: number, y0: number, S: number): void {
  if (rad.size === 0) return;
  ctx.save();
  ctx.strokeStyle = C.rime;
  ctx.lineWidth = 2;
  const inset = 3.5;
  const fin = (a: number, b: number, horiz: boolean, at: number) => {
    // Short perpendicular ticks along the face to read as a heatsink.
    const n = Math.max(2, Math.round((b - a) / 7));
    ctx.beginPath();
    for (let k = 0; k <= n; k++) {
      const p = a + ((b - a) * k) / n;
      if (horiz) {
        ctx.moveTo(p, at);
        ctx.lineTo(p, at + (at < y0 + S / 2 ? 4 : -4));
      } else {
        ctx.moveTo(at, p);
        ctx.lineTo(at + (at < x0 + S / 2 ? 4 : -4), p);
      }
    }
    ctx.stroke();
  };
  if (rad.has("N")) fin(x0 + 4, x0 + S - 4, true, y0 + inset);
  if (rad.has("S")) fin(x0 + 4, x0 + S - 4, true, y0 + S - inset);
  if (rad.has("W")) fin(y0 + 4, y0 + S - 4, false, x0 + inset);
  if (rad.has("E")) fin(y0 + 4, y0 + S - 4, false, x0 + S - inset);
  ctx.restore();
}

function drawTower(ctx: Ctx, game: Game, t: Tower): void {
  const S = t.size * TILE; // footprint side (px)
  const x0 = FLOOR_X0 + t.col * TILE;
  const y0 = FLOOR_Y0 + t.row * TILE;
  const bx0 = x0 + 2;
  const by0 = y0 + 2;
  const bs = S - 4;
  const fill = towerFill(game, t);

  ctx.save();
  ctx.shadowColor = fill;
  ctx.shadowBlur =
    t.type === "sink" ? 10 : t.tripped ? 20 : t.isEmitter ? 8 + t.heatFrac() * 20 : 18;
  ctx.fillStyle = fill;
  rr(ctx, bx0, by0, bs, bs, 6);
  ctx.fill();
  ctx.restore();

  // Lit highlight for a 3-D read.
  const grad = ctx.createRadialGradient(t.cx, t.cy - 6, 2, t.cx, t.cy + 4, S);
  grad.addColorStop(0, rgba("#ffffff", 0.32));
  grad.addColorStop(1, rgba("#ffffff", 0));
  ctx.fillStyle = grad;
  rr(ctx, bx0, by0, bs, bs, 6);
  ctx.fill();

  ctx.strokeStyle = rgba("#ffffff", 0.14);
  ctx.lineWidth = 1.5;
  rr(ctx, bx0, by0, bs, bs, 6);
  ctx.stroke();

  // Radiator faces (emitters).
  if (t.isEmitter) drawRadiatorFaces(ctx, t.worldRadiators(), x0, y0, S);

  // Glyph, scaled up a touch for bigger footprints.
  const glyphColor = t.type === "sink" ? C.sink : "#15181d";
  text(ctx, t.def.glyph, t.cx, t.cy + 6, 14 + (t.size - 2) * 5, glyphColor, "center", 700);

  // Heat read on the footprint (emitters, incl. Rime) — a short bar with the
  // per-tower redline marker at its max-efficiency point.
  if (t.isEmitter) {
    const bx = x0 + 5;
    const by = y0 + S - 8;
    const bw = S - 10;
    ctx.fillStyle = rgba("#ffffff", 0.14);
    rr(ctx, bx, by, bw, 4, 2);
    ctx.fill();
    const frac = Math.max(0, Math.min(1, t.heatFrac()));
    ctx.fillStyle = t.tripped ? C.trip : t.type === "rime" ? C.rime : heatColor(t.heat);
    rr(ctx, bx, by, Math.max(1, bw * frac), 4, 2);
    ctx.fill();
    // Redline marker (skip for the heat-averse Rime, whose redline is the trip).
    if (t.redline < 100) {
      const rx = bx + bw * (t.redline / 100);
      ctx.strokeStyle = C.trip;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(rx, by - 2);
      ctx.lineTo(rx, by + 6);
      ctx.stroke();
    }
  }

  if (t.tripped) {
    text(ctx, "OFFLINE", t.cx, y0 - 4, 8, C.trip, "center", 700);
  }
}

function drawRangeRings(ctx: Ctx, game: Game): void {
  const t = game.selected;
  if (!t || !isEmitterDef(t.def)) return;
  const r = t.stats().range * TILE;
  ctx.save();
  ctx.setLineDash([6, 6]);
  ctx.strokeStyle = rgba(C.text, 0.45);
  ctx.fillStyle = rgba(C.text, 0.05);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(t.cx, t.cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawPreview(ctx: Ctx, game: Game): void {
  const p = game.preview;
  if (!p || !game.armed) return;
  const def = TOWER_DEFS[game.armed];
  const size = def.size;
  const S = size * TILE;
  const x0 = FLOOR_X0 + p.col * TILE;
  const y0 = FLOOR_Y0 + p.row * TILE;
  const cx = x0 + S / 2;
  const cy = y0 + S / 2;
  const col = p.valid ? C.ok : C.bad;
  // Footprint highlight.
  ctx.fillStyle = rgba(col, 0.25);
  ctx.fillRect(x0, y0, S, S);
  ctx.strokeStyle = col;
  ctx.lineWidth = 2;
  ctx.strokeRect(x0 + 1, y0 + 1, S - 2, S - 2);
  // Radiator faces at the held rotation, so the player can aim them before placing.
  if (isEmitterDef(def)) {
    const rad = new Set<Side>(def.radiators.map((s) => rotateSide(s, game.armedRot)));
    drawRadiatorFaces(ctx, rad, x0, y0, S);
    // Range ring (emitters).
    ctx.save();
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = rgba(col, 0.7);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, def.range * TILE, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

// ---- Surge ----------------------------------------------------------------

function drawSurge(ctx: Ctx, u: import("./surge").Surge): void {
  const d = u.def;
  const x = u.x;
  const y = u.y;
  ctx.save();
  ctx.shadowBlur = 8;
  switch (u.type) {
    case "mote":
      ctx.shadowColor = C.ground;
      ctx.fillStyle = C.ground;
      rr(ctx, x - d.radius, y - d.radius, d.radius * 2, d.radius * 2, 5);
      ctx.fill();
      break;
    case "sprint":
      ctx.shadowColor = "#d6f25a";
      ctx.fillStyle = "#d6f25a";
      ctx.beginPath();
      ctx.arc(x, y, d.radius, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "hulk":
      ctx.shadowColor = "#6fae2e";
      ctx.fillStyle = "#6fae2e";
      rr(ctx, x - d.radius, y - d.radius, d.radius * 2, d.radius * 2, 4);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "#c7f06a";
      ctx.lineWidth = 2;
      rr(ctx, x - d.radius, y - d.radius, d.radius * 2, d.radius * 2, 4);
      ctx.stroke();
      break;
    case "swarm":
      ctx.shadowColor = "#b6f04a";
      ctx.fillStyle = "#b6f04a";
      ctx.beginPath();
      ctx.arc(x, y, d.radius, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "drift":
      ctx.shadowColor = C.flyer;
      ctx.fillStyle = C.flyer;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.PI / 4);
      rr(ctx, -d.radius * 0.72, -d.radius * 0.72, d.radius * 1.44, d.radius * 1.44, 2);
      ctx.fill();
      ctx.restore();
      break;
    case "core": {
      const g = ctx.createRadialGradient(x, y - 4, 3, x, y, d.radius);
      g.addColorStop(0, "#b46bff");
      g.addColorStop(1, C.boss);
      ctx.shadowColor = C.boss;
      ctx.shadowBlur = 18;
      ctx.fillStyle = g;
      rr(ctx, x - d.radius, y - d.radius, d.radius * 2, d.radius * 2, 8);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "#d7b3ff";
      ctx.lineWidth = 2;
      rr(ctx, x - d.radius, y - d.radius, d.radius * 2, d.radius * 2, 8);
      ctx.stroke();
      break;
    }
  }
  ctx.restore();

  // Health bar.
  const bw = d.radius * 2;
  const bx = x - d.radius;
  const by = y - d.radius - 7;
  ctx.fillStyle = rgba(C.steel, 0.85);
  ctx.fillRect(bx, by, bw, 3);
  ctx.fillStyle = C.hp;
  ctx.fillRect(bx, by, bw * Math.max(0, u.hp / u.maxHp), 3);
}

function drawShots(ctx: Ctx, game: Game): void {
  ctx.lineCap = "round";
  for (const s of game.shots) {
    ctx.strokeStyle = s.color;
    ctx.globalAlpha = Math.max(0, Math.min(1, s.life / 0.07));
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(s.x1, s.y1);
    ctx.lineTo(s.x2, s.y2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

// ---- Build panel / HUD ----------------------------------------------------

function drawPanel(ctx: Ctx, game: Game): void {
  ctx.fillStyle = C.panel;
  ctx.fillRect(PANEL_X, 0, PANEL_W, STAGE_H);
  ctx.strokeStyle = C.edge;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(PANEL_X + 1, 0);
  ctx.lineTo(PANEL_X + 1, STAGE_H);
  ctx.stroke();

  drawReadouts(ctx, game);
  drawShop(ctx, game);
  // Inspector area precedence (specs/playfield.md): hovering a shop tower shows
  // that type's info; otherwise a selected tower's inspector; otherwise the
  // next-wave preview.
  if (game.hoveredShop) drawShopInfo(ctx, game, game.hoveredShop);
  else if (game.selected) drawInspector(ctx, game, game.selected);
  else drawNextWave(ctx, game);
  drawWaveControls(ctx, game);
}

// The targeting read shown for every tower (specs/towers.md): all emitters hit
// ground and air, except the air-only Flak; the Forge and Sink never fire.
function targetsLabel(def: TowerDef): string {
  if (!isEmitterDef(def)) return "NONE";
  return (def as EmitterDef).airOnly ? "AIR ONLY" : "AIR + GROUND";
}

function readout(ctx: Ctx, label: string, value: string, x: number, valueColor: string, align: CanvasTextAlign): void {
  text(ctx, label, x, READOUTS_Y + 10, 10, C.textFaint, align, 400);
  text(ctx, value, x, READOUTS_Y + 32, 21, valueColor, align, 700);
}

function drawReadouts(ctx: Ctx, game: Game): void {
  readout(ctx, "MONEY", String(game.money), PANEL_INNER_X, C.money, "left");
  readout(ctx, "LIVES", String(game.lives), (PANEL_INNER_X + PANEL_INNER_R) / 2, C.text, "center");
  if (game.cfg.onslaught) {
    const remaining = Math.max(0, 100 - game.kills - game.leakCount);
    readout(ctx, "SURGE", `${remaining} left`, PANEL_INNER_R, C.text, "right");
  } else {
    readout(ctx, "WAVE", `${game.waveNumber} / ${game.totalWaves}`, PANEL_INNER_R, C.text, "right");
  }

  // Divider + a phase progress read.
  const dy = READOUTS_Y + 46;
  ctx.strokeStyle = C.edge;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PANEL_INNER_X, dy);
  ctx.lineTo(PANEL_INNER_R, dy);
  ctx.stroke();

  const barY = dy + 8;
  ctx.fillStyle = rgba("#ffffff", 0.08);
  rr(ctx, PANEL_INNER_X, barY, PANEL_INNER_W, 5, 2);
  ctx.fill();
  if (game.phase === "build") {
    if (game.openingPhase) {
      // Untimed opening phase — no countdown; the player starts when ready.
      ctx.fillStyle = C.vent;
      rr(ctx, PANEL_INNER_X, barY, PANEL_INNER_W, 5, 2);
      ctx.fill();
      text(ctx, "BUILD YOUR OPENING MAZE — PRESS START", PANEL_INNER_X, barY + 20, 10, C.textDim, "left", 400);
    } else {
      const frac = Math.max(0, Math.min(1, game.buildTimer / 15));
      ctx.fillStyle = C.hazard;
      rr(ctx, PANEL_INNER_X, barY, PANEL_INNER_W * frac, 5, 2);
      ctx.fill();
      text(ctx, `NEXT WAVE IN ${Math.ceil(game.buildTimer)}s`, PANEL_INNER_X, barY + 20, 10, C.textDim, "left", 400);
    }
  } else {
    // Rough progress: killed/leaked fraction of the wave.
    ctx.fillStyle = C.exhaust;
    rr(ctx, PANEL_INNER_X, barY, PANEL_INNER_W * waveProgress(game), 5, 2);
    ctx.fill();
    text(ctx, "WAVE IN PROGRESS", PANEL_INNER_X, barY + 20, 10, C.textDim, "left", 400);
  }
}

function waveProgress(game: Game): number {
  // Cosmetic: how far into the spawn schedule we are, minus what's still alive.
  const spawned = game.surge.length;
  return spawned === 0 ? 0.5 : Math.max(0.05, Math.min(1, 1 - spawned / (spawned + 6)));
}

function drawShop(ctx: Ctx, game: Game): void {
  text(ctx, "SHOP", PANEL_INNER_X, SHOP_TITLE_Y, 11, C.textDim, "left", 700);
  for (let k = 0; k < TOWER_ORDER.length; k++) {
    const type = TOWER_ORDER[k];
    const def = TOWER_DEFS[type];
    const r = shopItemRect(k);
    const afford = game.money >= def.cost;
    const armed = game.armed === type;

    ctx.globalAlpha = afford ? 1 : 0.4;
    ctx.fillStyle = "#232a33";
    rr(ctx, r.x, r.y, r.w, r.h, 8);
    ctx.fill();
    ctx.strokeStyle = armed ? C.ok : C.edge;
    ctx.lineWidth = armed ? 2 : 1;
    if (armed) {
      ctx.save();
      ctx.shadowColor = C.ok;
      ctx.shadowBlur = 10;
    }
    rr(ctx, r.x, r.y, r.w, r.h, 8);
    ctx.stroke();
    if (armed) ctx.restore();

    // Icon, sized to the footprint so 2/3/4 read at a glance.
    const iw = 12 + (def.size - 2) * 5;
    ctx.fillStyle = TYPE_COLOR[type];
    rr(ctx, r.x + r.w / 2 - iw / 2, r.y + 6, iw, 16, 4);
    ctx.fill();
    text(ctx, def.glyph, r.x + r.w / 2, r.y + 19, 12, "#15181d", "center", 700);
    // Size badge (top-left).
    text(ctx, `${def.size}x${def.size}`, r.x + 4, r.y + 11, 7, C.textFaint, "left", 700);
    text(ctx, def.name, r.x + r.w / 2, r.y + 36, 7.5, C.textDim, "center", 400);
    text(ctx, String(def.cost), r.x + r.w / 2, r.y + 48, 9, C.money, "center", 700);
    ctx.globalAlpha = 1;
  }
}

function statRow(ctx: Ctx, label: string, value: string, y: number): void {
  text(ctx, label, INSPECTOR.x + 12, y, 11, C.textDim, "left", 400);
  text(ctx, value, INSPECTOR.x + INSPECTOR.w - 12, y, 11, C.text, "right", 700);
}

function drawInspector(ctx: Ctx, game: Game, t: Tower): void {
  ctx.fillStyle = "#20262e";
  rr(ctx, INSPECTOR.x, INSPECTOR.y, INSPECTOR.w, INSPECTOR.h, 10);
  ctx.fill();
  ctx.strokeStyle = C.edge;
  ctx.lineWidth = 1;
  rr(ctx, INSPECTOR.x, INSPECTOR.y, INSPECTOR.w, INSPECTOR.h, 10);
  ctx.stroke();

  const ix = INSPECTOR.x + 12;
  text(ctx, t.def.name, ix, INSPECTOR.y + 24, 14, C.text, "left", 700);
  text(ctx, `LV ${ROMAN[t.level]}`, INSPECTOR.x + INSPECTOR.w - 12, INSPECTOR.y + 24, 11, C.money, "right", 700);

  let y = INSPECTOR.y + 52;
  if (isEmitterDef(t.def)) {
    const s = t.stats();
    statRow(ctx, "SIZE", `${t.size}x${t.size}`, y);
    y += 20;
    statRow(ctx, "RANGE", `${s.range.toFixed(1)} tiles`, y);
    y += 20;
    if (t.isRime) {
      const slow = s.slowCeil * (1 - t.heat / REDLINE);
      statRow(ctx, "SLOW", `${Math.round(slow * 100)}% (cold ${Math.round(s.slowCeil * 100)}%)`, y);
    } else {
      const dmg = Math.round(game.liveDamage(t));
      statRow(ctx, "DAMAGE", `${dmg} (x${game.damageMultiplier(t).toFixed(1)} heat)`, y);
    }
    y += 20;
    statRow(ctx, "RATE", `${s.fireRate.toFixed(1)} / s`, y);
    y += 20;
    // Targeting: every emitter hits ground and air, except the air-only Flak
    // (specs/towers.md).
    statRow(ctx, "TARGETS", targetsLabel(t.def), y);
    y += 20;
    if ((t.def as EmitterDef).splash) {
      statRow(ctx, "SPLASH", `${(t.def as EmitterDef).splash!.toFixed(1)} tiles`, y);
    } else {
      statRow(ctx, "MASS", `${(t.def as EmitterDef).mass.toFixed(1)}`, y);
    }
    y += 20;
    // Radiator faces at the current orientation.
    const rad = [...t.worldRadiators()];
    const order = ["N", "E", "S", "W"].filter((sd) => rad.includes(sd as Side));
    statRow(ctx, "RADIATORS", order.join(" · ") || "—", y);
    y += 20;

    // Instance tallies (specs/playfield.md): this tower's kills and total damage.
    statRow(ctx, "KILLS", String(t.kills), y);
    y += 20;
    statRow(ctx, "DMG DEALT", String(Math.round(t.damageDealt)), y);
    y += 20;

    // Heat meter, with the per-tower redline (max-efficiency) marker.
    const hy = y + 8;
    const effLabel = t.isRime ? "" : t.heat >= t.redline ? "  ▲ MAX" : "";
    text(ctx, `HEAT — ${Math.round(t.heat)}%${effLabel}`, ix, hy, 10, C.textFaint, "left", 400);
    const mw = INSPECTOR.w - 24;
    const my = hy + 6;
    ctx.fillStyle = rgba("#ffffff", 0.1);
    rr(ctx, ix, my, mw, 9, 5);
    ctx.fill();
    const g = ctx.createLinearGradient(ix, 0, ix + mw, 0);
    g.addColorStop(0, C.cold);
    g.addColorStop(0.5, C.warm);
    g.addColorStop(0.8, C.hot);
    g.addColorStop(1, C.white);
    ctx.fillStyle = t.tripped ? C.trip : g;
    rr(ctx, ix, my, mw * Math.max(0, Math.min(1, t.heatFrac())), 9, 5);
    ctx.fill();
    // Redline (max-efficiency) marker at the tower's own redline.
    const rx = ix + mw * (t.redline / 100);
    ctx.strokeStyle = C.trip;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(rx, my - 2);
    ctx.lineTo(rx, my + 11);
    ctx.stroke();
    text(ctx, t.isRime ? "TRIP" : "REDLINE", rx, my + 22, 8, C.trip, "center", 700);
    if (t.tripped) text(ctx, "OFFLINE — TRIPPED", ix, my + 22, 9, C.trip, "left", 700);
  } else {
    // Mover.
    const out = t.moverOutput();
    if (t.type === "forge") {
      statRow(ctx, "SETPOINT", `${out}% heat`, y);
      y += 20;
      statRow(ctx, "MODE", "thermostat", y);
    } else {
      statRow(ctx, "COOLING", `+${out} / edge`, y);
      y += 20;
      statRow(ctx, "MODE", "coolant loop", y);
    }
    y += 20;
    statRow(ctx, "CONTACT", "shared faces", y);
    y += 20;
    // Movers never fire (specs/towers.md), so their targeting and tallies read as
    // none — shown for parity with the emitter inspector (specs/playfield.md).
    statRow(ctx, "TARGETS", targetsLabel(t.def), y);
    y += 20;
    statRow(ctx, "KILLS", String(t.kills), y);
    y += 20;
    statRow(ctx, "DMG DEALT", String(Math.round(t.damageDealt)), y);
    y += 20;
    let dy = y + 14;
    for (const wl of wrapLines(ctx, t.def.desc, 10, INSPECTOR.w - 24)) {
      text(ctx, wl, ix, dy, 10, C.textFaint, "left", 400);
      dy += 15;
    }
  }

  // Actions. (A placed tower cannot be rotated — orientation is chosen on the
  // held preview before placing, specs/controls.md — so there is no rotate action.)
  const up = upgradeBtnRect();
  const sell = sellBtnRect();
  const canUp = t.level < 3 && game.money >= game.upgradeCostOf(t);
  ctx.fillStyle = "#232a33";
  rr(ctx, up.x, up.y, up.w, up.h, 7);
  ctx.fill();
  ctx.strokeStyle = t.level < 3 ? rgba(C.ok, 0.6) : C.edge;
  ctx.lineWidth = 1;
  rr(ctx, up.x, up.y, up.w, up.h, 7);
  ctx.stroke();
  ctx.globalAlpha = canUp ? 1 : 0.5;
  const upLabel = t.level >= 3 ? "MAX" : `UP ${game.upgradeCostOf(t)}`;
  text(ctx, upLabel, up.x + up.w / 2, up.y + 21, 11, t.level < 3 ? C.ok : C.textDim, "center", 700);
  ctx.globalAlpha = 1;

  ctx.fillStyle = "#232a33";
  rr(ctx, sell.x, sell.y, sell.w, sell.h, 7);
  ctx.fill();
  ctx.strokeStyle = C.edge;
  rr(ctx, sell.x, sell.y, sell.w, sell.h, 7);
  ctx.stroke();
  text(ctx, `SELL ${game.sellRefundOf(t)}`, sell.x + sell.w / 2, sell.y + 21, 11, C.money, "center", 700);
}

function drawNextWave(ctx: Ctx, game: Game): void {
  ctx.fillStyle = "#20262e";
  rr(ctx, INSPECTOR.x, INSPECTOR.y, INSPECTOR.w, INSPECTOR.h, 10);
  ctx.fill();
  ctx.strokeStyle = C.edge;
  ctx.lineWidth = 1;
  rr(ctx, INSPECTOR.x, INSPECTOR.y, INSPECTOR.w, INSPECTOR.h, 10);
  ctx.stroke();

  const ix = INSPECTOR.x + 12;
  const onslaught = game.cfg.onslaught;
  const previewWave = game.phase === "build" ? game.waveNumber : Math.min(game.totalWaves, game.waveNumber + 1);
  text(ctx, game.phase === "build" ? "NEXT WAVE" : "CURRENT WAVE", ix, INSPECTOR.y + 24, 12, C.textDim, "left", 700);
  text(ctx, onslaught ? "THE HUNDRED" : `WAVE ${previewWave}`, ix, INSPECTOR.y + 46, 16, C.text, "left", 700);
  if (onslaught) {
    text(ctx, "⚠ 100 UNITS", INSPECTOR.x + INSPECTOR.w - 12, INSPECTOR.y + 46, 11, C.exhaust, "right", 700);
  } else if (isBossWave(previewWave, game.totalWaves)) {
    text(ctx, "⚠ CORE BOSS", INSPECTOR.x + INSPECTOR.w - 12, INSPECTOR.y + 46, 11, C.exhaust, "right", 700);
  }

  const list = onslaught ? onslaughtPreview() : wavePreview(previewWave, game.totalWaves);
  let y = INSPECTOR.y + 78;
  for (const item of list) {
    const d = SURGE_DEFS[item.type];
    // Swatch.
    ctx.fillStyle = surgeSwatch(item.type);
    rr(ctx, ix, y - 9, 12, 12, 3);
    ctx.fill();
    text(ctx, d.name.toUpperCase(), ix + 20, y, 11, C.textDim, "left", 400);
    text(ctx, `x${item.count}`, INSPECTOR.x + INSPECTOR.w - 12, y, 11, C.text, "right", 700);
    y += 20;
  }

  text(ctx, "Select a tower to inspect", ix, INSPECTOR.y + INSPECTOR.h - 18, 10, C.textFaint, "left", 400);
}

// Shop-hover info panel (specs/playfield.md): the hovered tower's static stats —
// the same data the selected-tower inspector shows minus the runtime-only heat
// read and instance tallies — plus a plain-language description of what the tower
// does and how it works. Stats are the base (level I) values, since nothing is
// placed yet.
function drawShopInfo(ctx: Ctx, game: Game, type: TowerType): void {
  ctx.fillStyle = "#20262e";
  rr(ctx, INSPECTOR.x, INSPECTOR.y, INSPECTOR.w, INSPECTOR.h, 10);
  ctx.fill();
  ctx.strokeStyle = C.edge;
  ctx.lineWidth = 1;
  rr(ctx, INSPECTOR.x, INSPECTOR.y, INSPECTOR.w, INSPECTOR.h, 10);
  ctx.stroke();

  const def = TOWER_DEFS[type];
  const ix = INSPECTOR.x + 12;
  const rightX = INSPECTOR.x + INSPECTOR.w - 12;
  text(ctx, def.name, ix, INSPECTOR.y + 24, 14, C.text, "left", 700);
  const afford = game.money >= def.cost;
  text(ctx, `$${def.cost}`, rightX, INSPECTOR.y + 24, 13, afford ? C.money : C.bad, "right", 700);

  let y = INSPECTOR.y + 52;
  if (isEmitterDef(def)) {
    statRow(ctx, "SIZE", `${def.size}x${def.size}`, y);
    y += 20;
    statRow(ctx, "RANGE", `${def.range.toFixed(1)} tiles`, y);
    y += 20;
    if (type === "rime") {
      statRow(ctx, "SLOW", `up to ${Math.round((def.rimeSlow?.[0] ?? 0) * 100)}% (cold)`, y);
    } else {
      statRow(ctx, "DAMAGE", `${def.baseDamage}`, y);
    }
    y += 20;
    statRow(ctx, "RATE", `${def.fireRate.toFixed(1)} / s`, y);
    y += 20;
    statRow(ctx, "TARGETS", targetsLabel(def), y);
    y += 20;
    if (def.splash) {
      statRow(ctx, "SPLASH", `${def.splash.toFixed(1)} tiles`, y);
    } else {
      statRow(ctx, "MASS", `${def.mass.toFixed(1)}`, y);
    }
    y += 20;
    const order = ["N", "E", "S", "W"].filter((sd) => def.radiators.includes(sd as Side));
    statRow(ctx, "RADIATORS", order.join(" · ") || "—", y);
    y += 20;
  } else {
    statRow(ctx, "SIZE", `${def.size}x${def.size}`, y);
    y += 20;
    if (type === "forge") {
      statRow(ctx, "SETPOINT", `${def.output[0]}% heat`, y);
      y += 20;
      statRow(ctx, "MODE", "thermostat", y);
    } else {
      statRow(ctx, "COOLING", `+${def.output[0]} / edge`, y);
      y += 20;
      statRow(ctx, "MODE", "coolant loop", y);
    }
    y += 20;
    statRow(ctx, "TARGETS", targetsLabel(def), y);
    y += 20;
  }

  // Description (what it does / how it works).
  y += 6;
  for (const wl of wrapLines(ctx, def.desc, 11, INSPECTOR.w - 24)) {
    text(ctx, wl, ix, y, 11, C.textDim, "left", 400);
    y += 16;
  }

  text(ctx, "Click or hotkey to build", ix, INSPECTOR.y + INSPECTOR.h - 16, 10, C.textFaint, "left", 400);
}

function surgeSwatch(type: SurgeType): string {
  switch (type) {
    case "mote":
      return C.ground;
    case "sprint":
      return "#d6f25a";
    case "hulk":
      return "#6fae2e";
    case "swarm":
      return "#b6f04a";
    case "drift":
      return C.flyer;
    case "core":
      return C.boss;
  }
}

function drawWaveControls(ctx: Ctx, game: Game): void {
  const send = sendBtnRect();
  const inBuild = game.phase === "build";
  const opening = inBuild && game.openingPhase;
  ctx.save();
  if (inBuild) {
    ctx.shadowColor = opening ? C.ok : C.hazard;
    ctx.shadowBlur = 14;
  }
  ctx.fillStyle = inBuild ? (opening ? C.ok : C.hazard) : "#2a2f38";
  rr(ctx, send.x, send.y, send.w, send.h, 9);
  ctx.fill();
  ctx.restore();
  if (opening) {
    // Untimed opening phase: the control reads START and pays no early bonus.
    text(ctx, "START", send.x + send.w / 2, send.y + 28, 15, C.steel, "center", 700);
  } else if (inBuild) {
    text(ctx, "SEND NEXT WAVE", send.x + send.w / 2, send.y + 22, 13, C.steel, "center", 700);
    text(ctx, `EARLY BONUS +${Math.floor(Math.max(0, game.buildTimer))}`, send.x + send.w / 2, send.y + 38, 9, "#5a4a00", "center", 700);
  } else {
    text(ctx, "WAVE IN PROGRESS", send.x + send.w / 2, send.y + 28, 12, C.textDim, "center", 700);
  }

  const labels = ["1x", "2x", "PAUSE"];
  for (let k = 0; k < 3; k++) {
    const r = ctlRect(k);
    const active = (k === 0 && game.speed === 1) || (k === 1 && game.speed === 2);
    ctx.fillStyle = "#232a33";
    rr(ctx, r.x, r.y, r.w, r.h, 7);
    ctx.fill();
    ctx.strokeStyle = active ? C.textDim : C.edge;
    ctx.lineWidth = active ? 2 : 1;
    rr(ctx, r.x, r.y, r.w, r.h, 7);
    ctx.stroke();
    text(ctx, labels[k], r.x + r.w / 2, r.y + 22, 11, active ? C.text : C.textDim, "center", 700);
  }
}

// ---- Menus & overlays -----------------------------------------------------

function menuItem(ctx: Ctx, game: Game, label: string, cx: number, y: number, index: number, size: number): void {
  const selected = game.menuIndex === index;
  const color = selected ? C.text : C.textDim;
  const w = spaced(ctx, label, cx, y, size, color, size * 0.32, selected ? 700 : 400);
  if (selected) {
    setFont(ctx, size, 700);
    ctx.fillStyle = C.hot;
    ctx.textAlign = "right";
    ctx.fillText("▸", cx - w / 2 - 14, y);
    ctx.fillStyle = C.cold;
    ctx.textAlign = "left";
    ctx.fillText("◂", cx + w / 2 + 14, y);
  }
  const rect: Rect = { x: cx - w / 2 - 40, y: y - size, w: w + 80, h: size + 14 };
  game.menuHits.push({ index, rect } satisfies MenuHit);
}

function gradientText(ctx: Ctx, str: string, cx: number, y: number, size: number, spacing: number): void {
  setFont(ctx, size, 700);
  let total = 0;
  for (const ch of str) total += ctx.measureText(ch).width + spacing;
  total -= spacing;
  const g = ctx.createLinearGradient(cx - total / 2, 0, cx + total / 2, 0);
  g.addColorStop(0, C.cold);
  g.addColorStop(0.4, C.warm);
  g.addColorStop(0.7, C.hot);
  g.addColorStop(1, C.white);
  ctx.fillStyle = g;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  let x = cx - total / 2;
  for (const ch of str) {
    ctx.fillText(ch, x, y);
    x += ctx.measureText(ch).width + spacing;
  }
}

function drawTitle(ctx: Ctx, game: Game): void {
  const cx = STAGE_W / 2;
  ctx.save();
  ctx.shadowColor = rgba(C.hot, 0.4);
  ctx.shadowBlur = 24;
  gradientText(ctx, "MELTDOWN", cx, 250, 110, 16);
  ctx.restore();
  spaced(ctx, "RUN IT HOT", cx, 300, 22, C.textDim, 12, 400);

  for (let i = 0; i < TITLE_ITEMS.length; i++) {
    menuItem(ctx, game, TITLE_ITEMS[i], cx, 410 + i * 60, i, 30);
  }
  spaced(ctx, "CLICK OR ↑ ↓ + ENTER", cx, 686, 15, C.textFaint, 8, 400);
}

// A left-aligned vertical menu column (mode / difficulty screens): the focused
// row carries a pointer and records a hit rect for the mouse.
function drawMenuColumn(ctx: Ctx, game: Game, names: string[], x: number, y0: number, gap: number, size: number): void {
  for (let i = 0; i < names.length; i++) {
    const y = y0 + i * gap;
    const selected = game.menuIndex === i;
    setFont(ctx, size, selected ? 700 : 400);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    if (selected) {
      ctx.fillStyle = C.hot;
      ctx.fillText("▸", x - 30, y);
    }
    ctx.fillStyle = selected ? C.text : C.textDim;
    ctx.fillText(names[i], x, y);
    const w = ctx.measureText(names[i]).width;
    const rect: Rect = { x: x - 38, y: y - size, w: Math.max(w + 54, 300), h: size + 16 };
    game.menuHits.push({ index: i, rect });
  }
}

// The info card shown beside a menu column — the focused entry's name, optional
// stat rows, and its description. This is what the player reads on hover before
// choosing (specs/modes.md, specs/flow.md).
function drawInfoPanel(ctx: Ctx, title: string, lines: string[], stats?: Array<[string, string]>): void {
  const x = 616;
  const y = 196;
  const w = 528;
  const h = 356;
  ctx.fillStyle = "#20262e";
  rr(ctx, x, y, w, h, 12);
  ctx.fill();
  ctx.strokeStyle = C.edge;
  ctx.lineWidth = 1;
  rr(ctx, x, y, w, h, 12);
  ctx.stroke();

  text(ctx, title, x + 28, y + 56, 26, C.hot, "left", 700);
  let ly = y + 96;
  if (stats) {
    for (const [label, value] of stats) {
      text(ctx, label, x + 28, ly, 12, C.textFaint, "left", 400);
      text(ctx, value, x + w - 28, ly, 13, C.money, "right", 700);
      ly += 24;
    }
    ly += 10;
  }
  for (const line of lines) {
    for (const wl of wrapLines(ctx, line, 14, w - 56)) {
      text(ctx, wl, x + 28, ly, 14, C.textDim, "left", 400);
      ly += 22;
    }
    ly += 4;
  }
}

function drawModeSelect(ctx: Ctx, game: Game): void {
  const cx = STAGE_W / 2;
  spaced(ctx, "SELECT A MODE", cx, 98, 30, C.text, 8, 700);
  const names = [...MODE_ENTRIES.map((m) => m.name), "BACK"];
  drawMenuColumn(ctx, game, names, 150, 214, 58, 24);
  const focus: MenuEntry | null = game.menuIndex < MODE_ENTRIES.length ? MODE_ENTRIES[game.menuIndex] : null;
  drawInfoPanel(ctx, focus ? focus.name : "BACK", focus ? focus.blurb : ["Return to the main menu."]);
  spaced(ctx, "CLICK OR ↑ ↓ + ENTER   ·   ESC BACK", cx, 692, 13, C.textFaint, 6, 400);
}

function drawDifficulty(ctx: Ctx, game: Game): void {
  const cx = STAGE_W / 2;
  spaced(ctx, "SELECT DIFFICULTY", cx, 92, 30, C.text, 8, 700);
  spaced(ctx, "CONTAINMENT", cx, 128, 13, C.textFaint, 6, 400);
  const names = [...DIFFICULTIES.map((d) => d.name), "BACK"];
  drawMenuColumn(ctx, game, names, 150, 244, 66, 26);
  const d = game.menuIndex < DIFFICULTIES.length ? DIFFICULTIES[game.menuIndex] : null;
  drawInfoPanel(
    ctx,
    d ? d.name : "BACK",
    d ? d.blurb : ["Return to mode select."],
    d ? [["STARTING FUNDS", String(d.startMoney)], ["WAVES", String(d.totalWaves)], ["LIVES", "20"]] : undefined,
  );
  spaced(ctx, "CLICK OR ↑ ↓ + ENTER   ·   ESC BACK", cx, 692, 13, C.textFaint, 6, 400);
}

function drawHowTo(ctx: Ctx): void {
  const cx = STAGE_W / 2;
  spaced(ctx, "HOW TO PLAY", cx, 90, 34, C.text, 8, 700);
  const lines: Array<[string, string]> = [
    ["GOAL", "Stop the surge from reaching the exhausts. Lose all 20 lives and the reactor breaches; clear wave 20 to win."],
    ["TOWERS ARE WALLS", "Every tower is also a wall — you build the maze the surge must walk. Towers come in 2x2, 3x3, and 4x4 sizes. You can never seal the floor."],
    ["WALLED REACTOR", "Surge enters at the LEFT and TOP vents and must cross to its OPPOSITE exhaust (left→right, top→bottom) — the only openings in the casing."],
    ["HEAT IS POWER", "Emitters fire harder the hotter they run — full power once they reach their REDLINE mark, then hold it up to the 100 trip. Cold guns are nearly useless (about a third power), so keep them hot; hit 100 and they TRIP offline for 5s."],
    ["RUN IT HOT", "A tower only sheds heat through faces that touch OPEN AIR — its cyan RADIATOR faces cool best. Rotate (R) while placing to aim them at the open lane — a placed tower's facing is locked. Pack towers tight and their cores bake and trip."],
    ["SIZE & REDLINE", "Bigger towers hit harder but run hotter — they want corners and open air. Each tower has its own redline: light guns reach max power early with room to spare; heavy guns want to sit right near the top."],
    ["FORGE & SINK", "The Forge warms touching emitters toward its setpoint (never past it) — wake cold guns, feed a Lance. The Sink draws heat out — the only way to cool a boxed-in core."],
    ["THE RIME", "The cryo Rime runs backward — it slows hardest when COLD and fades as it heats. Give it open air or a Sink; keep it away from Forges and hot cores."],
    ["FLYERS", "Drift flyers ignore the maze and fly straight across. Any emitter can hit them; Flak is dedicated air-only coverage."],
    ["ECONOMY", "Start with 250. Earn kill bounties, wave bonuses, interest, and an early-send bonus. Sell for a 70% refund — but a tower sold before the wave it was placed on starts refunds in full. Opening build is untimed — press START; between waves you get 15s."],
    ["CONTROLS", "Mouse to build/select. 1–8 arm shop towers, R rotate faces while placing, U upgrade, S sell, Space send/start wave, F speed, Esc/P pause."],
  ];
  const bodyX = 372;
  const bodyMaxW = 1096 - bodyX;
  let y = 124;
  for (const [head, body] of lines) {
    text(ctx, head, 176, y, 12.5, C.hot, "left", 700);
    const wrapped = wrapLines(ctx, body, 12, bodyMaxW);
    let ly = y;
    for (const line of wrapped) {
      text(ctx, line, bodyX, ly, 12, C.textDim, "left", 400);
      ly += 15;
    }
    y += Math.max(34, wrapped.length * 15 + 13);
  }
  spaced(ctx, "CLICK OR PRESS ESC TO GO BACK", cx, 700, 14, C.textFaint, 6, 400);
}

// Greedy word-wrap to a max pixel width.
function wrapLines(ctx: Ctx, str: string, size: number, maxW: number): string[] {
  setFont(ctx, size, 400);
  ctx.textAlign = "left";
  const words = str.split(" ");
  const out: string[] = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(test).width > maxW && cur) {
      out.push(cur);
      cur = w;
    } else {
      cur = test;
    }
  }
  if (cur) out.push(cur);
  return out;
}

function dimStage(ctx: Ctx): void {
  ctx.fillStyle = rgba("#0a0c10", 0.72);
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
}

function card(ctx: Ctx, w: number, h: number): { x: number; y: number } {
  const x = STAGE_W / 2 - w / 2;
  const y = STAGE_H / 2 - h / 2;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 60;
  ctx.fillStyle = C.panel;
  rr(ctx, x, y, w, h, 18);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = C.edge;
  ctx.lineWidth = 1;
  rr(ctx, x, y, w, h, 18);
  ctx.stroke();
  return { x, y };
}

function drawPauseCard(ctx: Ctx, game: Game): void {
  dimStage(ctx);
  const w = 480;
  const h = 340;
  const { y } = card(ctx, w, h);
  const cx = STAGE_W / 2;
  spaced(ctx, "PAUSED", cx, y + 70, 40, C.text, 8, 700);
  for (let i = 0; i < PAUSE_ITEMS.length; i++) {
    menuItem(ctx, game, PAUSE_ITEMS[i], cx, y + 150 + i * 52, i, 22);
  }
}

function drawEndCard(ctx: Ctx, game: Game, victory: boolean): void {
  dimStage(ctx);
  const w = 560;
  const h = 380;
  const { y } = card(ctx, w, h);
  const cx = STAGE_W / 2;

  text(ctx, game.cfg.label, cx, y + 26, 11, C.textFaint, "center", 700);
  text(ctx, victory ? "CONTAINMENT HELD" : "REACTOR BREACHED", cx, y + 52, 18, victory ? C.ok : C.exhaust, "center", 700);
  // Title with a warm→hot gradient.
  setFont(ctx, 50, 700);
  const label = victory ? "VICTORY" : "MELTDOWN";
  let total = 0;
  const sp = 8;
  for (const ch of label) total += ctx.measureText(ch).width + sp;
  total -= sp;
  const g = ctx.createLinearGradient(cx - total / 2, 0, cx + total / 2, 0);
  g.addColorStop(0, C.warm);
  g.addColorStop(0.5, C.hot);
  g.addColorStop(1, C.trip);
  ctx.fillStyle = g;
  ctx.textAlign = "left";
  let x = cx - total / 2;
  for (const ch of label) {
    ctx.fillText(ch, x, y + 108);
    x += ctx.measureText(ch).width + sp;
  }

  spaced(ctx, `SCORE ${game.score.toLocaleString()}`, cx, y + 158, 34, C.text, 6, 700);
  if (victory) {
    spaced(ctx, game.cfg.onslaught ? "SURGE CLEARED — 100 / 100" : `WAVES SURVIVED ${game.totalWaves} / ${game.totalWaves}`, cx, y + 196, 17, C.textDim, 5, 400);
    spaced(ctx, `LIVES REMAINING ${game.lives}`, cx, y + 224, 17, C.textDim, 5, 400);
  } else {
    spaced(ctx, game.cfg.onslaught ? "THE HUNDRED — SURGE BREACHED" : `REACHED WAVE ${game.reachedWave} / ${game.totalWaves}`, cx, y + 200, 18, C.textDim, 6, 400);
  }

  for (let i = 0; i < END_ITEMS.length; i++) {
    const itemY = y + h - 44;
    menuItemInline(ctx, game, END_ITEMS[i], cx, itemY, i, 22, END_ITEMS.length);
  }
}

// Horizontal menu items for the end/pause action rows.
function menuItemInline(ctx: Ctx, game: Game, label: string, cx: number, y: number, index: number, size: number, count: number): void {
  const spacingBetween = 200;
  const itemCx = cx + (index - (count - 1) / 2) * spacingBetween;
  const selected = game.menuIndex === index;
  const w = spaced(ctx, label, itemCx, y, size, selected ? C.text : C.textDim, size * 0.28, selected ? 700 : 400);
  if (selected) {
    setFont(ctx, size, 700);
    ctx.fillStyle = C.hot;
    ctx.textAlign = "right";
    ctx.fillText("▸", itemCx - w / 2 - 12, y);
  }
  const rect: Rect = { x: itemCx - w / 2 - 20, y: y - size, w: w + 40, h: size + 12 };
  game.menuHits.push({ index, rect });
}
