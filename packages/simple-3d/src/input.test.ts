import { beforeEach, describe, expect, it } from "vitest";
import type { RegisteredAction, SurfaceMetrics } from "./contract";
import { InputRegistry, MENU_ACTIONS, TOUCH_LAYOUTS, touchLayout } from "./input";

/**
 * A surface over a bare `EventTarget`.
 *
 * The target is deliberately not a document node: the registry's whole reason for
 * taking its target from {@link SurfaceMetrics} is that an engine driven by a
 * validator has no document to listen on, so the suite runs the registry the way a
 * validator does and never falls back to one.
 */
function surfaceOver(target: EventTarget): SurfaceMetrics {
  return {
    cssWidth: () => 1280,
    cssHeight: () => 720,
    dpr: () => 1,
    events: () => target,
  };
}

/**
 * Real `KeyboardEvent`s dispatched at the surface's target: the registry's job is
 * to turn browser input into actions, so stubbing the event out would test nothing.
 */
function keyDown(target: EventTarget, code: string, repeat = false): void {
  target.dispatchEvent(new KeyboardEvent("keydown", { code, repeat, bubbles: true }));
}

function keyUp(target: EventTarget, code: string): void {
  target.dispatchEvent(new KeyboardEvent("keyup", { code, bubbles: true }));
}

describe("TOUCH_LAYOUTS", () => {
  it("holds exactly the five catalogued layouts: two pads and three sticks", () => {
    expect(Object.keys(TOUCH_LAYOUTS)).toEqual([
      "dpad-4",
      "dpad-4-two-buttons",
      "single-stick",
      "dual-stick",
      "dual-stick-two-buttons",
    ]);
  });

  it("gives each layout its own vocabulary followed by the menu actions", () => {
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
    expect(touchLayout("single-stick").actions).toEqual([
      "move-up",
      "move-down",
      "move-left",
      "move-right",
      ...MENU_ACTIONS,
    ]);
    expect(touchLayout("dual-stick").actions).toEqual([
      "move-up",
      "move-down",
      "move-left",
      "move-right",
      "look-up",
      "look-down",
      "look-left",
      "look-right",
      ...MENU_ACTIONS,
    ]);
  });

  it("builds the two-button stick entry on the dual-stick vocabulary, in order", () => {
    const dual = touchLayout("dual-stick").actions.filter(
      (action) => !MENU_ACTIONS.includes(action),
    );

    expect(touchLayout("dual-stick-two-buttons").actions).toEqual([
      ...dual,
      "a",
      "b",
      ...MENU_ACTIONS,
    ]);
  });

  it("gives every stick layout four directions per stick, and no pad any", () => {
    for (const name of ["single-stick", "dual-stick", "dual-stick-two-buttons"]) {
      const actions = TOUCH_LAYOUTS[name]?.actions ?? [];
      expect(actions).toEqual(
        expect.arrayContaining(["move-up", "move-down", "move-left", "move-right"]),
      );
    }

    for (const name of ["dpad-4", "dpad-4-two-buttons"]) {
      const actions = TOUCH_LAYOUTS[name]?.actions ?? [];
      expect(actions.filter((action) => action.startsWith("move-"))).toEqual([]);
      expect(actions.filter((action) => action.startsWith("look-"))).toEqual([]);
    }

    // Only the two-stick entries carry a look axis, which is the whole distinction
    // between them and `single-stick`.
    expect(TOUCH_LAYOUTS["single-stick"]?.actions).not.toContain("look-up");
    expect(TOUCH_LAYOUTS["dual-stick"]?.actions).toContain("look-up");
  });

  it("names every layout after its key, and never repeats an action within one", () => {
    for (const [key, layout] of Object.entries(TOUCH_LAYOUTS)) {
      expect(layout.name).toBe(key);
      expect(new Set(layout.actions).size).toBe(layout.actions.length);
    }
  });

  it("carries the menu vocabulary in every layout, in the documented order and last", () => {
    for (const layout of Object.values(TOUCH_LAYOUTS)) {
      expect(layout.actions.slice(-MENU_ACTIONS.length)).toEqual([...MENU_ACTIONS]);
    }
    expect(MENU_ACTIONS).toEqual(["confirm", "back", "pause", "mute"]);
  });

  it("is frozen, so a reader cannot rewrite what every other reader sees", () => {
    const layout = TOUCH_LAYOUTS["dual-stick"];
    expect(layout).toBeDefined();
    expect(() => layout?.actions.push("jump")).toThrow(TypeError);
    expect(() => {
      // @ts-expect-error the catalogue is readonly by type as well as at run time
      TOUCH_LAYOUTS["dual-stick"] = { name: "x", actions: [] };
    }).toThrow(TypeError);
    expect(TOUCH_LAYOUTS["dual-stick"]?.actions).toHaveLength(12);
  });
});

describe("touchLayout", () => {
  it("hands back a copy the caller may extend without touching the catalogue", () => {
    const layout = touchLayout("single-stick");
    layout.actions.push("boost");

    expect(touchLayout("single-stick").actions).not.toContain("boost");
    expect(TOUCH_LAYOUTS["single-stick"]?.actions).not.toContain("boost");
  });

  it("throws on an unknown layout rather than falling back to a default", () => {
    expect(() => touchLayout("dpad-8")).toThrow(/Unknown touch layout "dpad-8"/);
  });

  it("rejects a 2D layout name, since the catalogues are separate and closed", () => {
    // `dual-vertical` and `single-vertical` are the sibling 2D engine's entries; a
    // case that carried its layout across must fail rather than fall back.
    expect(() => touchLayout("dual-vertical")).toThrow(/Unknown touch layout/);
    expect(() => touchLayout("single-vertical")).toThrow(/Unknown touch layout/);
  });

  it("names every valid layout in the failure, since the cause is usually a typo", () => {
    let message = "";
    try {
      touchLayout("dual_stick");
    } catch (error) {
      message = (error as Error).message;
    }

    for (const name of Object.keys(TOUCH_LAYOUTS)) {
      expect(message).toContain(name);
    }
  });
});

describe("InputRegistry", () => {
  let target: EventTarget;
  let input: InputRegistry;

  beforeEach(() => {
    target = new EventTarget();
    input = new InputRegistry(surfaceOver(target));
  });

  describe("the surface seam", () => {
    it("listens on the target the surface supplies, with no document in play", () => {
      input.register("move-up", { keys: ["ArrowUp"] });

      keyDown(target, "ArrowUp");

      expect(input.value("move-up")).toBe(1);
    });

    it("is driven by a plain event carrying a code and a repeat, whatever realm it came from", () => {
      input.register("fire", { keys: ["Space"] });

      // What a validator dispatches: not a `KeyboardEvent` from this realm, but an
      // object shaped like one. The registry narrows structurally, so this is the
      // same path a player's keystroke takes.
      const down = Object.assign(new Event("keydown"), { code: "Space", repeat: false });
      target.dispatchEvent(down);

      expect(input.value("fire")).toBe(1);
      expect(input.pressed("fire")).toBe(true);

      const repeated = Object.assign(new Event("keydown"), { code: "Space", repeat: true });
      target.dispatchEvent(repeated);
      expect(input.pressed("fire")).toBe(false);

      target.dispatchEvent(Object.assign(new Event("keyup"), { code: "Space" }));
      expect(input.value("fire")).toBe(0);
    });

    it("ignores an event with no code, which is not a keyboard event at all", () => {
      input.register("fire", { keys: ["Space"] });

      target.dispatchEvent(new Event("keydown"));

      expect(input.value("fire")).toBe(0);
      expect(input.pressed("fire")).toBe(false);
    });

    it("attaches to the target it read at construction, even if the surface later moves", () => {
      const moved = new EventTarget();
      let current = target;
      const registry = new InputRegistry({
        cssWidth: () => 1280,
        cssHeight: () => 720,
        dpr: () => 1,
        events: () => current,
      });
      registry.register("fire", { keys: ["Space"] });

      current = moved;
      keyDown(moved, "Space");
      expect(registry.value("fire")).toBe(0);

      keyDown(target, "Space");
      expect(registry.value("fire")).toBe(1);

      // And detach reaches the original target rather than the one on offer now.
      registry.detach();
      keyUp(target, "Space");
      expect(registry.value("fire")).toBe(1);
    });
  });

  describe("keyboard bindings", () => {
    it("holds an action while its key is down and lowers it on release", () => {
      input.register("move-up", { keys: ["KeyW"] });

      expect(input.value("move-up")).toBe(0);
      keyDown(target, "KeyW");
      expect(input.value("move-up")).toBe(1);
      keyUp(target, "KeyW");
      expect(input.value("move-up")).toBe(0);
    });

    it("ignores a key the action is not bound to", () => {
      input.register("move-up", { keys: ["KeyW"] });

      keyDown(target, "KeyZ");

      expect(input.value("move-up")).toBe(0);
      expect(input.pressed("move-up")).toBe(false);
    });

    it("stays held until the last of several bound keys is released", () => {
      input.register("move-up", { keys: ["ArrowUp", "KeyW"] });

      keyDown(target, "ArrowUp");
      keyDown(target, "KeyW");
      keyUp(target, "ArrowUp");
      expect(input.value("move-up")).toBe(1);

      keyUp(target, "KeyW");
      expect(input.value("move-up")).toBe(0);
    });

    it("stays held when the keys are released in the order they went down", () => {
      input.register("move-up", { keys: ["ArrowUp", "KeyW"] });

      keyDown(target, "ArrowUp");
      keyDown(target, "KeyW");
      keyUp(target, "KeyW");
      expect(input.value("move-up")).toBe(1);

      keyUp(target, "ArrowUp");
      expect(input.value("move-up")).toBe(0);
    });

    it("tolerates a release for a key that never went down", () => {
      input.register("move-up", { keys: ["ArrowUp"] });

      keyUp(target, "ArrowUp");
      expect(input.value("move-up")).toBe(0);

      keyDown(target, "ArrowUp");
      expect(input.value("move-up")).toBe(1);
    });

    it("raises every action sharing one key code", () => {
      input.register("confirm", { keys: ["Space"] });
      input.register("a", { keys: ["Space"] });

      keyDown(target, "Space");

      expect(input.value("confirm")).toBe(1);
      expect(input.value("a")).toBe(1);
      expect(input.pressed("confirm")).toBe(true);
      expect(input.pressed("a")).toBe(true);
    });

    it("drops the old key when a binding is replaced, and keeps the action at rest", () => {
      input.register("fire", { keys: ["Space"] });
      keyDown(target, "Space");
      input.register("fire", { keys: ["KeyF"] });

      expect(input.value("fire")).toBe(0);
      keyDown(target, "Space");
      expect(input.value("fire")).toBe(0);

      keyDown(target, "KeyF");
      expect(input.value("fire")).toBe(1);
    });

    it("holds an action bound to no keys at rest, since nothing can raise it", () => {
      input.register("unbound", { keys: [] });

      keyDown(target, "Space");

      expect(input.value("unbound")).toBe(0);
      expect(input.actions()[0]?.keys).toEqual([]);
    });
  });

  describe("kinds", () => {
    it("defaults to digital", () => {
      input.register("fire", { keys: ["Space"] });

      expect(input.actions()[0]?.kind).toBe("digital");
    });

    it("quantizes every non-zero magnitude a digital action receives to full deflection", () => {
      input.register("fire", { keys: ["Space"] });

      for (const magnitude of [0.25, -0.5, 1e-9, 4]) {
        input.setAction("fire", magnitude);
        expect(input.value("fire")).toBe(1);
      }

      input.setAction("fire", 0);
      expect(input.value("fire")).toBe(0);
    });

    it("passes an analog magnitude through as given", () => {
      input.register("move-right", { keys: ["KeyD"], kind: "analog" });

      input.setAction("move-right", 0.25);
      expect(input.value("move-right")).toBeCloseTo(0.25, 6);

      input.setAction("move-right", 0.75);
      expect(input.value("move-right")).toBeCloseTo(0.75, 6);
    });

    it("gives an analog action full deflection from a held key, since a key has one position", () => {
      input.register("move-right", { keys: ["KeyD"], kind: "analog" });

      input.setAction("move-right", 0.25);
      keyDown(target, "KeyD");
      expect(input.value("move-right")).toBe(1);

      // The driven magnitude is not lost, only outranked while the key is down.
      keyUp(target, "KeyD");
      expect(input.value("move-right")).toBeCloseTo(0.25, 6);
    });

    it("rejects a kind outside the two, naming it, and leaves the registration alone", () => {
      input.register("fire", { keys: ["Space"], kind: "analog" });

      expect(() =>
        input.register("fire", { keys: ["KeyF"], kind: "toggle" as never }),
      ).toThrow(/toggle/);

      expect(input.actions()).toEqual<RegisteredAction[]>([
        { name: "fire", keys: ["Space"], kind: "analog", layout: null },
      ]);
    });

    it("names both valid kinds in the rejection, so the fix is in the message", () => {
      let message = "";
      try {
        input.register("throttle", { keys: ["ShiftLeft"], kind: "axis" as never });
      } catch (error) {
        message = (error as Error).message;
      }

      expect(message).toContain("throttle");
      expect(message).toContain("digital");
      expect(message).toContain("analog");
    });
  });

  describe("sticks", () => {
    /**
     * A stick reaches the game as four unipolar analog actions, so these exercise
     * the registry the way a touch stick's driver would: one `setAction` per
     * direction, each carrying that component of the deflection.
     */
    function pushStick(x: number, y: number): void {
      input.setAction("move-right", Math.max(0, x));
      input.setAction("move-left", Math.max(0, -x));
      input.setAction("move-up", Math.max(0, y));
      input.setAction("move-down", Math.max(0, -y));
    }

    beforeEach(() => {
      input.useLayout("dual-stick");
      for (const action of ["move-up", "move-down", "move-left", "move-right"]) {
        input.register(action, { keys: [], kind: "analog" });
      }
    });

    it("splits a diagonal deflection across two directions and leaves their opposites at rest", () => {
      pushStick(0.6, 0.8);

      expect(input.value("move-right")).toBeCloseTo(0.6, 6);
      expect(input.value("move-up")).toBeCloseTo(0.8, 6);
      expect(input.value("move-left")).toBe(0);
      expect(input.value("move-down")).toBe(0);
    });

    it("rebuilds the signed axis a game reads by subtracting one direction from its opposite", () => {
      pushStick(-0.5, 0);
      expect(input.value("move-right") - input.value("move-left")).toBeCloseTo(-0.5, 6);

      pushStick(0.25, 0);
      expect(input.value("move-right") - input.value("move-left")).toBeCloseTo(0.25, 6);

      pushStick(0, 0);
      expect(input.value("move-right") - input.value("move-left")).toBe(0);
    });

    it("lets a key and a stick drive one direction, the key winning with full deflection", () => {
      input.register("move-up", { keys: ["KeyW"], kind: "analog" });

      pushStick(0, 0.5);
      expect(input.value("move-up")).toBeCloseTo(0.5, 6);

      keyDown(target, "KeyW");
      expect(input.value("move-up")).toBe(1);

      keyUp(target, "KeyW");
      expect(input.value("move-up")).toBeCloseTo(0.5, 6);
    });

    it("arms a direction's press edge as the stick leaves rest, once per crossing", () => {
      pushStick(0, 0.1);
      expect(input.pressed("move-up")).toBe(true);
      expect(input.pressed("move-up")).toBe(false);

      // Pushing further is not a second press: the direction never returned to rest.
      pushStick(0, 0.9);
      expect(input.pressed("move-up")).toBe(false);

      pushStick(0, 0);
      pushStick(0, 0.4);
      expect(input.pressed("move-up")).toBe(true);
    });

    it("keeps the two sticks apart, so a look deflection leaves the move axis alone", () => {
      for (const action of ["look-up", "look-down", "look-left", "look-right"]) {
        input.register(action, { keys: [], kind: "analog" });
      }

      input.setAction("look-right", 0.7);
      pushStick(0, 0.3);

      expect(input.value("look-right")).toBeCloseTo(0.7, 6);
      expect(input.value("move-right")).toBe(0);
      expect(input.value("move-up")).toBeCloseTo(0.3, 6);
    });

    it("quantizes a deflection landing on a digital direction, which is what a pad reports", () => {
      // The same driver pushed at a pad layout's action: the kind decides, not the
      // source, so a game that registered `up` digital reads a held pad button.
      input.register("up", { keys: ["ArrowUp"] });

      input.setAction("up", 0.3);

      expect(input.value("up")).toBe(1);
    });
  });

  describe("edges", () => {
    it("reports a press exactly once, however often it is polled in one frame", () => {
      input.register("fire", { keys: ["Space"] });

      keyDown(target, "Space");

      expect(input.pressed("fire")).toBe(true);
      expect(input.pressed("fire")).toBe(false);
      expect(input.value("fire")).toBe(1);
    });

    it("does not re-arm on an OS auto-repeat of a held key", () => {
      input.register("fire", { keys: ["Space"] });

      keyDown(target, "Space");
      expect(input.pressed("fire")).toBe(true);

      for (let i = 0; i < 5; i += 1) {
        keyDown(target, "Space", true);
        input.endFrame();
      }
      keyDown(target, "Space", true);

      expect(input.pressed("fire")).toBe(false);
      expect(input.value("fire")).toBe(1);
    });

    it("arms again once the key has come up and gone down", () => {
      input.register("fire", { keys: ["Space"] });

      keyDown(target, "Space");
      expect(input.pressed("fire")).toBe(true);
      keyUp(target, "Space");
      keyDown(target, "Space");

      expect(input.pressed("fire")).toBe(true);
    });

    it("does not arm when a second bound key joins one already held", () => {
      input.register("move-up", { keys: ["ArrowUp", "KeyW"] });

      keyDown(target, "ArrowUp");
      expect(input.pressed("move-up")).toBe(true);

      keyDown(target, "KeyW");
      expect(input.pressed("move-up")).toBe(false);
    });

    it("lasts exactly one frame, and not the frame after it", () => {
      input.register("fire", { keys: ["Space"] });

      // Frame 1: the press happens and nothing polls it.
      keyDown(target, "Space");
      input.endFrame();

      // Frame 2: the edge is gone, though the key is still down.
      expect(input.pressed("fire")).toBe(false);
      expect(input.value("fire")).toBe(1);
      input.endFrame();

      expect(input.pressed("fire")).toBe(false);
    });

    it("closes the frame for every action at once", () => {
      input.register("a", { keys: ["KeyA"] });
      input.register("b", { keys: ["KeyB"] });

      keyDown(target, "KeyA");
      keyDown(target, "KeyB");
      input.endFrame();

      expect(input.pressed("a")).toBe(false);
      expect(input.pressed("b")).toBe(false);
    });

    it("tolerates closing a frame in which nothing happened", () => {
      input.register("fire", { keys: ["Space"] });

      expect(() => {
        input.endFrame();
        input.endFrame();
      }).not.toThrow();
      expect(input.pressed("fire")).toBe(false);
    });

    it("survives the tap a validator writes: press, one frame, release", () => {
      input.register("confirm", { keys: ["Enter"] });

      keyDown(target, "Enter");
      expect(input.pressed("confirm")).toBe(true);
      input.endFrame();
      keyUp(target, "Enter");

      expect(input.value("confirm")).toBe(0);
      expect(input.pressed("confirm")).toBe(false);
    });
  });

  describe("driving an action programmatically", () => {
    it("sets a value with no keyboard event involved", () => {
      input.register("move-up", { keys: ["KeyW"] });

      input.setAction("move-up", 1);

      expect(input.value("move-up")).toBe(1);
    });

    it("arms the edge when a driven action leaves rest, exactly as a key does", () => {
      input.register("byKey", { keys: ["Space"] });
      input.register("byDrive", { keys: ["Space"] });

      keyDown(target, "Space");
      input.setAction("byDrive", 1);

      expect(input.pressed("byKey")).toBe(true);
      expect(input.pressed("byDrive")).toBe(true);
      expect(input.pressed("byKey")).toBe(false);
      expect(input.pressed("byDrive")).toBe(false);
    });

    it("does not re-arm when a driven action is raised again without returning to rest", () => {
      input.register("look-right", { keys: ["ArrowRight"], kind: "analog" });

      input.setAction("look-right", 0.2);
      expect(input.pressed("look-right")).toBe(true);

      input.setAction("look-right", 0.9);
      expect(input.pressed("look-right")).toBe(false);
    });

    it("presses without leaving the action held, since a caller sends no release", () => {
      input.register("confirm", { keys: ["Enter"] });

      input.pressAction("confirm");

      expect(input.value("confirm")).toBe(0);
      expect(input.pressed("confirm")).toBe(true);
      expect(input.pressed("confirm")).toBe(false);
    });

    it("holds a driven value until the caller clears it, releases and all", () => {
      input.register("move-up", { keys: ["KeyW"] });
      input.setAction("move-up", 1);

      // A hold is not undone by a key it never pressed coming up, nor by the frame
      // ending: only another `setAction` releases it.
      keyDown(target, "KeyW");
      keyUp(target, "KeyW");
      input.endFrame();
      expect(input.value("move-up")).toBe(1);

      input.setAction("move-up", 0);
      expect(input.value("move-up")).toBe(0);
    });

    it("rejects a magnitude that is not finite, so no action can be poisoned", () => {
      input.register("look-right", { keys: ["ArrowRight"], kind: "analog" });
      input.setAction("look-right", 0.5);

      for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        expect(() => input.setAction("look-right", bad)).toThrow(/finite/);
      }

      expect(input.value("look-right")).toBeCloseTo(0.5, 6);
    });
  });

  describe("registration", () => {
    it("reports every action with its resolved keys, kind and layout", () => {
      input.register("move-up", { keys: ["KeyW", "ArrowUp"], kind: "analog" });
      input.register("fire", { keys: ["Space"] });

      expect(input.actions()).toEqual<RegisteredAction[]>([
        { name: "move-up", keys: ["KeyW", "ArrowUp"], kind: "analog", layout: null },
        { name: "fire", keys: ["Space"], kind: "digital", layout: null },
      ]);
    });

    it("returns a re-registered action to rest, held key, driven value, edge and all", () => {
      input.register("fire", { keys: ["Space"], kind: "analog" });
      keyDown(target, "Space");
      input.setAction("fire", 0.5);

      input.register("fire", { keys: ["KeyF"] });

      expect(input.value("fire")).toBe(0);
      expect(input.pressed("fire")).toBe(false);
      // The key that was down is no longer one of its keys, so its release must not
      // reach the action either way.
      keyUp(target, "Space");
      expect(input.value("fire")).toBe(0);
    });

    it("keeps registration order, including across a rebind", () => {
      input.register("a", { keys: ["KeyA"] });
      input.register("b", { keys: ["KeyB"] });
      input.register("c", { keys: ["KeyC"] });
      input.register("b", { keys: ["KeyN"] });

      expect(input.actions().map((action) => action.name)).toEqual(["a", "b", "c"]);
      expect(input.actions()[1]?.keys).toEqual(["KeyN"]);
    });

    it("copies the keys it is handed, so a later edit of the caller's array is not a rebind", () => {
      const keys = ["Space"];
      input.register("fire", { keys });

      keys.push("Enter");

      expect(input.actions()[0]?.keys).toEqual(["Space"]);
      keyDown(target, "Enter");
      expect(input.value("fire")).toBe(0);
    });

    it("hands out copies, so a reader cannot rewrite the live bindings", () => {
      input.register("fire", { keys: ["Space"] });

      const reported = input.actions();
      reported[0]?.keys.push("Enter");

      expect(input.actions()[0]?.keys).toEqual(["Space"]);
    });

    it("accepts any name, including one no layout has ever heard of", () => {
      expect(() => input.register("wobble-the-thing", { keys: ["KeyQ"] })).not.toThrow();

      keyDown(target, "KeyQ");
      expect(input.value("wobble-the-thing")).toBe(1);
    });

    it("reads an unregistered action as absent rather than throwing, so a check may probe", () => {
      expect(input.value("nope")).toBe(0);
      expect(input.pressed("nope")).toBe(false);
      expect(() => input.setAction("nope", 1)).not.toThrow();
      expect(() => input.pressAction("nope")).not.toThrow();
      expect(input.actions()).toEqual([]);
    });
  });

  describe("boundedness", () => {
    it("retains nothing for the keys a run presses", () => {
      input.register("fire", { keys: ["Space"] });

      for (let i = 0; i < 2000; i += 1) {
        keyDown(target, `Key${i}`);
        keyUp(target, `Key${i}`);
        input.endFrame();
      }

      // The registry is exactly as large as the registrations, and still working.
      expect(input.actions()).toHaveLength(1);
      keyDown(target, "Space");
      expect(input.pressed("fire")).toBe(true);
    });

    it("does not grow when the same action is registered over and over", () => {
      for (let i = 0; i < 500; i += 1) {
        input.register("fire", { keys: [`Key${i}`] });
      }

      expect(input.actions()).toHaveLength(1);
      // Only the last binding is live: the reverse index was rebuilt, not extended.
      keyDown(target, "Key0");
      expect(input.value("fire")).toBe(0);
      keyDown(target, "Key499");
      expect(input.value("fire")).toBe(1);
    });
  });

  describe("layouts", () => {
    it("reports no layout until one is selected", () => {
      expect(input.layout()).toBeNull();
    });

    it("tags actions registered after the selection that are in its vocabulary", () => {
      input.register("move-up", { keys: ["KeyW"] });
      input.useLayout("dual-stick");
      input.register("move-down", { keys: ["KeyS"] });
      input.register("boost", { keys: ["ShiftLeft"] });

      const byName = new Map(input.actions().map((action) => [action.name, action.layout]));
      expect(byName.get("move-up")).toBeNull();
      expect(byName.get("move-down")).toBe("dual-stick");
      expect(byName.get("boost")).toBeNull();
    });

    it("leaves a name outside the selected layout's vocabulary untagged", () => {
      input.useLayout("single-stick");
      input.register("look-up", { keys: ["ArrowUp"], kind: "analog" });

      // `look-up` belongs to the two-stick entries, not to `single-stick`.
      expect(input.actions()[0]?.layout).toBeNull();
    });

    it("tags the menu vocabulary every layout carries", () => {
      input.useLayout("dpad-4");
      input.register("pause", { keys: ["Escape"] });

      expect(input.actions()[0]?.layout).toBe("dpad-4");
    });

    it("attributes a whole registered vocabulary against the layout in one pass", () => {
      input.useLayout("dual-stick-two-buttons");
      for (const action of touchLayout("dual-stick-two-buttons").actions) {
        input.register(action, { keys: [], kind: action.startsWith("look-") ? "analog" : "digital" });
      }

      const registered = input.actions();
      expect(registered).toHaveLength(14);
      expect(registered.every((action) => action.layout === "dual-stick-two-buttons")).toBe(true);
    });

    it("reports the selected layout and its full vocabulary, as a copy", () => {
      input.useLayout("single-stick");

      const reported = input.layout();
      expect(reported).toEqual({
        name: "single-stick",
        actions: [
          "move-up",
          "move-down",
          "move-left",
          "move-right",
          "confirm",
          "back",
          "pause",
          "mute",
        ],
      });

      reported?.actions.push("intruder");
      expect(input.layout()?.actions).toHaveLength(8);
    });

    it("throws on an unknown layout and keeps the previous selection", () => {
      input.useLayout("dpad-4");

      expect(() => input.useLayout("dpad-6")).toThrow(/Unknown touch layout/);
      expect(input.layout()?.name).toBe("dpad-4");
    });
  });

  describe("detach", () => {
    it("stops listening, and tolerates being called twice", () => {
      input.register("fire", { keys: ["Space"] });

      input.detach();
      keyDown(target, "Space");

      expect(input.value("fire")).toBe(0);
      expect(input.pressed("fire")).toBe(false);
      expect(() => input.detach()).not.toThrow();
    });

    it("stays detached after a second call, which must not re-attach anything", () => {
      input.register("fire", { keys: ["Space"] });

      input.detach();
      input.detach();
      keyDown(target, "Space");

      expect(input.value("fire")).toBe(0);
    });

    it("leaves the registry readable, so a teardown race cannot throw", () => {
      input.register("fire", { keys: ["Space"] });
      keyDown(target, "Space");
      input.detach();

      // The action keeps the state it had; only new events stop arriving.
      expect(input.value("fire")).toBe(1);
      expect(input.pressed("fire")).toBe(true);
      expect(input.actions()).toHaveLength(1);
    });
  });
});
