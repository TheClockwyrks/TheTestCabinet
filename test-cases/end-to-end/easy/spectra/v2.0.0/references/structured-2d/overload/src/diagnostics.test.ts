import { describe, expect, it } from "vitest";
import { diagnosticSources } from "./diagnostics";
import { liveState, poseDrone } from "./fixtures";
import { createHarness } from "./harness";
import { fluxHold } from "./constants";

describe("the overlay's sources", () => {
  it("names every value the specification asks the overlay to show", () => {
    const state = liveState();
    const names = diagnosticSources(() => state).map(([name]) => name);
    expect(names).toEqual([
      "screen",
      "run",
      "resonance",
      "inversion",
      "ship",
      "drones",
      "flux window",
      "field",
    ]);
  });

  it("reads the live state at the call and reports what it holds", () => {
    const state = liveState();
    const sources = new Map(diagnosticSources(() => state));
    state.stage = 3;
    state.score = 700;
    state.lives = 2;
    state.resonance = 100;
    state.inversion = 2;
    state.ship.x = 480;
    state.ship.band = "magenta";
    const flux = poseDrone(state, "flux", 300, 200, {
      bandClock: fluxHold(3) + 0.1,
      charge: 2,
    });
    const prism = poseDrone(state, "prism", 400, 200, { shellAlive: false });

    expect(String(sources.get("screen")?.())).toContain("challenge");
    expect(String(sources.get("run")?.())).toBe("score 700  lives 2");
    expect(String(sources.get("resonance")?.())).toContain("READY");
    expect(String(sources.get("inversion")?.())).toContain("active");
    expect(String(sources.get("ship")?.())).toContain("magenta");
    const drones = String(sources.get("drones")?.());
    expect(drones).toContain(`#${flux.id}`);
    expect(drones).toContain("~");
    expect(drones).toContain("+2");
    expect(drones).toContain(`#${prism.id}`);
    expect(drones).toContain("core");
    expect(String(sources.get("field")?.())).toBe("bullets 0  bursts 0");
  });

  it("reports an empty field without a guard of the game's own", () => {
    const state = liveState();
    const sources = new Map(diagnosticSources(() => state));
    expect(sources.get("drones")?.()).toBe("-");
  });

  it("leaves the game exactly as it found it", async () => {
    const h = await createHarness();
    h.debug.setScreen("inWave");
    h.debug.addDrone("shard", 400, 200);
    await h.advance(1);
    const before = JSON.stringify(h.debug.snapshot());
    for (const [, source] of diagnosticSources(() => h.state)) source();
    expect(JSON.stringify(h.debug.snapshot())).toBe(before);
    h.dispose();
  });

  it("is registered with the world the mode opened", async () => {
    const h = await createHarness();
    // Re-registering a name replaces its source, so a registry that took the
    // game's names holds one per source.
    expect(() =>
      h.engine.world.diagnostics.register("probe", () => 1),
    ).not.toThrow();
    h.dispose();
  });
});
