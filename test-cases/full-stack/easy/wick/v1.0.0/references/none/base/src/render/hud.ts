// Wick — the HUD over the live world (specs/ui.md "`playing`").
//
// Health with its numbers, experience with the level, the clock, the kill
// count, the twelve slots with their level pips and each weapon's cooldown
// state, and the hurt cast the view carries while the flash runs.

import type { Assets } from "../assets";
import {
  ASSET_PATHS,
  HURT_FLASH,
  ICON_SIZE,
  LEVEL_LABEL,
  PASSIVES,
  PASSIVE_SLOTS,
  STAGE_CX,
  STAGE_CY,
  STAGE_H,
  STAGE_W,
  WEAPON_NAMES,
  WEAPON_SLOTS,
} from "../constants";
import { formatClock } from "../diagnostics";
import type { HeldPassive, HeldWeapon, RunState } from "../state";
import { runTime } from "../sim/enemies";
import { maxHp, xpToNext } from "../stats";
import { text } from "./draw";
import { COLORS } from "./theme";

const MARGIN = 24;
const BAR_W = 300;
const BAR_H = 18;
const SLOT = 44;
const SLOT_GAP = 8;

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
  assets: Assets,
  id: string,
  name: string,
  x: number,
  y: number,
  size = ICON_SIZE,
): void {
  const image = assets.image(ASSET_PATHS.icon(id));
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
  assets: Assets,
  x: number,
  y: number,
  count: number,
  held: readonly (HeldWeapon | HeldPassive)[],
  nameOf: (id: string) => string,
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

/**
 * The hurt cast over the view: a red gathering at the edges that fades as
 * `hurtFlash` runs out, so a tick that was hit reads differently from one
 * that was not.
 */
function drawHurt(ctx: CanvasRenderingContext2D, run: RunState): void {
  if (run.hurtFlash <= 0) return;
  const strength = Math.min(1, run.hurtFlash / HURT_FLASH);
  const cast = ctx.createRadialGradient(
    STAGE_CX,
    STAGE_CY,
    STAGE_H * 0.44,
    STAGE_CX,
    STAGE_CY,
    STAGE_W * 0.62,
  );
  cast.addColorStop(0, `rgba(${COLORS.hurt}, 0)`);
  cast.addColorStop(1, `rgba(${COLORS.hurt}, ${0.58 * strength})`);
  ctx.fillStyle = cast;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
}

export function drawHud(
  ctx: CanvasRenderingContext2D,
  run: RunState,
  assets: Assets,
): void {
  drawHurt(ctx, run);
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
