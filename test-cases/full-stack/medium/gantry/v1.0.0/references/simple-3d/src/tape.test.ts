// The tape editor: where each widget sits, what a press on one takes, and the
// edit it makes.

import { describe, expect, it } from "vitest";
import type { GantryState } from "./game";
import { AXES } from "./sim";
import {
  addActionStep,
  addMoveStep,
  currentProgram,
  openSite,
  setScreen,
  titleState,
} from "./state";
import {
  applyTapeWidget,
  AXIS_NUDGE,
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

const program = (): GantryState =>
  setScreen(openSite(titleState(), 0), "program");

/** A tape with one move carrying a slew command, and one action. */
function authored(): GantryState {
  let s = addMoveStep(program(), "slew", 30, 30);
  s = addActionStep(s, "attach");
  return s;
}

/** The first widget of a kind on the panel. */
function widget(state: GantryState, kind: TapeWidget["kind"]): TapeWidget {
  const found = tapeLayout(state).widgets.find((w) => w.kind === kind);
  if (found === undefined) throw new Error(`no ${kind} widget`);
  return found;
}

/** Press a widget: what `handlePointer` does once it has hit-tested one. */
const press = (state: GantryState, w: TapeWidget): GantryState =>
  applyTapeWidget(state, w);

describe("the panel", () => {
  it("owns its own rectangle and nothing outside it", () => {
    expect(insidePanel(PANEL.x + 1, PANEL.y + 1)).toBe(true);
    expect(insidePanel(PANEL.x - 1, PANEL.y + 1)).toBe(false);
    expect(insidePanel(PANEL.x + PANEL.w, PANEL.y + 1)).toBe(false);
  });

  it("counts the tape in its heading", () => {
    expect(tapeLayout(program()).titleText).toBe("TAPE — 0 STEPS");
    expect(tapeLayout(addMoveStep(program(), "slew", 0, 30)).titleText).toBe(
      "TAPE — 1 STEP",
    );
  });

  it("lays a line out per step and per command under it", () => {
    const layout = tapeLayout(authored());
    expect(layout.rows).toHaveLength(3);
    expect(layout.rows[0].kind).toBe("step");
    expect(layout.rows[1].kind).toBe("command");
    expect(layout.rows[2].text).toContain("ATTACH");
    expect(layout.clipped).toBe(0);
  });

  it("clips a tape longer than the list can show, and says how many", () => {
    let s = program();
    for (let i = 0; i < LIST_CAPACITY + 3; i++) s = addActionStep(s, "attach");
    const layout = tapeLayout(s);
    expect(layout.rows).toHaveLength(LIST_CAPACITY);
    expect(layout.clipped).toBe(3);
  });
});

describe("the hit test", () => {
  it("takes the widget a press falls inside", () => {
    const layout = tapeLayout(authored());
    const target = layout.bar[0];
    const hit = hitTapeWidget(layout, target.rect.x + 2, target.rect.y + 2);
    expect(hit?.kind).toBe("add-move");
  });

  it("takes none where a press falls on no widget", () => {
    const layout = tapeLayout(program());
    expect(hitTapeWidget(layout, PANEL.x + 1, PANEL.y + 1)).toBeNull();
  });
});

describe("the add bar", () => {
  it("appends a move on each axis at that axis's own defaults", () => {
    const s = press(program(), widget(program(), "add-move"));
    const step = currentProgram(s)[0];
    expect(step.kind).toBe("move");
    if (step.kind !== "move") return;
    expect(step.commands[0].axis).toBe("slew");
    expect(step.commands[0].target).toBe(defaultTarget("slew"));
    expect(step.commands[0].rate).toBe(defaultRate("slew"));
  });

  it("appends the two actions", () => {
    const bar = tapeLayout(program()).bar;
    const attach = bar.find((w) => w.kind === "add-action");
    expect(attach).toBeDefined();
    const s = press(program(), attach as TapeWidget);
    expect(currentProgram(s)[0]).toEqual({ kind: "action", action: "attach" });
  });

  it("empties the tape", () => {
    const s = press(authored(), widget(authored(), "clear-tape"));
    expect(currentProgram(s)).toHaveLength(0);
  });
});

describe("a move's commands", () => {
  it("gains one on each axis it does not already carry", () => {
    const s = press(authored(), widget(authored(), "add-command"));
    const step = currentProgram(s)[0];
    if (step.kind !== "move") throw new Error("expected a move");
    expect(step.commands).toHaveLength(2);
    // The button offers only the axes the step is free of, so the new one is
    // the first of those rather than a second slew.
    expect(step.commands.map((c) => c.axis)).toEqual(["slew", "trolley"]);
  });

  it("nudges a target onto the step's own grid", () => {
    const nudged = press(authored(), widget(authored(), "nudge-target"));
    const step = currentProgram(nudged)[0];
    if (step.kind !== "move") throw new Error("expected a move");
    expect(step.commands[0].target).toBe(30 - AXIS_NUDGE.slew.coarse);
  });

  it("nudges a rate and holds it inside what the editor accepts", () => {
    let s = authored();
    // Its rate starts at the axis's maximum, so up is refused and down lands.
    for (let i = 0; i < 20; i++) {
      s = press(s, widget(s, "nudge-rate"));
    }
    const step = currentProgram(s)[0];
    if (step.kind !== "move") throw new Error("expected a move");
    expect(step.commands[0].rate).toBe(AXIS_NUDGE.slew.rate);
  });

  it("removes one only while another is left", () => {
    const one = authored();
    expect(
      tapeLayout(one).widgets.some((w) => w.kind === "remove-command"),
    ).toBe(false);
    const two = press(one, widget(one, "add-command"));
    const gone = press(two, widget(two, "remove-command"));
    const step = currentProgram(gone)[0];
    if (step.kind !== "move") throw new Error("expected a move");
    expect(step.commands).toHaveLength(1);
  });
});

describe("the steps", () => {
  it("reorder within the tape and stay put at either end", () => {
    const s = authored();
    const down = reorderStep(s, 0, 1);
    expect(currentProgram(down)[0].kind).toBe("action");
    expect(currentProgram(reorderStep(s, 0, -1))).toEqual(currentProgram(s));
    expect(currentProgram(reorderStep(s, 9, 1))).toEqual(currentProgram(s));
  });

  it("are removed by their own button", () => {
    const s = authored();
    const gone = press(s, widget(s, "remove-step"));
    expect(currentProgram(gone)).toHaveLength(1);
    expect(currentProgram(gone)[0].kind).toBe("action");
  });
});

describe("the edits under the widgets", () => {
  it("take a target as written and refuse one that is not a number", () => {
    const set = setCommandTarget(authored(), 0, 0, 102.5);
    const step = currentProgram(set)[0];
    if (step.kind !== "move") throw new Error("expected a move");
    expect(step.commands[0].target).toBe(102.5);
    expect(
      currentProgram(setCommandTarget(authored(), 0, 0, Number.NaN)),
    ).toEqual(currentProgram(authored()));
  });

  it("refuse a rate the axis does not accept", () => {
    const over = setCommandRate(authored(), 0, 0, AXES.slew.maxRate + 1);
    expect(currentProgram(over)).toEqual(currentProgram(authored()));
    const zero = setCommandRate(authored(), 0, 0, 0);
    expect(currentProgram(zero)).toEqual(currentProgram(authored()));
  });

  it("touch nothing on an index the tape does not carry", () => {
    const before = currentProgram(authored());
    expect(currentProgram(setCommandTarget(authored(), 9, 0, 1))).toEqual(
      before,
    );
    expect(currentProgram(setCommandRate(authored(), 0, 9, 1))).toEqual(before);
    expect(currentProgram(removeCommand(authored(), 1, 0))).toEqual(before);
  });

  it("clear the check result, since the tape has changed", () => {
    const s = { ...authored(), checkResult: null };
    expect(press(s, widget(s, "add-command")).checkResult).toBeNull();
  });
});

describe("the words the panel is made of", () => {
  it("prints a figure at two decimals with no trailing zeros", () => {
    expect(formatValue(30)).toBe("30");
    expect(formatValue(0.125)).toBe("0.13");
    expect(formatValue(Number.NaN)).toBe("NaN");
  });

  it("numbers a step and counts a move's commands", () => {
    expect(stepText({ kind: "action", action: "release" }, 0)).toBe(
      "01  RELEASE",
    );
    expect(
      stepText(
        {
          kind: "move",
          commands: [
            { axis: "slew", target: 0, rate: 1 },
            { axis: "hoist", target: 0, rate: 1 },
          ],
        },
        4,
      ),
    ).toBe("05  MOVE (2)");
  });

  it("reads a command as its axis, its target, and its rate", () => {
    expect(commandText({ axis: "hoist", target: 6.5, rate: 4 })).toBe(
      "HOIST → 6.5  @ 4",
    );
  });
});

describe("the nudges", () => {
  it("step onto the grid rather than adding blindly", () => {
    expect(nudge(102.68, 1)).toBe(103);
    expect(nudge(102.68, -1)).toBe(102);
    expect(nudge(5, 0)).toBe(5);
    expect(nudge(Number.NaN, 1)).toBeNaN();
  });

  it("hold a rate between one step and the axis's maximum", () => {
    expect(clampRate("slew", 1000)).toBe(AXES.slew.maxRate);
    expect(clampRate("slew", -5)).toBe(AXIS_NUDGE.slew.rate);
  });
});
