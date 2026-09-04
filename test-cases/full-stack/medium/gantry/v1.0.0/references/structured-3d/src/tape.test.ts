import { describe, expect, it } from "vitest";
import { AXES } from "./sim";
import { GantryState } from "./game";
import { addActionStep, addMoveStep, currentProgram, setScreen } from "./state";
import {
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
  type TapeWidget,
} from "./tape";

/** A game on the program screen with one move step on the tape. */
function programming(): GantryState {
  const state = new GantryState();
  setScreen(state, "program");
  addMoveStep(state, "slew", 90, 30);
  return state;
}

/** The first widget of a kind the layout carries. */
function widget(state: GantryState, kind: TapeWidget["kind"]): TapeWidget {
  const found = tapeLayout(state).widgets.find((w) => w.kind === kind);
  if (found === undefined) throw new Error(`no ${kind} widget`);
  return found;
}

describe("nudge", () => {
  it("moves a value onto the next multiple of the step", () => {
    expect(nudge(102.68, 1)).toBe(103);
    expect(nudge(102.68, -1)).toBe(102);
    expect(nudge(90, 15)).toBe(105);
    expect(nudge(90, -15)).toBe(75);
  });

  it("leaves a value a zero step or a non-finite value alone", () => {
    expect(nudge(4, 0)).toBe(4);
    expect(nudge(Number.NaN, 1)).toBeNaN();
  });
});

describe("the defaults a command is added with", () => {
  it("takes the axis's run-start value and its maximum rate", () => {
    expect(defaultTarget("hoist")).toBe(2);
    expect(defaultTarget("slew")).toBe(0);
    expect(defaultRate("slew")).toBe(AXES.slew.maxRate);
  });

  it("holds a nudged rate inside what the editor accepts", () => {
    expect(clampRate("slew", 999)).toBe(AXES.slew.maxRate);
    expect(clampRate("slew", -5)).toBe(5);
  });
});

describe("tapeLayout", () => {
  it("lays a line out per step and per command under a move", () => {
    const state = programming();
    addActionStep(state, "attach");
    const layout = tapeLayout(state);
    expect(layout.rows.map((row) => row.kind)).toEqual([
      "step",
      "command",
      "step",
    ]);
    expect(layout.titleText).toBe("TAPE — 2 STEPS");
    expect(layout.clipped).toBe(0);
  });

  it("names one step in the singular", () => {
    expect(tapeLayout(programming()).titleText).toBe("TAPE — 1 STEP");
  });

  it("clips a tape longer than the list can show", () => {
    const state = new GantryState();
    setScreen(state, "program");
    for (let i = 0; i < LIST_CAPACITY + 4; i++) addActionStep(state, "attach");
    const layout = tapeLayout(state);
    expect(layout.rows).toHaveLength(LIST_CAPACITY);
    expect(layout.clipped).toBe(4);
  });

  it("hits the widget under a press, and nothing outside the panel", () => {
    const state = programming();
    const layout = tapeLayout(state);
    const target = layout.bar[0];
    expect(hitTapeWidget(layout, target.rect.x + 2, target.rect.y + 2)).toEqual(
      target,
    );
    expect(hitTapeWidget(layout, -50, -50)).toBeNull();
    expect(insidePanel(PANEL.x + 1, PANEL.y + 1)).toBe(true);
    expect(insidePanel(PANEL.x - 1, PANEL.y + 1)).toBe(false);
  });

  it("prints a step and a command compactly", () => {
    expect(stepText({ kind: "action", action: "release" }, 0)).toBe(
      "01  RELEASE",
    );
    expect(
      stepText(
        {
          kind: "move",
          commands: [
            { axis: "slew", target: 0, rate: 30 },
            { axis: "hoist", target: 2, rate: 4 },
          ],
        },
        4,
      ),
    ).toBe("05  MOVE (2)");
    expect(commandText({ axis: "slew", target: 90.125, rate: 30 })).toBe(
      "SLEW → 90.13  @ 30",
    );
    expect(formatValue(1.5)).toBe("1.5");
    expect(formatValue(Number.POSITIVE_INFINITY)).toBe("Infinity");
  });
});

describe("the edits the widgets make", () => {
  it("adds a move, an action, and a command, and empties the tape", () => {
    const state = new GantryState();
    setScreen(state, "program");
    applyTapeWidget(state, widget(state, "add-move"));
    expect(currentProgram(state)).toHaveLength(1);
    applyTapeWidget(state, widget(state, "add-action"));
    expect(currentProgram(state)).toHaveLength(2);
    applyTapeWidget(state, widget(state, "add-command"));
    const step = currentProgram(state)[0];
    expect(step.kind === "move" && step.commands).toHaveLength(2);
    applyTapeWidget(state, widget(state, "clear-tape"));
    expect(currentProgram(state)).toHaveLength(0);
  });

  it("nudges a target and a rate through the widgets", () => {
    const state = programming();
    applyTapeWidget(state, widget(state, "nudge-target"));
    const first = currentProgram(state)[0];
    expect(first.kind === "move" && first.commands[0].target).toBe(75);
    applyTapeWidget(state, widget(state, "nudge-rate"));
    const second = currentProgram(state)[0];
    expect(second.kind === "move" && second.commands[0].rate).toBe(25);
  });

  it("refuses a rate the tape editor does not accept", () => {
    const state = programming();
    setCommandRate(state, 0, 0, 0);
    setCommandRate(state, 0, 0, AXES.slew.maxRate + 1);
    const step = currentProgram(state)[0];
    expect(step.kind === "move" && step.commands[0].rate).toBe(30);
  });

  it("takes a target as written and refuses one that is not a number", () => {
    const state = programming();
    setCommandTarget(state, 0, 0, 1234);
    setCommandTarget(state, 0, 0, Number.NaN);
    const step = currentProgram(state)[0];
    expect(step.kind === "move" && step.commands[0].target).toBe(1234);
  });

  it("keeps a move's last command and drops the whole step instead", () => {
    const state = programming();
    removeCommand(state, 0, 0);
    expect(currentProgram(state)).toHaveLength(1);
    applyTapeWidget(state, widget(state, "remove-step"));
    expect(currentProgram(state)).toHaveLength(0);
  });

  it("reorders a step and leaves one already at the end where it is", () => {
    const state = programming();
    addActionStep(state, "attach");
    reorderStep(state, 1, -1);
    expect(currentProgram(state)[0].kind).toBe("action");
    reorderStep(state, 0, -1);
    expect(currentProgram(state)[0].kind).toBe("action");
    reorderStep(state, 9, 1);
    expect(currentProgram(state)).toHaveLength(2);
  });

  it("clears the shown check result, as every tape edit does", () => {
    const state = programming();
    state.checkResult = {
      issues: [],
      cost: 0,
      budget: 0,
      stable: true,
      members: [],
    };
    applyTapeWidget(state, widget(state, "add-action"));
    expect(state.checkResult).toBeNull();
  });
});
