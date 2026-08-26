import { describe, expect, it } from "vitest";
import { MENU_ACTIONS, TOUCH_LAYOUTS, touchLayout } from "./layouts";

describe("TOUCH_LAYOUTS", () => {
  it("holds exactly the four catalogued layouts", () => {
    expect(Object.keys(TOUCH_LAYOUTS)).toEqual([
      "stick-move",
      "stick-look",
      "stick-look-two-buttons",
      "wheel-pedals",
    ]);
  });

  it("gives each layout its own vocabulary followed by the menu actions", () => {
    // The docs state the `stick-move` array verbatim, so it is asserted verbatim.
    expect(touchLayout("stick-move").actions).toEqual([
      "move-forward",
      "move-back",
      "move-left",
      "move-right",
      "confirm",
      "back",
      "pause",
      "mute",
    ]);
    expect(touchLayout("stick-look").actions).toEqual([
      "move-forward",
      "move-back",
      "move-left",
      "move-right",
      "look-up",
      "look-down",
      "look-left",
      "look-right",
      ...MENU_ACTIONS,
    ]);
    expect(touchLayout("stick-look-two-buttons").actions).toEqual([
      "move-forward",
      "move-back",
      "move-left",
      "move-right",
      "look-up",
      "look-down",
      "look-left",
      "look-right",
      "a",
      "b",
      ...MENU_ACTIONS,
    ]);
    expect(touchLayout("wheel-pedals").actions).toEqual([
      "steer-left",
      "steer-right",
      "throttle",
      "brake",
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
    const layout = TOUCH_LAYOUTS["stick-move"];
    expect(layout).toBeDefined();
    expect(() => layout?.actions.push("jump")).toThrow(TypeError);
    expect(() => {
      // @ts-expect-error the catalogue is readonly by type as well as at run time
      TOUCH_LAYOUTS["stick-move"] = { name: "x", actions: [] };
    }).toThrow(TypeError);
    expect(TOUCH_LAYOUTS["stick-move"]?.actions).toHaveLength(8);
  });
});

describe("touchLayout", () => {
  it("hands back a copy the caller may extend without touching the catalogue", () => {
    const layout = touchLayout("wheel-pedals");
    layout.actions.push("horn");

    expect(touchLayout("wheel-pedals").actions).not.toContain("horn");
    expect(TOUCH_LAYOUTS["wheel-pedals"]?.actions).not.toContain("horn");
  });

  it("throws on an unknown layout rather than falling back to a default", () => {
    expect(() => touchLayout("stick-fly")).toThrow(
      /Unknown touch layout "stick-fly"/,
    );
  });

  it("names every valid layout in the failure, since the cause is usually a typo", () => {
    let message = "";
    try {
      touchLayout("stick_move");
    } catch (error) {
      message = (error as Error).message;
    }

    for (const name of Object.keys(TOUCH_LAYOUTS)) {
      expect(message).toContain(name);
    }
  });
});
