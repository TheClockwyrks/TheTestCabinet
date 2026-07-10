// Meltdown — all canvas drawing. Reads the Game's public state and paints the
// reactor floor, the towers (glowing along the heat ramp), the surge, the build
// panel/HUD, and the menu overlays, in the palette and type of specs/overview.md
// and the reference mockups. Drawing happens in logical 1280x720 space (main.ts
// installs the fit/letterbox transform).

import { heatColor, rgba } from "./colors";
import {
  C,
  FLOOR_H,
  FLOOR_W,
  MONO,
  PANEL_W,
  PANEL_X,
  REDLINE,
  STAGE_H,
  STAGE_W,
  TILE,
  TOTAL_WAVES,
} from "./constants";
import { isEmitterDef, SURGE_DEFS, TOWER_DEFS, type EmitterDef } from "./defs";
import type { Game, MenuHit } from "./game";
import { END_ITEMS, PAUSE_ITEMS, TITLE_ITEMS } from "./game";
import type { Tower } from "./towers";
import type { SurgeType, TowerType } from "./types";
import { TOWER_ORDER } from "./types";
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
import { wavePreview } from "./waves";

const TYPE_COLOR: Record<TowerType, string> = {
  arc: C.warm,
  stutter: C.hot,
  lance: C.cold,
  bloom: C.hot,
  rime: C.rime,
  flak: C.warm,
  forge: C.forge,
  vent: C.vent,
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

  if (game.state === "title" || game.state === "howto") {
    drawFloorBase(ctx);
    // The title shows a dim slice of reactor floor with glowing towers behind
    // the menu; the how-to keeps a clean floor so the text stays legible.
    if (game.state === "title") for (const t of game.towers) drawTower(ctx, game, t);
    ctx.fillStyle = rgba(C.steel, game.state === "title" ? 0.6 : 0.82);
    ctx.fillRect(0, 0, STAGE_W, STAGE_H);
    if (game.state === "title") drawTitle(ctx, game);
    else drawHowTo(ctx);
    return;
  }

  // In-match (also frozen behind pause / end overlays).
  drawFloorBase(ctx);
  drawPortals(ctx, game);
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

// ---- Floor & portals ------------------------------------------------------

function drawFloorBase(ctx: Ctx): void {
  ctx.fillStyle = C.steel;
  ctx.fillRect(0, 0, FLOOR_W, FLOOR_H);
  ctx.strokeStyle = C.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= FLOOR_W; x += TILE) {
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, FLOOR_H);
  }
  for (let y = 0; y <= FLOOR_H; y += TILE) {
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(FLOOR_W, y + 0.5);
  }
  ctx.stroke();
}

function drawPortals(ctx: Ctx, game: Game): void {
  const intake = (x: number, y: number, w: number, h: number) => {
    ctx.fillStyle = rgba(C.intake, 0.16);
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = C.intake;
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
    text(ctx, "IN", x + w / 2, y + h / 2 + 3, 9, C.intake, "center", 700);
  };
  const exhaust = (x: number, y: number, w: number, h: number) => {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.fillStyle = rgba(C.exhaust, 0.14);
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = rgba(C.hazard, 0.5);
    ctx.lineWidth = 5;
    ctx.beginPath();
    for (let d = -h; d < w + h; d += 14) {
      ctx.moveTo(x + d, y);
      ctx.lineTo(x + d + h, y + h);
    }
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = C.exhaust;
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
    text(ctx, "OUT", x + w / 2, y + h / 2 + 3, 8, C.exhaust, "center", 700);
  };
  // Highlight a portal that has surge passing through it (subtle glow omitted
  // for stillness; positions per specs/playfield.md).
  const g = game.grid;
  const px = (i: number) => (i % 50) * TILE;
  const py = (i: number) => Math.floor(i / 50) * TILE;
  intake(px(g.leftIntake.tiles[0]), py(g.leftIntake.tiles[0]), TILE, TILE * 4);
  intake(px(g.topIntake.tiles[0]), py(g.topIntake.tiles[0]), TILE * 4, TILE);
  exhaust(px(g.rightExhaust.tiles[0]), py(g.rightExhaust.tiles[0]), TILE, TILE * 4);
  exhaust(px(g.bottomExhaust.tiles[0]), py(g.bottomExhaust.tiles[0]), TILE * 4, TILE);
}

// ---- Towers ---------------------------------------------------------------

function towerFill(game: Game, t: Tower): string {
  if (t.type === "forge") return C.forge;
  if (t.type === "vent") return "#3a444f";
  if (t.type === "rime") return C.rime;
  if (t.tripped) {
    // Strobing red while offline.
    return Math.floor(game.simTime * 12) % 2 === 0 ? C.trip : "#5a0d0d";
  }
  return heatColor(t.heat);
}

function drawTower(ctx: Ctx, game: Game, t: Tower): void {
  const x0 = t.cx - 20;
  const y0 = t.cy - 20;
  const fill = towerFill(game, t);

  ctx.save();
  ctx.shadowColor = fill;
  ctx.shadowBlur =
    t.type === "vent" ? 10 : t.tripped ? 20 : t.isEmitter ? 8 + t.heatFrac() * 20 : 18;
  ctx.fillStyle = fill;
  rr(ctx, x0 + 2, y0 + 2, 36, 36, 7);
  ctx.fill();
  ctx.restore();

  // Lit highlight for a 3-D read.
  const grad = ctx.createRadialGradient(t.cx, t.cy - 6, 2, t.cx, t.cy + 4, 24);
  grad.addColorStop(0, rgba("#ffffff", 0.32));
  grad.addColorStop(1, rgba("#ffffff", 0));
  ctx.fillStyle = grad;
  rr(ctx, x0 + 2, y0 + 2, 36, 36, 7);
  ctx.fill();

  ctx.strokeStyle = rgba("#ffffff", 0.14);
  ctx.lineWidth = 1.5;
  rr(ctx, x0 + 2, y0 + 2, 36, 36, 7);
  ctx.stroke();

  // Glyph.
  const glyphColor = t.type === "vent" ? C.vent : "#15181d";
  text(ctx, t.def.glyph, t.cx, t.cy + 6, 17, glyphColor, "center", 700);

  // Heat read on the footprint (emitters, incl. Rime) — a short bar.
  if (t.isEmitter) {
    const bx = x0 + 6;
    const by = y0 + 32;
    const bw = 28;
    ctx.fillStyle = rgba("#ffffff", 0.14);
    rr(ctx, bx, by, bw, 4, 2);
    ctx.fill();
    const frac = Math.max(0, Math.min(1, t.heatFrac()));
    ctx.fillStyle = t.tripped ? C.trip : t.type === "rime" ? C.rime : heatColor(t.heat);
    rr(ctx, bx, by, Math.max(1, bw * frac), 4, 2);
    ctx.fill();
  }

  if (t.tripped) {
    text(ctx, "OFFLINE", t.cx, y0 - 4, 8, C.trip, "center", 700);
  }
}

function drawRangeRings(ctx: Ctx, game: Game): void {
  const t = game.selected;
  if (!t || !isEmitterDef(t.def)) return;
  const r = t.stats().range * 20;
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
  const cx = p.i * 20;
  const cy = p.j * 20;
  const col = p.valid ? C.ok : C.bad;
  // Footprint highlight.
  ctx.fillStyle = rgba(col, 0.25);
  ctx.fillRect(cx - 20, cy - 20, 40, 40);
  ctx.strokeStyle = col;
  ctx.lineWidth = 2;
  ctx.strokeRect(cx - 20 + 1, cy - 20 + 1, 38, 38);
  // Range ring (emitters).
  if (isEmitterDef(def)) {
    ctx.save();
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = rgba(col, 0.7);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, def.range * 20, 0, Math.PI * 2);
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
  if (game.selected) drawInspector(ctx, game, game.selected);
  else drawNextWave(ctx, game);
  drawWaveControls(ctx, game);
}

function readout(ctx: Ctx, label: string, value: string, x: number, valueColor: string, align: CanvasTextAlign): void {
  text(ctx, label, x, READOUTS_Y + 10, 10, C.textFaint, align, 400);
  text(ctx, value, x, READOUTS_Y + 32, 21, valueColor, align, 700);
}

function drawReadouts(ctx: Ctx, game: Game): void {
  readout(ctx, "MONEY", String(game.money), PANEL_INNER_X, C.money, "left");
  readout(ctx, "LIVES", String(game.lives), (PANEL_INNER_X + PANEL_INNER_R) / 2, C.text, "center");
  readout(ctx, "WAVE", `${game.waveNumber} / ${TOTAL_WAVES}`, PANEL_INNER_R, C.text, "right");

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
    const frac = Math.max(0, Math.min(1, game.buildTimer / 15));
    ctx.fillStyle = C.hazard;
    rr(ctx, PANEL_INNER_X, barY, PANEL_INNER_W * frac, 5, 2);
    ctx.fill();
    text(ctx, `NEXT WAVE IN ${Math.ceil(game.buildTimer)}s`, PANEL_INNER_X, barY + 20, 10, C.textDim, "left", 400);
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

    // Icon.
    ctx.fillStyle = TYPE_COLOR[type];
    rr(ctx, r.x + r.w / 2 - 11, r.y + 6, 22, 16, 4);
    ctx.fill();
    text(ctx, def.glyph, r.x + r.w / 2, r.y + 19, 12, "#15181d", "center", 700);
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
    if ((t.def as EmitterDef).airOnly) {
      statRow(ctx, "TARGETS", "AIR ONLY", y);
      y += 20;
    } else if ((t.def as EmitterDef).splash) {
      statRow(ctx, "SPLASH", `${(t.def as EmitterDef).splash!.toFixed(1)} tiles`, y);
      y += 20;
    }

    // Heat meter.
    const hy = y + 8;
    text(ctx, `HEAT — ${Math.round(t.heat)}%`, ix, hy, 10, C.textFaint, "left", 400);
    const my = hy + 6;
    ctx.fillStyle = rgba("#ffffff", 0.1);
    rr(ctx, ix, my, INSPECTOR.w - 24, 9, 5);
    ctx.fill();
    const g = ctx.createLinearGradient(ix, 0, ix + INSPECTOR.w - 24, 0);
    g.addColorStop(0, C.cold);
    g.addColorStop(0.5, C.warm);
    g.addColorStop(0.8, C.hot);
    g.addColorStop(1, C.white);
    ctx.fillStyle = t.tripped ? C.trip : g;
    rr(ctx, ix, my, (INSPECTOR.w - 24) * Math.max(0, Math.min(1, t.heatFrac())), 9, 5);
    ctx.fill();
    // Redline marker.
    ctx.strokeStyle = C.trip;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(ix + INSPECTOR.w - 24 - 1, my - 2);
    ctx.lineTo(ix + INSPECTOR.w - 24 - 1, my + 11);
    ctx.stroke();
    if (t.tripped) text(ctx, "OFFLINE — REDLINE TRIP", ix, my + 26, 10, C.trip, "left", 700);
  } else {
    // Mover.
    const out = t.moverOutput();
    if (t.type === "forge") statRow(ctx, "OUTPUT", `+${out} heat/s`, y);
    else statRow(ctx, "OUTPUT", `+${out} cool`, y);
    y += 20;
    statRow(ctx, "COUPLING", "orthogonal", y);
    y += 20;
    text(
      ctx,
      t.type === "forge" ? "Warms adjacent emitters." : "Cools adjacent emitters.",
      ix,
      y + 14,
      10,
      C.textFaint,
      "left",
      400,
    );
  }

  // Actions.
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
  const previewWave = game.phase === "build" ? game.waveNumber : Math.min(TOTAL_WAVES, game.waveNumber + 1);
  text(ctx, game.phase === "build" ? "NEXT WAVE" : "CURRENT WAVE", ix, INSPECTOR.y + 24, 12, C.textDim, "left", 700);
  text(ctx, `WAVE ${previewWave}`, ix, INSPECTOR.y + 46, 16, C.text, "left", 700);
  if (previewWave === 10 || previewWave === 20) {
    text(ctx, "⚠ CORE BOSS", INSPECTOR.x + INSPECTOR.w - 12, INSPECTOR.y + 46, 11, C.exhaust, "right", 700);
  }

  const list = wavePreview(previewWave);
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
  ctx.save();
  if (inBuild) {
    ctx.shadowColor = C.hazard;
    ctx.shadowBlur = 14;
  }
  ctx.fillStyle = inBuild ? C.hazard : "#2a2f38";
  rr(ctx, send.x, send.y, send.w, send.h, 9);
  ctx.fill();
  ctx.restore();
  if (inBuild) {
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

function drawHowTo(ctx: Ctx): void {
  const cx = STAGE_W / 2;
  spaced(ctx, "HOW TO PLAY", cx, 90, 34, C.text, 8, 700);
  const lines: Array<[string, string]> = [
    ["GOAL", "Stop the surge from reaching the exhausts. Lose all 20 lives and the reactor breaches; clear wave 20 to win."],
    ["TOWERS ARE WALLS", "Every tower is also a wall — you build the maze the surge must walk. It always keeps a path; you can never seal the floor."],
    ["TWO STREAMS", "Surge enters at the LEFT and TOP intakes and must cross to its OPPOSITE exhaust (left→right, top→bottom)."],
    ["HEAT IS POWER", "Emitters fire harder the hotter they run (up to 3x near the redline) — but hit 100 heat and they TRIP offline for 3s."],
    ["FORGE & VENT", "The Forge pours heat into orthogonal neighbours (an asset in a lull, a liability in a push); the Vent draws it out."],
    ["THE RIME", "The cryo Rime runs backward — it slows hardest when COLD and fades as it heats. Keep it isolated or beside a Vent."],
    ["FLYERS", "Drift flyers ignore the maze and fly straight across. Any emitter can hit them; Flak is dedicated air-only coverage."],
    ["ECONOMY", "Earn kill bounties, wave-clear bonuses, build-phase interest, and an early-send bonus. Sell for a 70% refund."],
    ["CONTROLS", "Mouse to build/select. 1–8 arm shop towers, U upgrade, S sell, Space send wave, F speed, Esc/P pause."],
  ];
  const bodyX = 400;
  const bodyMaxW = 1060 - bodyX;
  let y = 148;
  for (const [head, body] of lines) {
    text(ctx, head, 180, y, 14, C.hot, "left", 700);
    const wrapped = wrapLines(ctx, body, 13, bodyMaxW);
    let ly = y;
    for (const line of wrapped) {
      text(ctx, line, bodyX, ly, 13, C.textDim, "left", 400);
      ly += 18;
    }
    y += Math.max(50, wrapped.length * 18 + 22);
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

  text(ctx, victory ? "CONTAINMENT HELD" : "REACTOR BREACHED", cx, y + 46, 18, victory ? C.ok : C.exhaust, "center", 700);
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
    spaced(ctx, `WAVES SURVIVED ${TOTAL_WAVES} / ${TOTAL_WAVES}`, cx, y + 196, 17, C.textDim, 5, 400);
    spaced(ctx, `LIVES REMAINING ${game.lives}`, cx, y + 224, 17, C.textDim, 5, 400);
  } else {
    spaced(ctx, `REACHED WAVE ${game.reachedWave} / ${TOTAL_WAVES}`, cx, y + 200, 18, C.textDim, 6, 400);
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
