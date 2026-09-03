// The screen layer: every menu, readout, and panel Gantry draws over the yard,
// in logical stage units on the engine's own 2D context.
//
// It is one pure function of the state (plus what a click at the pointer would
// do, which the caller reads from the editor): the engine clears the layer and
// gives it the logical viewport transform before every frame, so everything
// here is written in stage units and nothing is retained between frames.
// Nothing is written back either, so a test can hand it any context —
// `@napi-rs/canvas` serves — and read what came out.

import {
  CLEARED_TEXT,
  CREAK_THRESHOLD,
  RUN_SPEEDS,
  SITE_COUNT,
  STAGE_H,
  STAGE_W,
  TAGLINE_TEXT,
  TICK_HZ,
  TITLE_TEXT,
} from "./constants";
import type { ReadonlyGantryState } from "./game";
import type { EditRefusal, StartIssue } from "./sim";
import {
  ACCENT,
  BAD,
  BROKEN_CSS,
  COOL,
  css,
  display,
  GAUGE_TRACK,
  GOOD,
  INK,
  INK_DIM,
  INK_FAINT,
  mono,
  OVER_LIMIT,
  PANEL,
  PANEL_EDGE,
  PANEL_INSET,
  PANEL_SOLID,
  SCRIM,
  utilizationColour,
} from "./render-palette";
import {
  axisReadouts,
  clock,
  cost as costText,
  fixed,
  HOW_TO,
  ISSUE_GLOSS,
  failText,
  menuEntries,
  REFUSAL_TEXT,
  seconds,
  siteRows,
  speedText,
  stepCounter,
  stepText,
  toolEntries,
  type SiteMark,
  type ToolEntry,
} from "./render-format";
import { pendingStartIssues } from "./screens";
import { tapeLayout, type Rect, type TapeWidget } from "./tape";
import {
  craneCost,
  currentProgram,
  currentSite,
  highlightedIndex,
} from "./state";

/**
 * What a click at the pointer would do on the build screen, which the caller
 * reads by running the editor's own rules over the state (`src/render.ts`).
 * Both are `null` on every other screen and wherever the pointer picks nothing.
 */
export interface HudHint {
  /** What a click would place or remove, in a few words. */
  readonly action: string | null;
  /** The rule that would refuse it. */
  readonly refusal: EditRefusal | null;
}

/** The 2D context the layer paints on. */
type Ctx = CanvasRenderingContext2D;

const MARGIN = 24;

// ---- Primitives ------------------------------------------------------------

function roundRectPath(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.arcTo(x + w, y, x + w, y + radius, radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius);
  ctx.lineTo(x + radius, y + h);
  ctx.arcTo(x, y + h, x, y + h - radius, radius);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();
}

function box(
  ctx: Ctx,
  rect: Rect,
  fill: string = PANEL,
  edge: string | null = PANEL_EDGE,
  radius = 6,
): void {
  roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, radius);
  ctx.fillStyle = fill;
  ctx.fill();
  if (edge !== null) {
    ctx.strokeStyle = edge;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

interface TextOptions {
  font?: string;
  colour?: string;
  align?: CanvasTextAlign;
  baseline?: CanvasTextBaseline;
}

function write(
  ctx: Ctx,
  content: string,
  x: number,
  y: number,
  options: TextOptions = {},
): void {
  ctx.font = options.font ?? mono(14);
  ctx.fillStyle = options.colour ?? INK;
  ctx.textAlign = options.align ?? "left";
  ctx.textBaseline = options.baseline ?? "alphabetic";
  ctx.fillText(content, x, y);
}

/** A line cut to a width, with an ellipsis where it was cut. */
export function clip(ctx: Ctx, content: string, width: number): string {
  if (ctx.measureText(content).width <= width) return content;
  let text = content;
  while (text.length > 1 && ctx.measureText(`${text}…`).width > width) {
    text = text.slice(0, -1);
  }
  return `${text}…`;
}

/** A small capitalised label, the layer's quietest voice. */
const caption = (ctx: Ctx, content: string, x: number, y: number): void =>
  write(ctx, content, x, y, { font: mono(11), colour: INK_FAINT });

/**
 * A row of key hints along the bottom of a yard screen.
 *
 * The yard behind them is any colour at all — packed earth, pale sky, a lit
 * member — so like every other readout they sit on a panel, which is what keeps
 * them legible against the scene (`specs/overview.md`: text is legible against
 * its background at the logical stage size).
 */
function hints(ctx: Ctx, lines: readonly string[]): void {
  const font = mono(12);
  ctx.font = font;
  const width = lines.reduce(
    (widest, line) => Math.max(widest, ctx.measureText(line).width),
    0,
  );
  const top = STAGE_H - MARGIN - (lines.length - 1) * 16;
  box(
    ctx,
    {
      x: STAGE_W - MARGIN - width - 10,
      y: top - 15,
      w: width + 20,
      h: lines.length * 16 + 8,
    },
    PANEL,
    null,
    4,
  );
  let y = top;
  for (const line of lines) {
    write(ctx, line, STAGE_W - MARGIN, y, {
      font,
      colour: INK_DIM,
      align: "right",
    });
    y += 16;
  }
}

// ---- The pieces the yard screens share -------------------------------------

/** The strip naming the open site and reading its cost against the budget. */
function siteStrip(ctx: Ctx, state: ReadonlyGantryState, x = MARGIN): void {
  const site = currentSite(state);
  const rect: Rect = { x, y: MARGIN, w: 424, h: 96 };
  box(ctx, rect);
  caption(
    ctx,
    `SITE ${state.siteIndex + 1} / ${SITE_COUNT}`,
    rect.x + 14,
    rect.y + 22,
  );
  write(ctx, site.name.toUpperCase(), rect.x + 14, rect.y + 46, {
    font: display(22),
  });

  const spent = craneCost(state);
  const share = site.budget === 0 ? 0 : Math.min(1, spent / site.budget);
  const gauge: Rect = { x: rect.x + 14, y: rect.y + 58, w: rect.w - 28, h: 8 };
  box(ctx, gauge, GAUGE_TRACK, null, 4);
  if (share > 0) {
    box(
      ctx,
      { ...gauge, w: Math.max(3, gauge.w * share) },
      share >= 1 ? BAD : share > 0.85 ? ACCENT : COOL,
      null,
      4,
    );
  }
  write(
    ctx,
    `COST ${costText(spent)} / ${costText(site.budget)}`,
    rect.x + 14,
    rect.y + 84,
    { font: mono(13), colour: share >= 1 ? BAD : INK_DIM },
  );
  write(
    ctx,
    `TAPE ${currentProgram(state).length} STEPS`,
    rect.x + rect.w - 14,
    rect.y + 84,
    { font: mono(13), colour: INK_DIM, align: "right" },
  );
}

/** The build screen's tool palette, with each tool's binding. */
function toolPalette(
  ctx: Ctx,
  state: ReadonlyGantryState,
  entries: readonly ToolEntry[],
): void {
  const rect: Rect = { x: MARGIN, y: 132, w: 200, h: 24 + entries.length * 32 };
  box(ctx, rect);
  caption(ctx, "TOOL", rect.x + 14, rect.y + 20);
  entries.forEach((entry, i) => {
    const y = rect.y + 30 + i * 32;
    const row: Rect = { x: rect.x + 8, y, w: rect.w - 16, h: 28 };
    if (entry.selected) box(ctx, row, PANEL_INSET, ACCENT, 4);
    write(ctx, entry.key, row.x + 12, y + 19, {
      font: mono(13, 700),
      colour: entry.selected ? ACCENT : INK_FAINT,
    });
    write(ctx, entry.label, row.x + 36, y + 19, {
      font: mono(14, entry.selected ? 700 : 400),
      colour: entry.selected ? INK : INK_DIM,
    });
  });
  if (state.pendingNode !== null) {
    const y = rect.y + rect.h + 10;
    box(ctx, { x: MARGIN, y, w: 200, h: 28 }, PANEL, ACCENT, 4);
    write(ctx, "NODE HELD — ESC DROPS", MARGIN + 12, y + 19, {
      font: mono(11),
      colour: ACCENT,
    });
  }
}

/**
 * The shape a site's state is marked with, drawn with lines so no font can
 * fail to carry it (`specs/ui.md`: the state reads without relying on hue).
 */
function siteMark(
  ctx: Ctx,
  mark: SiteMark,
  x: number,
  y: number,
  colour: string,
): void {
  const r = 7;
  ctx.strokeStyle = colour;
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.beginPath();
  if (mark === "tick") {
    ctx.moveTo(x - r, y);
    ctx.lineTo(x - r / 3, y + r * 0.7);
    ctx.lineTo(x + r, y - r * 0.8);
  } else if (mark === "cross") {
    ctx.moveTo(x - r * 0.7, y - r * 0.7);
    ctx.lineTo(x + r * 0.7, y + r * 0.7);
    ctx.moveTo(x + r * 0.7, y - r * 0.7);
    ctx.lineTo(x - r * 0.7, y + r * 0.7);
  } else {
    ctx.moveTo(x - r * 0.5, y - r * 0.85);
    ctx.lineTo(x + r * 0.75, y);
    ctx.lineTo(x - r * 0.5, y + r * 0.85);
    ctx.closePath();
    ctx.fillStyle = colour;
    ctx.fill();
  }
  ctx.stroke();
  ctx.lineWidth = 1;
}

/** One line per issue, by its own name with a gloss beside it. */
function issueLines(
  ctx: Ctx,
  issues: readonly StartIssue[],
  x: number,
  y: number,
  width: number,
): number {
  let line = y;
  for (const issue of issues) {
    write(ctx, issue, x, line, { font: mono(13, 700), colour: ACCENT });
    write(ctx, ISSUE_GLOSS[issue], x + width, line, {
      font: mono(12),
      colour: INK_DIM,
      align: "right",
    });
    line += 20;
  }
  return line;
}

/**
 * What would refuse a run right now, by name (`specs/ui.md`: a refused start
 * "stays on the screen and shows the refusing issues by name").
 *
 * A refused start leaves the state byte-identical (`specs/instrumentation.md`),
 * so there is nothing recorded to draw after the fact; the refusal is read off
 * the structure and the tape instead, which puts the same issues on screen at
 * the moment `run` is refused — and before it, so a player knows what the
 * crane still needs. Empty exactly when `run` would start a run.
 */
function startBlock(
  ctx: Ctx,
  state: ReadonlyGantryState,
  x: number,
  y: number,
): void {
  const issues = pendingStartIssues(state);
  if (issues.length === 0) return;
  const rect: Rect = { x, y, w: 300, h: 40 + issues.length * 20 };
  box(ctx, rect, PANEL, BAD, 6);
  caption(ctx, "G RUN IS REFUSED", rect.x + 14, rect.y + 22);
  let line = rect.y + 44;
  for (const issue of issues) {
    write(ctx, issue, rect.x + 14, line, { font: mono(13, 700), colour: BAD });
    line += 20;
  }
}

/** The static check's result, which stands until the crane or the tape changes. */
function checkPanel(ctx: Ctx, state: ReadonlyGantryState): void {
  const result = state.checkResult;
  if (result === null) return;
  // A readiness issue leaves the structure unsolved, so the check has no
  // verdict to report and the panel shows none (`specs/ui.md`): only the
  // issues by name, and no member. `empty-program` is not a readiness issue —
  // a ready crane with an empty tape is still solved and still judged.
  const judged = result.issues.every((issue) => issue === "empty-program");
  // One line per issue, or the single "no issues" line when there are none, so
  // the summary under them always has a line's room inside the panel.
  const rows = Math.max(1, result.issues.length);
  const height = (judged ? 96 : 72) + rows * 20;
  const rect: Rect = {
    x: STAGE_W - MARGIN - 400,
    y: MARGIN,
    w: 400,
    h: height,
  };
  box(ctx, rect);
  caption(ctx, "STATIC CHECK", rect.x + 14, rect.y + 22);

  if (judged) {
    const verdict = result.stable
      ? "THE STRUCTURE STANDS"
      : "IT DOES NOT STAND";
    write(ctx, verdict, rect.x + 14, rect.y + 48, {
      font: display(17),
      colour: result.stable ? GOOD : BAD,
    });
  }

  let y = rect.y + (judged ? 72 : 48);
  if (result.issues.length === 0) {
    write(ctx, "no issues", rect.x + 14, y, {
      font: mono(12),
      colour: INK_DIM,
    });
    y += 20;
  } else {
    y = issueLines(ctx, result.issues, rect.x + 14, y, rect.w - 28);
  }

  const peak = result.members.reduce(
    (top, m) => Math.max(top, m.utilization),
    0,
  );
  write(
    ctx,
    result.members.length === 0
      ? "no member solved"
      : `${result.members.length} members   peak ${fixed(peak, 2)}`,
    rect.x + 14,
    y + 4,
    { font: mono(12), colour: INK_FAINT },
  );
}

/** What a click would do, or the rule that would refuse it (`specs/ui.md`). */
function pointerHint(ctx: Ctx, hint: HudHint): void {
  const refused = hint.refusal !== null;
  const content = refused
    ? `REFUSED — ${REFUSAL_TEXT[hint.refusal as EditRefusal]}`
    : hint.action;
  if (content === null) return;
  const rect: Rect = { x: STAGE_W / 2 - 300, y: STAGE_H - 96, w: 600, h: 34 };
  box(ctx, rect, PANEL_SOLID, refused ? BAD : PANEL_EDGE, 4);
  write(ctx, content, STAGE_W / 2, rect.y + 23, {
    font: mono(14, refused ? 700 : 400),
    colour: refused ? BAD : INK_DIM,
    align: "center",
  });
}

// ---- The tape panel --------------------------------------------------------

function tapeButton(ctx: Ctx, widget: TapeWidget): void {
  box(ctx, widget.rect, PANEL_INSET, PANEL_EDGE, 3);
  write(
    ctx,
    widget.label,
    widget.rect.x + widget.rect.w / 2,
    widget.rect.y + widget.rect.h / 2 + 4,
    {
      font: mono(widget.rect.w > 40 ? 11 : 12, 700),
      colour: INK_DIM,
      align: "center",
    },
  );
}

/**
 * The tape editor.
 *
 * The layout is `src/tape.ts`'s, which is also what `handlePointer` hit-tests
 * against, so what is drawn and what a press works are one description: every
 * rectangle here comes back from `tapeLayout`.
 */
function tapePanel(ctx: Ctx, state: ReadonlyGantryState): void {
  const layout = tapeLayout(state);
  const program = currentProgram(state);
  box(ctx, layout.panel, PANEL_SOLID);
  write(ctx, layout.titleText, layout.title.x, layout.title.y + 15, {
    font: mono(13, 700),
    colour: INK_DIM,
  });
  if (layout.clipped > 0) {
    write(
      ctx,
      `${layout.clipped} MORE BELOW`,
      layout.title.x + layout.title.w,
      layout.title.y + 15,
      { font: mono(12, 700), colour: ACCENT, align: "right" },
    );
  }

  if (program.length === 0) {
    write(
      ctx,
      "the tape is empty — add a step from the bar below",
      layout.list.x + layout.list.w / 2,
      layout.list.y + 40,
      { font: mono(13), colour: INK_FAINT, align: "center" },
    );
  }

  for (const row of layout.rows) {
    if (row.kind === "step") {
      box(ctx, { ...row.rect, h: row.rect.h - 2 }, PANEL_INSET, PANEL_EDGE, 3);
    }
    const action = program[row.step]?.kind === "action";
    write(ctx, row.text, row.rect.x + 6, row.rect.y + row.rect.h - 7, {
      font: mono(
        row.kind === "step" ? 12 : 11,
        row.kind === "step" ? 700 : 400,
      ),
      colour: row.kind === "command" ? INK_DIM : action ? COOL : INK,
    });
  }

  // The buttons last, so a long line runs under them rather than over them.
  for (const widget of layout.widgets) tapeButton(ctx, widget);
}

// ---- The run screen --------------------------------------------------------

/** The legend for the utilization ramp, so the member colouring reads. */
function rampLegend(ctx: Ctx): void {
  const rect: Rect = { x: MARGIN, y: STAGE_H - MARGIN - 84, w: 300, h: 84 };
  box(ctx, rect);
  caption(ctx, "MEMBER LOAD", rect.x + 14, rect.y + 20);
  const bar: Rect = { x: rect.x + 14, y: rect.y + 34, w: rect.w - 28, h: 12 };
  const steps = 48;
  for (let i = 0; i < steps; i++) {
    ctx.fillStyle = css(utilizationColour(i / (steps - 1)));
    ctx.fillRect(bar.x + (bar.w * i) / steps, bar.y, bar.w / steps + 1, bar.h);
  }
  ctx.strokeStyle = PANEL_EDGE;
  ctx.lineWidth = 1;
  ctx.strokeRect(bar.x, bar.y, bar.w, bar.h);
  // The creak threshold, ticked on the bar itself and named above it, so the
  // two labels under the bar never crowd one another.
  const creak = bar.x + bar.w * CREAK_THRESHOLD;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(creak, bar.y - 2);
  ctx.lineTo(creak, bar.y + bar.h + 2);
  ctx.stroke();
  write(ctx, "CREAK", creak - 3, bar.y - 4, {
    font: mono(10),
    colour: INK_FAINT,
    align: "right",
  });
  write(ctx, "SLACK", bar.x, bar.y + 26, { font: mono(11), colour: INK_FAINT });
  write(ctx, "LIMIT", bar.x + bar.w, bar.y + 26, {
    font: mono(11),
    colour: INK_FAINT,
    align: "right",
  });
  ctx.fillStyle = css(OVER_LIMIT);
  ctx.fillRect(bar.x, bar.y + 34, 12, 10);
  write(ctx, "past limit", bar.x + 18, bar.y + 43, {
    font: mono(11),
    colour: INK_FAINT,
  });
  ctx.fillStyle = BROKEN_CSS;
  ctx.fillRect(bar.x + 120, bar.y + 34, 12, 10);
  write(ctx, "broken", bar.x + 138, bar.y + 43, {
    font: mono(11),
    colour: INK_FAINT,
  });
}

function runPanels(ctx: Ctx, state: ReadonlyGantryState): void {
  const run = state.run;
  const tape = currentProgram(state);

  const head: Rect = { x: MARGIN, y: MARGIN, w: 300, h: 134 };
  box(ctx, head);
  caption(ctx, "RUN CLOCK", head.x + 14, head.y + 20);
  write(ctx, clock(run.tick), head.x + 14, head.y + 54, { font: display(30) });
  write(
    ctx,
    `STEP ${stepCounter(run.stepIndex, tape.length)}`,
    head.x + 14,
    head.y + 78,
    { font: mono(13), colour: INK_DIM },
  );
  // What that step is doing, so the tape reads while it plays rather than only
  // in the editor.
  const live = tape[Math.min(run.stepIndex, tape.length - 1)];
  ctx.font = mono(11);
  write(
    ctx,
    live === undefined ? "—" : clip(ctx, stepText(live), head.w - 28),
    head.x + 14,
    head.y + 96,
    { font: mono(11), colour: INK_FAINT },
  );
  write(ctx, `COST ${costText(craneCost(state))}`, head.x + 14, head.y + 120, {
    font: mono(13),
    colour: INK_DIM,
  });
  write(
    ctx,
    `SPEED ${speedText(run.speedIndex)}`,
    head.x + head.w - 14,
    head.y + 120,
    { font: mono(13, 700), colour: ACCENT, align: "right" },
  );

  const axes: Rect = { x: MARGIN, y: head.y + head.h + 12, w: 300, h: 116 };
  box(ctx, axes);
  caption(ctx, "AXES", axes.x + 14, axes.y + 20);
  axisReadouts(run.axes).forEach((axis, i) => {
    const y = axes.y + 44 + i * 22;
    write(ctx, axis.label, axes.x + 14, y, {
      font: mono(12),
      colour: axis.moving ? ACCENT : INK_FAINT,
    });
    write(ctx, axis.value, axes.x + 168, y, {
      font: mono(13, 700),
      colour: INK,
      align: "right",
    });
    write(
      ctx,
      axis.target === null ? "—" : `→ ${axis.target}`,
      axes.x + axes.w - 14,
      y,
      {
        font: mono(12),
        colour: axis.target === null ? INK_FAINT : COOL,
        align: "right",
      },
    );
  });

  const site = currentSite(state);
  const strip: Rect = { x: STAGE_W - MARGIN - 300, y: MARGIN, w: 300, h: 66 };
  box(ctx, strip);
  caption(
    ctx,
    `SITE ${state.siteIndex + 1} / ${SITE_COUNT}`,
    strip.x + 14,
    strip.y + 22,
  );
  write(ctx, site.name.toUpperCase(), strip.x + 14, strip.y + 48, {
    font: display(18),
  });
  const placed = run.loads.filter((l) => l.phase === "placed").length;
  write(
    ctx,
    `${placed} / ${run.loads.length} PLACED`,
    strip.x + strip.w - 14,
    strip.y + 48,
    {
      font: mono(12),
      colour: placed === run.loads.length ? GOOD : INK_DIM,
      align: "right",
    },
  );

  if (run.broken.length > 0) {
    const warn: Rect = {
      x: STAGE_W - MARGIN - 300,
      y: strip.y + strip.h + 10,
      w: 300,
      h: 30,
    };
    box(ctx, warn, PANEL, BAD, 4);
    write(
      ctx,
      `${run.broken.length} MEMBERS BROKEN`,
      warn.x + 14,
      warn.y + 20,
      {
        font: mono(13, 700),
        colour: BAD,
      },
    );
  }

  rampLegend(ctx);

  if (run.phase === "failed" && run.cause !== null) {
    const banner: Rect = { x: STAGE_W / 2 - 300, y: 268, w: 600, h: 118 };
    box(ctx, banner, PANEL_SOLID, BAD, 8);
    write(ctx, "RUN FAILED", STAGE_W / 2, banner.y + 36, {
      font: mono(13, 700),
      colour: BAD,
      align: "center",
    });
    write(ctx, failText(run.cause), STAGE_W / 2, banner.y + 74, {
      font: display(28),
      colour: INK,
      align: "center",
    });
    write(ctx, run.cause, STAGE_W / 2, banner.y + 98, {
      font: mono(12),
      colour: INK_FAINT,
      align: "center",
    });
  }
}

// ---- The menu screens ------------------------------------------------------

function scrim(ctx: Ctx): void {
  ctx.fillStyle = SCRIM;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
}

function menu(
  ctx: Ctx,
  items: readonly string[],
  highlight: number,
  x: number,
  y: number,
  width: number,
): void {
  items.forEach((item, i) => {
    const rect: Rect = { x, y: y + i * 48, w: width, h: 40 };
    const on = i === highlight;
    if (on) box(ctx, rect, PANEL_INSET, ACCENT, 4);
    write(ctx, on ? "»" : " ", rect.x + 14, rect.y + 27, {
      font: mono(18, 700),
      colour: ACCENT,
    });
    write(ctx, item, rect.x + 44, rect.y + 27, {
      font: display(19, on ? 700 : 500),
      colour: on ? INK : INK_DIM,
    });
  });
}

function titleScreen(ctx: Ctx, state: ReadonlyGantryState): void {
  scrim(ctx);
  write(ctx, TITLE_TEXT, 120, 250, { font: display(112) });
  ctx.fillStyle = ACCENT;
  ctx.fillRect(124, 274, 320, 5);
  write(ctx, TAGLINE_TEXT, 124, 312, { font: mono(18), colour: INK_DIM });
  const items = menuEntries(state) ?? [];
  menu(ctx, items, highlightedIndex(state), 120, 400, 380);
  write(ctx, "↑ ↓ CHOOSE      ENTER SELECT      M MUTE", 120, STAGE_H - 60, {
    font: mono(12),
    colour: INK_FAINT,
  });
  if (state.muted) {
    write(ctx, "MUTED", STAGE_W - MARGIN, MARGIN + 16, {
      font: mono(12, 700),
      colour: ACCENT,
      align: "right",
    });
  }
}

function howToScreen(ctx: Ctx): void {
  scrim(ctx);
  write(ctx, "HOW TO PLAY", MARGIN + 36, 84, { font: display(38) });
  const columns = [
    { x: MARGIN + 36, sections: HOW_TO.slice(0, 3) },
    { x: STAGE_W / 2 + 12, sections: HOW_TO.slice(3) },
  ];
  for (const column of columns) {
    let y = 132;
    for (const section of column.sections) {
      write(ctx, section.heading, column.x, y, {
        font: mono(13, 700),
        colour: ACCENT,
      });
      y += 22;
      for (const line of section.lines) {
        write(ctx, line, column.x, y, { font: mono(13), colour: INK_DIM });
        y += 18;
      }
      y += 16;
    }
  }
  write(ctx, "ESC — BACK", MARGIN + 36, STAGE_H - 40, {
    font: mono(13),
    colour: INK_FAINT,
  });
}

function selectScreen(ctx: Ctx, state: ReadonlyGantryState): void {
  scrim(ctx);
  write(ctx, "SITES", MARGIN + 36, 92, { font: display(44) });
  write(ctx, "CLEAR A SITE TO OPEN THE NEXT", MARGIN + 36, 120, {
    font: mono(13),
    colour: INK_FAINT,
  });
  const rows = siteRows(state);
  rows.forEach((row, i) => {
    const rect: Rect = {
      x: MARGIN + 36,
      y: 152 + i * 76,
      w: STAGE_W - 2 * (MARGIN + 36),
      h: 64,
    };
    const locked = row.state === "locked";
    box(
      ctx,
      rect,
      row.highlighted ? PANEL_SOLID : PANEL,
      row.highlighted ? ACCENT : PANEL_EDGE,
      6,
    );
    write(ctx, row.number, rect.x + 20, rect.y + 41, {
      font: display(28),
      colour: locked ? INK_FAINT : ACCENT,
    });
    write(ctx, row.name.toUpperCase(), rect.x + 82, rect.y + 33, {
      font: display(21),
      colour: locked ? INK_FAINT : INK,
    });
    const tone =
      row.state === "cleared" ? GOOD : row.state === "open" ? COOL : INK_FAINT;
    siteMark(ctx, row.mark, rect.x + 90, rect.y + 49, tone);
    write(ctx, row.stateText, rect.x + 108, rect.y + 53, {
      font: mono(12, 700),
      colour: tone,
    });
    if (row.best !== null) {
      write(
        ctx,
        `BEST   COST ${costText(row.best.cost)}   TIME ${seconds(row.best.time)}`,
        rect.x + rect.w - 20,
        rect.y + 41,
        { font: mono(13), colour: INK_DIM, align: "right" },
      );
    } else if (locked) {
      write(ctx, "LOCKED", rect.x + rect.w - 20, rect.y + 41, {
        font: mono(13),
        colour: INK_FAINT,
        align: "right",
      });
    }
  });
  write(
    ctx,
    "↑ ↓ CHOOSE      ENTER OPEN SITE      ESC BACK",
    MARGIN + 36,
    STAGE_H - 34,
    {
      font: mono(12),
      colour: INK_FAINT,
    },
  );
}

function resultsScreen(ctx: Ctx, state: ReadonlyGantryState): void {
  scrim(ctx);
  const site = currentSite(state);
  const score = state.best[state.siteIndex] ?? null;
  const rect: Rect = { x: STAGE_W / 2 - 320, y: 120, w: 640, h: 460 };
  box(ctx, rect, PANEL_SOLID, ACCENT, 10);
  write(ctx, CLEARED_TEXT, STAGE_W / 2, rect.y + 84, {
    font: display(46),
    align: "center",
  });
  write(ctx, site.name.toUpperCase(), STAGE_W / 2, rect.y + 118, {
    font: mono(15),
    colour: INK_DIM,
    align: "center",
  });

  const runCost = craneCost(state);
  const runTime = state.run.tick / TICK_HZ;
  const columns: readonly [string, string, string][] = [
    ["COST", costText(runCost), costText(site.par.cost)],
    ["TIME", seconds(runTime), seconds(site.par.time)],
  ];
  columns.forEach(([label, mine, par], i) => {
    const x = STAGE_W / 2 - 150 + i * 300;
    caption(ctx, label, x, rect.y + 168);
    write(ctx, mine, x, rect.y + 206, { font: display(34) });
    write(ctx, `PAR ${par}`, x, rect.y + 232, {
      font: mono(13),
      colour: INK_FAINT,
    });
  });
  if (score !== null) {
    write(
      ctx,
      `BEST   COST ${costText(score.cost)}   TIME ${seconds(score.time)}`,
      STAGE_W / 2,
      rect.y + 262,
      { font: mono(13), colour: INK_DIM, align: "center" },
    );
  }

  const items = menuEntries(state) ?? [];
  menu(ctx, items, highlightedIndex(state), rect.x + 180, rect.y + 292, 280);
}

// ---- The whole layer -------------------------------------------------------

/**
 * Paint the screen layer for one frame. The engine has already cleared the
 * layer and given the context the logical viewport transform, so everything
 * here is in stage units.
 */
export function drawHud(
  ctx: Ctx,
  state: ReadonlyGantryState,
  hint: HudHint,
): void {
  ctx.save();
  ctx.lineJoin = "round";

  switch (state.screen) {
    case "title":
      titleScreen(ctx, state);
      break;
    case "howto":
      howToScreen(ctx);
      break;
    case "select":
      selectScreen(ctx, state);
      break;
    case "build":
      siteStrip(ctx, state);
      toolPalette(ctx, state, toolEntries(state.tool));
      startBlock(ctx, state, MARGIN, state.pendingNode === null ? 366 : 404);
      checkPanel(ctx, state);
      pointerHint(ctx, hint);
      hints(ctx, [
        "DRAG ORBIT   = − ZOOM   1…6 TOOL   Z UNDO   C CHECK",
        "P TAPE   G RUN   ESC BACK   M MUTE",
      ]);
      break;
    case "program":
      // The tape editor takes the left of the stage, so the site's own strip
      // moves to the right rather than sitting under it.
      siteStrip(ctx, state, STAGE_W - MARGIN - 424);
      startBlock(ctx, state, STAGE_W - MARGIN - 300, MARGIN + 106);
      tapePanel(ctx, state);
      hints(ctx, [
        "CLICK A WIDGET TO EDIT THE TAPE   DRAG ORBIT   = − ZOOM",
        "B BUILD   G RUN   ESC BACK   M MUTE",
      ]);
      break;
    case "run":
      runPanels(ctx, state);
      hints(ctx, [
        state.run.phase === "running"
          ? `S SPEED (${RUN_SPEEDS.join(" ")})   DRAG ORBIT   ESC ABORT   M MUTE`
          : "ESC BACK TO BUILD   DRAG ORBIT   M MUTE",
      ]);
      break;
    case "results":
      resultsScreen(ctx, state);
      break;
  }

  if (state.muted && state.screen !== "title") {
    write(ctx, "MUTED", STAGE_W - MARGIN, STAGE_H - MARGIN - 44, {
      font: mono(11, 700),
      colour: ACCENT,
      align: "right",
    });
  }
  ctx.restore();
}
