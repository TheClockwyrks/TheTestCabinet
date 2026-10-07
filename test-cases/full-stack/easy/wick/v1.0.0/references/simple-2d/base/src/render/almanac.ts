// Wick — the almanac (specs/ui.md "`almanac`").
//
// The tab bar across the top, the entry list down the left, and the entry at
// `menuIndex` in full to the right of it: its name, its produced picture, its
// figures, and its line. What each entry holds is `src/almanac.ts`; where the
// tabs and the rows sit is `src/menus.ts`, which is where the pointer reads
// them from as well. Nothing here ticks, so the pictures are animated off
// `simTime`, which rises on every frame whatever the screen.

import type { DeepReadonly } from "ts-essentials";
import {
  ALMANAC_TABS,
  ALMANAC_TEXT,
  EFFECT_SPRITES,
  ENEMIES,
  ENEMY_FRAMES,
  GEM_SPRITE_SIZES,
  PASSIVES,
  PICKUP_SPRITE_SIZE,
  STAGE_CX,
  WEAPON_NAMES,
  type WeaponId,
} from "../constants";
import {
  entriesOf,
  visibleRows,
  type AlmanacEntry,
  type AlmanacPicture,
} from "../almanac";
import type { WickState } from "../game";
import { almanacRowRects, almanacTabRects, MENU_TEXT_DROP } from "../menus";
import { centeredRect, text } from "./draw";
import { effectCycle, effectImage, walkFrame } from "./effects";
import { drawIcon } from "./hud";
import { dim } from "./screens";
import { COLORS } from "./theme";
import { drawEnemy, drawGem, drawPickup } from "./world";

type View = DeepReadonly<WickState>;

/** The detail pane, to the right of the list. */
const PANE_X = 512;
const PANE_Y = 196;
const PANE_W = 672;
const PANE_H = 432;

/** The pane's inner left edge, the edge its figures line up on, and its middle. */
const PANE_LEFT = PANE_X + 28;
const PANE_RIGHT = PANE_X + PANE_W - 28;
const PANE_CX = PANE_X + PANE_W / 2;

/** The square a picture is fitted into, centered on the pane. */
const PICTURE_BOX = 132;
const PICTURE_Y = 348;

/** The first figure's baseline, and the pitch between them. */
const STAT_Y = 452;
const STAT_LINE = 32;

/** `size` scaled to fit `PICTURE_BOX`, whichever way round it is. */
function fitted(width: number, height: number): [number, number] {
  const scale = PICTURE_BOX / Math.max(width, height);
  return [width * scale, height * scale];
}

/** A weapon's effect, looped so a sheet plays over and over here. */
function drawEffect(
  ctx: CanvasRenderingContext2D,
  weapon: WeaponId,
  x: number,
  y: number,
  t: number,
): void {
  const effect = EFFECT_SPRITES[weapon];
  const [width, height] = fitted(effect.width, effect.height);
  const image = effectImage(weapon, t % effectCycle(weapon));
  if (image) {
    ctx.drawImage(image, x - width / 2, y - height / 2, width, height);
    return;
  }
  centeredRect(ctx, x, y, width, height, COLORS.zone, COLORS.zoneEdge);
}

/** The entry's picture, centered on the pane and animated where it is a sheet. */
function drawPicture(
  ctx: CanvasRenderingContext2D,
  picture: AlmanacPicture,
  t: number,
): void {
  switch (picture.kind) {
    case "weapon":
      // A tool shows both: its icon, as the HUD and the offers draw it, and
      // the effect it makes beside it.
      drawIcon(
        ctx,
        picture.id,
        WEAPON_NAMES[picture.id],
        PANE_CX - 100,
        PICTURE_Y,
        72,
      );
      drawEffect(ctx, picture.id, PANE_CX + 80, PICTURE_Y, t);
      return;
    case "passive":
      drawIcon(
        ctx,
        picture.id,
        PASSIVES[picture.id].name,
        PANE_CX,
        PICTURE_Y,
        96,
      );
      return;
    case "enemy": {
      const [size] = fitted(
        ENEMIES[picture.id].radius * 2,
        ENEMIES[picture.id].radius * 2,
      );
      drawEnemy(
        ctx,
        picture.id,
        PANE_CX,
        PICTURE_Y,
        walkFrame(t, ENEMY_FRAMES),
        size,
      );
      return;
    }
    case "gem": {
      const [size] = fitted(
        GEM_SPRITE_SIZES[picture.id],
        GEM_SPRITE_SIZES[picture.id],
      );
      drawGem(ctx, picture.id, PANE_CX, PICTURE_Y, size);
      return;
    }
    case "pickup": {
      const [size] = fitted(PICKUP_SPRITE_SIZE, PICKUP_SPRITE_SIZE);
      drawPickup(ctx, picture.id, PANE_CX, PICTURE_Y, size);
      return;
    }
  }
}

/** The entry at the highlight, in the four parts the specification names. */
function drawDetail(
  ctx: CanvasRenderingContext2D,
  entry: AlmanacEntry,
  t: number,
): void {
  ctx.fillStyle = COLORS.panel;
  ctx.fillRect(PANE_X, PANE_Y, PANE_W, PANE_H);
  ctx.strokeStyle = COLORS.panelEdge;
  ctx.lineWidth = 2;
  ctx.strokeRect(PANE_X, PANE_Y, PANE_W, PANE_H);

  text(ctx, entry.name, PANE_LEFT, PANE_Y + 56, {
    size: 32,
    color: COLORS.highlight,
    bold: true,
  });
  drawPicture(ctx, entry.picture, t);
  entry.stats.forEach((stat, i) => {
    const y = STAT_Y + i * STAT_LINE;
    text(ctx, stat.label, PANE_LEFT, y, { size: 20, color: COLORS.textDim });
    text(ctx, stat.value, PANE_RIGHT, y, {
      size: 20,
      color: COLORS.text,
      bold: true,
      align: "right",
    });
  });
  text(ctx, entry.description, PANE_LEFT, PANE_Y + PANE_H - 34, {
    size: 18,
    color: COLORS.text,
  });
}

/** The tab bar, the tab at `almanacTab` drawn distinctly. */
function drawTabs(ctx: CanvasRenderingContext2D, state: View): void {
  almanacTabRects().forEach((rect, i) => {
    const active = i === state.almanacTab;
    ctx.fillStyle = active ? COLORS.highlight : COLORS.panel;
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    ctx.strokeStyle = COLORS.panelEdge;
    ctx.lineWidth = 2;
    ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
    text(
      ctx,
      ALMANAC_TABS[i],
      rect.x + rect.width / 2,
      rect.y + MENU_TEXT_DROP,
      {
        size: 22,
        color: active ? COLORS.stage : COLORS.text,
        bold: active,
        align: "center",
        spacing: 2,
        shadow: !active,
      },
    );
  });
}

/** The window of the tab's list, the entry at `menuIndex` drawn distinctly. */
function drawList(
  ctx: CanvasRenderingContext2D,
  state: View,
  entries: readonly AlmanacEntry[],
): void {
  almanacRowRects(visibleRows(entries.length, state.almanacScroll)).forEach(
    (rect, i) => {
      const index = state.almanacScroll + i;
      const active = index === state.menuIndex;
      if (active) {
        ctx.fillStyle = COLORS.highlight;
        ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      }
      text(ctx, entries[index].name, rect.x + 16, rect.y + MENU_TEXT_DROP, {
        size: 22,
        color: active ? COLORS.stage : COLORS.text,
        bold: active,
        shadow: !active,
      });
    },
  );
}

/** The almanac over the quieted night. */
export function drawAlmanac(ctx: CanvasRenderingContext2D, state: View): void {
  dim(ctx);
  text(ctx, ALMANAC_TEXT, STAGE_CX, 88, {
    size: 44,
    color: COLORS.highlight,
    bold: true,
    align: "center",
    spacing: 8,
  });
  drawTabs(ctx, state);
  const entries = entriesOf(state.almanacTab);
  drawList(ctx, state, entries);
  const entry = entries[state.menuIndex];
  if (entry !== undefined) drawDetail(ctx, entry, state.simTime);
}
