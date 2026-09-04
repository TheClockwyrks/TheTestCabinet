import { describe, expect, it } from "vitest";
import { FAIL_TEXT, RUN_SPEEDS, TICK_HZ } from "./constants";
import { GantryState } from "./game";
import {
  AXIS_ORDER,
  axisReadouts,
  axisValue,
  clock,
  commandText,
  cost,
  failText,
  fixed,
  HOW_TO,
  menuEntries,
  programLength,
  seconds,
  siteRows,
  speedText,
  stepCounter,
  stepText,
  toolEntries,
} from "./format";
import { addMoveStep, setScreen } from "./state";

describe("figures", () => {
  it("prints a fixed number of places and never a negative zero", () => {
    expect(fixed(1.25, 1)).toBe("1.3");
    expect(fixed(-0.004, 2)).toBe("0.00");
    expect(fixed(Number.NaN)).toBe("—");
  });

  it("groups a cost for reading", () => {
    expect(cost(2400)).toBe("2 400");
    expect(cost(999)).toBe("999");
    expect(cost(1234567)).toBe("1 234 567");
  });

  it("reads the run clock off the tick count", () => {
    expect(clock(TICK_HZ)).toBe("1.00s");
    expect(seconds(0.5)).toBe("0.50s");
  });

  it("cycles the watch speed through RUN_SPEEDS", () => {
    RUN_SPEEDS.forEach((speed, i) => expect(speedText(i)).toBe(`×${speed}`));
    expect(speedText(99)).toBe(`×${RUN_SPEEDS[0]}`);
  });
});

describe("the axes", () => {
  it("names the four axes in the order the program tabulates them", () => {
    expect(AXIS_ORDER).toEqual(["slew", "trolley", "hoist", "grip"]);
  });

  it("reads a value in its own unit", () => {
    expect(axisValue("slew", 90)).toBe("90.0°");
    expect(axisValue("hoist", 2)).toBe("2.0u");
  });

  it("reports each axis's value, its target while live, and whether it turns", () => {
    const run = new GantryState().run;
    run.axes.slew = { value: 10, rate: 2, command: { target: 90, rate: 30 } };
    const [slew, trolley] = axisReadouts(run.axes);
    expect(slew).toMatchObject({
      label: "SLEW",
      value: "10.0°",
      target: "90.0°",
      moving: true,
    });
    expect(trolley.target).toBeNull();
    expect(trolley.moving).toBe(false);
  });
});

describe("the tape and the step counter", () => {
  it("prints a command and a step", () => {
    expect(commandText({ axis: "slew", target: 90, rate: 30 })).toBe(
      "SLEW → 90.0° @ 30.0",
    );
    expect(stepText({ kind: "action", action: "attach" })).toBe("ATTACH");
    expect(
      stepText({
        kind: "move",
        commands: [{ axis: "grip", target: 0, rate: 45 }],
      }),
    ).toContain("MOVE");
    expect(stepText({ kind: "move", commands: [] })).toBe("MOVE");
  });

  it("counts from one and stops at the tape's length", () => {
    expect(stepCounter(0, 0)).toBe("0 / 0");
    expect(stepCounter(0, 3)).toBe("1 / 3");
    expect(stepCounter(3, 3)).toBe("3 / 3");
  });
});

describe("the screens' own words", () => {
  it("gives every failure cause its fixed copy", () => {
    for (const cause of Object.keys(FAIL_TEXT) as (keyof typeof FAIL_TEXT)[]) {
      expect(failText(cause)).toBe(FAIL_TEXT[cause]);
    }
  });

  it("marks the selected tool and names its binding", () => {
    const entries = toolEntries("rail");
    expect(entries).toHaveLength(6);
    expect(entries.map((entry) => entry.key)).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
    ]);
    expect(entries.filter((entry) => entry.selected)).toHaveLength(1);
    expect(entries[2].selected).toBe(true);
  });

  it("reads a site's state without relying on hue", () => {
    const state = new GantryState();
    state.cleared[0] = true;
    const rows = siteRows(state);
    expect(rows[0]).toMatchObject({
      number: "01",
      state: "cleared",
      mark: "tick",
    });
    expect(rows[1]).toMatchObject({ state: "open", mark: "arrow" });
    expect(rows[2]).toMatchObject({ state: "locked", mark: "cross" });
  });

  it("gives the menu of whichever screen shows one", () => {
    const state = new GantryState();
    expect(menuEntries(state)).toEqual(["SITES", "HOW TO PLAY"]);
    setScreen(state, "results");
    expect(menuEntries(state)).toEqual(["NEXT SITE", "REPLAY", "SITE SELECT"]);
    state.siteIndex = 5;
    expect(menuEntries(state)).toEqual(["REPLAY", "SITE SELECT"]);
    setScreen(state, "build");
    expect(menuEntries(state)).toBeNull();
  });

  it("counts the open site's tape", () => {
    const state = new GantryState();
    expect(programLength(state)).toBe(0);
    addMoveStep(state, "slew", 90, 30);
    expect(programLength(state)).toBe(1);
  });

  it("explains the game in six headed blocks", () => {
    expect(HOW_TO).toHaveLength(6);
    for (const section of HOW_TO) {
      expect(section.heading.length).toBeGreaterThan(0);
      expect(section.lines.length).toBeGreaterThan(0);
    }
  });
});
