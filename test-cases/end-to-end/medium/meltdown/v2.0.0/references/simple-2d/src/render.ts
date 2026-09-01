// Meltdown — every pixel this build draws.
//
// specs/overview.md leaves the palette, the type and the artwork to the build
// and states instead what a player must READ at a glance: an emitter's heat
// along a ramp, a tripped tower apart from an online one, a heat read with a
// marker at the redline, radiator faces apart from plain ones, the surge apart
// from the floor and from every colour a tower shows, the casing and its two
// kinds of opening, the grid, a valid preview apart from an invalid one, the
// build zone, and legible text. Each of those is drawn here, off `src/theme.ts`
// and `src/panel.ts`.
//
// Rendering reads the state and writes nothing: the read-only view the engine
// hands over is what guarantees it.

import {
  BOTTOM_EXHAUST_COLS,
  CASING,
  COLS,
  DIFFICULTIES,
  DIFFICULTY_ITEMS,
  DIFFICULTY_TABLE,
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
  TOWER_DEFS,
  TRIP_HEAT,
  tileLeft,
  tileTop,
  type ModeName,
  type TowerType,
} from "./constants";
import { heldValid } from "./build";
import { sizeOf, worldRadiators } from "./geometry";
import { buildZoneOf, waveCountOf, waveSizeOf, waveTypeOf } from "./modes";
import {
  PANEL,
  controlsOf,
  menuRects,
  selectedTower,
  type Rect,
} from "./panel";
import { menuItems } from "./flow";
import {
  SURGE_COLOR,
  COLOR,
  css,
  font,
  heatRgb,
  towerBody,
  withAlpha,
} from "./theme";
import {
  costOf,
  damageOf,
  emitterOf,
  heatMultOf,
  outputOf,
  redlineOf,
  refundOf,
  slowFactorOf,
  towerCentre,
  upgradeCostOf,
} from "./stats";
import type { MeltdownState, TowerState, UnitState } from "./game";

type Ctx = CanvasRenderingContext2D;

/** The label the shop and the panel give each tower. */
const TOWER_LABEL: Readonly<Record<TowerType, string>> = {
  arc: "ARC",
  stutter: "STUTTER",
  rime: "RIME",
  flak: "FLAK",
  bloom: "BLOOM",
  lance: "LANCE",
  forge: "FORGE",
  sink: "SINK",
};

/** What each mode is, drawn beside its row before it is chosen. */
const MODE_BLURB: Readonly<Record<ModeName, string[]>> = {
  containment: [
    "The standard run. Hold the floor through every wave of the",
    "progression at one of three difficulties, which set the",
    "starting money and how many waves you face.",
  ],
  hundred: [
    "One onslaught instead of a progression: a hundred units,",
    "cycling every type, each six times as tough. No build",
    "phases, because there is only ever one wave.",
  ],
  deeppockets: [
    "Ten thousand to spend and no interest paid. Build the maze",
    "you want on wave one and find out whether money was ever",
    "the thing holding you back.",
  ],
  bottleneck: [
    "Building is restricted to a marked central zone. The floor",
    "outside it stays open for the surge, and both straight",
    "vent-to-exhaust corridors run through it.",
  ],
  suddendeath: [
    "One life. A single unit reaching an exhaust ends the run,",
    "whatever it was and however far in.",
  ],
};

/**
 * The how-to screen's vertical rhythm.
 *
 * The step is what makes the body fit: HOWTO_LINES is long enough that a 20px
 * step would carry its last line to 716, past the 720 of the stage and straight
 * through the footer.
 */
const HOWTO_TOP = 116;
const HOWTO_LINE_STEP = 19;
const HOWTO_FOOTER_GAP = 14;

/** The how-to screen's body, one line per entry. */
const HOWTO_LINES: readonly string[] = [
  "GOAL — the surge pours in through the two vents and crosses the floor to the",
  "opposite exhaust. Every unit that gets there costs you lives. Clear every wave.",
  "",
  "CONTROLS — arm a tower from the shop or with 1-8, carry it over the floor and",
  "press to place. R rotates the held preview, Esc cancels it. Press a placed",
  "tower to select it, U upgrades, S sells. Space sends the next wave, F toggles",
  "speed, P pauses, M mutes.",
  "",
  "TOWERS ARE WALLS — there is no fixed path. Every footprint you place is a wall,",
  "so you build the maze the surge walks. The floor can never be sealed shut.",
  "",
  "HEAT IS POWER — an emitter fires harder the hotter it runs, climbing to full",
  "power at its own redline and holding it there. Carry one all the way to 100",
  "and it TRIPS: offline for five seconds while it bleeds back to cold.",
  "",
  "THE FORGE AND THE SINK — the Forge warms every emitter it touches toward its",
  "setpoint; the Sink drains heat out through a face that would otherwise shed",
  "nothing. Neither one fires, and both block their tiles like any other tower.",
  "",
  "THE RIME runs the rule backward: its slow is strongest when it is COLD, and",
  "nothing at all at 100. It still deals ordinary damage.",
  "",
  "FLYERS — the Drift ignores the maze entirely and flies straight to its exhaust.",
  "The Flak is the answer, and it targets air alone.",
  "",
  "WAVES — a Containment wave fields a single type, and the halfway and final",
  "waves are a Core. The Hundred is the exception and cycles every type.",
  "",
  "MONEY — kills pay a bounty, a cleared wave pays a bonus, a build phase pays 8%",
  "interest up to 40, and sending early pays 1 for each whole second left.",
];

/** Draw the whole game, whichever screen it is on. */
export function renderGame(state: MeltdownState, ctx: Ctx): void {
  ctx.save();
  ctx.fillStyle = COLOR.bg;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);

  if (state.screen === "playing" || state.screen === "paused") {
    drawReactor(state, ctx);
    drawPanel(state, ctx);
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
      drawHowTo(ctx);
      break;
    case "paused":
      drawPause(state, ctx);
      break;
    case "victory":
    case "gameover":
      drawEnding(state, ctx);
      break;
    case "playing":
      break;
  }
  ctx.restore();
}

// ---- Text ----------------------------------------------------------------

function text(
  ctx: Ctx,
  value: string,
  x: number,
  y: number,
  size: number,
  color: string,
  align: CanvasTextAlign = "left",
  weight = 600,
): void {
  ctx.font = font(size, weight);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(value, x, y);
}

// ---- The reactor ---------------------------------------------------------

function drawReactor(state: MeltdownState, ctx: Ctx): void {
  // The casing band, then the floor punched out of it.
  ctx.fillStyle = COLOR.casing;
  ctx.fillRect(0, 0, REACTOR_W, STAGE_H);
  ctx.strokeStyle = COLOR.casingEdge;
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, REACTOR_W - 2, STAGE_H - 2);
  ctx.fillStyle = COLOR.floor;
  ctx.fillRect(FLOOR_X0, FLOOR_Y0, FLOOR_W, FLOOR_H);

  drawBuildZone(state, ctx);
  drawGrid(ctx);
  drawOpenings(ctx);

  for (const tower of state.towers) drawTower(ctx, tower);
  drawPreview(state, ctx);
  for (const unit of state.surge) drawUnit(ctx, unit);
  drawSelection(state, ctx);
}

function drawBuildZone(state: MeltdownState, ctx: Ctx): void {
  const zone = buildZoneOf(state.mode);
  if (!zone) return;
  const x = tileLeft(zone.col0);
  const y = tileTop(zone.row0);
  const w = (zone.col1 - zone.col0 + 1) * TILE;
  const h = (zone.row1 - zone.row0 + 1) * TILE;
  ctx.fillStyle = COLOR.zone;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = COLOR.zoneEdge;
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
}

function drawGrid(ctx: Ctx): void {
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
}

function drawOpenings(ctx: Ctx): void {
  ctx.fillStyle = COLOR.vent;
  ctx.fillRect(
    0,
    tileTop(LEFT_VENT_ROWS[0]),
    CASING,
    LEFT_VENT_ROWS.length * TILE,
  );
  ctx.fillRect(
    tileLeft(TOP_VENT_COLS[0]),
    0,
    TOP_VENT_COLS.length * TILE,
    CASING,
  );
  ctx.fillStyle = COLOR.exhaust;
  ctx.fillRect(
    FLOOR_X1,
    tileTop(RIGHT_EXHAUST_ROWS[0]),
    CASING,
    RIGHT_EXHAUST_ROWS.length * TILE,
  );
  ctx.fillRect(
    tileLeft(BOTTOM_EXHAUST_COLS[0]),
    FLOOR_Y1,
    BOTTOM_EXHAUST_COLS.length * TILE,
    CASING,
  );
}

/** The bar along one world face of a footprint, which is how a radiator reads. */
function faceBar(
  ctx: Ctx,
  x: number,
  y: number,
  span: number,
  face: string,
  color: string,
): void {
  const t = 4;
  ctx.fillStyle = color;
  if (face === "N") ctx.fillRect(x, y, span, t);
  else if (face === "S") ctx.fillRect(x, y + span - t, span, t);
  else if (face === "W") ctx.fillRect(x, y, t, span);
  else ctx.fillRect(x + span - t, y, t, span);
}

function drawTower(ctx: Ctx, tower: TowerState): void {
  const size = sizeOf(tower.type);
  const x = tileLeft(tower.col);
  const y = tileTop(tower.row);
  const span = size * TILE;

  ctx.fillStyle = towerBody(tower.heat, tower.tripped);
  ctx.fillRect(x + 1, y + 1, span - 2, span - 2);
  ctx.strokeStyle = COLOR.bright;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 1.5, y + 1.5, span - 3, span - 3);

  for (const face of worldRadiators(tower.type, tower.rotation)) {
    faceBar(ctx, x + 1, y + 1, span - 2, face, COLOR.radiator);
  }

  if (tower.tripped) {
    ctx.strokeStyle = withAlpha(COLOR.invalid, 0.95);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x + 4, y + 4);
    ctx.lineTo(x + span - 4, y + span - 4);
    ctx.moveTo(x + span - 4, y + 4);
    ctx.lineTo(x + 4, y + span - 4);
    ctx.stroke();
  }

  text(
    ctx,
    TOWER_LABEL[tower.type].slice(0, 2),
    x + span / 2,
    y + span / 2 + 4,
    Math.min(13, span / 2),
    COLOR.bg,
    "center",
    700,
  );

  drawHeatRead(ctx, tower, x, y, span);
}

/** The on-floor heat read: a bar whose extent tracks the heat, with a marker
 * at the tower's redline (specs/hud.md, The reads on the floor). */
function drawHeatRead(
  ctx: Ctx,
  tower: TowerState,
  x: number,
  y: number,
  span: number,
): void {
  const barX = x + 3;
  const barY = y + span - 7;
  const barW = span - 6;
  ctx.fillStyle = COLOR.hpBack;
  ctx.fillRect(barX, barY, barW, 4);
  const heat = Math.max(0, Math.min(TRIP_HEAT, tower.heat));
  ctx.fillStyle = css(heatRgb(heat));
  ctx.fillRect(barX, barY, (barW * heat) / TRIP_HEAT, 4);
  const redline = redlineOf(tower.type);
  if (redline > 0) {
    ctx.fillStyle = COLOR.redlineMark;
    ctx.fillRect(barX + (barW * redline) / TRIP_HEAT - 1, barY - 2, 2, 8);
  }
}

function drawRangeRing(
  ctx: Ctx,
  centre: { x: number; y: number },
  radius: number,
  color: string,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(centre.x, centre.y, radius, 0, Math.PI * 2);
  ctx.stroke();
}

function drawPreview(state: MeltdownState, ctx: Ctx): void {
  const held = state.build;
  if (!held) return;
  const size = sizeOf(held.type);
  const x = tileLeft(held.col);
  const y = tileTop(held.row);
  const span = size * TILE;
  const valid = heldValid(state);
  ctx.fillStyle = withAlpha(valid ? COLOR.valid : COLOR.invalid, 0.45);
  ctx.fillRect(x, y, span, span);
  ctx.strokeStyle = valid ? COLOR.valid : COLOR.invalid;
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, span - 2, span - 2);
  for (const face of worldRadiators(held.type, held.rotation)) {
    faceBar(ctx, x + 1, y + 1, span - 2, face, COLOR.radiator);
  }
  const stats = emitterOf({ type: held.type, level: 1 });
  if (stats) {
    drawRangeRing(
      ctx,
      { x: x + span / 2, y: y + span / 2 },
      stats.range * TILE,
      COLOR.ring,
    );
  }
}

function drawSelection(state: MeltdownState, ctx: Ctx): void {
  const tower = selectedTower(state);
  if (!tower) return;
  const size = sizeOf(tower.type);
  const x = tileLeft(tower.col);
  const y = tileTop(tower.row);
  const span = size * TILE;
  ctx.strokeStyle = COLOR.highlight;
  ctx.lineWidth = 2;
  ctx.strokeRect(x - 1, y - 1, span + 2, span + 2);
  const stats = emitterOf(tower);
  if (stats) {
    drawRangeRing(ctx, towerCentre(tower), stats.range * TILE, COLOR.ring);
  }
}

/** The radius each surge type is drawn at, in logical units. */
const UNIT_RADIUS: Readonly<Record<UnitState["type"], number>> = {
  mote: 6,
  sprint: 5,
  hulk: 9,
  swarm: 4,
  drift: 7,
  core: 13,
};

function drawUnit(ctx: Ctx, unit: UnitState): void {
  const r = UNIT_RADIUS[unit.type];
  const color = SURGE_COLOR[unit.type];
  ctx.fillStyle = color;
  ctx.beginPath();
  if (unit.type === "drift") {
    ctx.moveTo(unit.x, unit.y - r);
    ctx.lineTo(unit.x + r, unit.y);
    ctx.lineTo(unit.x, unit.y + r);
    ctx.lineTo(unit.x - r, unit.y);
    ctx.closePath();
  } else if (unit.type === "core") {
    for (let i = 0; i < 6; i += 1) {
      const a = (Math.PI / 3) * i - Math.PI / 2;
      const px = unit.x + Math.cos(a) * r;
      const py = unit.y + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  } else {
    ctx.arc(unit.x, unit.y, r, 0, Math.PI * 2);
  }
  ctx.fill();

  if (unit.slowFactor > 0) {
    ctx.strokeStyle = COLOR.radiator;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  const barW = r * 2 + 4;
  const barX = unit.x - barW / 2;
  const barY = unit.y - r - 7;
  ctx.fillStyle = COLOR.hpBack;
  ctx.fillRect(barX, barY, barW, 3);
  ctx.fillStyle = COLOR.hp;
  const ratio = unit.maxHp > 0 ? Math.max(0, unit.hp / unit.maxHp) : 0;
  ctx.fillRect(barX, barY, barW * Math.min(1, ratio), 3);
}

// ---- The build panel -----------------------------------------------------

function drawPanel(state: MeltdownState, ctx: Ctx): void {
  ctx.fillStyle = COLOR.panel;
  ctx.fillRect(PANEL.x, 0, PANEL.w, STAGE_H);
  ctx.strokeStyle = COLOR.panelEdge;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(PANEL.x + 1, 0);
  ctx.lineTo(PANEL.x + 1, STAGE_H);
  ctx.stroke();

  drawReadouts(state, ctx);
  drawShop(state, ctx);
  drawInfo(state, ctx);
  drawControls(state, ctx);
}

function drawReadouts(state: MeltdownState, ctx: Ctx): void {
  const x = PANEL.innerX;
  const right = PANEL.innerX + PANEL.innerW;
  const waveCount = waveCountOf(state.mode, state.difficulty);
  text(ctx, HUD_MONEY_LABEL, x, 30, 13, COLOR.dim);
  text(ctx, String(state.money), right, 30, 17, COLOR.text, "right", 700);
  text(ctx, HUD_LIVES_LABEL, x, 54, 13, COLOR.dim);
  text(ctx, String(state.lives), right, 54, 17, COLOR.text, "right", 700);
  text(ctx, HUD_WAVE_LABEL, x, 78, 13, COLOR.dim);
  text(
    ctx,
    state.mode === "hundred" ? "ONSLAUGHT" : `${state.wave}/${waveCount}`,
    right,
    78,
    17,
    COLOR.text,
    "right",
    700,
  );
  if (state.phase === "building") {
    text(ctx, "NEXT WAVE IN", x, 96, 12, COLOR.dim);
    text(
      ctx,
      `${Math.max(0, state.buildTimer).toFixed(1)}s`,
      right,
      96,
      13,
      COLOR.highlight,
      "right",
      700,
    );
  }
}

function drawShop(state: MeltdownState, ctx: Ctx): void {
  for (const slot of controlsOf(state).shop) {
    const def = TOWER_DEFS[slot.type];
    const affordable = state.money >= def.cost;
    ctx.fillStyle = affordable ? COLOR.slot : COLOR.slotDisabled;
    ctx.fillRect(slot.x, slot.y, slot.w, slot.h);
    ctx.strokeStyle =
      state.build?.type === slot.type ? COLOR.highlight : COLOR.slotEdge;
    ctx.lineWidth = state.build?.type === slot.type ? 2 : 1;
    ctx.strokeRect(slot.x + 0.5, slot.y + 0.5, slot.w - 1, slot.h - 1);
    text(
      ctx,
      TOWER_LABEL[slot.type],
      slot.x + 10,
      slot.y + 22,
      14,
      affordable ? COLOR.text : COLOR.dim,
    );
    text(
      ctx,
      String(def.cost),
      slot.x + slot.w - 10,
      slot.y + 22,
      14,
      affordable ? COLOR.highlight : COLOR.dim,
      "right",
      700,
    );
  }
}

/** What the tower panel reads for a type's targeting (specs/hud.md). */
function targetingRead(type: TowerType): string {
  if (TOWER_DEFS[type].kind === "mover") return "NEVER FIRES";
  return type === "flak" ? "TARGETS AIR ONLY" : "TARGETS GROUND + AIR";
}

/** The damage-or-effect line, which is a slow read on a Rime. */
function effectRead(tower: {
  type: TowerType;
  level: number;
  heat: number;
}): string {
  if (tower.type === "rime") {
    return `SLOW ${(slowFactorOf(tower) * 100).toFixed(0)}%`;
  }
  if (TOWER_DEFS[tower.type].kind === "mover") {
    return tower.type === "forge"
      ? `SETPOINT ${outputOf(tower)}`
      : `DRAIN ${outputOf(tower)}`;
  }
  return `DMG ${damageOf(tower).toFixed(1)}  x${heatMultOf(tower).toFixed(2)}`;
}

function infoLines(tower: {
  type: TowerType;
  level: number;
  heat: number;
  rotation: number;
}): string[] {
  const def = TOWER_DEFS[tower.type];
  const stats = emitterOf(tower);
  const faces = worldRadiators(tower.type, tower.rotation);
  return [
    `SIZE ${def.size}x${def.size}`,
    stats ? `RANGE ${stats.range.toFixed(1)}` : "RANGE —",
    effectRead(tower),
    stats ? `RATE ${stats.fireRate.toFixed(2)}/s` : "RATE —",
    targetingRead(tower.type),
    `MASS ${def.kind === "emitter" ? def.mass.toFixed(1) : "—"}`,
    `RADIATORS ${faces.length > 0 ? faces.join(" ") : "NONE"}`,
  ];
}

function drawInfo(state: MeltdownState, ctx: Ctx): void {
  const x = PANEL.innerX;
  const right = PANEL.innerX + PANEL.innerW;
  let y = PANEL.infoY + 20;

  const hovered = state.hoverShop;
  const tower = selectedTower(state);

  if (hovered) {
    text(ctx, TOWER_LABEL[hovered], x, y, 16, COLOR.text, "left", 700);
    text(ctx, `${costOf(hovered)}`, right, y, 14, COLOR.highlight, "right");
    y += 20;
    for (const line of infoLines({
      type: hovered,
      level: 1,
      heat: 0,
      rotation: 0,
    })) {
      text(ctx, line, x, y, 13, COLOR.dim);
      y += 18;
    }
    return;
  }

  if (tower) {
    text(
      ctx,
      `${TOWER_LABEL[tower.type]}  L${tower.level}`,
      x,
      y,
      16,
      COLOR.text,
      "left",
      700,
    );
    y += 20;
    for (const line of infoLines(tower)) {
      text(ctx, line, x, y, 13, COLOR.dim);
      y += 18;
    }
    text(
      ctx,
      `HEAT ${tower.heat.toFixed(1)} / ${redlineOf(tower.type)}${
        tower.tripped ? "  TRIPPED" : ""
      }`,
      x,
      y,
      13,
      COLOR.text,
    );
    y += 18;
    text(
      ctx,
      `KILLS ${tower.kills}   DEALT ${tower.damageDealt.toFixed(0)}`,
      x,
      y,
      13,
      COLOR.text,
    );
    return;
  }

  if (state.phase === "building" || state.phase === "opening") {
    const waveCount = waveCountOf(state.mode, state.difficulty);
    const coming = state.wave;
    if (coming <= waveCount) {
      text(ctx, "NEXT WAVE", x, y, 14, COLOR.dim);
      y += 22;
      const type =
        state.mode === "hundred"
          ? "MIXED"
          : waveTypeOf(state.mode, coming, waveCount).toUpperCase();
      text(ctx, type, x, y, 17, COLOR.text, "left", 700);
      text(
        ctx,
        `x${waveSizeOf(state.mode, coming, waveCount)}`,
        right,
        y,
        17,
        COLOR.highlight,
        "right",
        700,
      );
    }
  }
}

function drawButton(
  ctx: Ctx,
  rect: Rect,
  label: string,
  detail: string,
  accent: string,
): void {
  ctx.fillStyle = COLOR.slot;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1;
  ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
  text(
    ctx,
    label,
    rect.x + rect.w / 2,
    rect.y + rect.h / 2 + (detail ? -1 : 5),
    13,
    COLOR.text,
    "center",
    700,
  );
  if (detail) {
    text(
      ctx,
      detail,
      rect.x + rect.w / 2,
      rect.y + rect.h - 6,
      11,
      accent,
      "center",
    );
  }
}

function drawControls(state: MeltdownState, ctx: Ctx): void {
  const controls = controlsOf(state);
  if (controls.rotate) {
    drawButton(ctx, controls.rotate, "ROTATE", "R", COLOR.highlight);
  }
  if (controls.cancel) {
    drawButton(ctx, controls.cancel, "CANCEL", "ESC", COLOR.invalid);
  }
  const tower = selectedTower(state);
  if (controls.upgrade && tower) {
    drawButton(
      ctx,
      controls.upgrade,
      "UPGRADE",
      tower.level >= 3 ? "MAX" : String(upgradeCostOf(tower)),
      COLOR.highlight,
    );
  }
  if (controls.sell && tower) {
    drawButton(
      ctx,
      controls.sell,
      "SELL",
      String(refundOf(tower)),
      COLOR.valid,
    );
  }
  drawButton(
    ctx,
    controls.send,
    state.phase === "opening" ? "START" : "SEND",
    "",
    COLOR.valid,
  );
  drawButton(ctx, controls.speed, `${state.speed}x`, "", COLOR.highlight);
  drawButton(
    ctx,
    controls.pause,
    state.screen === "paused" ? "RESUME" : "PAUSE",
    "",
    COLOR.dim,
  );
  drawButton(
    ctx,
    controls.mute,
    state.muted ? "MUTED" : "SOUND",
    "",
    state.muted ? COLOR.invalid : COLOR.valid,
  );
}

// ---- The screens ---------------------------------------------------------

function drawMenu(state: MeltdownState, ctx: Ctx): void {
  const items = menuItems(state.screen);
  const rects = menuRects(state);
  items.forEach((label, index) => {
    const rect = rects[index];
    const on = index === state.menuIndex;
    ctx.fillStyle = on ? withAlpha(COLOR.highlight, 0.22) : COLOR.overlay;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.strokeStyle = on ? COLOR.highlight : COLOR.panelEdge;
    ctx.lineWidth = on ? 2 : 1;
    ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
    text(
      ctx,
      label,
      rect.x + rect.w / 2,
      rect.y + rect.h / 2 + 7,
      20,
      on ? COLOR.bright : COLOR.text,
      "center",
      on ? 700 : 600,
    );
  });
}

function drawTitle(state: MeltdownState, ctx: Ctx): void {
  text(ctx, TITLE_TEXT, STAGE_W / 2, 250, 92, COLOR.text, "center", 700);
  text(ctx, TAGLINE_TEXT, STAGE_W / 2, 300, 26, COLOR.highlight, "center");
  drawMenu(state, ctx);
}

function drawModeSelect(state: MeltdownState, ctx: Ctx): void {
  text(ctx, "SELECT A MODE", STAGE_W / 2, 150, 34, COLOR.text, "center", 700);
  drawMenu(state, ctx);
  const blurb = MODE_BLURB[MODES[state.menuIndex]] ?? [];
  let y = 552;
  for (const line of blurb) {
    text(ctx, line, STAGE_W / 2, y, 16, COLOR.dim, "center");
    y += 22;
  }
}

function drawDifficultySelect(state: MeltdownState, ctx: Ctx): void {
  text(ctx, "CONTAINMENT", STAGE_W / 2, 190, 34, COLOR.text, "center", 700);
  const rects = menuRects(state);
  DIFFICULTY_ITEMS.forEach((label, index) => {
    const rect = rects[index];
    const on = index === state.menuIndex;
    ctx.fillStyle = on ? withAlpha(COLOR.highlight, 0.22) : COLOR.overlay;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.strokeStyle = on ? COLOR.highlight : COLOR.panelEdge;
    ctx.lineWidth = on ? 2 : 1;
    ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
    const row = DIFFICULTY_TABLE[DIFFICULTIES[index]];
    text(
      ctx,
      label,
      rect.x + 16,
      rect.y + rect.h / 2 + 7,
      20,
      on ? COLOR.bright : COLOR.text,
      "left",
      on ? 700 : 600,
    );
    text(
      ctx,
      `${row.money} MONEY   ${row.waves} WAVES`,
      rect.x + rect.w - 16,
      rect.y + rect.h / 2 + 6,
      14,
      COLOR.dim,
      "right",
    );
  });
}

function drawHowTo(ctx: Ctx): void {
  text(ctx, "HOW TO PLAY", 80, 74, 34, COLOR.text, "left", 700);
  let y = HOWTO_TOP;
  for (const line of HOWTO_LINES) {
    text(ctx, line, 80, y, 15, line === "" ? COLOR.dim : COLOR.text);
    y += HOWTO_LINE_STEP;
  }
  // Below the copy rather than at a height of its own, so the block and the
  // control under it cannot run into each other however long the copy grows.
  text(ctx, "ESC — BACK", 80, y + HOWTO_FOOTER_GAP, 15, COLOR.highlight);
}

function drawPause(state: MeltdownState, ctx: Ctx): void {
  ctx.fillStyle = COLOR.scrim;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
  text(ctx, "PAUSED", STAGE_W / 2, 240, 56, COLOR.text, "center", 700);
  drawMenu(state, ctx);
}

function drawEnding(state: MeltdownState, ctx: Ctx): void {
  ctx.fillStyle = COLOR.scrim;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
  const won = state.screen === "victory";
  const waveCount = waveCountOf(state.mode, state.difficulty);
  text(
    ctx,
    won ? "CONTAINED" : "MELTDOWN",
    STAGE_W / 2,
    250,
    72,
    won ? COLOR.valid : COLOR.invalid,
    "center",
    700,
  );
  text(
    ctx,
    `SCORE ${state.score}`,
    STAGE_W / 2,
    318,
    28,
    COLOR.text,
    "center",
    700,
  );
  text(
    ctx,
    won
      ? `WAVES SURVIVED ${waveCount}    LIVES REMAINING ${state.lives}`
      : `WAVE REACHED ${state.wave}`,
    STAGE_W / 2,
    360,
    20,
    COLOR.dim,
    "center",
  );
  drawMenu(state, ctx);
}
