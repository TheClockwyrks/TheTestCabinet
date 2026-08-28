import { describe, expect, it } from "vitest";

import { DEN_ORDER, ROSTER_CAP } from "./constants";
import { harness } from "./harness.test-support";

describe("the diagnostic sources", () => {
  it("names every fact the specification asks the overlay to show", () => {
    const h = harness();
    expect([...h.diagnostics.keys()].slice(0, 6)).toEqual([
      "screen",
      "score",
      "light",
      "sonar",
      "plankton",
      "forager",
    ]);
    expect(h.diagnostics.size).toBe(6 + DEN_ORDER.length * ROSTER_CAP);
  });

  it("reads each source live off the running game", () => {
    const h = harness();
    const read = (name: string): string => String(h.diagnostics.get(name)?.());
    expect(read("screen")).toBe("title  depth 1");
    h.state.depth = 3;
    h.state.score = 40;
    h.state.lives = 2;
    expect(read("screen")).toBe("title  depth 3");
    expect(read("score")).toBe("40  lives 2");
  });

  it("reports both circles the brightness drives", () => {
    const h = harness();
    const light = (): string => String(h.diagnostics.get("light")?.());
    expect(light()).toBe("G 0.00  V 96  R 192");
    h.state.forager.brightness = 1;
    expect(light()).toBe("G 1.00  V 160  R 320");
  });

  it("reports each predator on a line of its own", () => {
    const h = harness();
    const line = String(h.diagnostics.get("pred 0")?.());
    expect(line).toContain("lanternjaw");
    expect(line).toContain("den");
    expect(line.length).toBeLessThan(60);
  });

  it("holds a line for a den slot the current roster does not fill", () => {
    const h = harness();
    expect(String(h.diagnostics.get("pred 5")?.())).toBe("—");
  });

  it("is a pure read that leaves the simulation as it is", () => {
    const h = harness();
    h.advance(30);
    const before = JSON.stringify({
      x: h.state.forager.x,
      t: h.state.simTime,
    });
    for (const source of h.diagnostics.values()) source();
    expect(JSON.stringify({ x: h.state.forager.x, t: h.state.simTime })).toBe(
      before,
    );
  });
});
