// Wick — the screens, menus, and overlays (specs/ui.md).
//
// Every piece of copy the specification fixes is drawn from `constants.ts`,
// and every box an item occupies from `src/layout.ts`, so a menu is drawn
// exactly where the pointer finds it. The styling is this build's.

import type { Assets } from "../assets";
import {
  CHEST_HEAL,
  CHEST_TEXT,
  DAWN_TEXT,
  END_ITEMS,
  FALLEN_TEXT,
  LAMP_OIL_DESCRIPTION,
  LAMP_OIL_ID,
  LAMP_OIL_NAME,
  LEVEL_LABEL,
  LEVEL_UP_TEXT,
  OFFER_NEW_TEXT,
  PASSIVES,
  PASSIVE_DESCRIPTIONS,
  PAUSED_TEXT,
  PAUSE_ITEMS,
  STAGE_CX,
  STAGE_H,
  STAGE_W,
  TAGLINE_TEXT,
  TITLE_ITEMS,
  TITLE_TEXT,
  WEAPON_DESCRIPTIONS,
  WEAPON_NAMES,
  type OfferId,
} from "../constants";
import { formatClock } from "../diagnostics";
import {
  MENU_BASELINE,
  endRects,
  levelUpLayout,
  pauseRects,
  titleRects,
  type Rect,
} from "../layout";
import type { RunState, WickState } from "../state";
import { runTime } from "../sim/enemies";
import { isHeld, isPassiveId } from "../sim/progression";
import { text } from "./draw";
import { drawIcon } from "./hud";
import { COLORS } from "./theme";
import { drawLamplighterAt } from "./world";

/** Quiet the world beneath a menu or an overlay. */
export function dim(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = COLORS.dim;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
}

/** The dark plate a panel of copy or of offers sits on. */
export function panel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  ctx.fillStyle = COLORS.panel;
  ctx.fillRect(x, y, width, height);
  ctx.strokeStyle = COLORS.panelEdge;
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, width, height);
}

/** A vertical menu over its boxes, the item at `index` drawn distinctly. */
function menu(
  ctx: CanvasRenderingContext2D,
  items: readonly string[],
  index: number,
  rects: readonly Rect[],
): void {
  items.forEach((item, i) => {
    const rect = rects[i];
    const active = i === index;
    if (active) {
      ctx.fillStyle = COLORS.highlight;
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    }
    text(ctx, active ? `> ${item} <` : item, STAGE_CX, rect.y + MENU_BASELINE, {
      size: 24,
      color: active ? COLORS.stage : COLORS.text,
      bold: active,
      align: "center",
      shadow: !active,
    });
  });
}

export function drawTitle(
  ctx: CanvasRenderingContext2D,
  state: WickState,
  assets: Assets,
): void {
  dim(ctx);
  // The lamplighter stands large under his lamp, the one warm thing.
  const lampX = STAGE_CX + 200;
  const glow = ctx.createRadialGradient(lampX, 560, 20, lampX, 560, 200);
  glow.addColorStop(0, "rgba(255, 196, 96, 0.28)");
  glow.addColorStop(1, "rgba(255, 196, 96, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(lampX - 200, 360, 400, 400);
  drawLamplighterAt(ctx, state.run, assets, lampX, 560, 4);
  text(ctx, TITLE_TEXT, STAGE_CX, 250, {
    size: 96,
    color: COLORS.highlight,
    bold: true,
    align: "center",
    spacing: 12,
  });
  text(ctx, TAGLINE_TEXT, STAGE_CX, 300, {
    size: 24,
    color: COLORS.textDim,
    align: "center",
    spacing: 6,
  });
  menu(ctx, TITLE_ITEMS, state.menuIndex, titleRects());
}

const HOWTO_LINES = [
  "You are the lamplighter, and you only move. Every tool you carry fires on",
  "its own, each on its own rhythm; where you stand is the whole of the fight.",
  "",
  "Everything in the dark is drawn to the light, and it hurts to touch.",
  "What falls leaves gems. Gems raise the lamp's level, and each level offers",
  "a choice of one from three: a new tool, a new trinket, or a level on one",
  "you hold. You have six tool slots and six trinket slots.",
  "",
  "The big ones drop chests. A chest transforms a tool at its top level when",
  "you carry its trinket.",
  "",
  "The night ends at dawn, 10:00 on the clock. Reach it and you have won.",
  "",
  "The almanac, opened from the title, lists every tool, trinket, enemy, and",
  "pickup the night holds.",
  "",
  "Move with the arrows or WASD. Enter or Space confirms, Escape goes back or",
  "pauses, P pauses, and M mutes. Every menu answers the mouse as well.",
];

export function drawHowto(ctx: CanvasRenderingContext2D): void {
  dim(ctx);
  text(ctx, "HOW TO PLAY", STAGE_CX, 110, {
    size: 40,
    color: COLORS.highlight,
    bold: true,
    align: "center",
    spacing: 6,
  });
  HOWTO_LINES.forEach((line, i) => {
    text(ctx, line, STAGE_CX, 150 + i * 27, {
      size: 20,
      color: COLORS.text,
      align: "center",
    });
  });
  text(ctx, "Escape returns to the title", STAGE_CX, STAGE_H - 60, {
    size: 18,
    color: COLORS.textFaint,
    align: "center",
  });
}

function offerName(id: OfferId): string {
  if (id === LAMP_OIL_ID) return LAMP_OIL_NAME;
  if (isPassiveId(id)) return PASSIVES[id].name;
  return WEAPON_NAMES[id];
}

function offerDescription(id: OfferId): string {
  if (id === LAMP_OIL_ID) return LAMP_OIL_DESCRIPTION;
  if (isPassiveId(id)) return PASSIVE_DESCRIPTIONS[id];
  return WEAPON_DESCRIPTIONS[id];
}

function offerTag(run: RunState, id: OfferId): string {
  if (!isHeld(run, id)) return OFFER_NEW_TEXT;
  const level = isPassiveId(id)
    ? run.passives.find((passive) => passive.id === id)!.level
    : run.weapons.find((weapon) => weapon.id === id)!.level;
  return `${LEVEL_LABEL} ${level + 1}`;
}

export function drawLevelUp(
  ctx: CanvasRenderingContext2D,
  state: WickState,
  assets: Assets,
): void {
  dim(ctx);
  const { run } = state;
  const layout = levelUpLayout(run.offers.length);
  const { panel: box } = layout;
  panel(ctx, box.x, box.y, box.width, box.height);
  text(ctx, LEVEL_UP_TEXT, STAGE_CX, box.y + 52, {
    size: 30,
    color: COLORS.highlight,
    bold: true,
    align: "center",
    spacing: 3,
  });
  run.offers.forEach((id, i) => {
    const rect = layout.offers[i];
    const active = i === state.menuIndex;
    if (active) {
      ctx.fillStyle = COLORS.highlight;
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    }
    drawIcon(ctx, assets, id, offerName(id), rect.x + 40, rect.y + 30, 40);
    text(ctx, offerName(id), rect.x + 80, rect.y + 38, {
      size: 24,
      color: active ? COLORS.stage : COLORS.text,
      bold: active,
      shadow: !active,
    });
    text(ctx, offerTag(run, id), rect.x + rect.width - 20, rect.y + 38, {
      size: 20,
      color: active ? COLORS.stage : COLORS.textDim,
      align: "right",
      shadow: !active,
    });
  });
  // The line beneath the list names what the highlighted offer does.
  const highlighted = run.offers[state.menuIndex];
  if (highlighted !== undefined) {
    text(ctx, offerDescription(highlighted), STAGE_CX, layout.descriptionY, {
      size: 18,
      color: COLORS.textDim,
      align: "center",
    });
  }
}

export function drawChest(
  ctx: CanvasRenderingContext2D,
  state: WickState,
  assets: Assets,
): void {
  dim(ctx);
  const result = state.run.chestResult;
  panel(ctx, STAGE_CX - 280, 220, 560, 260);
  text(ctx, CHEST_TEXT, STAGE_CX, 275, {
    size: 30,
    color: COLORS.highlight,
    bold: true,
    align: "center",
    spacing: 3,
  });
  if (result === null) return;
  if (result.kind === "heal") {
    text(ctx, `The lamplighter is healed ${CHEST_HEAL}.`, STAGE_CX, 360, {
      size: 24,
      color: COLORS.text,
      align: "center",
    });
  } else {
    const name =
      result.kind === "evolve"
        ? WEAPON_NAMES[result.weapon]
        : isPassiveId(result.item)
          ? PASSIVES[result.item].name
          : WEAPON_NAMES[result.item];
    const id = result.kind === "evolve" ? result.weapon : result.item;
    drawIcon(ctx, assets, id, name, STAGE_CX, 340, 48);
    const line =
      result.kind === "evolve"
        ? `${name} is transformed`
        : `${name}  ${LEVEL_LABEL} ${result.level}`;
    text(ctx, line, STAGE_CX, 400, {
      size: 24,
      color: COLORS.text,
      bold: true,
      align: "center",
    });
  }
  text(ctx, "Enter to continue", STAGE_CX, 450, {
    size: 18,
    color: COLORS.textFaint,
    align: "center",
  });
}

export function drawPaused(
  ctx: CanvasRenderingContext2D,
  state: WickState,
): void {
  dim(ctx);
  text(ctx, PAUSED_TEXT, STAGE_CX, 340, {
    size: 64,
    color: COLORS.highlight,
    bold: true,
    align: "center",
    spacing: 10,
  });
  menu(ctx, PAUSE_ITEMS, state.menuIndex, pauseRects());
  text(ctx, "P or Escape resumes the night", STAGE_CX, STAGE_H - 60, {
    size: 18,
    color: COLORS.textFaint,
    align: "center",
  });
}

export function drawEnd(ctx: CanvasRenderingContext2D, state: WickState): void {
  dim(ctx);
  const { run } = state;
  text(ctx, state.screen === "dawn" ? DAWN_TEXT : FALLEN_TEXT, STAGE_CX, 200, {
    size: 64,
    color: COLORS.highlight,
    bold: true,
    align: "center",
    spacing: 8,
  });
  const figures = [
    `TIME SURVIVED  ${formatClock(runTime(run))}`,
    `${LEVEL_LABEL}  ${run.level}`,
    `KILLS  ${run.kills}`,
  ];
  figures.forEach((line, i) => {
    text(ctx, line, STAGE_CX, 280 + i * 36, {
      size: 24,
      color: COLORS.text,
      align: "center",
    });
  });
  menu(ctx, END_ITEMS, state.menuIndex, endRects());
}
