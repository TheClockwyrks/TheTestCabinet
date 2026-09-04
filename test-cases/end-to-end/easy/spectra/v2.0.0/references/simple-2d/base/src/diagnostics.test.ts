// The overlay's sources: registered once, pure reads, one short line each.

import { describe, expect, it } from "vitest";
import { registerDiagnostics } from "./diagnostics";
import { bareOpeningState } from "./flow";
import { INVERSION_TIME, RESONANCE_MAX } from "./constants";
import type { SpectraState } from "./game";
import type { DeepReadonly } from "ts-essentials";

type Source = (state: DeepReadonly<SpectraState>) => unknown;

/** Register the sources into a plain map, as the engine's overlay would. */
function sources(): Map<string, Source> {
  const registered = new Map<string, Source>();
  registerDiagnostics({
    diagnostics: {
      register: (name: string, source: Source) => registered.set(name, source),
    },
  });
  return registered;
}

describe("the diagnostics", () => {
  it("registers the values the specification lists", () => {
    expect([...sources().keys()]).toEqual([
      "screen",
      "run",
      "inversion",
      "ship",
      "field",
      "drones",
    ]);
  });

  it("reads the state it is handed, and changes nothing", () => {
    const opening = bareOpeningState();
    const state: SpectraState = {
      ...opening,
      screen: "inWave",
      stage: 3,
      score: 1200,
      resonance: RESONANCE_MAX,
      inversion: INVERSION_TIME,
      drones: [
        {
          id: 7,
          kind: "prism",
          x: 100.4,
          y: 200.6,
          band: "cyan",
          phase: "diving",
          phaseClock: 0.5,
          slotX: 100,
          slotY: 140,
          entryGroup: 0,
          bandClock: 0,
          shellAlive: false,
          shotsFired: 0,
          travel: true,
          oscillation: true,
          fire: true,
        },
      ],
    };
    const before = JSON.stringify({ ...state, art: null });
    const read = new Map<string, unknown>();
    for (const [name, source] of sources()) read.set(name, source(state));

    expect(String(read.get("screen"))).toContain("inWave");
    expect(String(read.get("screen"))).toContain("challenge");
    expect(String(read.get("run"))).toContain("1200");
    expect(String(read.get("run"))).toContain("READY");
    expect(String(read.get("inversion"))).toContain("active");
    expect(String(read.get("ship"))).toContain("cyan");
    expect(String(read.get("field"))).toContain("drones 1");
    const drones = String(read.get("drones"));
    expect(drones).toContain("#7");
    expect(drones).toContain("P");
    expect(drones).toContain("core");
    expect(drones).toContain("diving");
    // Nothing on one line is longer than a line.
    for (const value of read.values())
      expect(String(value).length).toBeLessThan(200);
    expect(JSON.stringify({ ...state, art: null })).toBe(before);
  });

  it("reports the quiet state plainly", () => {
    const read = new Map<string, unknown>();
    for (const [name, source] of sources())
      read.set(name, source(bareOpeningState()));
    expect(read.get("inversion")).toBe("off");
    expect(read.get("drones")).toBe("none");
    expect(String(read.get("run"))).not.toContain("READY");
  });
});
