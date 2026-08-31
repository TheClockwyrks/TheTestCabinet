import { describe, expect, it } from "vitest";
import { registerDiagnostics } from "./diagnostics";
import { createInitialState, loadBoard, type FacetState } from "./core";
import { quietRows } from "./core/fixtures";

/** Every source the game registers, in the order it registered them. */
function sources(): Map<string, (state: FacetState) => unknown> {
  const registered = new Map<string, (state: FacetState) => unknown>();
  registerDiagnostics({
    diagnostics: { register: (name, source) => registered.set(name, source) },
  });
  return registered;
}

describe("the diagnostic sources", () => {
  it("names every fact specs/instrumentation.md asks the overlay to show", () => {
    expect([...sources().keys()]).toEqual([
      "screen",
      "board",
      "score",
      "level",
      "chain",
      "last step",
      "cursor",
      "selection",
      "legal swap",
      "pointer",
    ]);
  });

  it("reads the screen and the phase together", () => {
    const state = createInitialState();
    expect(sources().get("screen")?.(state)).toBe("title / idle");
  });

  it("reports the board's dimensions, and none while none is in play", () => {
    const registered = sources();
    expect(registered.get("board")?.(createInitialState())).toBe("0x0");
    const posed = loadBoard(createInitialState(), quietRows());
    expect(registered.get("board")?.(posed)).toBe("8x8");
  });

  it("reports the level score against the level's target", () => {
    const state = { ...createInitialState(), level: 3, levelScore: 120 };
    expect(sources().get("level")?.(state)).toBe("3  120/6000");
  });

  it("reports the chain step and its multiplier", () => {
    const state = { ...createInitialState(), chainStep: 11 };
    expect(sources().get("chain")?.(state)).toBe("step 11  x8");
  });

  it("reports what the last step did", () => {
    const state = { ...createInitialState(), lastCleared: 6, lastPoints: 90 };
    expect(sources().get("last step")?.(state)).toBe("6 cells  90 pts");
  });

  it("reports the cursor, and a dash for no selection", () => {
    const registered = sources();
    const state = createInitialState();
    expect(registered.get("cursor")?.(state)).toBe("0,0");
    expect(registered.get("selection")?.(state)).toBe("-");
    expect(
      registered.get("selection")?.({
        ...state,
        selection: { col: 3, row: 5 },
      }),
    ).toBe("3,5");
  });

  it("derives whether a legal swap exists from the board as it stands", () => {
    const registered = sources();
    // The quiet board is run-free and has no legal swap on it at all.
    const posed = loadBoard(createInitialState(), quietRows());
    expect(registered.get("legal swap")?.(posed)).toBe(false);
  });

  it("reports the pointer, and marks it while it is down", () => {
    const registered = sources();
    const state = createInitialState();
    expect(registered.get("pointer")?.(state)).toBe("0, 0");
    expect(
      registered.get("pointer")?.({
        ...state,
        pointer: { x: 12.4, y: 300.6, down: true },
      }),
    ).toBe("12, 301 down");
  });

  it("changes nothing about the state it reads", () => {
    const state = loadBoard(createInitialState(), quietRows());
    const before = JSON.stringify(state);
    for (const source of sources().values()) source(state);
    expect(JSON.stringify(state)).toBe(before);
  });
});
