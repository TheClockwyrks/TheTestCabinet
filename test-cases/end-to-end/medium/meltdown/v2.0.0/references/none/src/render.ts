// Meltdown — drawing.
//
// Everything here reads the state and writes to the canvas; nothing here changes
// the game, which is what lets the simulation be advanced and read with no
// drawing taking part in the result (specs/instrumentation.md).
//
// The whole picture is drawn in the fixed logical stage the runtime has already
// installed a transform for, so every figure below is in the same units the
// specification is written in.

import {
  BOTTOM_EXHAUST_COLS,
  CASING,
  COLS,
  DIFFICULTY_TABLE,
  DIFFICULTY_ITEMS,
  FLOOR_H,
  FLOOR_W,
  FLOOR_X0,
  FLOOR_X1,
  FLOOR_Y0,
  FLOOR_Y1,
  HUD_LIVES_LABEL,
  HUD_MONEY_LABEL,
  HUD_WAVE_LABEL,
  LEFT_VENT_ROWS,
  MODES,
  REACTOR_W,
  RIGHT_EXHAUST_ROWS,
  ROWS,
  STAGE_H,
  STAGE_W,
  TAGLINE_TEXT,
  TILE,
  TITLE_TEXT,
  TOP_VENT_COLS,
  tileLeft,
  tileTop,
} from "./constants";
import { SURGE_DEFS, TOWER_DEFS, emitterStats, isEmitter } from "./defs";
import { heldIsValid } from "./build";
import { MODE_BLURBS, modeFigures } from "./modes";
import { HOWTO_ITEMS, highlighted, menuItems, menuRects } from "./menus";
import { INFO_RECT, INNER_X, PANEL, STATUS_RECT, panelControls } from "./panel";
import type { MeltdownState, Tower, Unit } from "./state";
import {
  centreOf,
  damageOf,
  heatMultOf,
  radiatorFaces,
  rangeUnits,
  redlineOf,
  refundOf,
  sizeOf,
  slowFactorOf,
  towerById,
  upgradeCostOfTower,
} from "./towers";
import { COLOR, FONT, alpha, heatColor } from "./theme";
import { fliesOf } from "./units";
import { wavePreview } from "./waves";
import type { Rect, Side, SurgeType, TowerType } from "./types";

/** One line of text, with the build's own type stack. */
function text(
  ctx: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  options: {
    size?: number;
    color?: string;
    align?: CanvasTextAlign;
    weight?: string;
  } = {},
): void {
  ctx.font = `${options.weight ?? "500"} ${options.size ?? 14}px ${FONT}`;
  ctx.fillStyle = options.color ?? COLOR.text;
  ctx.textAlign = options.align ?? "left";
  ctx.textBaseline = "middle";
  ctx.fillText(value, x, y);
}

/** A filled box with a hairline edge, which every panel control is drawn as. */
function box(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  fill: string,
  edge: string,
): void {
  ctx.fillStyle = fill;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.strokeStyle = edge;
  ctx.lineWidth = 1;
  ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
}

/** The whole frame. */
export function renderGame(
  state: MeltdownState,
  ctx: CanvasRenderingContext2D,
): void {
  ctx.save();
  ctx.lineJoin = "miter";
  const inRun =
    state.screen === "playing" ||
    state.screen === "paused" ||
    state.screen === "victory" ||
    state.screen === "gameover";

  if (inRun) {
    drawReactor(state, ctx);
    drawPanel(state, ctx);
  } else {
    drawBackdrop(ctx);
  }

  switch (state.screen) {
    case "title":
      drawTitle(state, ctx);
      break;
    case "modeselect":
      drawModeSelect(state, ctx);
      break;
    case "difficultyselect":
      drawDifficultySelect(state, ctx);
      break;
    case "howto":
      drawHowTo(state, ctx);
      break;
    case "paused":
      drawOverlayMenu(state, ctx, "PAUSED", []);
      break;
    case "victory":
      drawOverlayMenu(state, ctx, "CONTAINED", victoryLines(state));
      break;
    case "gameover":
      drawOverlayMenu(state, ctx, "MELTDOWN", gameOverLines(state));
      break;
    default:
      break;
  }
  ctx.restore();
}

// ---- The reactor ---------------------------------------------------------

function drawBackdrop(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = COLOR.floor;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
  ctx.strokeStyle = alpha(COLOR.grid, 0.55);
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= STAGE_W; x += TILE * 2) {
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, STAGE_H);
  }
  for (let y = 0; y <= STAGE_H; y += TILE * 2) {
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(STAGE_W, y + 0.5);
  }
  ctx.stroke();
}

function drawReactor(
  state: MeltdownState,
  ctx: CanvasRenderingContext2D,
): void {
  ctx.fillStyle = COLOR.floor;
  ctx.fillRect(0, 0, REACTOR_W, STAGE_H);

  // The floor, then the grid over it, so the grid reads at every zoom.
  ctx.fillStyle = COLOR.floorEdge;
  ctx.fillRect(FLOOR_X0, FLOOR_Y0, FLOOR_W, FLOOR_H);
  ctx.strokeStyle = COLOR.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let c = 0; c <= COLS; c += 1) {
    const x = tileLeft(c) + 0.5;
    ctx.moveTo(x, FLOOR_Y0);
    ctx.lineTo(x, FLOOR_Y1);
  }
  for (let r = 0; r <= ROWS; r += 1) {
    const y = tileTop(r) + 0.5;
    ctx.moveTo(FLOOR_X0, y);
    ctx.lineTo(FLOOR_X1, y);
  }
  ctx.stroke();

  drawBuildZone(state, ctx);
  drawCasing(ctx);
  drawShots(state, ctx);
  for (const tower of state.towers) drawTower(ctx, tower);
  for (const unit of state.surge) drawUnit(ctx, unit);
  drawSelection(state, ctx);
  drawPreview(state, ctx);
}

/** The casing band, and the four openings cut into it. */
function drawCasing(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = COLOR.casing;
  ctx.fillRect(0, 0, REACTOR_W, CASING);
  ctx.fillRect(0, STAGE_H - CASING, REACTOR_W, CASING);
  ctx.fillRect(0, 0, CASING, STAGE_H);
  ctx.fillRect(REACTOR_W - CASING, 0, CASING, STAGE_H);
  ctx.strokeStyle = COLOR.casingRim;
  ctx.lineWidth = 2;
  ctx.strokeRect(FLOOR_X0 - 1, FLOOR_Y0 - 1, FLOOR_W + 2, FLOOR_H + 2);

  for (const r of LEFT_VENT_ROWS) {
    drawOpening(ctx, 0, tileTop(r), CASING, TILE, COLOR.vent, "left");
  }
  for (const r of RIGHT_EXHAUST_ROWS) {
    drawOpening(
      ctx,
      FLOOR_X1,
      tileTop(r),
      CASING,
      TILE,
      COLOR.exhaust,
      "right",
    );
  }
  for (const c of TOP_VENT_COLS) {
    drawOpening(ctx, tileLeft(c), 0, TILE, CASING, COLOR.vent, "top");
  }
  for (const c of BOTTOM_EXHAUST_COLS) {
    drawOpening(
      ctx,
      tileLeft(c),
      FLOOR_Y1,
      TILE,
      CASING,
      COLOR.exhaust,
      "bottom",
    );
  }
}

/** One opening tile's slot through the casing, with a hazard lip inside it. */
function drawOpening(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  side: "left" | "right" | "top" | "bottom",
): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = alpha(color, 0.28);
  // The lip reaches a little way onto the floor so an exhaust reads as a mouth
  // rather than a stripe painted on the wall.
  const lip = 8;
  if (side === "left") ctx.fillRect(x + w, y, lip, h);
  if (side === "right") ctx.fillRect(x - lip, y, lip, h);
  if (side === "top") ctx.fillRect(x, y + h, w, lip);
  if (side === "bottom") ctx.fillRect(x, y - lip, w, lip);
}

/** The zone a mode restricts building to, where it restricts it at all. */
function drawBuildZone(
  state: MeltdownState,
  ctx: CanvasRenderingContext2D,
): void {
  const zone = modeFigures(state.mode, state.difficulty).buildZone;
  if (zone === null) return;
  const x = tileLeft(zone.col0);
  const y = tileTop(zone.row0);
  const w = (zone.col1 - zone.col0 + 1) * TILE;
  const h = (zone.row1 - zone.row0 + 1) * TILE;
  ctx.fillStyle = alpha(COLOR.zone, 0.07);
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = alpha(COLOR.zone, 0.85);
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 6]);
  ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
  ctx.setLineDash([]);
}

/** One tower: its body at its heat, its faces, and its heat read. */
function drawTower(ctx: CanvasRenderingContext2D, tower: Tower): void {
  const size = sizeOf(tower);
  const x = tileLeft(tower.col);
  const y = tileTop(tower.row);
  const w = size * TILE;
  const def = TOWER_DEFS[tower.type];

  let body: string;
  if (!isEmitter(def)) body = def.kind === "forge" ? COLOR.forge : COLOR.sink;
  else if (tower.tripped) body = COLOR.tripBody;
  else body = heatColor(tower.heat);

  ctx.fillStyle = body;
  ctx.fillRect(x + 1, y + 1, w - 2, w - 2);
  ctx.strokeStyle = alpha("#000000", 0.55);
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 1.5, y + 1.5, w - 3, w - 3);

  drawFaces(ctx, tower, x, y, w);

  if (tower.tripped) {
    // A tripped tower is unmistakable: a dark carcass under a red warning band
    // that no online tower shows at any heat.
    ctx.strokeStyle = COLOR.tripMark;
    ctx.lineWidth = 3;
    ctx.strokeRect(x + 3, y + 3, w - 6, w - 6);
    ctx.beginPath();
    ctx.moveTo(x + 6, y + 6);
    ctx.lineTo(x + w - 6, y + w - 6);
    ctx.moveTo(x + w - 6, y + 6);
    ctx.lineTo(x + 6, y + w - 6);
    ctx.stroke();
  }

  const label = def.name.slice(0, size >= 3 ? 5 : 2);
  text(ctx, label, x + w / 2, y + w / 2 - 2, {
    size: size >= 3 ? 12 : 9,
    color: tower.tripped ? COLOR.tripMark : alpha("#04070a", 0.85),
    align: "center",
    weight: "700",
  });

  if (isEmitter(def)) drawHeatRead(ctx, tower, x, y, w);
}

/** The radiator faces, drawn distinctly from the plain ones. */
function drawFaces(
  ctx: CanvasRenderingContext2D,
  tower: Tower,
  x: number,
  y: number,
  w: number,
): void {
  const faces = radiatorFaces(tower);
  const bar = 3;
  const sides: Side[] = ["N", "E", "S", "W"];
  for (const side of sides) {
    const radiator = faces.includes(side);
    ctx.fillStyle = radiator ? COLOR.radiator : COLOR.plainFace;
    if (side === "N") ctx.fillRect(x + 2, y + 1, w - 4, bar);
    if (side === "S") ctx.fillRect(x + 2, y + w - 1 - bar, w - 4, bar);
    if (side === "W") ctx.fillRect(x + 1, y + 2, bar, w - 4);
    if (side === "E") ctx.fillRect(x + w - 1 - bar, y + 2, bar, w - 4);
  }
}

/** The on-footprint heat read, with a marker at the tower's redline. */
function drawHeatRead(
  ctx: CanvasRenderingContext2D,
  tower: Tower,
  x: number,
  y: number,
  w: number,
): void {
  const barW = w - 10;
  const barH = 4;
  const barX = x + 5;
  const barY = y + w - 8;
  ctx.fillStyle = alpha("#04070a", 0.75);
  ctx.fillRect(barX, barY, barW, barH);
  ctx.fillStyle = tower.tripped ? COLOR.tripMark : heatColor(tower.heat);
  ctx.fillRect(barX, barY, (barW * tower.heat) / 100, barH);
  const redline = redlineOf(tower);
  ctx.fillStyle = COLOR.text;
  ctx.fillRect(barX + (barW * redline) / 100 - 1, barY - 2, 2, barH + 4);
}

/** One surge unit, with its health bar above it. */
function drawUnit(ctx: CanvasRenderingContext2D, unit: Unit): void {
  const def = SURGE_DEFS[unit.type];
  const color =
    unit.type === "core"
      ? COLOR.boss
      : fliesOf(unit)
        ? COLOR.flyer
        : COLOR.ground;

  ctx.fillStyle = color;
  ctx.beginPath();
  if (fliesOf(unit)) {
    // A flyer is a diamond, so its silhouette reads apart from a walker's.
    ctx.moveTo(unit.x, unit.y - def.radius);
    ctx.lineTo(unit.x + def.radius, unit.y);
    ctx.lineTo(unit.x, unit.y + def.radius);
    ctx.lineTo(unit.x - def.radius, unit.y);
    ctx.closePath();
  } else {
    ctx.arc(unit.x, unit.y, def.radius, 0, Math.PI * 2);
  }
  ctx.fill();
  if (unit.slowFactor > 0) {
    ctx.strokeStyle = COLOR.radiator;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  const barW = Math.max(12, def.radius * 2);
  const barY = unit.y - def.radius - 5;
  ctx.fillStyle = COLOR.healthBack;
  ctx.fillRect(unit.x - barW / 2, barY, barW, 3);
  ctx.fillStyle = COLOR.health;
  const fraction = unit.maxHp > 0 ? Math.max(0, unit.hp / unit.maxHp) : 0;
  ctx.fillRect(unit.x - barW / 2, barY, barW * fraction, 3);
}

/** The brief traces the frame's shots left. */
function drawShots(state: MeltdownState, ctx: CanvasRenderingContext2D): void {
  for (const shot of state.shots) {
    ctx.strokeStyle = alpha("#ffffff", Math.min(1, shot.life * 8));
    ctx.strokeStyle = shot.color;
    ctx.globalAlpha = Math.min(1, shot.life * 10);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(shot.x1, shot.y1);
    ctx.lineTo(shot.x2, shot.y2);
    ctx.stroke();
    if (shot.splash > 0) {
      ctx.beginPath();
      ctx.arc(shot.x2, shot.y2, shot.splash, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
}

/** A range ring, centred on a footprint. */
function drawRangeRing(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  color: string,
): void {
  if (radius <= 0) return;
  ctx.strokeStyle = alpha(color, 0.55);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();
}

/** The selected tower's ring. */
function drawSelection(
  state: MeltdownState,
  ctx: CanvasRenderingContext2D,
): void {
  const tower = towerById(state.towers, state.selected);
  if (tower === null) return;
  const size = sizeOf(tower);
  ctx.strokeStyle = COLOR.highlight;
  ctx.lineWidth = 2;
  ctx.strokeRect(
    tileLeft(tower.col) + 1,
    tileTop(tower.row) + 1,
    size * TILE - 2,
    size * TILE - 2,
  );
  const centre = centreOf(tower);
  drawRangeRing(ctx, centre.x, centre.y, rangeUnits(tower), COLOR.range);
}

/** The held preview: its footprint, its faces at the held rotation, its ring. */
function drawPreview(
  state: MeltdownState,
  ctx: CanvasRenderingContext2D,
): void {
  const held = state.build;
  if (held === null) return;
  const def = TOWER_DEFS[held.type];
  const size = def.size;
  const x = tileLeft(held.col);
  const y = tileTop(held.row);
  const w = size * TILE;
  const valid = heldIsValid(state);
  const color = valid ? COLOR.valid : COLOR.invalid;

  ctx.fillStyle = alpha(color, 0.22);
  ctx.fillRect(x, y, w, w);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, w - 2, w - 2);

  if (isEmitter(def)) {
    const ghost: Tower = {
      id: -1,
      type: held.type,
      col: held.col,
      row: held.row,
      rotation: held.rotation,
      level: 1,
      heat: 0,
      tripped: false,
      tripTimer: 0,
      fireAcc: 0,
      targeting: null,
      firing: false,
      kills: 0,
      damageDealt: 0,
      spent: def.cost,
      fresh: true,
      firingEnabled: true,
      thermalEnabled: true,
    };
    drawFaces(ctx, ghost, x, y, w);
    drawRangeRing(
      ctx,
      x + w / 2,
      y + w / 2,
      emitterStats(def, 1).range * TILE,
      color,
    );
  }
}

// ---- The build panel -----------------------------------------------------

function drawPanel(state: MeltdownState, ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = COLOR.panel;
  ctx.fillRect(REACTOR_W, 0, STAGE_W - REACTOR_W, STAGE_H);
  ctx.strokeStyle = COLOR.panelEdge;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(REACTOR_W + 1, 0);
  ctx.lineTo(REACTOR_W + 1, STAGE_H);
  ctx.stroke();

  drawStatus(state, ctx);
  drawShop(state, ctx);
  drawPlacementControls(state, ctx);
  drawInfoArea(state, ctx);
  drawWaveControls(state, ctx);
}

function drawStatus(state: MeltdownState, ctx: CanvasRenderingContext2D): void {
  const figures = modeFigures(state.mode, state.difficulty);
  const x = STATUS_RECT.x;
  const right = STATUS_RECT.x + STATUS_RECT.w;
  let y = STATUS_RECT.y + 12;

  text(ctx, HUD_MONEY_LABEL, x, y, { size: 13, color: COLOR.textDim });
  text(ctx, String(state.money), right, y, {
    size: 17,
    color: COLOR.money,
    align: "right",
    weight: "700",
  });
  y += 24;
  text(ctx, HUD_LIVES_LABEL, x, y, { size: 13, color: COLOR.textDim });
  text(ctx, String(state.lives), right, y, {
    size: 17,
    color: COLOR.lives,
    align: "right",
    weight: "700",
  });
  y += 24;
  text(ctx, HUD_WAVE_LABEL, x, y, { size: 13, color: COLOR.textDim });
  const waveRead =
    state.mode === "hundred"
      ? "ONSLAUGHT"
      : `${state.wave}/${figures.waveCount}`;
  text(ctx, waveRead, right, y, {
    size: 17,
    color: COLOR.text,
    align: "right",
    weight: "700",
  });
  y += 22;
  if (state.phase === "building") {
    text(ctx, "BUILD", x, y, { size: 12, color: COLOR.textDim });
    text(ctx, `${Math.ceil(state.buildTimer)}s`, right, y, {
      size: 13,
      color: COLOR.highlight,
      align: "right",
    });
  } else {
    text(ctx, phaseLabel(state), x, y, { size: 12, color: COLOR.textFaint });
  }
}

function phaseLabel(state: MeltdownState): string {
  if (state.phase === "opening") return "BUILD FREELY, THEN START";
  return `SURGE INBOUND  ${state.wavePending + state.surge.length} LEFT`;
}

function drawShop(state: MeltdownState, ctx: CanvasRenderingContext2D): void {
  text(ctx, "SHOP", INNER_X, PANEL.shopLabelY, {
    size: 12,
    color: COLOR.textDim,
  });
  for (const entry of panelControls(state).shop) {
    const def = TOWER_DEFS[entry.type];
    const affordable = state.money >= def.cost;
    const armed = state.build?.type === entry.type;
    box(
      ctx,
      entry,
      armed ? alpha(COLOR.highlight, 0.16) : COLOR.panelInset,
      armed ? COLOR.highlight : COLOR.panelEdge,
    );
    text(ctx, def.name, entry.x + 8, entry.y + 15, {
      size: 12,
      color: affordable ? COLOR.text : COLOR.textFaint,
      weight: "700",
    });
    text(ctx, String(def.cost), entry.x + entry.w - 8, entry.y + 15, {
      size: 12,
      color: affordable ? COLOR.money : COLOR.textFaint,
      align: "right",
    });
    text(ctx, `${def.size}x${def.size}`, entry.x + 8, entry.y + 30, {
      size: 10,
      color: COLOR.textFaint,
    });
    if (!affordable) {
      text(ctx, "TOO DEAR", entry.x + entry.w - 8, entry.y + 30, {
        size: 10,
        color: COLOR.textFaint,
        align: "right",
      });
    }
  }
}

function drawPlacementControls(
  state: MeltdownState,
  ctx: CanvasRenderingContext2D,
): void {
  const controls = panelControls(state);
  if (controls.rotate === null || controls.cancel === null) return;
  box(ctx, controls.rotate, COLOR.panelInset, COLOR.panelEdge);
  text(
    ctx,
    `ROTATE ${state.build?.rotation ?? 0}`,
    controls.rotate.x + controls.rotate.w / 2,
    controls.rotate.y + controls.rotate.h / 2,
    { size: 12, align: "center" },
  );
  box(ctx, controls.cancel, COLOR.panelInset, COLOR.panelEdge);
  text(
    ctx,
    "CANCEL",
    controls.cancel.x + controls.cancel.w / 2,
    controls.cancel.y + controls.cancel.h / 2,
    { size: 12, align: "center", color: COLOR.invalid },
  );
}

/** The one area that shows a hover panel, an inspector, or the next wave. */
function drawInfoArea(
  state: MeltdownState,
  ctx: CanvasRenderingContext2D,
): void {
  box(ctx, INFO_RECT, COLOR.panelInset, COLOR.panelEdge);
  const selected = towerById(state.towers, state.selected);
  if (state.hoverShop !== null) {
    drawTypeInfo(ctx, state.hoverShop);
    return;
  }
  if (selected !== null) {
    drawInspector(state, ctx, selected);
    return;
  }
  drawNextWave(state, ctx);
}

/** The fields both the hover panel and the inspector draw. */
function commonFields(type: TowerType, level: number): Array<[string, string]> {
  const def = TOWER_DEFS[type];
  const rows: Array<[string, string]> = [["SIZE", `${def.size}x${def.size}`]];
  if (isEmitter(def)) {
    const stats = emitterStats(def, level);
    rows.push(["RANGE", `${stats.range.toFixed(1)} tiles`]);
    rows.push(["RATE", `${stats.fireRate.toFixed(2)}/s`]);
    rows.push(["MASS", def.mass.toFixed(1)]);
    rows.push(["REDLINE", String(def.redline)]);
    rows.push(["HEAT/SHOT", stats.heatPerShot.toFixed(1)]);
    rows.push(["TARGETS", def.airOnly ? "AIR ONLY" : "GROUND + AIR"]);
  } else {
    rows.push(["RANGE", "—"]);
    rows.push(["RATE", "—"]);
    rows.push(["MASS", "—"]);
    rows.push(["TARGETS", "NEVER FIRES"]);
  }
  return rows;
}

/** A shop entry's info at level I. */
function drawTypeInfo(ctx: CanvasRenderingContext2D, type: TowerType): void {
  const def = TOWER_DEFS[type];
  let y = INFO_RECT.y + 18;
  text(ctx, def.name, INFO_RECT.x + 10, y, { size: 15, weight: "700" });
  text(ctx, "LEVEL I", INFO_RECT.x + INFO_RECT.w - 10, y, {
    size: 11,
    color: COLOR.textDim,
    align: "right",
  });
  y += 20;
  text(ctx, effectRead(type, 1, null), INFO_RECT.x + 10, y, {
    size: 12,
    color: COLOR.highlight,
  });
  y += 8;
  for (const [label, value] of commonFields(type, 1)) {
    y += 16;
    text(ctx, label, INFO_RECT.x + 10, y, { size: 11, color: COLOR.textDim });
    text(ctx, value, INFO_RECT.x + INFO_RECT.w - 10, y, {
      size: 11,
      align: "right",
    });
  }
  y += 16;
  text(ctx, "RADIATORS", INFO_RECT.x + 10, y, {
    size: 11,
    color: COLOR.textDim,
  });
  text(
    ctx,
    isEmitter(def) ? def.radiators.join(" ") : "—",
    INFO_RECT.x + INFO_RECT.w - 10,
    y,
    { size: 11, align: "right", color: COLOR.radiator },
  );
  y += 22;
  wrapped(ctx, def.blurb, INFO_RECT.x + 10, y, INFO_RECT.w - 20, 13, {
    size: 10,
    color: COLOR.textFaint,
  });
}

/**
 * The damage read: live per-shot damage beside the live multiplier — except a
 * Rime, which shows its live slow where another emitter shows a damage read.
 * That is this panel's display convention and nothing more: a Rime's shots deal
 * ordinary damage (specs/hud.md, specs/combat.md).
 */
function effectRead(
  type: TowerType,
  level: number,
  tower: Tower | null,
): string {
  const def = TOWER_DEFS[type];
  if (!isEmitter(def)) {
    const output = def.output[level - 1];
    return def.kind === "forge" ? `SETPOINT ${output}` : `DRAIN ${output}/edge`;
  }
  if (type === "rime") {
    const slow =
      tower === null ? emitterStats(def, level).slowCeil : slowFactorOf(tower);
    return `SLOW ${(slow * 100).toFixed(0)}%`;
  }
  if (tower === null) {
    const stats = emitterStats(def, level);
    return `DMG ${stats.baseDamage.toFixed(1)} x0.35`;
  }
  return `DMG ${damageOf(tower).toFixed(1)}  x${heatMultOf(tower).toFixed(2)}`;
}

/** The selected tower's live information, and its two actions. */
function drawInspector(
  state: MeltdownState,
  ctx: CanvasRenderingContext2D,
  tower: Tower,
): void {
  const def = TOWER_DEFS[tower.type];
  let y = INFO_RECT.y + 18;
  text(ctx, def.name, INFO_RECT.x + 10, y, { size: 15, weight: "700" });
  text(
    ctx,
    `LEVEL ${["I", "II", "III"][tower.level - 1]}`,
    INFO_RECT.x + INFO_RECT.w - 10,
    y,
    { size: 11, color: COLOR.highlight, align: "right" },
  );
  y += 20;
  text(ctx, effectRead(tower.type, tower.level, tower), INFO_RECT.x + 10, y, {
    size: 12,
    color: COLOR.highlight,
  });
  y += 8;
  for (const [label, value] of commonFields(tower.type, tower.level)) {
    y += 15;
    text(ctx, label, INFO_RECT.x + 10, y, { size: 11, color: COLOR.textDim });
    text(ctx, value, INFO_RECT.x + INFO_RECT.w - 10, y, {
      size: 11,
      align: "right",
    });
  }
  y += 15;
  text(ctx, "RADIATORS", INFO_RECT.x + 10, y, {
    size: 11,
    color: COLOR.textDim,
  });
  const faces = radiatorFaces(tower);
  text(
    ctx,
    faces.length > 0 ? faces.join(" ") : "—",
    INFO_RECT.x + INFO_RECT.w - 10,
    y,
    { size: 11, align: "right", color: COLOR.radiator },
  );
  y += 15;
  text(ctx, "HEAT", INFO_RECT.x + 10, y, { size: 11, color: COLOR.textDim });
  text(
    ctx,
    isEmitter(def)
      ? `${tower.heat.toFixed(1)} / ${redlineOf(tower)}${tower.tripped ? "  TRIPPED" : ""}`
      : "—",
    INFO_RECT.x + INFO_RECT.w - 10,
    y,
    {
      size: 11,
      align: "right",
      color: tower.tripped ? COLOR.tripMark : COLOR.text,
    },
  );
  y += 15;
  text(ctx, "KILLS", INFO_RECT.x + 10, y, { size: 11, color: COLOR.textDim });
  text(ctx, String(tower.kills), INFO_RECT.x + INFO_RECT.w - 10, y, {
    size: 11,
    align: "right",
  });
  y += 15;
  text(ctx, "DAMAGE", INFO_RECT.x + 10, y, { size: 11, color: COLOR.textDim });
  text(ctx, tower.damageDealt.toFixed(0), INFO_RECT.x + INFO_RECT.w - 10, y, {
    size: 11,
    align: "right",
  });

  const controls = panelControls(state);
  if (controls.upgrade !== null) {
    const cost = upgradeCostOfTower(tower);
    const can = cost > 0 && state.money >= cost;
    box(ctx, controls.upgrade, COLOR.panelInset, COLOR.panelEdge);
    text(
      ctx,
      cost > 0 ? `UPGRADE ${cost}` : "MAX LEVEL",
      controls.upgrade.x + controls.upgrade.w / 2,
      controls.upgrade.y + controls.upgrade.h / 2,
      { size: 12, align: "center", color: can ? COLOR.text : COLOR.textFaint },
    );
  }
  if (controls.sell !== null) {
    box(ctx, controls.sell, COLOR.panelInset, COLOR.panelEdge);
    text(
      ctx,
      `SELL ${refundOf(tower)}`,
      controls.sell.x + controls.sell.w / 2,
      controls.sell.y + controls.sell.h / 2,
      { size: 12, align: "center", color: COLOR.money },
    );
  }
}

/** How the coming wave's type reads: one type named, or The Hundred's mix. */
export function previewTypeLabel(
  state: MeltdownState,
  type: SurgeType,
): string {
  return state.mode === "hundred" ? "MIXED" : SURGE_DEFS[type].name;
}

/**
 * The coming wave's type and count, in the phases that draw one.
 *
 * The `wave` phase draws no preview: the wave is already on the floor
 * (specs/hud.md). The Hundred fields more than one type, so its preview reads as
 * mixed rather than naming one, and it lists no per-type figures because there is
 * no one type to list.
 */
function drawNextWave(
  state: MeltdownState,
  ctx: CanvasRenderingContext2D,
): void {
  if (state.phase === "wave") {
    drawInfoHint(ctx);
    return;
  }
  const figures = modeFigures(state.mode, state.difficulty);
  const coming = wavePreview(state.mode, state.wave, figures.waveCount);
  let y = INFO_RECT.y + 20;
  text(ctx, "NEXT WAVE", INFO_RECT.x + 10, y, {
    size: 12,
    color: COLOR.textDim,
  });
  y += 26;
  if (coming === null) {
    text(ctx, "NONE", INFO_RECT.x + 10, y, { size: 16, weight: "700" });
    drawInfoHint(ctx);
    return;
  }
  text(
    ctx,
    `${coming.count} x ${previewTypeLabel(state, coming.type)}`,
    INFO_RECT.x + 10,
    y,
    { size: 18, weight: "700", color: COLOR.highlight },
  );
  y += 24;
  const def = SURGE_DEFS[coming.type];
  const fields: Array<[string, string]> =
    state.mode === "hundred"
      ? [["TYPES", "EVERY ONE, IN TURN"]]
      : [
          ["HP", def.hp.toFixed(0)],
          ["SPEED", def.speed.toFixed(0)],
          ["FLIES", def.flies ? "YES" : "NO"],
          ["BOUNTY", String(def.bounty)],
          ["LEAK", `${def.leak} lives`],
        ];
  for (const [label, value] of fields) {
    y += 17;
    text(ctx, label, INFO_RECT.x + 10, y, { size: 11, color: COLOR.textDim });
    text(ctx, value, INFO_RECT.x + INFO_RECT.w - 10, y, {
      size: 11,
      align: "right",
    });
  }
  drawInfoHint(ctx);
}

/** The standing note under the information area: how to fill it with a tower. */
function drawInfoHint(ctx: CanvasRenderingContext2D): void {
  const y = INFO_RECT.y + INFO_RECT.h - 30;
  text(ctx, "HOVER A SHOP ENTRY OR", INFO_RECT.x + 10, y, {
    size: 10,
    color: COLOR.textFaint,
  });
  text(ctx, "SELECT A TOWER FOR ITS INFO", INFO_RECT.x + 10, y + 13, {
    size: 10,
    color: COLOR.textFaint,
  });
}

function drawWaveControls(
  state: MeltdownState,
  ctx: CanvasRenderingContext2D,
): void {
  const controls = panelControls(state);
  const sendLabel = state.phase === "opening" ? "START" : "SEND";
  const sendable = state.phase !== "wave";
  box(
    ctx,
    controls.send,
    sendable ? alpha(COLOR.valid, 0.16) : COLOR.panelInset,
    sendable ? COLOR.valid : COLOR.panelEdge,
  );
  text(
    ctx,
    sendLabel,
    controls.send.x + controls.send.w / 2,
    controls.send.y + controls.send.h / 2,
    {
      size: 15,
      align: "center",
      weight: "700",
      color: sendable ? COLOR.text : COLOR.textFaint,
    },
  );

  const toggles: Array<[Rect, string]> = [
    [controls.speed, `${state.speed}x`],
    [controls.pause, state.screen === "paused" ? "RESUME" : "PAUSE"],
    [controls.mute, state.muted ? "MUTED" : "SOUND"],
  ];
  for (const [rect, label] of toggles) {
    box(ctx, rect, COLOR.panelInset, COLOR.panelEdge);
    text(ctx, label, rect.x + rect.w / 2, rect.y + rect.h / 2, {
      size: 12,
      align: "center",
      color: label === "MUTED" ? COLOR.textFaint : COLOR.text,
    });
  }
}

// ---- The screens ---------------------------------------------------------

/** A menu's rows, with the highlighted one drawn plainly apart. */
function drawMenu(state: MeltdownState, ctx: CanvasRenderingContext2D): void {
  const rects = menuRects(state.screen);
  const items = menuItems(state.screen);
  const index = highlighted(state);
  rects.forEach((rect, i) => {
    const on = i === index;
    box(
      ctx,
      rect,
      on ? alpha(COLOR.highlight, 0.18) : alpha("#04070a", 0.55),
      on ? COLOR.highlight : COLOR.panelEdge,
    );
    text(ctx, items[i], rect.x + rect.w / 2, rect.y + rect.h / 2, {
      size: 18,
      align: "center",
      weight: "700",
      color: on ? COLOR.highlight : COLOR.text,
    });
  });
}

function drawTitle(state: MeltdownState, ctx: CanvasRenderingContext2D): void {
  text(ctx, TITLE_TEXT, STAGE_W / 2, 232, {
    size: 92,
    align: "center",
    weight: "700",
    color: COLOR.heatHot,
  });
  text(ctx, TAGLINE_TEXT, STAGE_W / 2, 300, {
    size: 22,
    align: "center",
    color: COLOR.heatWarm,
  });
  drawMenu(state, ctx);
}

function drawModeSelect(
  state: MeltdownState,
  ctx: CanvasRenderingContext2D,
): void {
  text(ctx, "SELECT A MODE", STAGE_W / 2, 150, {
    size: 34,
    align: "center",
    weight: "700",
  });
  drawMenu(state, ctx);
  const mode = MODES[highlighted(state)];
  const figures = modeFigures(mode, state.difficulty);
  wrapped(ctx, MODE_BLURBS[mode], 300, 540, 680, 24, {
    size: 15,
    color: COLOR.textDim,
    align: "center",
  });
  text(
    ctx,
    `MONEY ${figures.startMoney}   WAVES ${figures.waveCount}   LIVES ${figures.startLives}`,
    STAGE_W / 2,
    632,
    { size: 15, align: "center", color: COLOR.money },
  );
  text(ctx, "ESC GOES BACK", STAGE_W / 2, 676, {
    size: 12,
    align: "center",
    color: COLOR.textFaint,
  });
}

function drawDifficultySelect(
  state: MeltdownState,
  ctx: CanvasRenderingContext2D,
): void {
  text(ctx, "CONTAINMENT", STAGE_W / 2, 170, {
    size: 34,
    align: "center",
    weight: "700",
  });
  drawMenu(state, ctx);
  const rects = menuRects("difficultyselect");
  DIFFICULTY_ITEMS.forEach((_item, i) => {
    const rect = rects[i];
    const row = DIFFICULTY_TABLE[(["easy", "medium", "hard"] as const)[i]];
    text(
      ctx,
      `${row.money} MONEY   ${row.waves} WAVES`,
      rect.x + rect.w + 24,
      rect.y + rect.h / 2,
      { size: 14, color: COLOR.money },
    );
  });
  text(ctx, "ESC GOES BACK", STAGE_W / 2, 640, {
    size: 12,
    align: "center",
    color: COLOR.textFaint,
  });
}

const HOWTO_LINES: readonly string[] = [
  "GOAL   The surge pours in at the two vents and crosses the floor to the",
  "       opposite exhaust. Every leak costs lives; lose them all and the",
  "       reactor is gone. Clear the last wave to contain it.",
  "",
  "WALLS  Every tower is a wall, so you build the maze the surge walks.",
  "       You can never seal the floor: a placement that would is refused.",
  "",
  "HEAT   An emitter fires harder the hotter it runs, up to its own redline",
  "       and flat from there. Carry one all the way to 100 and it TRIPS",
  "       offline for five seconds, cooling to nothing, leaving a hole.",
  "",
  "COOL   A tower sheds heat only through faces touching open air, and its",
  "       radiator faces shed far better. Rotate before you place to aim",
  "       them. Pack guns tight and the block bakes its own core.",
  "",
  "MOVE   The FORGE warms every emitter it touches toward its setpoint. The",
  "       SINK drains them, even through a face nothing else can cool.",
  "",
  "RIME   The cryo RIME runs the rule backward: it slows hardest when cold,",
  "       and its shots deal ordinary damage besides.",
  "",
  "AIR    The DRIFT flies over the maze entirely. Only the FLAK can hit it.",
  "",
  "WAVES  A Containment wave fields one type. Kills pay a bounty, a cleared",
  "       wave pays a bonus, and money left over earns 8% interest.",
];

function drawHowTo(state: MeltdownState, ctx: CanvasRenderingContext2D): void {
  text(ctx, "HOW TO PLAY", STAGE_W / 2, 60, {
    size: 30,
    align: "center",
    weight: "700",
  });
  HOWTO_LINES.forEach((line, i) => {
    text(ctx, line, 120, 108 + i * 20, {
      size: 13,
      color: line.startsWith(" ") ? COLOR.textDim : COLOR.text,
    });
  });
  void HOWTO_ITEMS;
  drawMenu(state, ctx);
}

function victoryLines(state: MeltdownState): string[] {
  const figures = modeFigures(state.mode, state.difficulty);
  return [
    `SCORE ${state.score}`,
    `WAVES SURVIVED ${figures.waveCount}`,
    `LIVES REMAINING ${state.lives}`,
  ];
}

function gameOverLines(state: MeltdownState): string[] {
  return [`SCORE ${state.score}`, `WAVE REACHED ${state.wave}`];
}

/** A menu drawn over the run: the pause screen and the two end screens. */
function drawOverlayMenu(
  state: MeltdownState,
  ctx: CanvasRenderingContext2D,
  heading: string,
  lines: readonly string[],
): void {
  ctx.fillStyle = alpha("#04070a", 0.72);
  ctx.fillRect(0, 0, REACTOR_W, STAGE_H);
  text(ctx, heading, REACTOR_W / 2, 220, {
    size: 60,
    align: "center",
    weight: "700",
    color: state.screen === "gameover" ? COLOR.invalid : COLOR.heatWarm,
  });
  lines.forEach((line, i) => {
    text(ctx, line, REACTOR_W / 2, 300 + i * 30, {
      size: 18,
      align: "center",
      color: COLOR.text,
    });
  });
  drawMenu(state, ctx);
}

/** Wrap a paragraph to `width`, and draw it. */
function wrapped(
  ctx: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  width: number,
  lineHeight: number,
  options: { size?: number; color?: string; align?: CanvasTextAlign } = {},
): void {
  ctx.font = `500 ${options.size ?? 12}px ${FONT}`;
  const words = value.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line.length === 0 ? word : `${line} ${word}`;
    if (ctx.measureText(candidate).width > width && line.length > 0) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line.length > 0) lines.push(line);
  lines.forEach((entry, i) => {
    text(
      ctx,
      entry,
      options.align === "center" ? x + width / 2 : x,
      y + i * lineHeight,
      options,
    );
  });
}
