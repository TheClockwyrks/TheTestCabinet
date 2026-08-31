import { describe, expect, it } from "vitest";
import { ACTIONS, BINDINGS, LAYOUT } from "./constants";
import { pressed, registerActions } from "./input";
import type { FacetState } from "./game";
import { TOUCH_LAYOUTS } from "@test-cabinet/simple-2d";
import type {
  ActionBinding,
  InitApi,
  UpdateApi,
} from "@test-cabinet/simple-2d";

describe("registerActions", () => {
  it("registers every action against the keys BINDINGS names", () => {
    const registered = new Map<string, ActionBinding>();
    registerActions({
      input: {
        register: (name: string, binding: ActionBinding) =>
          registered.set(name, binding),
        layout: () => null,
      },
    } as unknown as Pick<InitApi<FacetState>, "input">);

    expect([...registered.keys()]).toEqual([...ACTIONS]);
    for (const action of ACTIONS) {
      expect(registered.get(action)?.keys).toEqual([...BINDINGS[action]]);
    }
  });

  it("registers exactly the vocabulary the selected layout brings", () => {
    expect([...ACTIONS].sort()).toEqual(
      [...TOUCH_LAYOUTS[LAYOUT].actions].sort(),
    );
  });

  it("binds the three keys specs/controls.md fixes", () => {
    expect(BINDINGS.pause).toEqual(["KeyP"]);
    expect(BINDINGS.mute).toEqual(["KeyM"]);
    expect(BINDINGS.back).toEqual(["Escape"]);
  });

  it("hands the engine a fresh array, so a binding cannot be edited in place", () => {
    const registered: ActionBinding[] = [];
    registerActions({
      input: {
        register: (_name: string, binding: ActionBinding) =>
          registered.push(binding),
        layout: () => null,
      },
    } as unknown as Pick<InitApi<FacetState>, "input">);
    registered[0].keys.push("KeyZ");
    expect(BINDINGS.up).toEqual(["ArrowUp", "KeyW"]);
  });
});

describe("pressed", () => {
  it("reads the action's edge off the engine, consuming it", () => {
    const asked: string[] = [];
    const api = {
      input: {
        pressed: (name: string) => {
          asked.push(name);
          return name === "confirm";
        },
      },
    } as unknown as Pick<UpdateApi, "input">;

    expect(pressed(api, "confirm")).toBe(true);
    expect(pressed(api, "back")).toBe(false);
    expect(asked).toEqual(["confirm", "back"]);
  });
});
