// Wick — the screens, menus, and overlays (specs/ui.md). The almanac is
// `src/render/almanac.ts`.
//
// Every piece of copy the specification fixes is drawn from `constants.ts`;
// the layout and the styling are this build's. Every menu is drawn over the
// rectangles `src/menus.ts` gives it, which are the rectangles the pointer
// answers, so the highlight a player sees is the target a click takes.

import type { DeepReadonly } from "ts-essentials";
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
import type { RunState, WickRect, WickState } from "../game";
import {
  DISMISS_TEXT_DROP,
  END_MENU_Y,
  MENU_TEXT_DROP,
  PAUSE_MENU_Y,
  TITLE_MENU_Y,
  chestRects,
  descriptionBaseline,
  howtoRects,
  levelUpPanel,
  offerBaseline,
  offerRects,
  stackRects,
} from "../menus";
import { runTime } from "../sim/enemies";
import { isHeld, isPassiveId } from "../sim/progression";
import { isBaseWeapon } from "../sim/weapons";
import { text } from "./draw";
import { drawIcon } from "./hud";
import { COLORS } from "./theme";
import { drawLamplighterAt } from "./world";

type View = DeepReadonly<WickState>;

/** Quiet the world beneath a menu or an overlay. */
export function dim(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = COLORS.dim;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
}

function panel(
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

/**
 * The one box a screen with no menu is left by, with its line inside it.
 *
 * `specs/controls.md` gives `howto` and `chest` a single rectangle each, "the
 * area the screen's way out is taken in, which the screen shows", so the box is
 * drawn as well as answered.
 */
function dismissBox(
  ctx: CanvasRenderingContext2D,
  rect: WickRect,
  label: string,
): void {
  ctx.strokeStyle = COLORS.panelEdge;
  ctx.lineWidth = 2;
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
  text(ctx, label, STAGE_CX, rect.y + DISMISS_TEXT_DROP, {
    size: 18,
    color: COLORS.textFaint,
    align: "center",
  });
}

/** A vertical menu over its rectangles, the item at `index` drawn distinctly. */
function menu(
  ctx: CanvasRenderingContext2D,
  items: readonly string[],
  index: number,
  rects: readonly WickRect[],
): void {
  items.forEach((item, i) => {
    const rect = rects[i];
    const active = i === index;
    if (active) {
      ctx.fillStyle = COLORS.highlight;
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    }
    text(
      ctx,
      active ? `> ${item} <` : item,
      STAGE_CX,
      rect.y + MENU_TEXT_DROP,
      {
        size: 24,
        color: active ? COLORS.stage : COLORS.text,
        bold: active,
        align: "center",
        shadow: !active,
      },
    );
  });
}

export function drawTitle(ctx: CanvasRenderingContext2D, state: View): void {
  dim(ctx);
  // The lamplighter stands large under his lamp, the one warm thing.
  const lampX = STAGE_CX + 200;
  const glow = ctx.createRadialGradient(lampX, 560, 20, lampX, 560, 200);
  glow.addColorStop(0, "rgba(255, 196, 96, 0.28)");
  glow.addColorStop(1, "rgba(255, 196, 96, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(lampX - 200, 360, 400, 400);
  drawLamplighterAt(ctx, state.run, lampX, 560, 4);
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
  menu(
    ctx,
    TITLE_ITEMS,
    state.menuIndex,
    stackRects(TITLE_MENU_Y, TITLE_ITEMS.length),
  );
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
  "pauses, P pauses, and M mutes. Every menu answers the mouse and touch too.",
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
    text(ctx, line, STAGE_CX, 164 + i * 26, {
      size: 20,
      color: COLORS.text,
      align: "center",
    });
  });
  dismissBox(ctx, howtoRects()[0]!, "BACK  —  Escape, or click or tap here");
}

function offerName(id: OfferId): string {
  if (id === LAMP_OIL_ID) return LAMP_OIL_NAME;
  if (isBaseWeapon(id)) return WEAPON_NAMES[id];
  if (isPassiveId(id)) return PASSIVES[id].name;
  return WEAPON_NAMES[id];
}

/** The line beneath the offer list: what the highlighted offer does. */
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

export function drawLevelUp(ctx: CanvasRenderingContext2D, state: View): void {
  dim(ctx);
  const { run } = state;
  const rows = run.offers.length;
  const { top, height } = levelUpPanel(rows);
  const rects = offerRects(rows);
  panel(ctx, STAGE_CX - 300, top, 600, height);
  text(ctx, LEVEL_UP_TEXT, STAGE_CX, top + 52, {
    size: 30,
    color: COLORS.highlight,
    bold: true,
    align: "center",
    spacing: 3,
  });
  run.offers.forEach((id, i) => {
    const y = offerBaseline(top, i);
    const rect = rects[i];
    const active = i === state.menuIndex;
    if (active) {
      ctx.fillStyle = COLORS.highlight;
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    }
    drawIcon(ctx, id, offerName(id), STAGE_CX - 230, y + 22, 40);
    text(ctx, offerName(id), STAGE_CX - 190, y + 30, {
      size: 24,
      color: active ? COLORS.stage : COLORS.text,
      bold: active,
      shadow: !active,
    });
    text(ctx, offerTag(run, id), STAGE_CX + 250, y + 30, {
      size: 20,
      color: active ? COLORS.stage : COLORS.textDim,
      align: "right",
      shadow: !active,
    });
  });
  const highlighted = run.offers[state.menuIndex];
  if (highlighted === undefined) return;
  text(
    ctx,
    offerDescription(highlighted),
    STAGE_CX,
    descriptionBaseline(top, rows),
    { size: 18, color: COLORS.textDim, align: "center" },
  );
}

export function drawChest(ctx: CanvasRenderingContext2D, state: View): void {
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
    const id = result.kind === "evolve" ? result.weapon : result.item;
    const name = offerName(id);
    drawIcon(ctx, id, name, STAGE_CX, 340, 48);
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
  dismissBox(ctx, chestRects()[0]!, "CONTINUE  —  Enter, or click or tap here");
}

export function drawPaused(ctx: CanvasRenderingContext2D, state: View): void {
  dim(ctx);
  text(ctx, PAUSED_TEXT, STAGE_CX, 300, {
    size: 64,
    color: COLORS.highlight,
    bold: true,
    align: "center",
    spacing: 10,
  });
  menu(
    ctx,
    PAUSE_ITEMS,
    state.menuIndex,
    stackRects(PAUSE_MENU_Y, PAUSE_ITEMS.length),
  );
}

export function drawEnd(ctx: CanvasRenderingContext2D, state: View): void {
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
  menu(
    ctx,
    END_ITEMS,
    state.menuIndex,
    stackRects(END_MENU_Y, END_ITEMS.length),
  );
}
