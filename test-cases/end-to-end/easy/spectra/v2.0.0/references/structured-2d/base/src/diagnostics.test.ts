// The values Spectra registers with the engine's overlay.

import { describe, expect, it } from "vitest";
import { diagnosticSources } from "./diagnostics";
import { liveWave, poseDrone } from "./fixtures";

describe("the overlay's sources", () => {
  it("names the screen, the run, the inversion, the ship and the field", () => {
    const state = liveWave();
    const names = diagnosticSources(() => state).map(([name]) => name);
    expect(names).toEqual([
      "screen",
      "run",
      "inversion",
      "ship",
      "field",
      "drones",
    ]);
  });

  it("reads the state at the call rather than at registration", () => {
    const state = liveWave();
    const sources = new Map(diagnosticSources(() => state));
    expect(String(sources.get("run")?.())).toContain("score 0");
    state.score = 4200;
    expect(String(sources.get("run")?.())).toContain("score 4200");
  });

  it("keeps every source a pure read", () => {
    const state = liveWave();
    poseDrone(state, "prism", 400, 200);
    const before = JSON.stringify(state);
    for (const [, source] of diagnosticSources(() => state)) source();
    expect(JSON.stringify(state)).toBe(before);
  });

  it("reports a drone's id, kind, bands, place, phase and layer", () => {
    const state = liveWave();
    const prism = poseDrone(state, "prism", 400, 200, "cyan");
    prism.shellAlive = false;
    const sources = new Map(diagnosticSources(() => state));
    const line = String(sources.get("drones")?.());
    expect(line).toContain(`#${prism.id}`);
    expect(line).toContain("P");
    expect(line).toContain("cyan>magenta");
    expect(line).toContain("formation");
    expect(line).toContain("400");
    expect(line).toContain("core");
  });

  it("reports a Flux's shimmer", () => {
    const state = liveWave();
    const flux = poseDrone(state, "flux", 400, 200, "cyan");
    flux.bandClock = 1.6;
    const sources = new Map(diagnosticSources(() => state));
    expect(String(sources.get("drones")?.())).toContain("shimmer");
  });

  it("reports an empty field rather than an empty line", () => {
    const state = liveWave();
    const sources = new Map(diagnosticSources(() => state));
    expect(sources.get("drones")?.()).toBe("none");
    expect(String(sources.get("field")?.())).toContain("drones 0");
  });

  it("reports whether a discharge is ready and whether the bands are swapped", () => {
    const state = liveWave();
    state.resonance = 100;
    state.inversion = 2;
    const sources = new Map(diagnosticSources(() => state));
    expect(String(sources.get("run")?.())).toContain("READY");
    expect(String(sources.get("inversion")?.())).toContain("active");

    state.inversion = 0;
    expect(sources.get("inversion")?.()).toBe("off");
  });

  it("names a challenge stage on the screen's own line", () => {
    const state = liveWave();
    state.stage = 3;
    const sources = new Map(diagnosticSources(() => state));
    expect(String(sources.get("screen")?.())).toContain("challenge");
  });
});
