// Meltdown — the picture, drawn from the state and writing nothing back.
//
// Every function here is a pure read of `MeltdownState`. The engine's pipeline
// calls them through the draw components in `src/actors.ts`, with the context
// already carrying the world-to-device transform and the camera left at rest,
// so the drawing runs in world units that coincide with the stage's logical
// units and every figure in the specification is directly usable.
//
// The look is this build's own (specs/overview.md, Visual design). What the
// specification fixes is what a player must be able to READ, so the separations
// the legibility table asks for are stated in `src/theme.ts` and used here: the
// heat ramp is the one axis that carries information, and the surge, a tripped
// tower, the casing and the openings are all kept off it.

import {
  BOTTOM_EXHAUST_COLS,
  CASING,
  COLS,
  DIFFICULTY_ITEMS,
  DIFFICULTY_TABLE,
  DIFFICULTIES,
  ENDING_ITEMS,
  FLOOR_H,
  FLOOR_W,
  FLOOR_X0,
  FLOOR_Y0,
  HUD_LIVES_LABEL,
  HUD_MONEY_LABEL,
  HUD_WAVE_LABEL,
  FORGE_SETPOINT,
  HUNDRED_HP_SCALE,
  HUNDRED_UNITS,
  LEFT_VENT_ROWS,
  MODES,
  MODE_ITEMS,
  PANEL_W,
  PANEL_X,
  PAUSE_ITEMS,
  REACTOR_W,
  RIGHT_EXHAUST_ROWS,
  RIME_SLOW_CEIL,
  ROWS,
  SINK_OUTPUT,
  STAGE_H,
  STAGE_W,
  SURGE_DEFS,
  TAGLINE_TEXT,
  TILE,
  TITLE_ITEMS,
  TITLE_TEXT,
  TOWER_DEFS,
  TOP_VENT_COLS,
  TOWER_TYPES,
  tileLeft,
  tileTop,
  type SurgeType,
  type TowerType,
} from "./constants";
import {
  HOWTO_LINES,
  MODE_BLURB,
  TARGETING_READ,
  TOWER_LABEL,
  TOWER_NAME,
} from "./copy";
import { footprintRect, sizeOf, worldFaces, type Rect } from "./geometry";
import {
  INFO_H,
  INFO_Y,
  PANEL_INNER_W,
  PANEL_INNER_X,
  SHOP_ROW_H,
  STATUS_Y,
  menuGeometry,
  menuRowRect,
  panelControls,
} from "./layout";
import {
  damageOf,
  emitterDef,
  heatMultOf,
  liveStats,
  outputOf,
  rangeUnits,
  redlineOf,
  refundOf,
  slowFactorOf,
  towerCentre,
  upgradeCostOf,
  worldRadiatorsOf,
} from "./stats";
import { FONT, RGB, SURGE_RGB, css, heatRgb, rgba, type Rgb } from "./theme";
import { previewValid } from "./build";
import { figuresOf, nextWaveInfo } from "./waves";
import type { MeltdownState, TowerState, UnitState } from "./game";

type Ctx = CanvasRenderingContext2D;

/** Whether this screen draws the reactor floor and the build panel. */
export function showsFloor(state: MeltdownState): boolean {
  return state.screen === "playing" || state.screen === "paused";
}

function fillRect(ctx: Ctx, rect: Rect, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
}

function strokeRect(ctx: Ctx, rect: Rect, color: string, width = 1): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.strokeRect(
    rect.x + width / 2,
    rect.y + width / 2,
    rect.w - width,
    rect.h - width,
  );
}

function label(
  ctx: Ctx,
  text: string,
  x: number,
  y: number,
  font: string,
  color: string,
  align: CanvasTextAlign = "left",
  baseline: CanvasTextBaseline = "middle",
): void {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.fillText(text, x, y);
}

function round(value: number, places = 1): string {
  return value.toFixed(places);
}

// ---- The floor ------------------------------------------------------------

/** The casing band, its four openings, the tile grid, and any build zone. */
export function drawFloor(state: MeltdownState, ctx: Ctx): void {
  fillRect(ctx, { x: 0, y: 0, w: STAGE_W, h: STAGE_H }, css(RGB.bg));

  // The reactor region: the casing band, with the floor cut out of it.
  fillRect(ctx, { x: 0, y: 0, w: REACTOR_W, h: STAGE_H }, css(RGB.casing));
  fillRect(
    ctx,
    { x: FLOOR_X0, y: FLOOR_Y0, w: FLOOR_W, h: FLOOR_H },
    css(RGB.floor),
  );
  strokeRect(
    ctx,
    { x: 0, y: 0, w: REACTOR_W, h: STAGE_H },
    css(RGB.casingEdge),
    2,
  );

  // The four openings, cut into the casing at the tile runs they open onto.
  const vent = css(RGB.vent);
  const exhaust = css(RGB.exhaust);
  const rows = LEFT_VENT_ROWS;
  fillRect(
    ctx,
    {
      x: 0,
      y: tileTop(rows[0]),
      w: CASING,
      h: rows.length * TILE,
    },
    vent,
  );
  fillRect(
    ctx,
    {
      x: FLOOR_X0 + FLOOR_W,
      y: tileTop(RIGHT_EXHAUST_ROWS[0]),
      w: CASING,
      h: RIGHT_EXHAUST_ROWS.length * TILE,
    },
    exhaust,
  );
  fillRect(
    ctx,
    {
      x: tileLeft(TOP_VENT_COLS[0]),
      y: 0,
      w: TOP_VENT_COLS.length * TILE,
      h: CASING,
    },
    vent,
  );
  fillRect(
    ctx,
    {
      x: tileLeft(BOTTOM_EXHAUST_COLS[0]),
      y: FLOOR_Y0 + FLOOR_H,
      w: BOTTOM_EXHAUST_COLS.length * TILE,
      h: CASING,
    },
    exhaust,
  );

  // The build zone a restricted mode draws, under the grid so the grid still
  // reads over it.
  const zone = figuresOf(state).buildZone;
  if (zone !== null) {
    fillRect(
      ctx,
      {
        x: tileLeft(zone.col0),
        y: tileTop(zone.row0),
        w: (zone.col1 - zone.col0 + 1) * TILE,
        h: (zone.row1 - zone.row0 + 1) * TILE,
      },
      css(RGB.zone),
    );
    strokeRect(
      ctx,
      {
        x: tileLeft(zone.col0),
        y: tileTop(zone.row0),
        w: (zone.col1 - zone.col0 + 1) * TILE,
        h: (zone.row1 - zone.row0 + 1) * TILE,
      },
      css(RGB.zoneEdge),
      2,
    );
  }

  // The tile grid, visible at all times, with no tower placed.
  ctx.strokeStyle = css(RGB.grid);
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let c = 0; c <= COLS; c += 1) {
    ctx.moveTo(tileLeft(c) + 0.5, FLOOR_Y0);
    ctx.lineTo(tileLeft(c) + 0.5, FLOOR_Y0 + FLOOR_H);
  }
  for (let r = 0; r <= ROWS; r += 1) {
    ctx.moveTo(FLOOR_X0, tileTop(r) + 0.5);
    ctx.lineTo(FLOOR_X0 + FLOOR_W, tileTop(r) + 0.5);
  }
  ctx.stroke();
}

// ---- A tower --------------------------------------------------------------

/** The colour a tower's body is drawn in right now. */
export function towerBodyColor(tower: TowerState): string {
  if (tower.tripped) return css(RGB.tripped);
  if (tower.type === "forge") return css(RGB.forge);
  if (tower.type === "sink") return css(RGB.sink);
  return css(heatRgb(tower.heat));
}

/** The face bars: radiator faces drawn plainly apart from plain ones. */
function drawFaces(ctx: Ctx, tower: TowerState, rect: Rect): void {
  const radiators = new Set(worldRadiatorsOf(tower));
  const thickness = 4;
  const bars: Record<string, Rect> = {
    N: { x: rect.x, y: rect.y, w: rect.w, h: thickness },
    S: { x: rect.x, y: rect.y + rect.h - thickness, w: rect.w, h: thickness },
    W: { x: rect.x, y: rect.y, w: thickness, h: rect.h },
    E: { x: rect.x + rect.w - thickness, y: rect.y, w: thickness, h: rect.h },
  };
  for (const face of ["N", "E", "S", "W"] as const) {
    fillRect(
      ctx,
      bars[face],
      radiators.has(face) ? css(RGB.radiator) : css(RGB.plainFace),
    );
  }
}

/** The heat read every tower carries on its footprint, with its redline mark. */
function drawHeatRead(ctx: Ctx, tower: TowerState, rect: Rect): void {
  const def = emitterDef(tower.type);
  if (def === null) return;
  const track: Rect = {
    x: rect.x + 5,
    y: rect.y + rect.h - 10,
    w: rect.w - 10,
    h: 5,
  };
  fillRect(ctx, track, css(RGB.barTrack));
  fillRect(
    ctx,
    { ...track, w: (track.w * Math.max(0, Math.min(100, tower.heat))) / 100 },
    css(heatRgb(tower.heat)),
  );
  const mark = track.x + (track.w * def.redline) / 100;
  fillRect(
    ctx,
    { x: mark - 1, y: track.y - 2, w: 2, h: track.h + 4 },
    css(RGB.redline),
  );
}

/** One tower on the floor: its body, its faces, its heat read, and its state. */
export function drawTower(
  state: MeltdownState,
  tower: TowerState,
  ctx: Ctx,
): void {
  const size = sizeOf(tower.type);
  const rect = footprintRect(tower.col, tower.row, size);
  fillRect(ctx, rect, towerBodyColor(tower));
  drawFaces(ctx, tower, rect);
  strokeRect(ctx, rect, css(RGB.barTrack), 1);

  if (tower.tripped) {
    // Hazard stripes, so a tripped tower is unmistakable at any heat.
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.w, rect.h);
    ctx.clip();
    ctx.strokeStyle = css(RGB.trippedMark);
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let offset = -rect.h; offset < rect.w; offset += 10) {
      ctx.moveTo(rect.x + offset, rect.y);
      ctx.lineTo(rect.x + offset + rect.h, rect.y + rect.h);
    }
    ctx.stroke();
    ctx.restore();
  }

  drawHeatRead(ctx, tower, rect);

  label(
    ctx,
    TOWER_LABEL[tower.type],
    rect.x + rect.w / 2,
    rect.y + rect.h / 2 - 3,
    FONT.small,
    css(tower.tripped || tower.heat > 62 ? RGB.barTrack : RGB.text),
    "center",
  );
  if (tower.level > 1) {
    label(
      ctx,
      "I".repeat(tower.level),
      rect.x + rect.w - 4,
      rect.y + 10,
      FONT.small,
      css(RGB.select),
      "right",
    );
  }

  if (state.selected === tower.id) {
    strokeRect(ctx, rect, css(RGB.select), 2);
  }
}

// ---- A surge unit ---------------------------------------------------------

/** The radius each surge type is drawn at. */
const UNIT_RADIUS: Readonly<Record<SurgeType, number>> = {
  mote: 6,
  sprint: 5,
  hulk: 9,
  swarm: 4,
  drift: 7,
  core: 13,
};

/** One surge unit: its body, and the health bar above it. */
export function drawUnit(unit: UnitState, ctx: Ctx): void {
  const radius = UNIT_RADIUS[unit.type];
  const color = css(SURGE_RGB[unit.type]);

  if (SURGE_DEFS[unit.type].flies) {
    // A flyer reads as a diamond over a shadow ring, so it is told from a
    // walker by shape as well as by colour.
    ctx.strokeStyle = rgba(SURGE_RGB[unit.type], 0.4);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(unit.x, unit.y, radius + 5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(unit.x, unit.y - radius);
    ctx.lineTo(unit.x + radius, unit.y);
    ctx.lineTo(unit.x, unit.y + radius);
    ctx.lineTo(unit.x - radius, unit.y);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(unit.x, unit.y, radius, 0, Math.PI * 2);
    ctx.fill();
    if (unit.type === "core") {
      ctx.strokeStyle = css(RGB.text);
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  if (unit.slowFactor > 0) {
    ctx.strokeStyle = css(RGB.vent);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(unit.x, unit.y, radius + 2.5, 0, Math.PI * 2);
    ctx.stroke();
  }

  const width = Math.max(14, radius * 2);
  const track: Rect = {
    x: unit.x - width / 2,
    y: unit.y - radius - 7,
    w: width,
    h: 3,
  };
  fillRect(ctx, track, css(RGB.healthTrack));
  const share = unit.maxHp > 0 ? Math.max(0, unit.hp / unit.maxHp) : 0;
  fillRect(ctx, { ...track, w: track.w * Math.min(1, share) }, css(RGB.health));
}

// ---- The preview and the range rings --------------------------------------

/** A ring at a tower's range, centred on its footprint centre. */
function drawRing(ctx: Ctx, x: number, y: number, radius: number): void {
  if (radius <= 0) return;
  ctx.strokeStyle = rgba(RGB.ring, 0.75);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.stroke();
}

/** The held preview at its footprint, and the ring of a selected tower. */
export function drawPreview(state: MeltdownState, ctx: Ctx): void {
  const selected = state.towers.find((tower) => tower.id === state.selected);
  if (selected !== undefined) {
    const centre = towerCentre(selected);
    drawRing(ctx, centre.x, centre.y, rangeUnits(selected));
  }

  const build = state.build;
  if (build === null) return;
  const size = sizeOf(build.type);
  const rect = footprintRect(build.col, build.row, size);
  const valid = previewValid(state);
  const tint = valid ? RGB.previewValid : RGB.previewInvalid;
  fillRect(ctx, rect, rgba(tint, 0.4));
  strokeRect(ctx, rect, css(tint), 2);

  const radiators = new Set(
    worldFaces(TOWER_DEFS[build.type].radiators, build.rotation),
  );
  const thickness = 4;
  const bars: Record<string, Rect> = {
    N: { x: rect.x, y: rect.y, w: rect.w, h: thickness },
    S: { x: rect.x, y: rect.y + rect.h - thickness, w: rect.w, h: thickness },
    W: { x: rect.x, y: rect.y, w: thickness, h: rect.h },
    E: { x: rect.x + rect.w - thickness, y: rect.y, w: thickness, h: rect.h },
  };
  for (const face of ["N", "E", "S", "W"] as const) {
    if (radiators.has(face)) fillRect(ctx, bars[face], css(RGB.radiator));
  }

  const def = emitterDef(build.type);
  if (def !== null) {
    drawRing(ctx, rect.x + rect.w / 2, rect.y + rect.h / 2, def.range * TILE);
  }
}

// ---- The build panel ------------------------------------------------------

/** One line of the information area, advancing its own cursor. */
function infoLine(
  ctx: Ctx,
  y: number,
  left: string,
  right: string,
  color: Rgb = RGB.text,
): number {
  label(ctx, left, PANEL_INNER_X, y, FONT.small, css(RGB.textDim));
  label(
    ctx,
    right,
    PANEL_INNER_X + PANEL_INNER_W,
    y,
    FONT.small,
    css(color),
    "right",
  );
  return y + 16;
}

/** The hover panel: a type's figures at level I. */
function drawTypeInfo(ctx: Ctx, type: TowerType): void {
  let y = INFO_Y + 14;
  label(ctx, TOWER_NAME[type], PANEL_INNER_X, y, FONT.label, css(RGB.text));
  y += 20;
  const def = TOWER_DEFS[type];
  y = infoLine(ctx, y, "SIZE", `${def.size}x${def.size}`);
  y = infoLine(ctx, y, "COST", `${def.cost}`);
  if (def.kind === "emitter") {
    y = infoLine(ctx, y, "RANGE", `${round(def.range)} TILES`);
    y = infoLine(
      ctx,
      y,
      type === "rime" ? "SLOW" : "DAMAGE",
      type === "rime"
        ? `${Math.round(RIME_SLOW_CEIL[0] * 100)}% COLD`
        : `${round(def.baseDamage)}`,
    );
    y = infoLine(ctx, y, "FIRE RATE", `${round(def.fireRate)}/S`);
    y = infoLine(ctx, y, "TARGETS", TARGETING_READ[type]);
    y = infoLine(ctx, y, "MASS", `${round(def.mass, 2)}`);
    infoLine(ctx, y, "RADIATORS", def.radiators.join(" "));
  } else {
    y = infoLine(ctx, y, "RANGE", "NONE");
    y = infoLine(
      ctx,
      y,
      "EFFECT",
      type === "forge"
        ? `WARMS TO ${FORGE_SETPOINT[0]}`
        : `DRAINS ${SINK_OUTPUT[0]}/EDGE`,
    );
    y = infoLine(ctx, y, "FIRE RATE", "NONE");
    y = infoLine(ctx, y, "TARGETS", TARGETING_READ[type]);
    y = infoLine(ctx, y, "MASS", "NONE");
    infoLine(ctx, y, "RADIATORS", "NONE");
  }
}

/** The inspector: a placed tower's live figures, and its two actions. */
function drawInspector(ctx: Ctx, tower: TowerState): void {
  let y = INFO_Y + 14;
  label(
    ctx,
    `${TOWER_NAME[tower.type]}  ${"I".repeat(tower.level)}`,
    PANEL_INNER_X,
    y,
    FONT.label,
    css(RGB.text),
  );
  y += 20;
  const size = sizeOf(tower.type);
  const stats = liveStats(tower);
  y = infoLine(ctx, y, "SIZE", `${size}x${size}`);
  const def = emitterDef(tower.type);
  if (def === null) {
    y = infoLine(ctx, y, "HEAT", "NONE");
    y = infoLine(ctx, y, "RANGE", "NONE");
    y = infoLine(
      ctx,
      y,
      "OUTPUT",
      tower.type === "forge"
        ? `WARMS TO ${outputOf(tower)}`
        : `DRAINS ${outputOf(tower)}/EDGE`,
    );
    y = infoLine(ctx, y, "FIRE RATE", "NONE");
    y = infoLine(ctx, y, "TARGETS", TARGETING_READ[tower.type]);
    y = infoLine(ctx, y, "MASS  KILLS", `NONE  ${tower.kills}`);
    infoLine(
      ctx,
      y,
      "DEALT  RADIATORS",
      `${Math.round(tower.damageDealt)}  NONE`,
    );
    return;
  }
  y = infoLine(
    ctx,
    y,
    "HEAT",
    `${round(tower.heat)} / ${redlineOf(tower)}`,
    tower.tripped ? RGB.textBad : RGB.text,
  );
  y = infoLine(ctx, y, "RANGE", `${round(stats.range)} TILES`);
  // A selected Rime shows its live slow where another emitter shows its
  // damage: a display convention of this panel and nothing more
  // (specs/hud.md, The damage read).
  y =
    tower.type === "rime"
      ? infoLine(ctx, y, "SLOW", `${Math.round(slowFactorOf(tower) * 100)}%`)
      : infoLine(
          ctx,
          y,
          "DAMAGE",
          `${round(damageOf(tower))}  x${round(heatMultOf(tower), 2)}`,
        );
  y = infoLine(ctx, y, "FIRE RATE", `${round(stats.fireRate, 2)}/S`);
  y = infoLine(ctx, y, "TARGETS", TARGETING_READ[tower.type]);
  y = infoLine(ctx, y, "MASS  KILLS", `${round(def.mass, 2)}  ${tower.kills}`);
  infoLine(
    ctx,
    y,
    "DEALT  RADIATORS",
    `${Math.round(tower.damageDealt)}  ${worldRadiatorsOf(tower).join(" ")}`,
  );
}

/**
 * The next-wave preview, drawn in the opening phase or a build phase with
 * nothing hovered and nothing selected. The wave phase draws no preview: the
 * wave is already on the floor (specs/hud.md, The next-wave preview).
 *
 * The Hundred's one onslaught fields more than one type, so its preview reads
 * as mixed rather than naming one, alongside the count.
 */
function drawNextWave(state: MeltdownState, ctx: Ctx): void {
  if (state.phase === "wave") return;
  const next = nextWaveInfo(state);
  let y = INFO_Y + 14;
  label(ctx, "NEXT WAVE", PANEL_INNER_X, y, FONT.label, css(RGB.text));
  y += 20;
  if (next === null) {
    infoLine(ctx, y, "NONE", "RUN COMPLETE");
    return;
  }
  const mixed = state.mode === "hundred";
  y = infoLine(ctx, y, "TYPE", mixed ? "MIXED" : next.type.toUpperCase());
  y = infoLine(ctx, y, "COUNT", `${next.count}`);
  if (mixed) {
    infoLine(ctx, y, "EVERY TYPE", `x${HUNDRED_HP_SCALE} HP`);
    return;
  }
  const surge = SURGE_DEFS[next.type];
  y = infoLine(ctx, y, "SPEED", `${surge.speed}`);
  y = infoLine(ctx, y, "FLIES", surge.flies ? "YES" : "NO");
  infoLine(ctx, y, "LEAK COSTS", `${surge.leak}`);
}

/** One panel button. */
function drawButton(
  ctx: Ctx,
  rect: Rect,
  text: string,
  enabled: boolean,
): void {
  fillRect(ctx, rect, css(enabled ? RGB.panelEdge : RGB.barTrack));
  strokeRect(ctx, rect, css(enabled ? RGB.textDim : RGB.panelEdge), 1);
  label(
    ctx,
    text,
    rect.x + rect.w / 2,
    rect.y + rect.h / 2,
    FONT.small,
    css(enabled ? RGB.text : RGB.textDim),
    "center",
  );
}

/** The whole build panel: readouts, shop, information area, and controls. */
export function drawPanel(state: MeltdownState, ctx: Ctx): void {
  fillRect(ctx, { x: PANEL_X, y: 0, w: PANEL_W, h: STAGE_H }, css(RGB.panel));
  fillRect(ctx, { x: PANEL_X, y: 0, w: 2, h: STAGE_H }, css(RGB.panelEdge));

  const figures = figuresOf(state);

  // The three status readouts, drawn at all times during a run.
  let y = STATUS_Y + 12;
  label(ctx, HUD_MONEY_LABEL, PANEL_INNER_X, y, FONT.label, css(RGB.textDim));
  label(
    ctx,
    `${state.money}`,
    PANEL_INNER_X + PANEL_INNER_W,
    y,
    FONT.readout,
    css(RGB.textGood),
    "right",
  );
  y += 28;
  label(ctx, HUD_LIVES_LABEL, PANEL_INNER_X, y, FONT.label, css(RGB.textDim));
  label(
    ctx,
    `${state.lives}`,
    PANEL_INNER_X + PANEL_INNER_W,
    y,
    FONT.readout,
    css(state.lives <= 3 ? RGB.textBad : RGB.text),
    "right",
  );
  y += 28;
  label(ctx, HUD_WAVE_LABEL, PANEL_INNER_X, y, FONT.label, css(RGB.textDim));
  label(
    ctx,
    state.mode === "hundred"
      ? `ONSLAUGHT ${HUNDRED_UNITS}`
      : `${state.wave} / ${figures.waveCount}`,
    PANEL_INNER_X + PANEL_INNER_W,
    y,
    FONT.readout,
    css(RGB.text),
    "right",
  );
  y += 22;
  if (state.phase === "building") {
    label(
      ctx,
      `BUILD ${state.buildTimer.toFixed(1)}S`,
      PANEL_INNER_X + PANEL_INNER_W,
      y,
      FONT.small,
      css(RGB.select),
      "right",
    );
  } else if (state.phase === "wave") {
    label(
      ctx,
      `SURGE ${state.wavePending + state.surge.length}`,
      PANEL_INNER_X + PANEL_INNER_W,
      y,
      FONT.small,
      css(RGB.textBad),
      "right",
    );
  }

  // The shop: all eight types, in shop order, each with its cost.
  const controls = panelControls(state);
  for (const entry of controls.shop) {
    const def = TOWER_DEFS[entry.type];
    const affordable = state.money >= def.cost;
    const armed = state.build?.type === entry.type;
    const hovered = state.hoverShop === entry.type;
    fillRect(
      ctx,
      entry,
      css(armed ? RGB.panelEdge : hovered ? RGB.zone : RGB.barTrack),
    );
    strokeRect(ctx, entry, css(armed ? RGB.select : RGB.panelEdge), 1);
    const color = affordable ? RGB.text : RGB.textDim;
    label(
      ctx,
      TOWER_NAME[entry.type],
      entry.x + 10,
      entry.y + SHOP_ROW_H / 2,
      FONT.label,
      css(color),
    );
    label(
      ctx,
      `${def.cost}`,
      entry.x + entry.w - 10,
      entry.y + SHOP_ROW_H / 2,
      FONT.label,
      css(affordable ? RGB.textGood : RGB.textBad),
      "right",
    );
  }

  // The information area: the hover panel, the inspector, or the next wave.
  fillRect(
    ctx,
    { x: PANEL_INNER_X, y: INFO_Y, w: PANEL_INNER_W, h: INFO_H },
    css(RGB.barTrack),
  );
  const selected = state.towers.find((tower) => tower.id === state.selected);
  if (state.hoverShop !== null) drawTypeInfo(ctx, state.hoverShop);
  else if (selected !== undefined) drawInspector(ctx, selected);
  else drawNextWave(state, ctx);

  if (controls.rotate !== null)
    drawButton(ctx, controls.rotate, "ROTATE", true);
  if (controls.cancel !== null)
    drawButton(ctx, controls.cancel, "CANCEL", true);
  if (controls.upgrade !== null && selected !== undefined) {
    const cost = upgradeCostOf(selected);
    drawButton(
      ctx,
      controls.upgrade,
      cost === 0 ? "MAX LEVEL" : `UPGRADE ${cost}`,
      cost > 0 && state.money >= cost,
    );
  }
  if (controls.sell !== null && selected !== undefined) {
    drawButton(ctx, controls.sell, `SELL ${refundOf(selected)}`, true);
  }
  drawButton(
    ctx,
    controls.send,
    state.phase === "opening" ? "START" : "SEND",
    state.phase !== "wave",
  );
  drawButton(ctx, controls.speed, `${state.speed}X`, true);
  drawButton(
    ctx,
    controls.pause,
    state.screen === "paused" ? "PLAY" : "PAUSE",
    true,
  );
  drawButton(ctx, controls.mute, state.muted ? "MUTED" : "SOUND", true);
}

// ---- The screens ----------------------------------------------------------

/** A screen's menu, with its highlighted row drawn plainly apart. */
function drawMenu(
  state: MeltdownState,
  ctx: Ctx,
  items: readonly string[],
  detail?: (index: number, rect: Rect) => void,
): void {
  const geometry = menuGeometry(state.screen);
  if (geometry === null) return;
  items.forEach((item, index) => {
    const rect = menuRowRect(state.screen, index);
    if (rect === null) return;
    const highlighted = index === state.menuIndex;
    fillRect(ctx, rect, css(highlighted ? RGB.zone : RGB.panel));
    strokeRect(
      ctx,
      rect,
      css(highlighted ? RGB.select : RGB.panelEdge),
      highlighted ? 3 : 1,
    );
    label(
      ctx,
      item,
      rect.x + 20,
      rect.y + rect.h / 2,
      FONT.menu,
      css(highlighted ? RGB.text : RGB.textDim),
    );
    detail?.(index, rect);
  });
}

/** A full-stage backdrop for a screen that does not show the floor. */
function drawBackdrop(ctx: Ctx): void {
  fillRect(ctx, { x: 0, y: 0, w: STAGE_W, h: STAGE_H }, css(RGB.bg));
  ctx.strokeStyle = css(RGB.grid);
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= STAGE_W; x += 40) {
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, STAGE_H);
  }
  ctx.stroke();
}

/** Everything drawn over or in place of the floor, screen by screen. */
export function drawScreen(state: MeltdownState, ctx: Ctx): void {
  switch (state.screen) {
    case "title":
      drawBackdrop(ctx);
      label(
        ctx,
        TITLE_TEXT,
        STAGE_W / 2,
        250,
        FONT.title,
        css(heatRgb(88)),
        "center",
      );
      label(
        ctx,
        TAGLINE_TEXT,
        STAGE_W / 2,
        320,
        FONT.heading,
        css(RGB.textDim),
        "center",
      );
      drawMenu(state, ctx, TITLE_ITEMS);
      return;
    case "modeselect": {
      drawBackdrop(ctx);
      label(ctx, "SELECT A MODE", 110, 140, FONT.heading, css(RGB.text));
      drawMenu(state, ctx, MODE_ITEMS);
      const mode = MODE_ITEMS[state.menuIndex];
      const key = MODES[state.menuIndex];
      label(ctx, mode, 610, 200, FONT.heading, css(RGB.select));
      MODE_BLURB[key].forEach((line, index) => {
        label(ctx, line, 610, 250 + index * 26, FONT.body, css(RGB.text));
      });
      label(
        ctx,
        "ENTER TO CHOOSE   ESC TO GO BACK",
        610,
        420,
        FONT.small,
        css(RGB.textDim),
      );
      return;
    }
    case "difficultyselect":
      drawBackdrop(ctx);
      label(
        ctx,
        "CONTAINMENT",
        STAGE_W / 2,
        170,
        FONT.heading,
        css(RGB.text),
        "center",
      );
      drawMenu(state, ctx, DIFFICULTY_ITEMS, (index, rect) => {
        const row = DIFFICULTY_TABLE[DIFFICULTIES[index]];
        label(
          ctx,
          `${row.money} MONEY   ${row.waves} WAVES`,
          rect.x + rect.w - 20,
          rect.y + rect.h / 2,
          FONT.body,
          css(RGB.textGood),
          "right",
        );
      });
      return;
    case "howto":
      drawBackdrop(ctx);
      label(ctx, "HOW TO PLAY", 70, 46, FONT.heading, css(RGB.text));
      HOWTO_LINES.forEach((line, index) => {
        label(
          ctx,
          line,
          70,
          82 + index * 15,
          FONT.small,
          css(line.startsWith("  ") ? RGB.text : RGB.select),
        );
      });
      label(
        ctx,
        "ESC TO GO BACK",
        STAGE_W - 70,
        STAGE_H - 24,
        FONT.small,
        css(RGB.textDim),
        "right",
      );
      return;
    case "paused":
      // The floor is still drawn behind the menu.
      fillRect(ctx, { x: 0, y: 0, w: STAGE_W, h: STAGE_H }, rgba(RGB.bg, 0.72));
      label(
        ctx,
        "PAUSED",
        STAGE_W / 2,
        230,
        FONT.heading,
        css(RGB.text),
        "center",
      );
      drawMenu(state, ctx, PAUSE_ITEMS);
      return;
    case "victory":
    case "gameover": {
      drawBackdrop(ctx);
      const won = state.screen === "victory";
      label(
        ctx,
        won ? "CONTAINED" : "MELTDOWN",
        STAGE_W / 2,
        220,
        FONT.title,
        css(won ? RGB.textGood : RGB.exhaust),
        "center",
      );
      const figures = figuresOf(state);
      const lines = won
        ? [
            `SCORE ${state.score}`,
            `WAVES SURVIVED ${figures.waveCount}`,
            `LIVES REMAINING ${state.lives}`,
          ]
        : [`SCORE ${state.score}`, `WAVE REACHED ${state.wave}`];
      lines.forEach((line, index) => {
        label(
          ctx,
          line,
          STAGE_W / 2,
          320 + index * 34,
          FONT.menu,
          css(RGB.text),
          "center",
        );
      });
      drawMenu(state, ctx, ENDING_ITEMS);
      return;
    }
    case "playing":
      return;
  }
}

/** The eight shop types, exported so a test can walk the same order. */
export const SHOP_ORDER: readonly TowerType[] = TOWER_TYPES;
