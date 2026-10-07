// The values the engine's overlay shows: each one is a pure read of the state it
// is handed, and each fits on a line.

import { describe, expect, it } from "vitest";
import { registerDiagnostics } from "./diagnostics";
import { blankState } from "./flow";
import { addFoe } from "./foes";
import { putNode } from "./field";
import { addWorm } from "./worm";
import { toSim } from "./sim";
import type { WirewormState } from "./game";
import type { DeepReadonly } from "ts-essentials";

type Source = (state: DeepReadonly<WirewormState>) => unknown;

function sources(): Map<string, Source> {
  const registered = new Map<string, Source>();
  registerDiagnostics({
    diagnostics: {
      register: (name, source) => {
        registered.set(name, source as Source);
      },
    },
  });
  return registered;
}

describe("the overlay's sources", () => {
  it("names the screen, the run, the rosters and the cursor", () => {
    const registered = sources();
    expect([...registered.keys()]).toEqual([
      "screen",
      "run",
      "nodes",
      "worms",
      "foes",
      "cursor",
      "bolts",
    ]);
  });

  it("reads the state it is handed rather than one it closed over", () => {
    const registered = sources();
    const sim = toSim(blankState());
    sim.screen = "playing";
    sim.phase = "active";
    sim.score = 120;
    sim.level = 4;
    putNode(sim, 3, 3, 2);
    addWorm(sim, 10, 5);
    addFoe(sim, "dropper", 100, 200);
    sim.bolts.push({ id: 99, x: 5, y: 5 });

    const read = (name: string): string =>
      String(registered.get(name)?.(sim as WirewormState));

    expect(read("screen")).toContain("playing");
    expect(read("run")).toContain("120");
    expect(read("run")).toContain("level 4");
    expect(read("nodes")).toBe("1");
    expect(read("worms")).toContain("10,5");
    expect(read("foes")).toContain("dropper");
    expect(read("cursor")).toContain("640.0");
    expect(read("bolts")).toBe("1");
  });

  it("says so plainly when a roster is empty", () => {
    const registered = sources();
    const sim = toSim(blankState());
    expect(registered.get("worms")?.(sim as WirewormState)).toBe("none");
    expect(registered.get("foes")?.(sim as WirewormState)).toBe("none");
  });
});
