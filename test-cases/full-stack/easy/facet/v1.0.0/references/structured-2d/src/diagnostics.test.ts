// The values the engine's debug overlay shows.

import { describe, expect, it } from "vitest";
import { diagnosticSources } from "./diagnostics";
import { boardFromCore } from "./bridge";
import { LEVEL_TARGET_STEP } from "./constants";
import { parseBoard } from "./core";
import { quietRows, quietRowsWith } from "./core/fixtures";
import { FacetState } from "./game";
import { createHarness } from "./harness";

function read(state: FacetState): Map<string, unknown> {
  const values = new Map<string, unknown>();
  for (const [name, source] of diagnosticSources(() => state)) {
    values.set(name, source());
  }
  return values;
}

describe("the sources", () => {
  it("names every value specs/instrumentation.md asks the overlay to show", () => {
    const names = diagnosticSources(() => new FacetState()).map(
      ([name]) => name,
    );
    expect(names).toEqual([
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

  it("reports the resting values off the title screen", () => {
    const values = read(new FacetState());
    expect(values.get("screen")).toBe("title / idle");
    expect(values.get("board")).toBe("0x0");
    expect(values.get("score")).toBe(0);
    expect(values.get("level")).toBe(`1  0/${LEVEL_TARGET_STEP}`);
    expect(values.get("chain")).toBe("step 0  x0");
    expect(values.get("last step")).toBe("0 cells  0 pts");
    expect(values.get("cursor")).toBe("0,0");
    expect(values.get("selection")).toBe("-");
    expect(values.get("legal swap")).toBe(false);
    expect(values.get("pointer")).toBe("0, 0");
  });

  it("reports the live board, the chain, and the pointer", () => {
    const state = new FacetState();
    state.screen = "playing";
    state.phase = "resolving";
    state.chainStep = 11;
    state.board = boardFromCore(
      parseBoard(quietRowsWith({ "2,0": "R0", "1,0": "R0" })),
    );
    state.score = 4200;
    state.level = 3;
    state.levelScore = 900;
    state.lastCleared = 5;
    state.lastPoints = 120;
    state.cursor = { col: 4, row: 6 };
    state.selection = { col: 1, row: 2 };
    state.pointer = { x: 123.4, y: 55.6, down: true };

    const values = read(state);
    expect(values.get("screen")).toBe("playing / resolving");
    expect(values.get("board")).toBe("8x8");
    expect(values.get("level")).toBe(`3  900/${3 * LEVEL_TARGET_STEP}`);
    // The multiplier caps at MAX_MULTIPLIER while the step keeps counting.
    expect(values.get("chain")).toBe("step 11  x8");
    expect(values.get("last step")).toBe("5 cells  120 pts");
    expect(values.get("cursor")).toBe("4,6");
    expect(values.get("selection")).toBe("1,2");
    expect(values.get("legal swap")).toBe(true);
    expect(values.get("pointer")).toBe("123, 56 down");
  });

  it("reads the state at the call rather than one captured at registration", () => {
    const state = new FacetState();
    const [, screen] = diagnosticSources(() => state)[0];
    expect(screen()).toBe("title / idle");
    state.screen = "playing";
    expect(screen()).toBe("playing / idle");
  });

  it("leaves the state exactly as it found it", () => {
    const state = new FacetState();
    state.board = boardFromCore(parseBoard(quietRows()));
    const before = JSON.stringify(state);
    read(state);
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe("registration", () => {
  it("registers them all with the open world", async () => {
    const harness = await createHarness();
    try {
      const seen: string[] = [];
      harness.engine.world.diagnostics.register = (name) => seen.push(name);
      // Re-registering over the same world is what the mode's beginPlay does.
      const { registerDiagnostics } = await import("./diagnostics");
      registerDiagnostics(harness.engine.world);
      expect(seen).toHaveLength(10);
      expect(seen).toContain("legal swap");
    } finally {
      harness.dispose();
    }
  });
});
