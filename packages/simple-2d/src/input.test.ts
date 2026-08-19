import { beforeEach, describe, expect, it } from "vitest";
import type { RegisteredAction } from "./contract";
import { InputRegistry } from "./input";

/**
 * Real `KeyboardEvent`s dispatched at a real target: the registry's whole job is to
 * turn browser input into actions, so stubbing the event out would test nothing.
 */
function keyDown(target: EventTarget, code: string, repeat = false): void {
  target.dispatchEvent(new KeyboardEvent("keydown", { code, repeat, bubbles: true }));
}

function keyUp(target: EventTarget, code: string): void {
  target.dispatchEvent(new KeyboardEvent("keyup", { code, bubbles: true }));
}

describe("InputRegistry", () => {
  let target: EventTarget;
  let input: InputRegistry;

  beforeEach(() => {
    target = document.createElement("div");
    input = new InputRegistry(target);
  });

  describe("keyboard bindings", () => {
    it("holds an action while its key is down and lowers it on release", () => {
      input.register("thrust", { keys: ["ArrowUp"] });

      expect(input.value("thrust")).toBe(0);
      keyDown(target, "ArrowUp");
      expect(input.value("thrust")).toBe(1);
      keyUp(target, "ArrowUp");
      expect(input.value("thrust")).toBe(0);
    });

    it("ignores a key the action is not bound to", () => {
      input.register("thrust", { keys: ["ArrowUp"] });

      keyDown(target, "KeyZ");

      expect(input.value("thrust")).toBe(0);
      expect(input.pressed("thrust")).toBe(false);
    });

    it("stays held until the last of several bound keys is released", () => {
      input.register("up", { keys: ["ArrowUp", "KeyW"] });

      keyDown(target, "ArrowUp");
      keyDown(target, "KeyW");
      keyUp(target, "ArrowUp");
      expect(input.value("up")).toBe(1);

      keyUp(target, "KeyW");
      expect(input.value("up")).toBe(0);
    });

    it("raises every action sharing one key code", () => {
      input.register("confirm", { keys: ["Space"] });
      input.register("fire", { keys: ["Space"] });

      keyDown(target, "Space");

      expect(input.value("confirm")).toBe(1);
      expect(input.value("fire")).toBe(1);
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
      input.register("up", { keys: ["ArrowUp", "KeyW"] });

      keyDown(target, "ArrowUp");
      expect(input.pressed("up")).toBe(true);

      keyDown(target, "KeyW");
      expect(input.pressed("up")).toBe(false);
    });

    it("discards an edge nobody consumed at the end of the frame", () => {
      input.register("fire", { keys: ["Space"] });

      keyDown(target, "Space");
      input.endFrame();

      expect(input.pressed("fire")).toBe(false);
      expect(input.value("fire")).toBe(1);
    });
  });

  describe("driver-driven input", () => {
    it("sets a value with no keyboard event involved", () => {
      input.register("p1-up", { keys: ["KeyW"] });

      input.setAction("p1-up", 1);

      expect(input.value("p1-up")).toBe(1);
    });

    it("passes an analog value through and quantizes a digital one", () => {
      input.register("tilt", { keys: ["ArrowRight"], kind: "analog" });
      input.register("fire", { keys: ["Space"] });

      input.setAction("tilt", 0.25);
      input.setAction("fire", 0.25);

      expect(input.value("tilt")).toBeCloseTo(0.25, 6);
      expect(input.value("fire")).toBe(1);
    });

    it("arms the edge when a driven action leaves rest, as a keypress would", () => {
      input.register("fire", { keys: ["Space"] });

      input.setAction("fire", 1);

      expect(input.pressed("fire")).toBe(true);
      expect(input.pressed("fire")).toBe(false);
    });

    it("presses without leaving the action held, since a driver sends no release", () => {
      input.register("confirm", { keys: ["Enter"] });

      input.pressAction("confirm");

      expect(input.value("confirm")).toBe(0);
      expect(input.pressed("confirm")).toBe(true);
      expect(input.pressed("confirm")).toBe(false);
    });

    it("holds a driven value until the driver clears it, releases and all", () => {
      input.register("p1-up", { keys: ["KeyW"] });
      input.setAction("p1-up", 1);

      // A driver's hold is not undone by a key it never pressed coming up, nor by
      // the frame ending: only another `setAction` releases it.
      keyDown(target, "KeyW");
      keyUp(target, "KeyW");
      input.endFrame();
      expect(input.value("p1-up")).toBe(1);

      input.setAction("p1-up", 0);
      expect(input.value("p1-up")).toBe(0);
    });
  });

  describe("static inspection", () => {
    it("reports every action with its resolved keys, kind and layout", () => {
      input.register("tilt", { keys: ["ArrowLeft", "ArrowRight"], kind: "analog" });
      input.register("fire", { keys: ["Space"] });

      expect(input.actions()).toEqual<RegisteredAction[]>([
        { name: "tilt", keys: ["ArrowLeft", "ArrowRight"], kind: "analog", layout: null },
        { name: "fire", keys: ["Space"], kind: "digital", layout: null },
      ]);
    });

    it("keeps registration order, including across a rebind", () => {
      input.register("a", { keys: ["KeyA"] });
      input.register("b", { keys: ["KeyB"] });
      input.register("c", { keys: ["KeyC"] });
      input.register("b", { keys: ["KeyN"] });

      expect(input.actions().map((action) => action.name)).toEqual(["a", "b", "c"]);
      expect(input.actions()[1]?.keys).toEqual(["KeyN"]);
    });

    it("hands out copies, so a reader cannot rewrite the live bindings", () => {
      input.register("fire", { keys: ["Space"] });

      const reported = input.actions();
      reported[0]?.keys.push("Enter");

      expect(input.actions()[0]?.keys).toEqual(["Space"]);
    });

    it("reads an unregistered action as absent rather than throwing, so a driver may probe", () => {
      expect(input.value("nope")).toBe(0);
      expect(input.pressed("nope")).toBe(false);
      expect(() => input.setAction("nope", 1)).not.toThrow();
      expect(() => input.pressAction("nope")).not.toThrow();
      expect(input.actions()).toEqual([]);
    });
  });

  describe("layouts", () => {
    it("reports no layout until one is selected", () => {
      expect(input.layout()).toBeNull();
    });

    it("tags actions registered after the selection that are in its vocabulary", () => {
      input.register("p1-up", { keys: ["KeyW"] });
      input.useLayout("dual-vertical");
      input.register("p1-down", { keys: ["KeyS"] });
      input.register("boost", { keys: ["ShiftLeft"] });

      const byName = new Map(input.actions().map((action) => [action.name, action.layout]));
      expect(byName.get("p1-up")).toBeNull();
      expect(byName.get("p1-down")).toBe("dual-vertical");
      expect(byName.get("boost")).toBeNull();
    });

    it("reports the selected layout and its full vocabulary", () => {
      input.useLayout("single-vertical");

      expect(input.layout()).toEqual({
        name: "single-vertical",
        actions: ["up", "down", "confirm", "back", "pause", "mute"],
      });
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
  });
});
