// Orrery — the two panels drawn over a run (specs/ui.md "The solved panel",
// "The fault display").
//
// Neither is a screen: both are drawn on the editor from `sim.status`, and the
// field stays visible behind them, so a player reads the machine that just
// finished or just halted while the panel is up.
//
// The solved panel carries the finished run's three metrics, the challenge's
// records with this run's bests marked, and the menu of `SOLVED_ITEMS` that
// `src/game.ts` filters — `NEXT CHALLENGE` is offered only when the mode has a
// challenge after this one, and a challenge loaded through the debug surface
// belongs to no course, so it is never offered there.
//
// The fault display names which of the `FAULTS` stopped the run in this
// build's own words; the parts and motes the fault names are marked on the
// field itself, in `src/fielddraw.ts`.

import { SOLVED_TITLE_TEXT, STAGE_CX, STAGE_W } from "./constants";
import { fillRect, roundRect, strokeRect, text } from "./draw";
import { solvedItems } from "./progress";
import {
  solvedItemRect,
  SOLVED_PANEL_H,
  SOLVED_PANEL_W,
  SOLVED_PANEL_X,
  SOLVED_PANEL_Y,
  SOLVED_TEXT_BASELINE,
} from "./regions";
import { recordsOf } from "./state";
import { COLORS } from "./theme";
import type { FaultKind, Metrics, OrreryState } from "./types";

/** What each fault of specs/simulation.md is announced as. */
export const FAULT_BANNERS: Record<FaultKind, string> = {
  collision: "COLLISION — two motes came too close",
  torn: "TORN — one constellation, two different motions",
  overextended: "OVEREXTENDED — that piston is already at full reach",
  overretracted: "OVERRETRACTED — that piston is already drawn in",
  unmounted: "UNMOUNTED — that part stands on no track",
  "track-end": "TRACK END — the path runs out there",
  impossible: "IMPOSSIBLE — that part cannot perform that instruction",
};

/** The panel a completed run puts up, over the machine that finished it. */
export function drawSolvedPanel(
  ctx: CanvasRenderingContext2D,
  state: OrreryState,
): void {
  const metrics = state.sim?.metrics ?? null;
  if (metrics === null) return;
  // The panel's own box and its items' boxes are laid out in `src/regions.ts`,
  // because the items are a menu the pointer and a touch contact drive and the
  // surface reports through `menuItemRect` (specs/ui.md "Pointer and touch").
  const width = SOLVED_PANEL_W;
  const height = SOLVED_PANEL_H;
  const x = SOLVED_PANEL_X;
  const y = SOLVED_PANEL_Y;

  ctx.save();
  ctx.fillStyle = "rgba(8, 11, 22, 0.92)";
  roundRect(ctx, x, y, width, height, 10);
  ctx.fill();
  ctx.restore();
  strokeRect(ctx, x, y, width, height, COLORS.brass, 2);

  text(ctx, SOLVED_TITLE_TEXT, STAGE_CX, y + 44, {
    size: 26,
    color: COLORS.brass,
    bold: true,
    align: "center",
    spacing: 4,
  });

  const record = recordFor(state);
  const rows: { label: string; value: number; best: number | null }[] = [
    { label: "cost", value: metrics.cost, best: record?.cost ?? null },
    { label: "cycles", value: metrics.cycles, best: record?.cycles ?? null },
    { label: "area", value: metrics.area, best: record?.area ?? null },
  ];
  let row = y + 86;
  text(ctx, "THIS RUN", x + 150, row, {
    size: 10,
    color: COLORS.textFaint,
    align: "right",
    spacing: 2,
  });
  text(ctx, "BEST", x + 240, row, {
    size: 10,
    color: COLORS.textFaint,
    align: "right",
    spacing: 2,
  });
  row += 22;
  for (const entry of rows) {
    const isBest = entry.best !== null && entry.best === entry.value;
    text(ctx, entry.label, x + 28, row, { size: 14, color: COLORS.textDim });
    text(ctx, String(entry.value), x + 150, row, {
      size: 14,
      color: COLORS.text,
      align: "right",
    });
    text(ctx, entry.best === null ? "—" : String(entry.best), x + 240, row, {
      size: 14,
      color: isBest ? COLORS.brass : COLORS.textDim,
      align: "right",
    });
    if (isBest) {
      text(ctx, "NEW BEST", x + 258, row, {
        size: 11,
        color: COLORS.legal,
        bold: true,
        spacing: 1,
      });
    }
    row += 24;
  }

  const items = solvedItems(state);
  items.forEach((item, index) => {
    const rect = solvedItemRect(index);
    const selected = index === state.menuIndex;
    if (selected) {
      fillRect(ctx, rect.x, rect.y, rect.w, rect.h, COLORS.panel);
    }
    text(ctx, item, STAGE_CX, rect.y + SOLVED_TEXT_BASELINE, {
      size: 16,
      color: selected ? COLORS.brass : COLORS.textDim,
      bold: selected,
      align: "center",
      spacing: 2,
    });
  });
  text(
    ctx,
    "ENTER takes the item, ESC keeps tinkering",
    STAGE_CX,
    y + height - 16,
    {
      size: 11,
      color: COLORS.textFaint,
      align: "center",
    },
  );
}

/** The record this challenge holds, or `null` for one that belongs to no course. */
function recordFor(state: OrreryState): Metrics | null {
  const ref = state.challengeRef;
  if (ref === null) return null;
  return recordsOf(state, ref.mode)[ref.index] ?? null;
}

/** The banner a faulted run puts up, naming what stopped it. */
export function drawFaultBanner(
  ctx: CanvasRenderingContext2D,
  state: OrreryState,
): void {
  const fault = state.sim?.fault ?? null;
  if (fault === null) return;
  const y = 96;
  const height = 56;
  ctx.save();
  ctx.fillStyle = "rgba(20, 6, 6, 0.9)";
  ctx.fillRect(0, y, STAGE_W, height);
  ctx.restore();
  fillRect(ctx, 0, y, STAGE_W, 2, COLORS.fault);
  fillRect(ctx, 0, y + height - 2, STAGE_W, 2, COLORS.fault);
  text(ctx, FAULT_BANNERS[fault.kind], STAGE_CX, y + 26, {
    size: 18,
    color: COLORS.fault,
    bold: true,
    align: "center",
    spacing: 2,
  });
  text(
    ctx,
    "the machine is frozen where it stood — ESC returns to editing",
    STAGE_CX,
    y + 45,
    {
      size: 12,
      color: COLORS.textDim,
      align: "center",
    },
  );
}
