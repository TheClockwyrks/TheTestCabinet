// The tape editor's model: the widgets the program screen puts over the yard,
// where each one sits on the stage, and the edit each one makes.
//
// `specs/controls.md` fixes what the player can do here and leaves the widgets
// to the build: add a step, a move or an action; give a move its commands, each
// an axis, a target, and a rate the editor accepts under `specs/program.md`;
// edit, reorder, and remove existing steps; and read the whole tape in order.
// This file is that design, as pure geometry and pure edits, so `src/render.ts`
// draws exactly what `handlePointer` hit-tests and the two can never disagree.
//
// The editor keeps nothing of its own between frames: every widget is a whole
// edit, taken on the press, decided from the tape as it stands. There is no
// selection, no cursor, and no half-typed value, which is what lets the whole
// of `specs/state.md`'s state be the state.

import { thaw } from "./convert";
import type { Command, GantryState, ReadonlyGantryState, Step } from "./game";
import { AXES, AXIS_NAMES, startingAxes, type AxisName } from "./sim";
import {
  acceptableRate,
  addActionStep,
  addCommand,
  addMoveStep,
  clearProgram,
  currentProgram,
  removeStep,
} from "./state";

// ---- Geometry --------------------------------------------------------------

/** An axis-aligned rectangle in the logical stage's units. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** The panel the editor draws over the yard, and its inner padding. */
export const PANEL: Rect = { x: 16, y: 40, w: 700, h: 664 };
const PAD = 8;
const INNER_X = PANEL.x + PAD;
const INNER_W = PANEL.w - PAD * 2;

/** The panel's heading, which carries the tape's step count. */
export const TITLE_RECT: Rect = {
  x: INNER_X,
  y: PANEL.y + PAD,
  w: INNER_W,
  h: 20,
};

/** The step list: two columns of fixed-height rows. */
export const LIST_RECT: Rect = { x: INNER_X, y: 74, w: INNER_W, h: 550 };

/** One row of the list, and the buttons that sit in one. */
export const ROW_H = 22;
const COL_GAP = 12;
const COL_W = (LIST_RECT.w - COL_GAP) / 2;
const ROWS_PER_COL = Math.floor(LIST_RECT.h / ROW_H);

/** How many rows the list can show; a longer tape is clipped past this. */
export const LIST_CAPACITY = ROWS_PER_COL * 2;

const BTN = 18;
const BTN_GAP = 3;
const GROUP_GAP = 7;

/** The two rows of the add bar, under the list. */
const BAR_H = 28;
const BAR_Y1 = 632;
const BAR_Y2 = 666;

const contains = (rect: Rect, x: number, y: number): boolean =>
  x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;

/** Whether a stage position falls on the editor's panel. */
export const insidePanel = (x: number, y: number): boolean =>
  contains(PANEL, x, y);

// ---- The nudges ------------------------------------------------------------

/**
 * How far one press moves a value.
 *
 * A target needs both reaches: a set-down is judged to `PLACE_POS_TOL`, so the
 * fine step has to be fine enough to aim with, and a slew of a hundred degrees
 * has to be reachable without a hundred presses. A rate has one step, since the
 * axes' rates are coarse figures — every axis's maximum is a whole multiple of
 * its step, so both ends of its range are reachable.
 */
export interface AxisNudge {
  readonly fine: number;
  readonly coarse: number;
  readonly rate: number;
}

export const AXIS_NUDGE: Readonly<Record<AxisName, AxisNudge>> = {
  slew: { fine: 1, coarse: 15, rate: 5 },
  trolley: { fine: 0.1, coarse: 1, rate: 0.5 },
  hoist: { fine: 0.1, coarse: 1, rate: 0.5 },
  grip: { fine: 5, coarse: 45, rate: 5 },
};

const tidy = (value: number): number => Math.round(value * 1e6) / 1e6;

/**
 * The next multiple of `step` past `value` in the direction of `delta`, which
 * is how a press both moves a value and snaps it onto the step's grid: a target
 * of `102.68` nudged up by `1` reads `103`, and down by `1` reads `102`.
 */
export function nudge(value: number, delta: number): number {
  const step = Math.abs(delta);
  if (step === 0 || !Number.isFinite(value)) return value;
  const units = value / step;
  const next =
    delta > 0 ? Math.floor(units + 1e-9) + 1 : Math.ceil(units - 1e-9) - 1;
  return tidy(next * step);
}

/** The target a command takes when it is added: the axis's run-start value. */
export const defaultTarget = (axis: AxisName): number =>
  startingAxes()[axis].value;

/** The rate a command takes when it is added: the axis's maximum. */
export const defaultRate = (axis: AxisName): number => AXES[axis].maxRate;

/** A nudged rate held inside what the tape editor accepts. */
export function clampRate(axis: AxisName, rate: number): number {
  const step = AXIS_NUDGE[axis].rate;
  return tidy(Math.min(AXES[axis].maxRate, Math.max(step, rate)));
}

// ---- The widgets -----------------------------------------------------------

/** Everything a press on the tape editor can do. */
export type TapeWidget =
  | {
      readonly kind: "add-move";
      readonly rect: Rect;
      readonly label: string;
      readonly axis: AxisName;
    }
  | {
      readonly kind: "add-action";
      readonly rect: Rect;
      readonly label: string;
      readonly action: "attach" | "release";
    }
  | { readonly kind: "clear-tape"; readonly rect: Rect; readonly label: string }
  | {
      readonly kind: "add-command";
      readonly rect: Rect;
      readonly label: string;
      readonly step: number;
      readonly axis: AxisName;
    }
  | {
      readonly kind: "nudge-target";
      readonly rect: Rect;
      readonly label: string;
      readonly step: number;
      readonly command: number;
      readonly delta: number;
    }
  | {
      readonly kind: "nudge-rate";
      readonly rect: Rect;
      readonly label: string;
      readonly step: number;
      readonly command: number;
      readonly delta: number;
    }
  | {
      readonly kind: "remove-command";
      readonly rect: Rect;
      readonly label: string;
      readonly step: number;
      readonly command: number;
    }
  | {
      readonly kind: "reorder-step";
      readonly rect: Rect;
      readonly label: string;
      readonly step: number;
      readonly delta: number;
    }
  | {
      readonly kind: "remove-step";
      readonly rect: Rect;
      readonly label: string;
      readonly step: number;
    };

/** One line of the list: a step's own line, or one of a move's commands. */
export interface TapeRow {
  readonly rect: Rect;
  readonly kind: "step" | "command";
  /** The step this line belongs to, counted from `0`. */
  readonly step: number;
  /** Which of that move's commands, or `null` on a step's own line. */
  readonly command: number | null;
  /** The line as the panel reads it, left-aligned in the row. */
  readonly text: string;
  readonly widgets: readonly TapeWidget[];
}

/** The whole editor, laid out over the tape as it stands. */
export interface TapeLayout {
  readonly panel: Rect;
  readonly title: Rect;
  readonly titleText: string;
  readonly list: Rect;
  readonly rows: readonly TapeRow[];
  /** The add bar's buttons, under the list. */
  readonly bar: readonly TapeWidget[];
  /** Every widget on the panel, in the order they were laid out. */
  readonly widgets: readonly TapeWidget[];
  /** Rows the list had no room for, which is `0` on every ordinary tape. */
  readonly clipped: number;
}

const AXIS_INITIAL: Readonly<Record<AxisName, string>> = {
  slew: "S",
  trolley: "T",
  hoist: "H",
  grip: "G",
};

/** A figure as the panel shows it: at most two decimals, no trailing zeros. */
export const formatValue = (value: number): string =>
  Number.isFinite(value) ? String(Number(value.toFixed(2))) : String(value);

/** A command as one command line reads it. */
export const commandText = (command: Command): string =>
  `${command.axis.toUpperCase()} → ${formatValue(command.target)}  @ ${formatValue(command.rate)}`;

/** The text of a step's own line. */
export function stepText(step: Step, index: number): string {
  const number = String(index + 1).padStart(2, "0");
  if (step.kind === "action") return `${number}  ${step.action.toUpperCase()}`;
  const many = step.commands.length === 1 ? "" : ` (${step.commands.length})`;
  return `${number}  MOVE${many}`;
}

/** A run of same-sized buttons ending at `right`, laid out left to right. */
function buttonRow(
  right: number,
  y: number,
  groups: readonly (readonly string[])[],
): Rect[] {
  const counts = groups.map((g) => g.length).filter((n) => n > 0);
  const buttons = counts.reduce((sum, n) => sum + n, 0);
  if (buttons === 0) return [];
  const width =
    buttons * BTN +
    (buttons - counts.length) * BTN_GAP +
    (counts.length - 1) * GROUP_GAP;
  const rects: Rect[] = [];
  let x = right - width;
  groups.forEach((group) => {
    if (group.length === 0) return;
    group.forEach((_label, i) => {
      rects.push({ x, y, w: BTN, h: BTN });
      x += BTN + (i === group.length - 1 ? 0 : BTN_GAP);
    });
    x += GROUP_GAP;
  });
  return rects;
}

/** Lay the whole editor out over the open site's tape. */
export function tapeLayout(state: ReadonlyGantryState): TapeLayout {
  const program = currentProgram(state);
  const widgets: TapeWidget[] = [];

  // The list, as one flat run of lines: each step's own line, and under a move
  // one line per command.
  interface Line {
    readonly step: number;
    readonly command: number | null;
  }
  const lines: Line[] = [];
  program.forEach((step, index) => {
    lines.push({ step: index, command: null });
    if (step.kind === "move") {
      step.commands.forEach((_c, ci) =>
        lines.push({ step: index, command: ci }),
      );
    }
  });

  const rows: TapeRow[] = [];
  const shown = Math.min(lines.length, LIST_CAPACITY);
  for (let i = 0; i < shown; i++) {
    const line = lines[i];
    const column = Math.floor(i / ROWS_PER_COL);
    const colX = LIST_RECT.x + column * (COL_W + COL_GAP);
    const rect: Rect = {
      x: colX,
      y: LIST_RECT.y + (i % ROWS_PER_COL) * ROW_H,
      w: COL_W,
      h: ROW_H,
    };
    const right = colX + COL_W - 2;
    const buttonY = rect.y + (ROW_H - BTN) / 2;
    const step = program[line.step];
    const rowWidgets: TapeWidget[] = [];

    if (line.command === null) {
      const free =
        step.kind === "move"
          ? AXIS_NAMES.filter((a) => !step.commands.some((c) => c.axis === a))
          : [];
      const rects = buttonRow(right, buttonY, [
        free.map((a) => AXIS_INITIAL[a]),
        ["▲", "▼", "×"],
      ]);
      free.forEach((axis, i) => {
        rowWidgets.push({
          kind: "add-command",
          rect: rects[i],
          label: `+${AXIS_INITIAL[axis]}`,
          step: line.step,
          axis,
        });
      });
      const tail = rects.slice(free.length);
      rowWidgets.push({
        kind: "reorder-step",
        rect: tail[0],
        label: "▲",
        step: line.step,
        delta: -1,
      });
      rowWidgets.push({
        kind: "reorder-step",
        rect: tail[1],
        label: "▼",
        step: line.step,
        delta: 1,
      });
      rowWidgets.push({
        kind: "remove-step",
        rect: tail[2],
        label: "×",
        step: line.step,
      });
      rows.push({
        rect,
        kind: "step",
        step: line.step,
        command: null,
        text: stepText(step as Step, line.step),
        widgets: rowWidgets,
      });
    } else {
      // A command line only exists under a move step.
      const commands = step.kind === "move" ? step.commands : [];
      const command = commands[line.command] as Command;
      const nudges = AXIS_NUDGE[command.axis];
      const removable = commands.length > 1;
      const rects = buttonRow(right, buttonY, [
        ["«", "‹", "›", "»"],
        ["−", "+"],
        removable ? ["×"] : [],
      ]);
      const deltas = [-nudges.coarse, -nudges.fine, nudges.fine, nudges.coarse];
      const labels = ["«", "‹", "›", "»"];
      deltas.forEach((delta, i) => {
        rowWidgets.push({
          kind: "nudge-target",
          rect: rects[i],
          label: labels[i],
          step: line.step,
          command: line.command as number,
          delta,
        });
      });
      [-nudges.rate, nudges.rate].forEach((delta, i) => {
        rowWidgets.push({
          kind: "nudge-rate",
          rect: rects[4 + i],
          label: i === 0 ? "−" : "+",
          step: line.step,
          command: line.command as number,
          delta,
        });
      });
      if (removable) {
        rowWidgets.push({
          kind: "remove-command",
          rect: rects[6],
          label: "×",
          step: line.step,
          command: line.command,
        });
      }
      rows.push({
        rect,
        kind: "command",
        step: line.step,
        command: line.command,
        text: `    ${commandText(command)}`,
        widgets: rowWidgets,
      });
    }
    rowWidgets.forEach((w) => widgets.push(w));
  }

  // The add bar: a move on each axis, the two actions, and emptying the tape.
  const bar: TapeWidget[] = [];
  const spread = (count: number, index: number, gap: number): Rect => {
    const w = (INNER_W - gap * (count - 1)) / count;
    return { x: INNER_X + index * (w + gap), y: 0, w, h: BAR_H };
  };
  AXIS_NAMES.forEach((axis, i) => {
    bar.push({
      kind: "add-move",
      rect: { ...spread(4, i, 8), y: BAR_Y1 },
      label: `+ MOVE ${axis.toUpperCase()}`,
      axis,
    });
  });
  (["attach", "release"] as const).forEach((action, i) => {
    bar.push({
      kind: "add-action",
      rect: { ...spread(3, i, 8), y: BAR_Y2 },
      label: `+ ${action.toUpperCase()}`,
      action,
    });
  });
  bar.push({
    kind: "clear-tape",
    rect: { ...spread(3, 2, 8), y: BAR_Y2 },
    label: "CLEAR TAPE",
  });
  bar.forEach((w) => widgets.push(w));

  const steps = program.length;
  return {
    panel: PANEL,
    title: TITLE_RECT,
    titleText: `TAPE — ${steps} ${steps === 1 ? "STEP" : "STEPS"}`,
    list: LIST_RECT,
    rows,
    bar,
    widgets,
    clipped: lines.length - shown,
  };
}

/** The widget a press at a stage position takes, or `null` for none. */
export function hitTapeWidget(
  layout: TapeLayout,
  x: number,
  y: number,
): TapeWidget | null {
  for (const widget of layout.widgets) {
    if (contains(widget.rect, x, y)) return widget;
  }
  return null;
}

// ---- The edits the widgets make --------------------------------------------

/**
 * The open site's tape, replaced on a state the caller owns. The check result
 * stands only until the structure or the tape changes (`specs/structure.md`),
 * so every tape edit clears it, exactly as `src/state.ts`'s own tape
 * transitions do.
 */
function withProgram(s: GantryState, program: Step[]): GantryState {
  s.sites[s.siteIndex].program = program;
  s.checkResult = null;
  return s;
}

/** One move step's commands, or `null` when the tape carries no such move. */
function commandsAt(
  state: ReadonlyGantryState,
  index: number,
  command: number,
): readonly Command[] | null {
  const step = currentProgram(state)[index];
  if (step === undefined || step.kind !== "move") return null;
  if (command < 0 || command >= step.commands.length) return null;
  return step.commands as readonly Command[];
}

function replaceCommand(
  state: ReadonlyGantryState,
  index: number,
  command: number,
  next: Command,
): GantryState {
  const s = thaw(state);
  const program = s.sites[s.siteIndex].program;
  const step = program[index];
  if (step === undefined || step.kind !== "move") return s;
  const commands = step.commands.map((c, i) => (i === command ? next : c));
  const replaced = program.slice();
  replaced[index] = { kind: "move", commands };
  return withProgram(s, replaced);
}

/**
 * Set a command's target. Targets are accepted as written: whether one is
 * reachable depends on the structure, so it is judged when the step starts
 * (`specs/program.md`).
 */
export function setCommandTarget(
  state: ReadonlyGantryState,
  index: number,
  command: number,
  target: number,
): GantryState {
  const commands = commandsAt(state, index, command);
  if (commands === null || !Number.isFinite(target)) return thaw(state);
  return replaceCommand(state, index, command, {
    ...commands[command],
    target,
  });
}

/**
 * Set a command's rate. Refused, silently, on a rate the tape editor does not
 * accept: greater than `0` and at most the axis's maximum (`specs/program.md`).
 */
export function setCommandRate(
  state: ReadonlyGantryState,
  index: number,
  command: number,
  rate: number,
): GantryState {
  const commands = commandsAt(state, index, command);
  if (commands === null) return thaw(state);
  const current = commands[command];
  if (!acceptableRate(current.axis, rate)) return thaw(state);
  return replaceCommand(state, index, command, { ...current, rate });
}

/**
 * Remove one of a move's commands. Refused on the last one, since the editor
 * accepts a move only with at least one command (`specs/program.md`): the whole
 * step is what goes instead.
 */
export function removeCommand(
  state: ReadonlyGantryState,
  index: number,
  command: number,
): GantryState {
  const commands = commandsAt(state, index, command);
  const s = thaw(state);
  if (commands === null || commands.length <= 1) return s;
  const program = s.sites[s.siteIndex].program;
  const next = program.slice();
  next[index] = {
    kind: "move",
    commands: commands.filter((_c, i) => i !== command).map((c) => ({ ...c })),
  };
  return withProgram(s, next);
}

/**
 * Move a step one place earlier or later in the tape. A step already at the end
 * it is moved toward stays where it is.
 */
export function reorderStep(
  state: ReadonlyGantryState,
  index: number,
  delta: number,
): GantryState {
  const s = thaw(state);
  const program = s.sites[s.siteIndex].program;
  const to = index + delta;
  if (index < 0 || index >= program.length) return s;
  if (to < 0 || to >= program.length) return s;
  const next = program.slice();
  const moved = next[index];
  next[index] = next[to];
  next[to] = moved;
  return withProgram(s, next);
}

/** Apply the edit one widget stands for. */
export function applyTapeWidget(
  state: ReadonlyGantryState,
  widget: TapeWidget,
): GantryState {
  switch (widget.kind) {
    case "add-move":
      return addMoveStep(
        state,
        widget.axis,
        defaultTarget(widget.axis),
        defaultRate(widget.axis),
      );
    case "add-action":
      return addActionStep(state, widget.action);
    case "clear-tape":
      return clearProgram(state);
    case "add-command":
      return addCommand(
        state,
        widget.step,
        widget.axis,
        defaultTarget(widget.axis),
        defaultRate(widget.axis),
      );
    case "nudge-target": {
      const commands = commandsAt(state, widget.step, widget.command);
      if (commands === null) return thaw(state);
      return setCommandTarget(
        state,
        widget.step,
        widget.command,
        nudge(commands[widget.command].target, widget.delta),
      );
    }
    case "nudge-rate": {
      const commands = commandsAt(state, widget.step, widget.command);
      if (commands === null) return thaw(state);
      const current = commands[widget.command];
      return setCommandRate(
        state,
        widget.step,
        widget.command,
        clampRate(current.axis, nudge(current.rate, widget.delta)),
      );
    }
    case "remove-command":
      return removeCommand(state, widget.step, widget.command);
    case "reorder-step":
      return reorderStep(state, widget.step, widget.delta);
    case "remove-step":
      return removeStep(state, widget.step);
  }
}
