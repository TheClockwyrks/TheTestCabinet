// Orrery — drawing the tray (specs/editor.md "The tray").
//
// One slot per available part, in the derived order `src/tray.ts` fixes, each
// at the rectangle specs/editor.md fixes for it — the same rectangles a press
// is targeted by, so what a player sees and what a press hits are one thing.
//
// A slot shows the part's name and its cost from `PART_COSTS`; a rise or set
// slot says which reagent or product it is; and a slot whose part is already
// on the field is drawn spent, because a press on it does nothing until that
// part is deleted.

import {
  HEADING_H,
  STAGE_H,
  TRAY_REGION_W,
  TRAY_SLOT_H,
  TRAY_W,
  TRAY_X0,
  TRAY_Y0,
} from "./constants";
import { fillRect, strokeRect, text } from "./draw";
import { partClass } from "./parts";
import { COLORS } from "./theme";
import { entrySpent, traySlotRect, trayEntries } from "./tray";
import type { OrreryState } from "./state";

/** The class chip's color, so a mechanism, a sigil, and an aperture read apart. */
const CLASS_COLORS: Record<string, string> = {
  arm: COLORS.brass,
  wheel: COLORS.brass,
  track: COLORS.brassDark,
  sigil: COLORS.steel,
  rise: COLORS.legal,
  set: COLORS.target,
};

/** Draw the tray's heading and every slot the open challenge offers. */
export function drawTray(
  ctx: CanvasRenderingContext2D,
  state: OrreryState,
): void {
  // The tray's own edge, so the region reads apart from the field beside it.
  fillRect(
    ctx,
    TRAY_REGION_W - 1,
    HEADING_H,
    1,
    STAGE_H - HEADING_H,
    COLORS.panelEdge,
  );
  const entries = trayEntries(state.challenge);
  entries.forEach((entry, index) => {
    const rect = traySlotRect(index);
    const spent = entrySpent(entry, state.editor.parts);
    fillRect(
      ctx,
      rect.x0,
      rect.y0,
      TRAY_W,
      TRAY_SLOT_H - 2,
      spent ? COLORS.sky : COLORS.panel,
    );
    strokeRect(
      ctx,
      rect.x0,
      rect.y0,
      TRAY_W,
      TRAY_SLOT_H - 2,
      spent ? COLORS.panelEdge : COLORS.brassDark,
    );
    fillRect(
      ctx,
      rect.x0 + 4,
      rect.y0 + 6,
      4,
      TRAY_SLOT_H - 14,
      spent
        ? COLORS.textFaint
        : (CLASS_COLORS[partClass(entry.kind)] ?? COLORS.brass),
    );
    text(ctx, entry.label, rect.x0 + 16, rect.y0 + 19, {
      size: 13,
      color: spent ? COLORS.textFaint : COLORS.text,
    });
    text(
      ctx,
      entry.perCell ? `${entry.cost}/cell` : String(entry.cost),
      rect.x0 + TRAY_W - 8,
      rect.y0 + 19,
      {
        size: 12,
        color: spent ? COLORS.textFaint : COLORS.brass,
        align: "right",
      },
    );
    // A spent slot is struck through as well as dimmed, so it is told from an
    // unspent one without relying on hue.
    if (spent) {
      fillRect(
        ctx,
        rect.x0 + 14,
        rect.y0 + 14,
        TRAY_W - 44,
        1,
        COLORS.textFaint,
      );
    }
  });
  if (entries.length === 0) {
    text(ctx, "no challenge open", TRAY_X0 + 4, TRAY_Y0 + 20, {
      size: 12,
      color: COLORS.textFaint,
    });
  }
}
