// Wick — the screens, menus, and overlays (specs/ui.md).
//
// Every piece of copy the specification fixes is drawn from `constants.ts`;
// the layout and the styling are this build's. The screen component
// translates the context to the stage's top-left before calling in, so
// everything here is laid out in logical stage units.
//
// Every menu item is drawn inside the rectangle `src/menus.ts` gives it, and
// those are the rectangles the pointer answers, so a hover and a click land
// on exactly the item a player sees. The almanac is large enough to be its
// own module, `src/render/almanac.ts`.

import type { WickAssets } from "../assets";
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
  TAGLINE_TEXT,
  TITLE_ITEMS,
  TITLE_TEXT,
  WEAPON_DESCRIPTIONS,
  WEAPON_NAMES,
  type OfferId,
} from "../constants";
import {
  DISMISS_BASELINE,
  END_MENU_TOP,
  MENU_ITEM_BASELINE,
  OFFER_ROW_HEIGHT,
  PAUSE_MENU_TOP,
  TITLE_MENU_TOP,
  chestRects,
  howtoRects,
  levelUpPanel,
  offerRects,
  stackedRects,
  type WickRect,
} from "../menus";
import { runTime } from "../sim/enemies";
import { isHeld, isPassiveId } from "../sim/progression";
import { isWeaponId } from "../sim/weapons";
import type { RunState, Screen, WickState } from "../state";
import { drawAlmanac } from "./almanac";
import { dim, text } from "./draw";
import { drawIcon, formatClock } from "./hud";
import { COLORS } from "./theme";
import { drawLamplighterAt } from "./world";

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
 * A vertical menu, each item inside the rectangle `rects` gives it and the
 * item at `index` drawn distinctly.
 */
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
      rect.x + rect.width / 2,
      rect.y + MENU_ITEM_BASELINE,
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
  text(ctx, label, STAGE_CX, rect.y + DISMISS_BASELINE, {
    size: 18,
    color: COLORS.textFaint,
    align: "center",
  });
}

export function drawTitle(
  ctx: CanvasRenderingContext2D,
  state: WickState,
  assets: WickAssets,
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
  menu(
    ctx,
    TITLE_ITEMS,
    state.menuIndex,
    stackedRects(TITLE_ITEMS.length, TITLE_MENU_TOP),
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
  "you carry its trinket. The night ends at dawn, 10:00 on the clock; reach",
  "it and you have won.",
  "",
  "The almanac, opened from the title, lists every tool, trinket, enemy, and",
  "pickup the night holds.",
  "",
  "Move with the arrows or WASD. Enter or Space confirms, Escape goes back",
  "or pauses, P pauses, and M mutes. Every menu answers the mouse and touch",
  "as well: the item under the pointer is highlighted, and a click or a tap",
  "on it takes it.",
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
    text(ctx, line, STAGE_CX, 162 + i * 28, {
      size: 20,
      color: COLORS.text,
      align: "center",
    });
  });
  dismissBox(ctx, howtoRects()[0]!, "BACK  —  Escape, or click or tap here");
}

/** An offer's display name. */
export function offerName(id: OfferId): string {
  if (id === LAMP_OIL_ID) return LAMP_OIL_NAME;
  if (isWeaponId(id)) return WEAPON_NAMES[id];
  return PASSIVES[id].name;
}

/** An offer's one line of copy, drawn beneath the offer list. */
export function offerDescription(id: OfferId): string {
  if (id === LAMP_OIL_ID) return LAMP_OIL_DESCRIPTION;
  if (isWeaponId(id)) return WEAPON_DESCRIPTIONS[id];
  return PASSIVE_DESCRIPTIONS[id];
}

/** An offer's tag: `NEW`, or the level it would become. */
export function offerTag(run: RunState, id: OfferId): string {
  if (!isHeld(run, id)) return OFFER_NEW_TEXT;
  const level = isPassiveId(id)
    ? run.passives.find((passive) => passive.id === id)!.level
    : run.weapons.find((weapon) => weapon.id === id)!.level;
  return `${LEVEL_LABEL} ${level + 1}`;
}

export function drawLevelUp(
  ctx: CanvasRenderingContext2D,
  state: WickState,
  assets: WickAssets,
): void {
  const { run } = state;
  const rows = run.offers.length;
  const box = levelUpPanel(rows);
  const rects = offerRects(rows);
  panel(ctx, box.x, box.y, box.width, box.height);
  text(ctx, LEVEL_UP_TEXT, STAGE_CX, box.y + 52, {
    size: 30,
    color: COLORS.highlight,
    bold: true,
    align: "center",
    spacing: 3,
  });
  run.offers.forEach((id, i) => {
    const rect = rects[i];
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
  const highlighted = run.offers[state.menuIndex];
  if (highlighted !== undefined) {
    const last = rects[rects.length - 1];
    text(
      ctx,
      offerDescription(highlighted),
      STAGE_CX,
      last.y + OFFER_ROW_HEIGHT + 34,
      { size: 18, color: COLORS.textDim, align: "center" },
    );
  }
}

export function drawChest(
  ctx: CanvasRenderingContext2D,
  state: WickState,
  assets: WickAssets,
): void {
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
  dismissBox(ctx, chestRects()[0]!, "CONTINUE  —  Enter, or click or tap here");
}

export function drawPaused(
  ctx: CanvasRenderingContext2D,
  state: WickState,
): void {
  text(ctx, PAUSED_TEXT, STAGE_CX, 330, {
    size: 64,
    color: COLORS.highlight,
    bold: true,
    align: "center",
    spacing: 10,
  });
  text(ctx, "P or Escape resumes the night", STAGE_CX, 376, {
    size: 20,
    color: COLORS.textDim,
    align: "center",
  });
  menu(
    ctx,
    PAUSE_ITEMS,
    state.menuIndex,
    stackedRects(PAUSE_ITEMS.length, PAUSE_MENU_TOP),
  );
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
  menu(
    ctx,
    END_ITEMS,
    state.menuIndex,
    stackedRects(END_ITEMS.length, END_MENU_TOP),
  );
}

/** The screens the HUD is drawn on: the night and everything held over it. */
export const HUD_SCREENS: readonly Screen[] = [
  "playing",
  "levelup",
  "chest",
  "paused",
];

/**
 * The screens that hold the night still under an overlay or a pause. The
 * world beneath is quieted before the HUD is drawn, so the HUD stays legible
 * over the dimmed world and the overlay reads over both.
 */
export const HELD_SCREENS: readonly Screen[] = ["levelup", "chest", "paused"];

/**
 * Whatever the current screen lays over the world and the HUD: each menu,
 * overlay, and end card on its screen, and nothing on `playing`.
 */
export function drawScreen(
  ctx: CanvasRenderingContext2D,
  state: WickState,
  assets: WickAssets,
): void {
  switch (state.screen) {
    case "title":
      drawTitle(ctx, state, assets);
      break;
    case "howto":
      drawHowto(ctx);
      break;
    case "playing":
      break;
    case "levelup":
      drawLevelUp(ctx, state, assets);
      break;
    case "chest":
      drawChest(ctx, state, assets);
      break;
    case "almanac":
      drawAlmanac(ctx, state, assets);
      break;
    case "paused":
      drawPaused(ctx, state);
      break;
    case "fallen":
    case "dawn":
      drawEnd(ctx, state);
      break;
  }
}
