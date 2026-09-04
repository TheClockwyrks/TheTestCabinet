// The values the engine's overlay shows: each a pure read of the state.

import { describe, expect, it } from "vitest";
import { registerDiagnostics } from "./diagnostics";
import { openingState } from "./flow";
import type { ShatterState } from "./game";

type Source = (state: ShatterState) => unknown;

function registered(): Map<string, Source> {
  const sources = new Map<string, Source>();
  registerDiagnostics({
    diagnostics: {
      register(name, source) {
        sources.set(name, source as Source);
      },
    },
  });
  return sources;
}

describe("the overlay's sources", () => {
  it("names the screen, the run, the ship, the field, the saucer and the clock", () => {
    expect([...registered().keys()]).toEqual([
      "screen",
      "run",
      "ship",
      "facing",
      "field",
      "saucer",
      "sim",
    ]);
  });

  it("reads the state it is handed and changes nothing", () => {
    const sources = registered();
    const state: ShatterState = {
      ...openingState(),
      score: 120,
      lives: 2,
      wave: 3,
      waveBanner: 0.5,
    };
    const before = JSON.stringify(state);

    expect(sources.get("screen")?.(state)).toBe("title");
    expect(String(sources.get("run")?.(state))).toContain("score 120");
    expect(String(sources.get("run")?.(state))).toContain("banner 0.5s");
    expect(String(sources.get("ship")?.(state))).toContain("640.0, 560.0");
    expect(String(sources.get("facing")?.(state))).toContain("-90.0 deg");
    expect(String(sources.get("field")?.(state))).toBe("0 bullets  0 rocks");
    expect(sources.get("saucer")?.(state)).toBe("none");
    expect(sources.get("sim")?.(state)).toBe("0.0s");

    expect(JSON.stringify(state)).toBe(before);
  });

  it("names the saucer when one is up", () => {
    const sources = registered();
    const state: ShatterState = {
      ...openingState(),
      saucer: {
        id: 7,
        x: 100,
        y: 200,
        vx: 140,
        vy: 0,
        mind: true,
        gun: true,
        travel: true,
        fireClock: 1,
        weaveClock: 1,
        age: 0,
      },
    };
    expect(String(sources.get("saucer")?.(state))).toContain("#7");
  });
});
