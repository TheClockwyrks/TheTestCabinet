import { beforeEach, describe, expect, it } from "vitest";
import type { RegisteredAction } from "./input";
import type { SurfaceMetrics } from "./viewport";
import { InputRegistry } from "./input";

/**
 * This suite covers the action registry alone: registration, resolution, edges,
 * and the surface seam the key listeners attach through. The pointer half of the
 * input surface has its own suite beside `pointer.ts`, and the frame loop's
 * calls into `endFrame` belong to the engine suite; here the frame close is
 * driven by hand.
 *
 * A surface over a bare `EventTarget` is the fixture throughout. The target is
 * deliberately not a document node: the registry's whole reason for taking its
 * target from {@link SurfaceMetrics} is that an engine driven by a validator has
 * no document to listen on, so the suite runs the registry the way a validator
 * does and never falls back to one.
 */
function surfaceOver(target: EventTarget): SurfaceMetrics {
  return {
    cssWidth: () => 640,
    cssHeight: () => 360,
    dpr: () => 1,
    events: () => target,
  };
}

/**
 * Key events shaped the way the docs' own harness dispatches them: plain
 * `Event`s carrying a `code` and a `repeat`, which the listeners narrow
 * structurally. The suite runs under the node environment, where no
 * `KeyboardEvent` constructor exists — and needing none is the point, since this
 * is the same path a player's keystroke takes.
 */
function keyDown(target: EventTarget, code: string, repeat = false): void {
  target.dispatchEvent(Object.assign(new Event("keydown"), { code, repeat }));
}

function keyUp(target: EventTarget, code: string): void {
  target.dispatchEvent(Object.assign(new Event("keyup"), { code }));
}

describe("InputRegistry", () => {
  let target: EventTarget;
  let input: InputRegistry;

  beforeEach(() => {
    target = new EventTarget();
    input = new InputRegistry(surfaceOver(target));
  });

  describe("the surface seam", () => {
    it("listens on the target the surface supplies, with no document in play", () => {
      input.register("thrust", { keys: ["ArrowUp"] });

      keyDown(target, "ArrowUp");

      expect(input.value("thrust")).toBe(1);
    });

    it("is driven by a plain event carrying a code and a repeat, whatever realm it came from", () => {
      input.register("fire", { keys: ["Space"] });

      keyDown(target, "Space");
      expect(input.value("fire")).toBe(1);
      expect(input.pressed("fire")).toBe(true);

      // An OS auto-repeat arms nothing: the key never came up.
      keyDown(target, "Space", true);
      expect(input.pressed("fire")).toBe(false);

      keyUp(target, "Space");
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
        cssWidth: () => 640,
        cssHeight: () => 360,
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
      input.register("move-forward", { keys: ["ArrowUp", "KeyW"] });

      keyDown(target, "ArrowUp");
      keyDown(target, "KeyW");
      keyUp(target, "ArrowUp");
      expect(input.value("move-forward")).toBe(1);

      keyUp(target, "KeyW");
      expect(input.value("move-forward")).toBe(0);
    });

    it("stays held when the keys are released in the order they went down", () => {
      input.register("move-forward", { keys: ["ArrowUp", "KeyW"] });

      keyDown(target, "ArrowUp");
      keyDown(target, "KeyW");
      keyUp(target, "KeyW");
      expect(input.value("move-forward")).toBe(1);

      keyUp(target, "ArrowUp");
      expect(input.value("move-forward")).toBe(0);
    });

    it("tolerates a release for a key that never went down", () => {
      input.register("move-forward", { keys: ["ArrowUp"] });

      keyUp(target, "ArrowUp");
      expect(input.value("move-forward")).toBe(0);

      keyDown(target, "ArrowUp");
      expect(input.value("move-forward")).toBe(1);
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
      input.register("look-right", { keys: ["ArrowRight"], kind: "analog" });

      input.setAction("look-right", 0.25);
      expect(input.value("look-right")).toBeCloseTo(0.25, 6);

      input.setAction("look-right", -0.75);
      expect(input.value("look-right")).toBeCloseTo(-0.75, 6);
    });

    it("gives an analog action full deflection from a held key, since a key has one position", () => {
      input.register("look-right", { keys: ["ArrowRight"], kind: "analog" });

      input.setAction("look-right", 0.25);
      keyDown(target, "ArrowRight");
      expect(input.value("look-right")).toBe(1);

      // The driven magnitude is not lost, only outranked while the key is down.
      keyUp(target, "ArrowRight");
      expect(input.value("look-right")).toBeCloseTo(0.25, 6);
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
      input.register("move-forward", { keys: ["ArrowUp", "KeyW"] });

      keyDown(target, "ArrowUp");
      expect(input.pressed("move-forward")).toBe(true);

      keyDown(target, "KeyW");
      expect(input.pressed("move-forward")).toBe(false);
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
  });

  describe("driving an action programmatically", () => {
    it("sets a value with no keyboard event involved", () => {
      input.register("move-forward", { keys: ["KeyW"] });

      input.setAction("move-forward", 1);

      expect(input.value("move-forward")).toBe(1);
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
      input.register("move-forward", { keys: ["KeyW"] });
      input.setAction("move-forward", 1);

      // A hold is not undone by a key it never pressed coming up, nor by the frame
      // ending: only another `setAction` releases it.
      keyDown(target, "KeyW");
      keyUp(target, "KeyW");
      input.endFrame();
      expect(input.value("move-forward")).toBe(1);

      input.setAction("move-forward", 0);
      expect(input.value("move-forward")).toBe(0);
    });

    it("rejects a magnitude that is not finite, so no action can be poisoned", () => {
      input.register("look-right", { keys: ["ArrowRight"], kind: "analog" });
      input.setAction("look-right", 0.5);

      for (const bad of [
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
      ]) {
        expect(() => input.setAction("look-right", bad)).toThrow(/finite/);
      }

      expect(input.value("look-right")).toBeCloseTo(0.5, 6);
    });
  });

  describe("registration", () => {
    it("reports every action with its resolved keys, kind and layout", () => {
      input.register("look-right", {
        keys: ["ArrowLeft", "ArrowRight"],
        kind: "analog",
      });
      input.register("fire", { keys: ["Space"] });

      expect(input.actions()).toEqual<RegisteredAction[]>([
        {
          name: "look-right",
          keys: ["ArrowLeft", "ArrowRight"],
          kind: "analog",
          layout: null,
        },
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

      expect(input.actions().map((action) => action.name)).toEqual([
        "a",
        "b",
        "c",
      ]);
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
      expect(() =>
        input.register("wobble-the-thing", { keys: ["KeyQ"] }),
      ).not.toThrow();

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
      input.register("move-forward", { keys: ["KeyW"] });
      input.useLayout("stick-look");
      input.register("move-back", { keys: ["KeyS"] });
      input.register("boost", { keys: ["ShiftLeft"] });

      const byName = new Map(
        input.actions().map((action) => [action.name, action.layout]),
      );
      expect(byName.get("move-forward")).toBeNull();
      expect(byName.get("move-back")).toBe("stick-look");
      expect(byName.get("boost")).toBeNull();
    });

    it("tags the menu vocabulary every layout carries", () => {
      input.useLayout("wheel-pedals");
      input.register("pause", { keys: ["Escape"] });

      expect(input.actions()[0]?.layout).toBe("wheel-pedals");
    });

    it("reports the selected layout and its full vocabulary, as a copy", () => {
      input.useLayout("stick-move");

      const reported = input.layout();
      expect(reported).toEqual({
        name: "stick-move",
        actions: [
          "move-forward",
          "move-back",
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
      input.useLayout("stick-move");

      expect(() => input.useLayout("stick-fly")).toThrow(
        /Unknown touch layout/,
      );
      expect(input.layout()?.name).toBe("stick-move");
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
