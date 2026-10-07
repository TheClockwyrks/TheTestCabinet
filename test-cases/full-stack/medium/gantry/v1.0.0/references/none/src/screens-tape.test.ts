import { describe, expect, it } from "vitest";

import { HOIST_MAX_RATE, HOIST_START, SLEW_MAX_RATE } from "./constants";
import { AXES, type AxisName, type MoveStep, type TapeStep } from "./sim";
import {
  addActionStep,
  addCommand,
  addMoveStep,
  currentProgram,
  setScreen,
  titleState,
  type GantryState,
} from "./state";
import {
  AXIS_NUDGE,
  applyTapeWidget,
  clampRate,
  commandText,
  defaultRate,
  defaultTarget,
  formatValue,
  hitTapeWidget,
  insidePanel,
  LIST_CAPACITY,
  nudge,
  PANEL,
  removeCommand,
  reorderStep,
  setCommandRate,
  setCommandTarget,
  stepText,
  tapeLayout,
  type Rect,
  type TapeWidget,
} from "./screens-tape";

const programScreen = (): GantryState => setScreen(titleState(), "program");

const moveOf = (state: GantryState, index: number): MoveStep => {
  const step = currentProgram(state)[index];
  if (step.kind !== "move") throw new Error("not a move step");
  return step;
};

const center = (rect: Rect): { x: number; y: number } => ({
  x: rect.x + rect.w / 2,
  y: rect.y + rect.h / 2,
});

/** Press the widget the predicate names, through the hit test. */
function press(
  state: GantryState,
  match: (w: TapeWidget) => boolean,
): GantryState {
  const layout = tapeLayout(state);
  const target = layout.widgets.find(match);
  if (target === undefined) throw new Error("no such widget");
  const at = center(target.rect);
  const hit = hitTapeWidget(layout, at.x, at.y);
  expect(hit).toEqual(target);
  return applyTapeWidget(state, hit!);
}

describe("the nudge", () => {
  it("moves to the next multiple of its step in its direction", () => {
    expect(nudge(102.68, 1)).toBe(103);
    expect(nudge(102.68, -1)).toBe(102);
    expect(nudge(102.68, 15)).toBe(105);
    expect(nudge(102.68, -15)).toBe(90);
  });

  it("leaves a value already on the grid moving by a whole step", () => {
    expect(nudge(90, 15)).toBe(105);
    expect(nudge(90, -15)).toBe(75);
    expect(nudge(0, 0.1)).toBe(0.1);
    expect(nudge(0.1, -0.1)).toBe(0);
  });

  it("keeps a tenth a tenth rather than a float smear", () => {
    let value = 0;
    for (let i = 0; i < 10; i++) value = nudge(value, 0.1);
    expect(value).toBe(1);
  });

  it("moves nothing on a zero step or a value that is not finite", () => {
    expect(nudge(5, 0)).toBe(5);
    expect(nudge(Number.NaN, 1)).toBeNaN();
  });
});

describe("the rates the editor offers", () => {
  it("holds a nudged rate between one step and the axis's maximum", () => {
    for (const axis of ["slew", "trolley", "hoist", "grip"] as AxisName[]) {
      const step = AXIS_NUDGE[axis].rate;
      expect(clampRate(axis, 0)).toBe(step);
      expect(clampRate(axis, -100)).toBe(step);
      expect(clampRate(axis, 1e6)).toBe(AXES[axis].maxRate);
      // Every axis's maximum is a whole number of steps, so both ends are
      // reachable by pressing.
      expect(AXES[axis].maxRate / step).toBe(
        Math.round(AXES[axis].maxRate / step),
      );
    }
  });

  it("starts a command at the axis's run-start value and its top rate", () => {
    expect(defaultTarget("hoist")).toBe(HOIST_START);
    expect(defaultTarget("slew")).toBe(0);
    expect(defaultRate("slew")).toBe(SLEW_MAX_RATE);
    expect(defaultRate("hoist")).toBe(HOIST_MAX_RATE);
  });
});

describe("the panel's text", () => {
  it("numbers the steps from one and names each kind", () => {
    const move: TapeStep = {
      kind: "move",
      commands: [{ axis: "slew", target: 90, rate: 30 }],
    };
    expect(stepText(move, 0)).toBe("01  MOVE");
    expect(stepText({ kind: "action", action: "attach" }, 2)).toBe(
      "03  ATTACH",
    );
    expect(
      stepText(
        {
          kind: "move",
          commands: [
            { axis: "slew", target: 90, rate: 30 },
            { axis: "hoist", target: 4, rate: 4 },
          ],
        },
        9,
      ),
    ).toBe("10  MOVE (2)");
  });

  it("reads a command as its axis, its target, and its rate", () => {
    expect(commandText({ axis: "trolley", target: 8.25, rate: 4 })).toBe(
      "TROLLEY → 8.25  @ 4",
    );
  });

  it("shows a figure to at most two decimals with no trailing zeros", () => {
    expect(formatValue(102.6803)).toBe("102.68");
    expect(formatValue(20)).toBe("20");
    expect(formatValue(-0.5)).toBe("-0.5");
  });

  it("counts the tape in its heading", () => {
    expect(tapeLayout(programScreen()).titleText).toBe("TAPE — 0 STEPS");
    const one = addActionStep(programScreen(), "attach");
    expect(tapeLayout(one).titleText).toBe("TAPE — 1 STEP");
  });
});

describe("the layout", () => {
  it("puts one row on each step and one under a move on each command", () => {
    let state = addMoveStep(programScreen(), "slew", 90, 30);
    state = addCommand(state, 0, "hoist", 6, 4);
    state = addActionStep(state, "attach");
    const layout = tapeLayout(state);
    expect(layout.rows.map((r) => [r.kind, r.step, r.command])).toEqual([
      ["step", 0, null],
      ["command", 0, 0],
      ["command", 0, 1],
      ["step", 1, null],
    ]);
    expect(layout.rows[0].text).toBe("01  MOVE (2)");
    expect(layout.rows[3].text).toBe("02  ATTACH");
    expect(layout.clipped).toBe(0);
  });

  it("keeps every widget inside the panel and off every other widget", () => {
    let state = programScreen();
    state = addMoveStep(state, "slew", 90, 30);
    state = addCommand(state, 0, "trolley", 8, 4);
    state = addActionStep(state, "attach");
    state = addMoveStep(state, "hoist", 6, 4);
    const layout = tapeLayout(state);
    expect(layout.widgets.length).toBeGreaterThan(20);
    for (const w of layout.widgets) {
      expect(w.rect.x).toBeGreaterThanOrEqual(PANEL.x);
      expect(w.rect.y).toBeGreaterThanOrEqual(PANEL.y);
      expect(w.rect.x + w.rect.w).toBeLessThanOrEqual(PANEL.x + PANEL.w);
      expect(w.rect.y + w.rect.h).toBeLessThanOrEqual(PANEL.y + PANEL.h);
    }
    for (let i = 0; i < layout.widgets.length; i++) {
      for (let j = i + 1; j < layout.widgets.length; j++) {
        const a = layout.widgets[i].rect;
        const b = layout.widgets[j].rect;
        const apart =
          a.x + a.w <= b.x ||
          b.x + b.w <= a.x ||
          a.y + a.h <= b.y ||
          b.y + b.h <= a.y;
        expect(apart).toBe(true);
      }
    }
  });

  it("offers a move only the axes it does not already command", () => {
    let state = addMoveStep(programScreen(), "slew", 90, 30);
    const before = tapeLayout(state).widgets.filter(
      (w) => w.kind === "add-command",
    );
    expect(before.map((w) => (w.kind === "add-command" ? w.axis : ""))).toEqual(
      ["trolley", "hoist", "grip"],
    );
    state = addCommand(state, 0, "hoist", 6, 4);
    const after = tapeLayout(state).widgets.filter(
      (w) => w.kind === "add-command",
    );
    expect(after.map((w) => (w.kind === "add-command" ? w.axis : ""))).toEqual([
      "trolley",
      "grip",
    ]);
  });

  it("offers no add-command widget on an action step", () => {
    const state = addActionStep(programScreen(), "release");
    expect(
      tapeLayout(state).widgets.some((w) => w.kind === "add-command"),
    ).toBe(false);
  });

  it("offers a remove only on a move carrying more than one command", () => {
    let state = addMoveStep(programScreen(), "slew", 90, 30);
    expect(
      tapeLayout(state).widgets.some((w) => w.kind === "remove-command"),
    ).toBe(false);
    state = addCommand(state, 0, "grip", 45, 45);
    expect(
      tapeLayout(state).widgets.filter((w) => w.kind === "remove-command"),
    ).toHaveLength(2);
  });

  it("carries the add bar whatever the tape holds", () => {
    const layout = tapeLayout(programScreen());
    expect(layout.rows).toHaveLength(0);
    expect(layout.bar.map((w) => w.kind)).toEqual([
      "add-move",
      "add-move",
      "add-move",
      "add-move",
      "add-action",
      "add-action",
      "clear-tape",
    ]);
  });

  it("clips a tape longer than the list can show", () => {
    let state = programScreen();
    for (let i = 0; i < LIST_CAPACITY + 5; i++) {
      state = addActionStep(state, "attach");
    }
    const layout = tapeLayout(state);
    expect(layout.rows).toHaveLength(LIST_CAPACITY);
    expect(layout.clipped).toBe(5);
  });

  it("hits nothing off a widget, and knows the panel from the yard", () => {
    const layout = tapeLayout(addActionStep(programScreen(), "attach"));
    expect(hitTapeWidget(layout, 1200, 400)).toBeNull();
    expect(insidePanel(1200, 400)).toBe(false);
    expect(insidePanel(PANEL.x + 4, PANEL.y + 4)).toBe(true);
  });
});

describe("the edits the widgets make", () => {
  it("adds a move on each axis and an action of each kind", () => {
    let state = programScreen();
    state = press(state, (w) => w.kind === "add-move" && w.axis === "hoist");
    state = press(
      state,
      (w) => w.kind === "add-action" && w.action === "release",
    );
    expect(currentProgram(state)).toEqual([
      {
        kind: "move",
        commands: [
          { axis: "hoist", target: HOIST_START, rate: HOIST_MAX_RATE },
        ],
      },
      { kind: "action", action: "release" },
    ]);
  });

  it("gives a move another axis's command, and refuses a second on one", () => {
    let state = press(programScreen(), (w) => w.kind === "add-move");
    state = press(state, (w) => w.kind === "add-command" && w.axis === "grip");
    expect(moveOf(state, 0).commands.map((c) => c.axis)).toEqual([
      "slew",
      "grip",
    ]);
    // The editor offers no second `grip`, and posing one is refused.
    expect(
      tapeLayout(state).widgets.some(
        (w) => w.kind === "add-command" && w.axis === "grip",
      ),
    ).toBe(false);
  });

  it("nudges a target finely and coarsely, both ways", () => {
    let state = addMoveStep(programScreen(), "slew", 102.68, 30);
    const fine = (delta: number) => (w: TapeWidget) =>
      w.kind === "nudge-target" && w.delta === delta;
    state = press(state, fine(1));
    expect(moveOf(state, 0).commands[0].target).toBe(103);
    state = press(state, fine(-1));
    expect(moveOf(state, 0).commands[0].target).toBe(102);
    state = press(state, fine(15));
    expect(moveOf(state, 0).commands[0].target).toBe(105);
    state = press(state, fine(-15));
    expect(moveOf(state, 0).commands[0].target).toBe(90);
  });

  it("nudges a rate and holds it inside what the editor accepts", () => {
    let state = addMoveStep(programScreen(), "trolley", 8, 4);
    const down = (w: TapeWidget) => w.kind === "nudge-rate" && w.delta < 0;
    const up = (w: TapeWidget) => w.kind === "nudge-rate" && w.delta > 0;
    for (let i = 0; i < 20; i++) state = press(state, down);
    expect(moveOf(state, 0).commands[0].rate).toBe(AXIS_NUDGE.trolley.rate);
    for (let i = 0; i < 40; i++) state = press(state, up);
    expect(moveOf(state, 0).commands[0].rate).toBe(AXES.trolley.maxRate);
  });

  it("removes a command, and never the last one", () => {
    let state = addMoveStep(programScreen(), "slew", 90, 30);
    state = addCommand(state, 0, "hoist", 6, 4);
    state = press(state, (w) => w.kind === "remove-command" && w.command === 0);
    expect(moveOf(state, 0).commands.map((c) => c.axis)).toEqual(["hoist"]);
    expect(removeCommand(state, 0, 0)).toBe(state);
  });

  it("removes a step", () => {
    let state = addActionStep(
      addMoveStep(programScreen(), "slew", 90, 30),
      "attach",
    );
    state = press(state, (w) => w.kind === "remove-step" && w.step === 0);
    expect(currentProgram(state)).toEqual([
      { kind: "action", action: "attach" },
    ]);
  });

  it("reorders a step, and refuses to move one off either end", () => {
    let state = addMoveStep(programScreen(), "slew", 90, 30);
    state = addActionStep(state, "attach");
    state = press(
      state,
      (w) => w.kind === "reorder-step" && w.step === 1 && w.delta === -1,
    );
    expect(currentProgram(state).map((s) => s.kind)).toEqual([
      "action",
      "move",
    ]);
    expect(reorderStep(state, 0, -1)).toBe(state);
    expect(reorderStep(state, 1, 1)).toBe(state);
    expect(reorderStep(state, 7, 1)).toBe(state);
  });

  it("empties the tape", () => {
    let state = addActionStep(
      addMoveStep(programScreen(), "slew", 90, 30),
      "attach",
    );
    state = press(state, (w) => w.kind === "clear-tape");
    expect(currentProgram(state)).toEqual([]);
  });

  it("clears the shown check result on every tape edit", () => {
    const showing = (s: GantryState): GantryState => ({
      ...s,
      checkResult: {
        issues: [],
        cost: 0,
        budget: 0,
        stable: true,
        members: [],
      },
    });
    let state = addMoveStep(programScreen(), "slew", 90, 30);
    expect(setCommandTarget(showing(state), 0, 0, 45).checkResult).toBeNull();
    expect(setCommandRate(showing(state), 0, 0, 10).checkResult).toBeNull();
    state = addCommand(state, 0, "hoist", 6, 4);
    expect(removeCommand(showing(state), 0, 1).checkResult).toBeNull();
    state = addActionStep(state, "attach");
    expect(reorderStep(showing(state), 0, 1).checkResult).toBeNull();
  });

  it("refuses an edit the tape has no such step or command for", () => {
    const state = addActionStep(programScreen(), "attach");
    expect(setCommandTarget(state, 0, 0, 5)).toBe(state);
    expect(setCommandRate(state, 0, 0, 5)).toBe(state);
    expect(removeCommand(state, 0, 0)).toBe(state);
    expect(setCommandTarget(state, 9, 0, 5)).toBe(state);
  });

  it("refuses a target that is not a number and a rate it would not accept", () => {
    const state = addMoveStep(programScreen(), "slew", 90, 30);
    expect(setCommandTarget(state, 0, 0, Number.NaN)).toBe(state);
    expect(setCommandRate(state, 0, 0, 0)).toBe(state);
    expect(setCommandRate(state, 0, 0, SLEW_MAX_RATE + 1)).toBe(state);
    expect(moveOf(setCommandRate(state, 0, 0, 5), 0).commands[0].rate).toBe(5);
  });

  it("applies a posed widget the layout no longer carries without throwing", () => {
    const state = programScreen();
    const gone: TapeWidget = {
      kind: "nudge-target",
      rect: { x: 0, y: 0, w: 1, h: 1 },
      label: "‹",
      step: 4,
      command: 0,
      delta: 1,
    };
    expect(applyTapeWidget(state, gone)).toBe(state);
    expect(
      applyTapeWidget(state, { ...gone, kind: "nudge-rate" } as TapeWidget),
    ).toBe(state);
  });

  it("names a widget for every button the layout draws", () => {
    let state = addMoveStep(programScreen(), "slew", 90, 30);
    state = addCommand(state, 0, "hoist", 6, 4);
    state = addActionStep(state, "attach");
    const kinds = new Set(tapeLayout(state).widgets.map((w) => w.kind));
    expect([...kinds].sort()).toEqual([
      "add-action",
      "add-command",
      "add-move",
      "clear-tape",
      "nudge-rate",
      "nudge-target",
      "remove-command",
      "remove-step",
      "reorder-step",
    ]);
  });

  it("holds the widgets of a row on that row", () => {
    const state = addMoveStep(programScreen(), "slew", 90, 30);
    for (const row of tapeLayout(state).rows) {
      for (const w of row.widgets) {
        expect(w.rect.y).toBeGreaterThanOrEqual(row.rect.y);
        expect(w.rect.y + w.rect.h).toBeLessThanOrEqual(
          row.rect.y + row.rect.h,
        );
        expect(w.rect.x).toBeGreaterThanOrEqual(row.rect.x);
        expect(w.rect.x + w.rect.w).toBeLessThanOrEqual(
          row.rect.x + row.rect.w,
        );
      }
    }
  });

  it("lays a long tape out in two columns", () => {
    let state = programScreen();
    for (let i = 0; i < 30; i++) state = addActionStep(state, "attach");
    const layout = tapeLayout(state);
    const columns = new Set(layout.rows.map((r) => r.rect.x));
    expect(columns.size).toBe(2);
  });
});
