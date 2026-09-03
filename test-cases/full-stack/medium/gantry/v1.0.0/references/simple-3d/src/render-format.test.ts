// The words the readouts are made of, away from any canvas.

import { describe, expect, it } from "vitest";
import { FAIL_TEXT, RUN_SPEEDS, SITE_COUNT, SITE_NAMES } from "./constants";
import type { AxisName, AxisState, GantryState } from "./game";
import {
  axisReadouts,
  clock,
  commandText,
  cost,
  failText,
  fixed,
  HOW_TO,
  ISSUE_GLOSS,
  menuEntries,
  programLength,
  REFUSAL_TEXT,
  seconds,
  siteRows,
  speedText,
  stepCounter,
  stepText,
  toolEntries,
} from "./render-format";
import { idleRun } from "./convert";
import {
  addActionStep,
  openSite,
  setBest,
  setCleared,
  setMenuIndex,
  setScreen,
  titleState,
} from "./state";

describe("figures", () => {
  it("prints a number at a fixed number of places", () => {
    expect(fixed(1.25, 1)).toBe("1.3");
    expect(fixed(-0.04, 1)).toBe("0.0");
    expect(fixed(Number.POSITIVE_INFINITY)).toBe("—");
  });

  it("groups a cost for reading", () => {
    expect(cost(2400)).toBe("2 400");
    expect(cost(999)).toBe("999");
    expect(cost(Number.NaN)).toBe("—");
  });

  it("reads a clock in seconds off the tick", () => {
    expect(seconds(2)).toBe("2.00s");
    expect(clock(90)).toBe("1.50s");
  });
});

describe("the axis lines", () => {
  const axes: Record<AxisName, AxisState> = idleRun().axes;

  it("reads all four axes in the order the tape names them", () => {
    const lines = axisReadouts(axes);
    expect(lines.map((l) => l.axis)).toEqual([
      "slew",
      "trolley",
      "hoist",
      "grip",
    ]);
    expect(lines[0].value.endsWith("°")).toBe(true);
    expect(lines[1].value.endsWith("u")).toBe(true);
  });

  it("shows a target only while a command is live, and marks a turning axis", () => {
    const live = {
      ...axes,
      slew: { value: 10, rate: 3, command: { target: 90 } },
    };
    const lines = axisReadouts(live);
    expect(lines[0].target).toBe("90.0°");
    expect(lines[0].moving).toBe(true);
    expect(lines[1].target).toBeNull();
    expect(lines[1].moving).toBe(false);
  });
});

describe("the tape's own words", () => {
  it("reads a command as its axis, its target, and its rate", () => {
    expect(commandText({ axis: "slew", target: 90, rate: 30 })).toBe(
      "SLEW → 90.0° @ 30.0",
    );
  });

  it("reads a step as what it does", () => {
    expect(stepText({ kind: "action", action: "attach" })).toBe("ATTACH");
    expect(stepText({ kind: "move", commands: [] })).toBe("MOVE");
    expect(
      stepText({
        kind: "move",
        commands: [{ axis: "hoist", target: 4, rate: 2 }],
      }),
    ).toBe("MOVE  HOIST → 4.0u @ 2.0");
  });

  it("counts the live step from one, and an empty tape from nothing", () => {
    expect(stepCounter(0, 0)).toBe("0 / 0");
    expect(stepCounter(0, 3)).toBe("1 / 3");
    expect(stepCounter(3, 3)).toBe("3 / 3");
  });

  it("names the watch speed", () => {
    expect(speedText(0)).toBe(`×${RUN_SPEEDS[0]}`);
    expect(speedText(9)).toBe(`×${RUN_SPEEDS[0]}`);
  });

  it("counts the open site's tape", () => {
    const s = addActionStep(openSite(titleState(), 0), "attach");
    expect(programLength(s)).toBe(1);
  });
});

describe("the glosses", () => {
  it("carries one for every start issue and every refusal", () => {
    for (const gloss of Object.values(ISSUE_GLOSS)) {
      expect(gloss.length).toBeGreaterThan(0);
    }
    for (const gloss of Object.values(REFUSAL_TEXT)) {
      expect(gloss.length).toBeGreaterThan(0);
    }
  });

  it("shows each failure as the fixed copy", () => {
    expect(failText("collapse")).toBe(FAIL_TEXT.collapse);
    expect(failText("loads-unplaced")).toBe(FAIL_TEXT["loads-unplaced"]);
  });
});

describe("the tool palette", () => {
  it("lists the six tools in binding order, marking the one selected", () => {
    const entries = toolEntries("rail");
    expect(entries.map((e) => e.tool)).toEqual([
      "strut",
      "cable",
      "rail",
      "ring",
      "counterweight",
      "delete",
    ]);
    expect(entries.map((e) => e.key)).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(entries.filter((e) => e.selected).map((e) => e.tool)).toEqual([
      "rail",
    ]);
  });
});

describe("the site list", () => {
  it("lists every site, numbered from one, with the first open", () => {
    const rows = siteRows(setScreen(titleState(), "select"));
    expect(rows).toHaveLength(SITE_COUNT);
    expect(rows.map((r) => r.name)).toEqual([...SITE_NAMES]);
    expect(rows[0].number).toBe("01");
    expect(rows[0].state).toBe("open");
    expect(rows[1].state).toBe("locked");
  });

  it("marks each state with a shape as well as a word", () => {
    let s: GantryState = setScreen(titleState(), "select");
    s = setBest(setCleared(s, 0, true), 0, { cost: 100, time: 2 });
    const rows = siteRows(s);
    expect(rows[0].state).toBe("cleared");
    expect(rows[0].mark).toBe("tick");
    expect(rows[0].best).toEqual({ cost: 100, time: 2 });
    expect(rows[1].mark).toBe("arrow");
    expect(rows[2].mark).toBe("cross");
  });

  it("highlights the row the menu is on", () => {
    const rows = siteRows(setMenuIndex(setScreen(titleState(), "select"), 0));
    expect(rows.filter((r) => r.highlighted)).toHaveLength(1);
  });
});

describe("the menus", () => {
  it("names the title's two entries and the results' three", () => {
    expect(menuEntries(titleState())).toEqual(["SITES", "HOW TO PLAY"]);
    expect(menuEntries(setScreen(titleState(), "results"))).toHaveLength(3);
    expect(menuEntries(setScreen(titleState(), "build"))).toBeNull();
  });
});

describe("how to play", () => {
  it("covers the game in headed blocks a player can read", () => {
    expect(HOW_TO.length).toBeGreaterThanOrEqual(6);
    for (const section of HOW_TO) {
      expect(section.heading).toMatch(/^[A-Z ]+$/);
      expect(section.lines.length).toBeGreaterThan(0);
    }
    const all = HOW_TO.flatMap((s) => s.lines).join(" ");
    expect(all).toContain("slew ring");
    expect(all).toContain("ATTACH");
  });
});
