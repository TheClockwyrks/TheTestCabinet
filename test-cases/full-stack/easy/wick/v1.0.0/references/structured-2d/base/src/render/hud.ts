// Wick — the HUD over the live world (specs/ui.md "`playing`").
//
// Health with its numbers, experience with the level, the clock, the kill
// count, and the twelve slots with their level pips and each weapon's
// cooldown state, laid out in logical stage units from the stage's top-left.
// The HUD component translates the context to the stage's top-left in world
// space before calling in, so everything here is stage coordinates.

import type { WickAssets } from "../assets";
import {
  ICON_PATHS,
  ICON_SIZE,
  LEVEL_LABEL,
  PASSIVES,
  PASSIVE_SLOTS,
  STAGE_H,
  STAGE_W,
  WEAPON_NAMES,
  WEAPON_SLOTS,
  type OfferId,
} from "../constants";
import { runTime } from "../sim/enemies";
import type { PassiveSlot, RunState, WeaponSlot } from "../state";
import { maxHp, xpToNext } from "../stats";
import { text } from "./draw";
import { COLORS } from "./theme";

const MARGIN = 24;
const BAR_W = 300;
const BAR_H = 18;
const SLOT = 44;
const SLOT_GAP = 8;

/** The run clock as `m:ss`. */
export function formatClock(seconds: number): string {
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${minutes}:${rest < 10 ? "0" : ""}${rest}`;
}

function bar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  fraction: number,
  fill: string,
  back: string,
): void {
  ctx.fillStyle = back;
  ctx.fillRect(x, y, BAR_W, BAR_H);
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, BAR_W * Math.max(0, Math.min(1, fraction)), BAR_H);
  ctx.strokeStyle = COLORS.panelEdge;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, BAR_W - 1, BAR_H - 1);
}

/** Draw an item's icon, or its initials where the icon did not decode. */
export function drawIcon(
  ctx: CanvasRenderingContext2D,
  assets: WickAssets,
  id: OfferId,
  name: string,
  x: number,
  y: number,
  size = ICON_SIZE,
): void {
  const image = assets.image(ICON_PATHS[id]);
  if (image) {
    ctx.drawImage(image, x - size / 2, y - size / 2, size, size);
    return;
  }
  ctx.fillStyle = COLORS.slotEdge;
  ctx.fillRect(x - size / 2, y - size / 2, size, size);
  text(ctx, name.slice(0, 2).toUpperCase(), x, y + size * 0.22, {
    size: size * 0.55,
    color: COLORS.text,
    bold: true,
    align: "center",
  });
}

function pips(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  level: number,
): void {
  for (let i = 0; i < level; i += 1) {
    ctx.fillStyle = COLORS.pip;
    ctx.fillRect(x + 3 + i * 5, y, 3, 3);
  }
}

function drawSlots(
  ctx: CanvasRenderingContext2D,
  assets: WickAssets,
  x: number,
  y: number,
  count: number,
  held: readonly (WeaponSlot | PassiveSlot)[],
  nameOf: (id: OfferId) => string,
): void {
  for (let i = 0; i < count; i += 1) {
    const sx = x + i * (SLOT + SLOT_GAP);
    ctx.fillStyle = COLORS.slot;
    ctx.fillRect(sx, y, SLOT, SLOT);
    ctx.strokeStyle = COLORS.slotEdge;
    ctx.lineWidth = 1;
    ctx.strokeRect(sx + 0.5, y + 0.5, SLOT - 1, SLOT - 1);
    const item = held[i];
    if (!item) continue;
    drawIcon(
      ctx,
      assets,
      item.id,
      nameOf(item.id),
      sx + SLOT / 2,
      y + SLOT / 2 - 4,
    );
    pips(ctx, sx, y + SLOT - 7, item.level);
    if ("cooldown" in item && item.cooldownSet > 0 && item.cooldown > 0) {
      const fraction = Math.min(1, item.cooldown / item.cooldownSet);
      ctx.fillStyle = COLORS.cooldown;
      ctx.fillRect(sx, y + SLOT * (1 - fraction), SLOT, SLOT * fraction);
    }
  }
}

/** The bars, the clock, the kill count, and the twelve slots. */
export function drawHud(
  ctx: CanvasRenderingContext2D,
  run: RunState,
  assets: WickAssets,
): void {
  const max = maxHp(run.passives);
  const hp = Math.max(0, run.player.hp);
  bar(ctx, MARGIN, MARGIN, hp / max, COLORS.health, COLORS.healthBack);
  text(ctx, `${Math.ceil(hp)} / ${max}`, MARGIN + BAR_W + 12, MARGIN + 15, {
    size: 16,
    color: COLORS.text,
    bold: true,
  });
  const need = xpToNext(run.level);
  bar(ctx, MARGIN, MARGIN + BAR_H + 8, run.xp / need, COLORS.xp, COLORS.xpBack);
  text(
    ctx,
    `${LEVEL_LABEL} ${run.level}`,
    MARGIN + BAR_W + 12,
    MARGIN + BAR_H + 8 + 15,
    { size: 16, color: COLORS.text, bold: true },
  );

  text(ctx, formatClock(runTime(run)), STAGE_W / 2, MARGIN + 26, {
    size: 30,
    color: COLORS.text,
    bold: true,
    align: "center",
  });
  text(ctx, `${run.kills} KILLS`, STAGE_W - MARGIN, MARGIN + 18, {
    size: 20,
    color: COLORS.text,
    bold: true,
    align: "right",
  });

  const slotsY = STAGE_H - MARGIN - SLOT;
  drawSlots(
    ctx,
    assets,
    MARGIN,
    slotsY,
    WEAPON_SLOTS,
    run.weapons,
    (id) => WEAPON_NAMES[id as keyof typeof WEAPON_NAMES],
  );
  const passivesX =
    STAGE_W - MARGIN - PASSIVE_SLOTS * (SLOT + SLOT_GAP) + SLOT_GAP;
  drawSlots(
    ctx,
    assets,
    passivesX,
    slotsY,
    PASSIVE_SLOTS,
    run.passives,
    (id) => PASSIVES[id as keyof typeof PASSIVES].name,
  );
}
