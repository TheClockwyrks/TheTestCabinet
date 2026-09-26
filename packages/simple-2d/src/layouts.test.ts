import { describe, expect, it } from "vitest";
import { MENU_ACTIONS, TOUCH_LAYOUTS, touchLayout } from "./layouts";

describe("TOUCH_LAYOUTS", () => {
  it("holds exactly the four catalogued layouts", () => {
    expect(Object.keys(TOUCH_LAYOUTS)).toEqual([
      "dual-vertical",
      "single-vertical",
      "dpad-4",
      "dpad-4-two-buttons",
    ]);
  });

  it("gives each layout its own vocabulary followed by the menu actions", () => {
    expect(touchLayout("dual-vertical").actions).toEqual([
      "p1-up",
      "p1-down",
      "p2-up",
      "p2-down",
      ...MENU_ACTIONS,
    ]);
    expect(touchLayout("single-vertical").actions).toEqual([
      "up",
      "down",
      ...MENU_ACTIONS,
    ]);
    expect(touchLayout("dpad-4").actions).toEqual([
      "up",
      "down",
      "left",
      "right",
      ...MENU_ACTIONS,
    ]);
    expect(touchLayout("dpad-4-two-buttons").actions).toEqual([
      "up",
      "down",
      "left",
      "right",
      "a",
      "b",
      ...MENU_ACTIONS,
    ]);
  });

  it("names every layout after its key, and never repeats an action within one", () => {
    for (const [key, layout] of Object.entries(TOUCH_LAYOUTS)) {
      expect(layout.name).toBe(key);
      expect(new Set(layout.actions).size).toBe(layout.actions.length);
    }
  });

  it("carries the menu vocabulary in every layout", () => {
    for (const layout of Object.values(TOUCH_LAYOUTS)) {
      expect(layout.actions).toEqual(expect.arrayContaining([...MENU_ACTIONS]));
    }
  });

  it("is frozen, so a reader cannot rewrite what every other reader sees", () => {
    const layout = TOUCH_LAYOUTS["dpad-4"];
    expect(layout).toBeDefined();
    expect(() => layout?.actions.push("jump")).toThrow(TypeError);
    expect(() => {
      // @ts-expect-error the catalogue is readonly by type as well as at run time
      TOUCH_LAYOUTS["dpad-4"] = { name: "x", actions: [] };
    }).toThrow(TypeError);
    expect(TOUCH_LAYOUTS["dpad-4"]?.actions).toHaveLength(8);
  });
});

describe("touchLayout", () => {
  it("hands back a copy the caller may extend without touching the catalogue", () => {
    const layout = touchLayout("single-vertical");
    layout.actions.push("boost");

    expect(touchLayout("single-vertical").actions).not.toContain("boost");
    expect(TOUCH_LAYOUTS["single-vertical"]?.actions).not.toContain("boost");
  });

  it("throws on an unknown layout rather than falling back to a default", () => {
    expect(() => touchLayout("dpad-8")).toThrow(
      /Unknown touch layout "dpad-8"/,
    );
  });

  it("names every valid layout in the failure, since the cause is usually a typo", () => {
    let message = "";
    try {
      touchLayout("dual_vertical");
    } catch (error) {
      message = (error as Error).message;
    }

    for (const name of Object.keys(TOUCH_LAYOUTS)) {
      expect(message).toContain(name);
    }
  });
});
