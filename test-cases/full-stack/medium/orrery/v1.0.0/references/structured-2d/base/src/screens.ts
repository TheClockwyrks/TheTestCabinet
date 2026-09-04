// Orrery — the title, how-to, and select screens (specs/ui.md).
//
// All three are worked from the keyboard alone, so each draws exactly one
// highlight and says what the keys do. The select screen is shared by the two
// modes and differs only in the list it shows and the locking it applies, so
// there is one drawing here and `src/flow.ts` decides what may be entered.
//
// A row's state is readable without relying on hue: every row carries a word —
// LOCKED, OPEN, or SOLVED — beside its number and name, and a solved row shows
// its three records, each labelled.

import { challengesOf } from "./challenges";
import {
  HOWTO_PAGES,
  STAGE_CX,
  STAGE_H,
  STAGE_W,
  TAGLINE_TEXT,
  TITLE_ITEMS,
  TITLE_TEXT,
} from "./constants";
import { disc, fillRect, line, sprite, strokeRect, text } from "./draw";
import { enterable } from "./flow";
import { howtoPage } from "./howto";
import type { Sprites } from "./assets";
import { type OrreryState, recordsOf, solvedOf } from "./state";
import { MOTE_SPRITE_PATHS, MOTE_SPRITE_SIZE } from "./constants";
import { COLORS, MOTE_COLORS } from "./theme";
import type { Metrics, MoteType } from "./types";

/** The title screen: the game's name, its tagline, the main menu, and the toy. */
export function drawTitle(
  ctx: CanvasRenderingContext2D,
  state: OrreryState,
  sprites: Sprites,
): void {
  text(ctx, TITLE_TEXT, STAGE_CX, 208, {
    size: 76,
    color: COLORS.brass,
    bold: true,
    align: "center",
    spacing: 14,
  });
  text(ctx, TAGLINE_TEXT, STAGE_CX, 252, {
    size: 16,
    color: COLORS.textDim,
    align: "center",
    spacing: 6,
  });
  fillRect(ctx, STAGE_CX - 160, 276, 320, 1, COLORS.panelEdge);
  TITLE_ITEMS.forEach((item, index) => {
    const selected = index === state.menuIndex;
    const y = 356 + index * 46;
    if (selected) {
      fillRect(ctx, STAGE_CX - 150, y - 24, 300, 34, COLORS.panel);
      strokeRect(ctx, STAGE_CX - 150, y - 24, 300, 34, COLORS.brass);
    }
    text(ctx, item, STAGE_CX, y, {
      size: 22,
      color: selected ? COLORS.brass : COLORS.textDim,
      bold: selected,
      align: "center",
      spacing: 5,
    });
  });
  drawOrrery(ctx, state.simTime, sprites);
  text(ctx, "ARROWS choose · ENTER takes · M mutes", STAGE_CX, STAGE_H - 24, {
    size: 12,
    color: COLORS.textFaint,
    align: "center",
    spacing: 1,
  });
}

/** How far the title orrery's rings are tipped away from the viewer. */
const ORBIT_TILT = 0.42;

/** The three bodies the title's little orrery carries, innermost first. */
const ORRERY_RINGS: readonly {
  readonly type: MoteType;
  readonly radius: number;
  readonly period: number;
}[] = [
  { type: "luna", radius: 46, period: 7 },
  { type: "mars", radius: 76, period: 13 },
  { type: "jupiter", radius: 106, period: 23 },
];

/**
 * A small working orrery under the menu: a sun on its hub and three bodies
 * turning about it on their own periods, drawn from `state.simTime` with the
 * produced mote sprites, so the title screen shows what the game is about.
 */
function drawOrrery(
  ctx: CanvasRenderingContext2D,
  simTime: number,
  sprites: Sprites,
): void {
  const cx = STAGE_CX;
  const cy = 572;
  ctx.save();
  ctx.strokeStyle = COLORS.panelEdge;
  ctx.lineWidth = 1;
  for (const ring of ORRERY_RINGS) {
    ctx.beginPath();
    ctx.ellipse(
      cx,
      cy,
      ring.radius,
      ring.radius * ORBIT_TILT,
      0,
      0,
      Math.PI * 2,
    );
    ctx.stroke();
  }
  ctx.restore();
  drawBody(ctx, sprites, "sol", cx, cy);
  for (const ring of ORRERY_RINGS) {
    const angle = (simTime / ring.period) * Math.PI * 2;
    const x = cx + Math.cos(angle) * ring.radius;
    const y = cy + Math.sin(angle) * ring.radius * ORBIT_TILT;
    line(ctx, cx, cy, x, y, COLORS.panelEdge, 1);
    drawBody(ctx, sprites, ring.type, x, y);
  }
}

/** One body of the title's orrery, as its produced sprite or as a bead. */
function drawBody(
  ctx: CanvasRenderingContext2D,
  sprites: Sprites,
  type: MoteType,
  x: number,
  y: number,
): void {
  if (
    !sprite(ctx, sprites.get(MOTE_SPRITE_PATHS[type]), x, y, MOTE_SPRITE_SIZE)
  ) {
    disc(ctx, x, y, 12, MOTE_COLORS[type] ?? COLORS.brass);
  }
}

/** The how-to: one of `HOWTO_PAGES` pages, and which page this is. */
export function drawHowto(
  ctx: CanvasRenderingContext2D,
  state: OrreryState,
): void {
  const page = howtoPage(state.howtoPage);
  text(ctx, "HOW TO PLAY", STAGE_CX, 72, {
    size: 18,
    color: COLORS.textFaint,
    align: "center",
    spacing: 6,
  });
  text(ctx, page.title, STAGE_CX, 118, {
    size: 32,
    color: COLORS.brass,
    bold: true,
    align: "center",
    spacing: 4,
  });
  fillRect(ctx, 200, 138, STAGE_W - 400, 1, COLORS.panelEdge);

  let y = 178;
  for (const paragraph of page.lines) {
    text(ctx, paragraph, 220, y, { size: 15, color: COLORS.text });
    y += 24;
  }
  const columns = page.columns ?? [];
  const half = Math.ceil(columns.length / 2);
  columns.forEach((entry, index) => {
    const column = index < half ? 0 : 1;
    const row = index < half ? index : index - half;
    text(ctx, entry, 220 + column * 430, y + row * 22, {
      size: 14,
      color: COLORS.textDim,
    });
  });

  text(ctx, `${state.howtoPage + 1} / ${HOWTO_PAGES}`, STAGE_CX, STAGE_H - 74, {
    size: 14,
    color: COLORS.brass,
    align: "center",
    spacing: 2,
  });
  for (let page_ = 0; page_ < HOWTO_PAGES; page_ += 1) {
    const x = STAGE_CX - (HOWTO_PAGES - 1) * 9 + page_ * 18;
    fillRect(
      ctx,
      x - 4,
      STAGE_H - 60,
      8,
      8,
      page_ === state.howtoPage ? COLORS.brass : COLORS.panelEdge,
    );
  }
  text(
    ctx,
    "LEFT and RIGHT turn the page · ENTER or ESC returns to the title",
    STAGE_CX,
    STAGE_H - 30,
    { size: 12, color: COLORS.textFaint, align: "center" },
  );
}

/** The select screen: the current mode's challenges, and what each row is. */
export function drawSelect(
  ctx: CanvasRenderingContext2D,
  state: OrreryState,
): void {
  const list = challengesOf(state.mode);
  const solved = solvedOf(state, state.mode);
  const records = recordsOf(state, state.mode);

  text(ctx, state.mode === "campaign" ? "CAMPAIGN" : "EXTRAS", STAGE_CX, 76, {
    size: 30,
    color: COLORS.brass,
    bold: true,
    align: "center",
    spacing: 8,
  });
  text(
    ctx,
    state.mode === "campaign"
      ? "a course worked through in order"
      : "ten standalone challenges, all open",
    STAGE_CX,
    102,
    { size: 13, color: COLORS.textDim, align: "center" },
  );

  const x0 = 200;
  const width = STAGE_W - 400;
  const rowHeight = list.length > 12 ? 34 : 40;
  const top = 140;
  list.forEach((challenge, index) => {
    const y = top + index * rowHeight;
    const highlighted = index === state.selectIndex;
    const isSolved = solved.includes(index);
    const open = enterable(state, state.mode, index);
    const stateWord = !open ? "LOCKED" : isSolved ? "SOLVED" : "OPEN";
    if (highlighted) {
      fillRect(ctx, x0, y - 20, width, rowHeight - 4, COLORS.panel);
      strokeRect(ctx, x0, y - 20, width, rowHeight - 4, COLORS.brass);
    }
    const dim = !open;
    text(ctx, String(index + 1).padStart(2, " "), x0 + 16, y, {
      size: 15,
      color: dim ? COLORS.textFaint : COLORS.textDim,
    });
    text(ctx, challenge.name, x0 + 56, y, {
      size: 16,
      color: dim ? COLORS.textFaint : highlighted ? COLORS.brass : COLORS.text,
      bold: highlighted,
    });
    text(ctx, stateWord, x0 + 300, y, {
      size: 11,
      color: !open
        ? COLORS.textFaint
        : isSolved
          ? COLORS.legal
          : COLORS.textDim,
      bold: true,
      spacing: 1,
    });
    const record = isSolved ? (records[index] ?? null) : null;
    if (record !== null) {
      text(ctx, recordLine(record), x0 + width - 16, y, {
        size: 12,
        color: COLORS.textDim,
        align: "right",
      });
    }
  });

  text(
    ctx,
    "ARROWS choose · ENTER opens · ESC returns to the title",
    STAGE_CX,
    STAGE_H - 40,
    { size: 12, color: COLORS.textFaint, align: "center" },
  );
}

/** A solved row's three records, each labelled. */
export function recordLine(record: Metrics): string {
  return `cost ${record.cost}   cycles ${record.cycles}   area ${record.area}`;
}
