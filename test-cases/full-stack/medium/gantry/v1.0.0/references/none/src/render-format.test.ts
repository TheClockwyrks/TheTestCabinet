import { describe, expect, it } from "vitest";
import {
  FAIL_TEXT,
  RUN_SPEEDS,
  SITE_COUNT,
  SITE_NAMES,
  TICK_HZ,
} from "./constants";
import { startingAxes, type AxisName, type StartIssue } from "./sim";
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
  ISSUE_GLOSS,
  menuEntries,
  REFUSAL_TEXT,
  seconds,
  siteRows,
  speedText,
  stepCounter,
  stepText,
  toolEntries,
} from "./render-format";
import {
  setCleared,
  setBest,
  setMenuIndex,
  setScreen,
  titleState,
} from "./state";

describe("numbers", () => {
  it("fixes a number at the places asked for", () => {
    expect(fixed(1.234, 1)).toBe("1.2");
    expect(fixed(1.235, 2)).toBe("1.24");
    expect(fixed(-0.001, 1)).toBe("0.0");
    expect(fixed(Number.POSITIVE_INFINITY)).toBe("—");
  });

  it("groups a cost so it reads at a glance", () => {
    expect(cost(0)).toBe("0");
    expect(cost(940)).toBe("940");
    expect(cost(2400)).toBe("2 400");
    expect(cost(1234567)).toBe("1 234 567");
    expect(cost(2399.6)).toBe("2 400");
  });

  it("reads a run clock off the tick count", () => {
    expect(clock(0)).toBe("0.00s");
    expect(clock(TICK_HZ)).toBe("1.00s");
    expect(clock(TICK_HZ * 18)).toBe("18.00s");
    expect(seconds(1.5)).toBe("1.50s");
  });
});

describe("the axes", () => {
  it("reads the four axes in the order the specification tabulates them", () => {
    expect(AXIS_ORDER).toEqual(["slew", "trolley", "hoist", "grip"]);
  });

  it("gives an angle degrees and a length units", () => {
    expect(axisValue("slew", 90)).toBe("90.0°");
    expect(axisValue("grip", -45)).toBe("-45.0°");
    expect(axisValue("trolley", 3.25)).toBe("3.3u");
    expect(axisValue("hoist", 2)).toBe("2.0u");
  });

  it("shows a target only while a command is live", () => {
    const axes = startingAxes();
    axes.slew.command = { target: 90, rate: 30 };
    axes.slew.rate = 12;
    const readouts = axisReadouts(axes);
    expect(readouts[0].target).toBe("90.0°");
    expect(readouts[0].moving).toBe(true);
    expect(readouts[1].target).toBeNull();
    expect(readouts[1].moving).toBe(false);
  });
});

describe("the tape", () => {
  it("writes a command with its axis, target, and rate", () => {
    expect(commandText({ axis: "slew", target: 90, rate: 30 })).toBe(
      "SLEW → 90.0° @ 30.0",
    );
  });

  it("writes a move with every command it carries", () => {
    const text = stepText({
      kind: "move",
      commands: [
        { axis: "trolley", target: 8, rate: 4 },
        { axis: "hoist", target: 6, rate: 2 },
      ],
    });
    expect(text).toContain("MOVE");
    expect(text).toContain("TROLLEY → 8.0u");
    expect(text).toContain("HOIST → 6.0u");
  });

  it("writes an action by its own name", () => {
    expect(stepText({ kind: "action", action: "attach" })).toBe("ATTACH");
    expect(stepText({ kind: "action", action: "release" })).toBe("RELEASE");
  });

  it("counts the live step as specs/ui.md counts it", () => {
    // `1 / n` before the first tick takes a step …
    expect(stepCounter(0, 4)).toBe("1 / 4");
    expect(stepCounter(1, 4)).toBe("2 / 4");
    // … and `n / n` once every step is complete.
    expect(stepCounter(4, 4)).toBe("4 / 4");
    expect(stepCounter(9, 4)).toBe("4 / 4");
    expect(stepCounter(0, 0)).toBe("0 / 0");
  });

  it("reads the watch speed off RUN_SPEEDS", () => {
    RUN_SPEEDS.forEach((speed, index) => {
      expect(speedText(index)).toBe(`×${speed}`);
    });
    expect(speedText(99)).toBe(`×${RUN_SPEEDS[0]}`);
  });
});

describe("the copy", () => {
  it("gives every failure cause the fixed copy specs/ui.md fixes", () => {
    for (const cause of Object.keys(FAIL_TEXT) as (keyof typeof FAIL_TEXT)[]) {
      expect(failText(cause)).toBe(FAIL_TEXT[cause]);
    }
  });

  it("glosses every start issue", () => {
    const issues: StartIssue[] = [
      "no-ring",
      "no-rail",
      "invalid-rail",
      "disconnected-members",
      "empty-program",
    ];
    for (const issue of issues) {
      expect(ISSUE_GLOSS[issue].length).toBeGreaterThan(4);
    }
  });

  it("explains every refusal the editor can give", () => {
    for (const line of Object.values(REFUSAL_TEXT)) {
      expect(line.length).toBeGreaterThan(4);
    }
  });

  it("explains the game in a player's words, naming the bindings", () => {
    const whole = HOW_TO.flatMap((section) => section.lines).join(" ");
    for (const key of ["Z", "C", "P", "B", "G", "S", "M", "ESC"]) {
      expect(whole).toContain(key);
    }
    expect(whole).toContain("ATTACH");
    expect(whole).toContain("RELEASE");
    expect(HOW_TO.length).toBeGreaterThan(3);
  });
});

describe("the tool palette", () => {
  it("lists the six tools with the digits that select them", () => {
    const entries = toolEntries("rail");
    expect(entries.map((entry) => entry.tool)).toEqual([
      "strut",
      "cable",
      "rail",
      "ring",
      "counterweight",
      "delete",
    ]);
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
});

describe("the site select", () => {
  it("numbers a site from one and names it", () => {
    const rows = siteRows(setScreen(titleState(), "select"));
    expect(rows).toHaveLength(SITE_COUNT);
    expect(rows[0].number).toBe("01");
    expect(rows[5].number).toBe("06");
    expect(rows.map((row) => row.name)).toEqual([...SITE_NAMES]);
  });

  it("opens the first site and locks the rest until one is cleared", () => {
    const rows = siteRows(setScreen(titleState(), "select"));
    expect(rows[0].state).toBe("open");
    expect(rows[1].state).toBe("locked");

    const cleared = setBest(
      setCleared(setScreen(titleState(), "select"), 0, true),
      0,
      { cost: 2400, time: 18 },
    );
    const after = siteRows(cleared);
    expect(after[0].state).toBe("cleared");
    expect(after[0].best).toEqual({ cost: 2400, time: 18 });
    expect(after[1].state).toBe("open");
    expect(after[2].state).toBe("locked");
  });

  it("marks the state with a shape, so it does not read by hue alone", () => {
    const state = setBest(
      setCleared(setScreen(titleState(), "select"), 0, true),
      0,
      { cost: 2400, time: 18 },
    );
    const rows = siteRows(state);
    expect(rows[0].mark).toBe("tick");
    expect(rows[1].mark).toBe("arrow");
    expect(rows[2].mark).toBe("cross");
    expect(new Set(rows.map((row) => row.mark)).size).toBe(3);
  });

  it("highlights the row the menu index names", () => {
    const state = setMenuIndex(setScreen(titleState(), "select"), 3);
    const rows = siteRows(state);
    expect(rows.filter((row) => row.highlighted)).toHaveLength(1);
    expect(rows[3].highlighted).toBe(true);
  });
});

describe("menuEntries", () => {
  it("names the title menu and the results menu, and nothing else", () => {
    expect(menuEntries(titleState())).toEqual(["SITES", "HOW TO PLAY"]);
    expect(menuEntries(setScreen(titleState(), "results"))).toEqual([
      "NEXT SITE",
      "REPLAY",
      "SITE SELECT",
    ]);
    expect(menuEntries(setScreen(titleState(), "build"))).toBeNull();
    expect(menuEntries(setScreen(titleState(), "run"))).toBeNull();
  });

  it("drops NEXT SITE on the last site", () => {
    const last = setScreen({ ...titleState(), siteIndex: 5 }, "results");
    expect(menuEntries(last)).toEqual(["REPLAY", "SITE SELECT"]);
  });
});

describe("the axis labels", () => {
  it("names every axis", () => {
    const names: AxisName[] = ["slew", "trolley", "hoist", "grip"];
    for (const axis of names) {
      expect(axisValue(axis, 0).length).toBeGreaterThan(2);
    }
  });
});
