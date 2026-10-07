// Wick — the almanac screen (specs/ui.md "`almanac`").
//
// The heading, the tab bar, the windowed entry list, and the detail pane:
// the entry's name, the produced picture it draws, its figures, and its one
// line of copy. What the tabs hold and what one entry says is
// `src/almanac.ts`; where a tab and a row are drawn is `src/menus.ts`, whose
// rectangles are also the areas the pointer answers, so every row is clicked
// exactly where it is drawn.
//
// Nothing on this screen ticks, so every animation here is counted off
// `simTime`, which every frame advances whatever the screen: an enemy walks
// at `WALK_FRAME_TIME` and a weapon effect that is a sheet loops over its own
// cycle.

import {
  descriptionOf,
  entriesOf,
  entryAt,
  nameOf,
  statsOf,
  type AlmanacEntry,
} from "../almanac";
import type { WickAssets } from "../assets";
import {
  ALMANAC_TABS,
  ALMANAC_TEXT,
  EFFECT_SPRITES,
  ENEMY_FRAMES,
  STAGE_CX,
  STAGE_H,
  type WeaponId,
} from "../constants";
import {
  DETAIL,
  LIST_TOP,
  LIST_WIDTH,
  LIST_X,
  menuRects,
  tabBarRects,
} from "../menus";
import type { WickState } from "../state";
import { dim, sprite, text } from "./draw";
import { effectCycle, effectImage, walkFrame } from "./effects";
import { drawIcon } from "./hud";
import { COLORS } from "./theme";
import { drawEnemyPicture, drawGemPicture, drawPickupPicture } from "./world";

/** The picture band of the detail pane, and where its figures are listed. */
const PICTURE_CX = DETAIL.x + 190;
const PICTURE_CY = DETAIL.y + 190;
const STATS_X = DETAIL.x + 430;
const STATS_RIGHT = DETAIL.x + DETAIL.width - 32;
const STATS_TOP = DETAIL.y + 140;
const STATS_PITCH = 40;

/** The box a weapon's effect and a big sprite are fitted into. */
const EFFECT_BOX = 190;
const SPRITE_SIZE = 128;

function pane(
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

/** The tab bar, the tab at `almanacTab` drawn distinctly. */
function drawTabs(ctx: CanvasRenderingContext2D, state: WickState): void {
  tabBarRects().forEach((rect, i) => {
    const active = i === state.almanacTab;
    ctx.fillStyle = active ? COLORS.highlight : COLORS.slot;
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    ctx.strokeStyle = COLORS.panelEdge;
    ctx.lineWidth = 2;
    ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
    text(ctx, ALMANAC_TABS[i], rect.x + rect.width / 2, rect.y + 27, {
      size: 20,
      color: active ? COLORS.stage : COLORS.textDim,
      bold: active,
      align: "center",
      spacing: 2,
      shadow: !active,
    });
  });
}

/**
 * The window over the tab's entries, the entry at `menuIndex` drawn
 * distinctly. The rows are the rectangles the pointer answers.
 */
function drawList(
  ctx: CanvasRenderingContext2D,
  state: WickState,
  entries: readonly AlmanacEntry[],
): void {
  pane(ctx, LIST_X, LIST_TOP, LIST_WIDTH, DETAIL.height);
  const rows = menuRects(state);
  rows.forEach((rect, i) => {
    const index = state.almanacScroll + i;
    const entry = entries[index];
    if (!entry) return;
    const active = index === state.menuIndex;
    if (active) {
      ctx.fillStyle = COLORS.highlight;
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    }
    text(ctx, nameOf(entry), rect.x + 20, rect.y + 27, {
      size: 20,
      color: active ? COLORS.stage : COLORS.text,
      bold: active,
      shadow: !active,
    });
  });
  if (entries.length > rows.length) {
    text(
      ctx,
      `${state.almanacScroll + 1}-${state.almanacScroll + rows.length} of ${entries.length}`,
      LIST_X + LIST_WIDTH / 2,
      LIST_TOP + DETAIL.height + 24,
      { size: 16, color: COLORS.textFaint, align: "center" },
    );
  }
}

/** A weapon's effect, fitted into `EFFECT_BOX` at its own aspect. */
function drawEffect(
  ctx: CanvasRenderingContext2D,
  assets: WickAssets,
  weapon: WeaponId,
  x: number,
  y: number,
  seconds: number,
): void {
  const canvas = EFFECT_SPRITES[weapon];
  const cycle = effectCycle(weapon);
  const scale = EFFECT_BOX / Math.max(canvas.width, canvas.height);
  const width = canvas.width * scale;
  const height = canvas.height * scale;
  const image = effectImage(assets, weapon, cycle === 0 ? 0 : seconds % cycle);
  if (image) {
    sprite(ctx, image, x, y, width, height);
    return;
  }
  ctx.fillStyle = COLORS.zone;
  ctx.fillRect(x - width / 2, y - height / 2, width, height);
  ctx.strokeStyle = COLORS.zoneEdge;
  ctx.lineWidth = 2;
  ctx.strokeRect(x - width / 2, y - height / 2, width, height);
}

/** The produced picture the entry shows, animated where its sprite is a sheet. */
function drawPicture(
  ctx: CanvasRenderingContext2D,
  assets: WickAssets,
  entry: AlmanacEntry,
  seconds: number,
): void {
  switch (entry.kind) {
    case "weapon":
      drawIcon(
        ctx,
        assets,
        entry.id,
        nameOf(entry),
        PICTURE_CX,
        PICTURE_CY - 88,
        72,
      );
      drawEffect(ctx, assets, entry.id, PICTURE_CX, PICTURE_CY + 44, seconds);
      return;
    case "passive":
      drawIcon(
        ctx,
        assets,
        entry.id,
        nameOf(entry),
        PICTURE_CX,
        PICTURE_CY,
        96,
      );
      return;
    case "enemy":
      drawEnemyPicture(
        ctx,
        assets,
        entry.id,
        PICTURE_CX,
        PICTURE_CY,
        SPRITE_SIZE,
        walkFrame(seconds, ENEMY_FRAMES),
      );
      return;
    case "gem":
      drawGemPicture(ctx, assets, entry.id, PICTURE_CX, PICTURE_CY, 6);
      return;
    case "pickup":
      drawPickupPicture(ctx, assets, entry.id, PICTURE_CX, PICTURE_CY, 4);
      return;
  }
}

/** The name, the picture, the figures, and the one line of copy. */
function drawDetail(
  ctx: CanvasRenderingContext2D,
  assets: WickAssets,
  entry: AlmanacEntry,
  seconds: number,
): void {
  pane(ctx, DETAIL.x, DETAIL.y, DETAIL.width, DETAIL.height);
  text(ctx, nameOf(entry), DETAIL.x + 32, DETAIL.y + 48, {
    size: 30,
    color: COLORS.highlight,
    bold: true,
    spacing: 2,
  });
  drawPicture(ctx, assets, entry, seconds);
  statsOf(entry).forEach((stat, i) => {
    const y = STATS_TOP + i * STATS_PITCH;
    text(ctx, stat.label, STATS_X, y, {
      size: 20,
      color: COLORS.textDim,
      spacing: 2,
    });
    text(ctx, stat.figure, STATS_RIGHT, y, {
      size: 20,
      color: COLORS.text,
      bold: true,
      align: "right",
    });
  });
  text(
    ctx,
    descriptionOf(entry),
    DETAIL.x + 32,
    DETAIL.y + DETAIL.height - 26,
    { size: 18, color: COLORS.text },
  );
}

/** The whole screen: the heading, the tabs, the list, and the detail pane. */
export function drawAlmanac(
  ctx: CanvasRenderingContext2D,
  state: WickState,
  assets: WickAssets,
): void {
  dim(ctx);
  const entries = entriesOf(state.almanacTab);
  text(ctx, ALMANAC_TEXT, STAGE_CX, 76, {
    size: 40,
    color: COLORS.highlight,
    bold: true,
    align: "center",
    spacing: 6,
  });
  drawTabs(ctx, state);
  drawList(ctx, state, entries);
  const entry = entryAt(state.almanacTab, state.menuIndex);
  if (entry) drawDetail(ctx, assets, entry, state.simTime);
  text(
    ctx,
    "Arrows or WASD to browse, Escape returns to the title",
    STAGE_CX,
    STAGE_H - 40,
    { size: 18, color: COLORS.textFaint, align: "center" },
  );
}
