// Wick — the almanac screen (specs/ui.md "`almanac`").
//
// The tab bar across the top, the window of entry rows down the left, and the
// highlighted entry in full to the right: its name, its produced picture, its
// labelled figures, and its one line of copy. What each entry holds is
// `src/almanac.ts` and where every box sits is `src/layout.ts`, so the rows
// and the tabs are drawn exactly where the pointer finds them. Nothing
// advances on this screen, so the pictures are animated on `simTime`, which
// every frame raises whatever the screen.

import { almanacEntries, type AlmanacEntry } from "../almanac";
import type { Assets } from "../assets";
import {
  ALMANAC_TABS,
  ALMANAC_TEXT,
  ASSET_PATHS,
  EFFECT_SHEETS,
  EFFECT_SIZES,
  ENEMIES,
  ENEMY_WALK_FRAMES,
  GEM_SIZES,
  PICKUP_SIZE,
  STAGE_CX,
  STAGE_H,
  type WeaponId,
} from "../constants";
import {
  ALMANAC,
  almanacRowRects,
  almanacTabRects,
  type Rect,
} from "../layout";
import type { WickState } from "../state";
import { sprite, text } from "./draw";
import { walkFrame } from "./effects";
import { drawIcon } from "./hud";
import { dim, panel } from "./screens";
import { COLORS } from "./theme";

/** The side of the square a picture is fitted into. */
const PICTURE_BOX = 176;
/** The pitch of the figures listed beside a picture. */
const STAT_LINE = 40;

/** The effect image of `weapon` at `t` seconds, its sheets looping. */
function loopingEffect(
  assets: Assets,
  weapon: WeaponId,
  t: number,
): HTMLImageElement | null {
  const frames = EFFECT_SHEETS[weapon];
  if (frames === undefined) return assets.image(ASSET_PATHS.effect(weapon));
  return assets.image(ASSET_PATHS.effectFrame(weapon, walkFrame(t, frames)));
}

/** Draw `image` centered at `(x, y)`, scaled to fill the picture box. */
function fitted(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const scale = PICTURE_BOX / Math.max(width, height);
  sprite(ctx, image, x, y, width * scale, height * scale);
}

/** Where a produced sprite did not decode, its name's initials stand in. */
function standIn(
  ctx: CanvasRenderingContext2D,
  name: string,
  x: number,
  y: number,
  size: number,
): void {
  ctx.fillStyle = COLORS.slot;
  ctx.fillRect(x - size / 2, y - size / 2, size, size);
  ctx.strokeStyle = COLORS.slotEdge;
  ctx.lineWidth = 2;
  ctx.strokeRect(x - size / 2, y - size / 2, size, size);
  text(ctx, name.slice(0, 2).toUpperCase(), x, y + size * 0.16, {
    size: size * 0.4,
    color: COLORS.textDim,
    bold: true,
    align: "center",
  });
}

/** One produced sprite, or a stand-in of the same extent. */
function drawSprite(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement | null,
  name: string,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  if (image) fitted(ctx, image, x, y, width, height);
  else standIn(ctx, name, x, y, PICTURE_BOX);
}

/**
 * The entry's picture: a tool's icon beside its effect, a trinket's icon, an
 * enemy's walk sheet at `WALK_FRAME_TIME`, and a gem's or a pickup's sprite.
 */
function drawPicture(
  ctx: CanvasRenderingContext2D,
  assets: Assets,
  entry: AlmanacEntry,
  pane: Rect,
  t: number,
): void {
  const y = pane.y + 190;
  const picture = entry.picture;
  switch (picture.of) {
    case "tool": {
      drawIcon(ctx, assets, picture.weapon, entry.name, pane.x + 76, y, 64);
      const size = EFFECT_SIZES[picture.weapon];
      const image = loopingEffect(assets, picture.weapon, t);
      drawSprite(
        ctx,
        image,
        entry.name,
        pane.x + 216,
        y,
        size.width,
        size.height,
      );
      break;
    }
    case "trinket":
      drawIcon(ctx, assets, picture.passive, entry.name, pane.x + 108, y, 96);
      break;
    case "enemy": {
      const frame = walkFrame(t, ENEMY_WALK_FRAMES);
      const side = ENEMIES[picture.enemy].radius * 2;
      drawSprite(
        ctx,
        assets.image(ASSET_PATHS.enemy(picture.enemy, frame)),
        entry.name,
        pane.x + 108,
        y,
        side,
        side,
      );
      break;
    }
    case "gem": {
      const side = GEM_SIZES[picture.tier];
      drawSprite(
        ctx,
        assets.image(ASSET_PATHS.gem(picture.tier)),
        entry.name,
        pane.x + 108,
        y,
        side,
        side,
      );
      break;
    }
    case "pickup":
      drawSprite(
        ctx,
        assets.image(ASSET_PATHS.pickup(picture.pickup)),
        entry.name,
        pane.x + 108,
        y,
        PICKUP_SIZE,
        PICKUP_SIZE,
      );
      break;
  }
}

/** The highlighted entry in full: name, picture, figures, and its line. */
function drawEntry(
  ctx: CanvasRenderingContext2D,
  assets: Assets,
  entry: AlmanacEntry,
  pane: Rect,
  t: number,
): void {
  text(ctx, entry.name, pane.x + 32, pane.y + 54, {
    size: 34,
    color: COLORS.highlight,
    bold: true,
  });
  drawPicture(ctx, assets, entry, pane, t);
  entry.stats.forEach((stat, i) => {
    const line = pane.y + 132 + i * STAT_LINE;
    text(ctx, stat.label, pane.x + 380, line, {
      size: 22,
      color: COLORS.textDim,
    });
    text(ctx, stat.value, pane.x + pane.width - 52, line, {
      size: 22,
      color: COLORS.text,
      bold: true,
      align: "right",
    });
  });
  text(ctx, entry.description, pane.x + 32, pane.y + pane.height - 48, {
    size: 20,
    color: COLORS.text,
  });
}

export function drawAlmanac(
  ctx: CanvasRenderingContext2D,
  state: WickState,
  assets: Assets,
): void {
  dim(ctx);
  text(ctx, ALMANAC_TEXT, STAGE_CX, ALMANAC.headingY, {
    size: 40,
    color: COLORS.highlight,
    bold: true,
    align: "center",
    spacing: 6,
  });

  almanacTabRects().forEach((rect, i) => {
    const active = i === state.almanacTab;
    ctx.fillStyle = active ? COLORS.highlight : COLORS.slot;
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    ctx.strokeStyle = COLORS.slotEdge;
    ctx.lineWidth = 1;
    ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.width - 1, rect.height - 1);
    text(ctx, ALMANAC_TABS[i], rect.x + rect.width / 2, rect.y + 27, {
      size: 20,
      color: active ? COLORS.stage : COLORS.text,
      bold: active,
      align: "center",
      spacing: 2,
      shadow: !active,
    });
  });

  const entries = almanacEntries(state.almanacTab);
  almanacRowRects(entries.length).forEach((rect, i) => {
    const index = state.almanacScroll + i;
    const entry = entries[index];
    if (entry === undefined) return;
    const active = index === state.menuIndex;
    if (active) {
      ctx.fillStyle = COLORS.highlight;
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    }
    text(ctx, entry.name, rect.x + 14, rect.y + 24, {
      size: 20,
      color: active ? COLORS.stage : COLORS.text,
      bold: active,
      shadow: !active,
    });
  });

  const pane: Rect = {
    x: ALMANAC.paneX,
    y: ALMANAC.paneY,
    width: ALMANAC.paneWidth,
    height: ALMANAC.paneHeight,
  };
  panel(ctx, pane.x, pane.y, pane.width, pane.height);
  const shown = entries[state.menuIndex];
  if (shown !== undefined) {
    drawEntry(ctx, assets, shown, pane, state.simTime);
  }

  text(ctx, "Escape returns to the title", STAGE_CX, STAGE_H - 60, {
    size: 18,
    color: COLORS.textFaint,
    align: "center",
  });
}
