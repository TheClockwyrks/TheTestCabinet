// Holdfast — the in-code HUD dashboard (DESIGN §5, specs/overview.md, specs/controls.md).
//
// render.ts composes these over the colony view. The TOP strip is the vitals band: the four
// stock readouts (produced icons + numbers), the colony state (living count + hungry/tired/
// hurt flags), the day + time-of-day clock and speed, and — taking over the centre when a
// raid is near — the pulsing threat banner. The BOTTOM strip is the command band: a roster
// card per living settler (name, need/health bars, activity) and the build palette / tool
// bar (designate, cancel, the seven structures with costs, the work-grid toggle, and the
// speed / pause / mute controls). The WORK-PRIORITY GRID is a panel opened from the bottom
// bar. Everything here only reads the sim; the Clickable[] it emits is the input contract.

import {
  COL,
  EAT_THRESHOLD,
  FONT,
  RESOURCE_ORDER,
  SKILL_ORDER,
  SLEEP_TRIGGER_DAY,
  STAGE_H,
  STAGE_W,
  STRUCTURES,
  STRUCTURE_ORDER,
  TOP_H,
  VIEW_Y0,
  WORK_LABEL,
  WORK_ORDER,
  type Activity,
  type Skill,
  type StructureKind,
} from "./constants";
import type { Assets } from "./assets";
import type { Clickable, Phase, Settler } from "./types";
import type { Game } from "./sim";
import {
  BUILD_ICON,
  STOCK_ICON,
  bar,
  blit,
  button,
  hexA,
  inRect,
  isMuted,
  isWorkGridOpen,
  lineCount,
  ptr,
  renderTime,
  roundRect,
  text,
  wrap,
} from "./render";

// ---- top strip ----------------------------------------------------------------
export function drawTopHud(ctx: CanvasRenderingContext2D, game: Game, A: Assets, _clicks: Clickable[]): void {
  ctx.fillStyle = COL.panel;
  ctx.fillRect(0, 0, STAGE_W, TOP_H);
  hairline(ctx, TOP_H - 0.5);

  // Stock readouts (produced 16×16 icons + numbers).
  let x = 18;
  for (const res of RESOURCE_ORDER) {
    blit(ctx, A.sprite(STOCK_ICON[res]), x + 9, 34, 18, 18, 0);
    text(ctx, res.toUpperCase(), x + 22, 20, 9, COL.text3, "left", "600", 1);
    text(ctx, `${Math.floor(game.stock[res])}`, x + 22, 40, 16, COL.text, "left", "700");
    x += 92;
  }

  // Centre: the raid banner takes over when a raid is near/live; otherwise colony state.
  if (game.raidIncoming || game.raidActive) drawRaidBanner(ctx, game);
  else drawColonyState(ctx, game, A);

  // Right: day + time-of-day clock + speed.
  const rx = STAGE_W - 18;
  text(ctx, `DAY ${game.day}`, rx, 22, 18, COL.text, "right", "800", 1);
  const speedLabel = game.paused ? "PAUSED" : `${game.speed}×`;
  const phaseName = phaseLabel(game.phase);
  text(ctx, `${phaseName} · ${speedLabel}`, rx, 44, 11, game.paused ? COL.alert : COL.text2, "right", "600", 1);
  // Phase dial: a small dot tinted by the time of day.
  const dotX = rx - ctx.measureText(`${phaseName} · ${speedLabel}`).width - 24;
  ctx.save();
  ctx.fillStyle = phaseColor(game.phase);
  ctx.beginPath();
  ctx.arc(dotX, 44, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = hexA(COL.text, 0.4);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

function drawColonyState(ctx: CanvasRenderingContext2D, game: Game, A: Assets): void {
  const living = game.livingSettlers();
  let x = STAGE_W / 2 - 150;
  blit(ctx, A.sprite("icons/settler"), x + 9, 32, 18, 18, 0);
  text(ctx, `${living.length} LIVING`, x + 22, 32, 15, COL.settler, "left", "700", 0.5);
  x += 22 + ctx.measureText(`${living.length} LIVING`).width + 26;

  const hungry = living.some((s) => s.needs.hunger >= EAT_THRESHOLD);
  const tired = living.some((s) => s.needs.rest <= SLEEP_TRIGGER_DAY);
  const hurt = living.some((s) => s.downed || s.health < s.maxHealth * 0.5);
  const flags: [boolean, string][] = [
    [hungry, "HUNGRY"],
    [tired, "TIRED"],
    [hurt, "HURT"],
  ];
  for (const [on, label] of flags) {
    if (!on) continue;
    blit(ctx, A.sprite("icons/alert"), x + 7, 32, 14, 14, 0);
    text(ctx, label, x + 18, 32, 11, COL.alert, "left", "700", 0.5);
    x += 18 + ctx.measureText(label).width + 16;
  }
}

function drawRaidBanner(ctx: CanvasRenderingContext2D, game: Game): void {
  const pulse = 0.6 + 0.4 * Math.abs(Math.sin(renderTime() * 4));
  const label = game.raidActive ? "RAID UNDERWAY" : `RAID INCOMING — ${Math.ceil(game.raidCountdown)}s`;
  ctx.font = `800 16px ${FONT}`;
  const w = ctx.measureText(label).width + 56;
  const bx = STAGE_W / 2 - w / 2;
  ctx.save();
  ctx.globalAlpha = pulse;
  roundRect(ctx, bx, 14, w, 36, 8);
  ctx.fillStyle = hexA(COL.alert, 0.22);
  ctx.fill();
  ctx.strokeStyle = COL.alert;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
  text(ctx, "«", bx + 18, 32, 18, COL.alert, "center", "800");
  text(ctx, "»", bx + w - 18, 32, 18, COL.alert, "center", "800");
  text(ctx, label, STAGE_W / 2, 32, 16, COL.alert, "center", "800", 1);
}

// ---- bottom strip -------------------------------------------------------------
const ROSTER_X = 10;
const ROSTER_W = 156;
const ROSTER_GAP = 6;
const PAL_X = 500;
const PAL_PITCH = 50;
const CTRL_X = 964;

export function drawBottomHud(ctx: CanvasRenderingContext2D, game: Game, A: Assets, clicks: Clickable[]): void {
  const y0 = STAGE_H - 64;
  ctx.fillStyle = COL.panel;
  ctx.fillRect(0, y0, STAGE_W, 64);
  hairline(ctx, y0 + 0.5);

  drawRoster(ctx, game, clicks);
  drawPalette(ctx, game, A, clicks);
}

function drawRoster(ctx: CanvasRenderingContext2D, game: Game, clicks: Clickable[]): void {
  const cy = STAGE_H - 62;
  const h = 52;
  const living = game.livingSettlers();
  living.forEach((s, i) => {
    const x = ROSTER_X + i * (ROSTER_W + ROSTER_GAP);
    const selected = game.selectedSettlerId === s.id;
    const hovered = inRect(ptr().x, ptr().y, x, cy, ROSTER_W, h);
    roundRect(ctx, x, cy, ROSTER_W, h, 6);
    ctx.fillStyle = selected ? hexA(COL.settler, 0.16) : "rgba(255,255,255,0.03)";
    ctx.fill();
    ctx.strokeStyle = selected ? COL.settler : "rgba(255,255,255,0.08)";
    ctx.lineWidth = selected ? 2 : 1;
    ctx.stroke();

    text(ctx, s.name, x + 8, cy + 11, 12, selected ? COL.settler : COL.text, "left", "700", 0.5);
    text(ctx, actLabel(s.activity), x + ROSTER_W - 8, cy + 11, 9, actColor(s.activity), "right", "600", 0.5);

    // four need/health bars: fullness (1-hunger), rest, mood, health.
    const bx = x + 20;
    const bw = ROSTER_W - 28;
    const rows: [string, number, string][] = [
      ["H", 1 - s.needs.hunger, COL.food],
      ["R", s.needs.rest, COL.settler],
      ["M", s.needs.mood, COL.wood],
      ["♥", Math.max(0, s.health) / s.maxHealth, COL.health],
    ];
    let by = cy + 22;
    for (const [glyph, frac, col] of rows) {
      text(ctx, glyph, x + 12, by + 2, 8, COL.text3, "center", "600");
      bar(ctx, bx, by, bw, 4, frac, col);
      by += 7;
    }

    clicks.push({ x, y: cy, w: ROSTER_W, h, action: `select:${s.id}` });
    if ((hovered || selected) && !isWorkGridOpen()) drawStandoutSkills(ctx, s, x + ROSTER_W / 2, cy);
  });
}

function drawStandoutSkills(ctx: CanvasRenderingContext2D, s: Settler, anchorX: number, cardTop: number): void {
  const ranked = [...SKILL_ORDER].sort((a, b) => s.skills[b] - s.skills[a]);
  const top = ranked.slice(0, 2).map((sk) => `${skillLabel(sk)} ${Math.round(s.skills[sk])}`);
  drawTooltip(ctx, s.name, `Best at: ${top.join(", ")}.`, COL.settler, anchorX, cardTop - 8);
}

// ---- build palette / tool bar -------------------------------------------------
function drawPalette(ctx: CanvasRenderingContext2D, game: Game, A: Assets, clicks: Clickable[]): void {
  const y = STAGE_H - 62;
  const w = 46;
  const h = 50;

  // Designate + cancel tools.
  paletteButton(ctx, clicks, PAL_X, y, w, h, A.sprite("icons/tool_designate"), "", game.tool === "designate", true, "tool:designate", COL.text);
  paletteButton(ctx, clicks, PAL_X + PAL_PITCH, y, w, h, A.sprite("icons/tool_cancel"), "", game.tool === "cancel", true, "tool:cancel", COL.alert);

  // The seven structures (produced glyph + cost; greyed when unaffordable).
  STRUCTURE_ORDER.forEach((kind, i) => {
    const x = PAL_X + (i + 2) * PAL_PITCH;
    const def = STRUCTURES[kind];
    const afford = game.canAfford(kind);
    const active = game.tool === "build" && game.buildKind === kind;
    const cost = def.cost.ore > 0 ? `${def.cost.wood}·${def.cost.ore}` : `${def.cost.wood}`;
    paletteButton(ctx, clicks, x, y, w, h, A.sprite(BUILD_ICON[kind]), cost, active, afford, `build:${kind}`, COL.wood);
    if (inRect(ptr().x, ptr().y, x, y, w, h)) {
      const oreBit = def.cost.ore > 0 ? `, ${def.cost.ore} ore` : "";
      drawTooltip(ctx, def.name, `${def.cost.wood} wood${oreBit}. ${structureBlurb(kind)}`, COL.wood, x + w / 2, y);
    }
  });

  // Right controls: work grid toggle, speed, pause, mute.
  button(ctx, clicks, CTRL_X, y, 80, h, "WORK GRID", "workgrid", isWorkGridOpen() ? COL.food : COL.text, true);
  if (isWorkGridOpen()) {
    roundRect(ctx, CTRL_X, y, 80, h, 6);
    ctx.strokeStyle = COL.food;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctrlButton(ctx, clicks, CTRL_X + 88, y, 46, h, `${game.speed}×`, "speed", COL.text);
  ctrlButton(ctx, clicks, CTRL_X + 138, y, 42, h, game.paused ? "▶" : "❚❚", "pause", game.paused ? COL.alert : COL.text);
  ctrlButton(ctx, clicks, CTRL_X + 184, y, 42, h, isMuted() ? "♪̸" : "♪", "mute", isMuted() ? COL.text3 : COL.text);
}

function paletteButton(
  ctx: CanvasRenderingContext2D,
  clicks: Clickable[],
  x: number,
  y: number,
  w: number,
  h: number,
  icon: HTMLImageElement,
  cost: string,
  active: boolean,
  enabled: boolean,
  action: string,
  accent: string,
): void {
  roundRect(ctx, x, y, w, h, 6);
  ctx.fillStyle = active ? hexA(accent, 0.2) : "rgba(255,255,255,0.03)";
  ctx.fill();
  ctx.strokeStyle = active ? accent : "rgba(255,255,255,0.08)";
  ctx.lineWidth = active ? 2 : 1;
  ctx.stroke();
  ctx.save();
  ctx.globalAlpha = enabled ? 1 : 0.35;
  blit(ctx, icon, x + w / 2, y + (cost ? 18 : h / 2), 20, 20, 0);
  ctx.restore();
  if (cost) text(ctx, cost, x + w / 2, y + h - 11, 9, enabled ? COL.text2 : COL.text3, "center", "700");
  // Always clickable (an unaffordable structure still selects — placement refuses it).
  clicks.push({ x, y, w, h, action });
}

function ctrlButton(ctx: CanvasRenderingContext2D, clicks: Clickable[], x: number, y: number, w: number, h: number, label: string, action: string, color: string): void {
  roundRect(ctx, x, y, w, h, 6);
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  ctx.lineWidth = 1;
  ctx.stroke();
  text(ctx, label, x + w / 2, y + h / 2 + 1, 15, color, "center", "700");
  clicks.push({ x, y, w, h, action });
}

// ---- work-priority grid panel -------------------------------------------------
export function drawWorkGrid(ctx: CanvasRenderingContext2D, game: Game, clicks: Clickable[]): void {
  const living = game.livingSettlers();
  const nameW = 130;
  const cellW = 64;
  const rowH = 38;
  const headerH = 66;
  const gridW = nameW + WORK_ORDER.length * cellW;
  const panelW = gridW + 40;
  const panelH = headerH + Math.max(1, living.length) * rowH + 56;
  const px = STAGE_W / 2 - panelW / 2;
  const py = (VIEW_Y0 + (STAGE_H - 64)) / 2 - panelH / 2;

  // dim the board behind the panel
  ctx.fillStyle = "rgba(6,9,14,0.5)";
  ctx.fillRect(0, VIEW_Y0, STAGE_W, STAGE_H - 64 - VIEW_Y0);

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.5)";
  ctx.shadowBlur = 30;
  roundRect(ctx, px, py, panelW, panelH, 12);
  ctx.fillStyle = COL.panel;
  ctx.fill();
  ctx.restore();
  roundRect(ctx, px, py, panelW, panelH, 12);
  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  ctx.lineWidth = 1;
  ctx.stroke();

  text(ctx, "WORK PRIORITIES", px + 20, py + 26, 16, COL.text, "left", "800", 1);
  text(ctx, "CLICK A CELL TO CYCLE  0 OFF … 4 TOP", px + 20, py + 46, 10, COL.text3, "left", "600", 1);

  const gx = px + 20;
  const gy = py + headerH;
  // column headers
  WORK_ORDER.forEach((w, c) => {
    const cx = gx + nameW + c * cellW + cellW / 2;
    text(ctx, WORK_LABEL[w].toUpperCase(), cx, gy - 8, 10, COL.text2, "center", "700", 0.5);
  });

  living.forEach((s, r) => {
    const ry = gy + r * rowH;
    text(ctx, s.name, gx + 6, ry + rowH / 2, 13, COL.text, "left", "700", 0.5);
    WORK_ORDER.forEach((w, c) => {
      const cx = gx + nameW + c * cellW;
      const p = game.priorityOf(s.id, w);
      const cw = cellW - 8;
      const ch = rowH - 10;
      const cxx = cx + 4;
      const cyy = ry + 5;
      roundRect(ctx, cxx, cyy, cw, ch, 5);
      ctx.fillStyle = p === 0 ? "rgba(255,255,255,0.03)" : hexA(COL.food, 0.08 + 0.06 * p);
      ctx.fill();
      ctx.strokeStyle = p === 0 ? "rgba(255,255,255,0.08)" : hexA(COL.food, 0.5);
      ctx.lineWidth = 1;
      ctx.stroke();
      text(ctx, p === 0 ? "—" : `${p}`, cxx + cw / 2, cyy + ch / 2 + 1, 13, p === 0 ? COL.text3 : COL.food, "center", "800");
      clicks.push({ x: cxx, y: cyy, w: cw, h: ch, action: `prio:${s.id}:${w}` });
    });
  });

  button(ctx, clicks, px + panelW / 2 - 70, py + panelH - 40, 140, 30, "CLOSE", "workgrid", COL.text, true);
}

// ---- floating tooltip ---------------------------------------------------------
// Anchored above `anchorX/anchorY`, clamped fully on-screen.
export function drawTooltip(ctx: CanvasRenderingContext2D, title: string, body: string, accent: string, anchorX: number, anchorY: number): void {
  const tw = 220;
  const pad = 12;
  const innerW = tw - pad * 2;
  const bodyLines = lineCount(ctx, body, innerW, 11);
  const th = pad + 16 + bodyLines * 15 + pad - 6;
  const tx = Math.max(8, Math.min(STAGE_W - tw - 8, anchorX - tw / 2));
  const ty = Math.max(TOP_H + 8, anchorY - th - 10);
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = 22;
  roundRect(ctx, tx, ty, tw, th, 10);
  ctx.fillStyle = COL.panel;
  ctx.fill();
  ctx.restore();
  roundRect(ctx, tx, ty, tw, th, 10);
  ctx.strokeStyle = hexA(accent, 0.6);
  ctx.lineWidth = 1;
  ctx.stroke();
  text(ctx, title, tx + pad, ty + pad + 6, 12, accent, "left", "700", 0.5);
  wrap(ctx, body, tx + pad, ty + pad + 24, innerW, 11, COL.text2, 15);
}

// ---- small mappings -----------------------------------------------------------
function hairline(ctx: CanvasRenderingContext2D, y: number): void {
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, y);
  ctx.lineTo(STAGE_W, y);
  ctx.stroke();
}

function phaseLabel(p: Phase): string {
  return p.toUpperCase();
}
function phaseColor(p: Phase): string {
  switch (p) {
    case "dawn":
      return "#ffcf6a";
    case "day":
      return "#f2dd9a";
    case "dusk":
      return "#ff8646";
    case "night":
      return "#4f6fb0";
  }
}

const ACT_LABEL: Record<Activity, string> = {
  idle: "idle",
  walk: "walking",
  chop: "chopping",
  mine: "mining",
  haul: "hauling",
  build: "building",
  cook: "cooking",
  farm: "farming",
  fight: "fighting",
  tend: "tending",
  eat: "eating",
  sleep: "sleeping",
  flee: "fleeing",
  downed: "DOWNED",
};
function actLabel(a: Activity): string {
  return ACT_LABEL[a];
}
function actColor(a: Activity): string {
  if (a === "downed") return COL.alert;
  if (a === "fight" || a === "flee") return COL.raider;
  if (a === "idle") return COL.text3;
  return COL.text2;
}

const SKILL_LABEL: Record<Skill, string> = {
  chop: "Chop",
  mine: "Mine",
  build: "Build",
  cook: "Cook",
  shoot: "Shoot",
  farm: "Farm",
};
function skillLabel(s: Skill): string {
  return SKILL_LABEL[s];
}

function structureBlurb(kind: StructureKind): string {
  switch (kind) {
    case "wall":
      return "Blocks movement and gives cover; raiders can't break it.";
    case "door":
      return "Passable to settlers; closes a wall line to raiders.";
    case "floor":
      return "Speeds movement and lifts mood a little.";
    case "bed":
      return "Faster rest and a mood boost for its owner.";
    case "stove":
      return "Cooks crops into meals.";
    case "farm":
      return "Grows crops in daylight; best on grass.";
    case "turret":
      return "Automated ranged defense.";
  }
}
