// The values Shatter names for the runtime's overlay.
//
// `specs/instrumentation.md` lists what the overlay must report, and every source
// must be a PURE READ: watching the panel leaves the game exactly as it is. Both
// are checked here — every listed fact appears on a line, and reading every line
// twice changes nothing about the state behind them.

import { describe, expect, it } from "vitest";

import { registerDiagnostics } from "./diagnostics";
import { posed } from "./harness.test-support";
import { Diagnostics } from "./overlay";
import type { InitApi } from "./runtime";

/** A panel with Shatter's own sources registered over `state`. */
function panelOver(
  state: Parameters<typeof registerDiagnostics>[1],
): Diagnostics {
  const panel = new Diagnostics();
  const api: InitApi = {
    input: { register: () => undefined },
    audio: { define: () => undefined },
    diagnostics: { register: (name, source) => panel.register(name, source) },
  };
  registerDiagnostics(api, state);
  return panel;
}

describe("the overlay's sources", () => {
  it("reports every fact the specification lists", () => {
    const { state, advance } = posed();
    advance(1);
    // Posed after the tick, so what the panel reports is what the state holds
    // rather than what a tick of drag left of it.
    state.score = 320;
    state.lives = 2;
    state.wave = 4;
    state.ship.x = 400;
    state.ship.y = 300;
    state.ship.vx = 60;
    state.ship.vy = -80;
    state.ship.invuln = 1.25; // one place, so the panel line reads 1.3

    const lines = panelOver(state).lines({ count: 1, dt: 1 / 60 });
    const named = (name: string): string =>
      lines.find((line) => line.startsWith(`${name} `)) ?? "";

    expect(named("screen")).toBe("screen playing");
    expect(named("run")).toContain("score 320");
    expect(named("run")).toContain("lives 2");
    expect(named("run")).toContain("wave 4");
    expect(named("ship pos")).toBe("ship pos 400.0, 300.0");
    // The velocity line carries the speed beside the two components.
    expect(named("ship vel")).toContain("(100.0)");
    expect(named("ship facing")).toBe("ship facing -90.0");
    expect(named("invuln")).toBe("invuln 1.3");
    expect(named("field")).toBe("field bullets 0  rocks 0");
    expect(named("saucer")).toBe("saucer none");
    expect(named("sim time")).toBe(`sim time ${state.simTime.toFixed(1)}`);
  });

  it("reports the saucer's position while one is up", () => {
    const { state } = posed();
    state.saucer = {
      id: 9,
      x: 200,
      y: 120,
      vx: 140,
      vy: 0,
      mind: true,
      gun: true,
      travel: true,
      weave: 1,
      fireTimer: 1.6,
      weaveTimer: 1,
      age: 0,
    };
    const lines = panelOver(state).lines({ count: 0, dt: 0 });
    expect(lines).toContain("saucer 200.0, 120.0");
  });

  it("leaves the game exactly as it stands, however often it is read", () => {
    const { state, advance } = posed();
    advance(30);
    const panel = panelOver(state);
    const before = JSON.stringify(state);
    panel.lines({ count: 0, dt: 0 });
    panel.lines({ count: 0, dt: 0 });
    expect(JSON.stringify(state)).toBe(before);
  });
});
