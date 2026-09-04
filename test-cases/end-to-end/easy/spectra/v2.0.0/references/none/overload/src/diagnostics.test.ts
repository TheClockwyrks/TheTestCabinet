// Spectra — the values the overlay shows, which are pure reads of the state.

import { describe, expect, it } from "vitest";
import { ROSTER_LINES, droneLine, roster } from "./diagnostics";
import { driver, poseDrone, startPosed } from "./harness.test-support";

describe("the registered sources", () => {
  it("names the screen, the run, the inversion, the ship, the drones and the field", () => {
    const driven = driver();
    expect([...driven.diagnostics.keys()]).toEqual([
      "screen",
      "run",
      "inversion",
      "ship",
      "drones",
      "field",
    ]);
  });

  it("reads the live game and changes nothing", () => {
    const driven = driver();
    startPosed(driven);
    const id = poseDrone(driven, "flux", 400, 200);
    driven.debug.setDroneCharge(id, 2);
    driven.debug.setScore(1234);
    const before = JSON.stringify(driven.debug.snapshot());
    const lines = [...driven.diagnostics.values()].map((source) =>
      String(source()),
    );
    expect(JSON.stringify(driven.debug.snapshot())).toBe(before);
    expect(lines[0]).toContain("inWave");
    expect(lines[1]).toContain("1234");
    expect(lines[2]).toBe("off");
    expect(lines[3]).toContain("cyan");
    expect(lines[4]).toContain("flux");
    expect(lines[4]).toContain("chg 2");
    expect(lines[5]).toContain("bullets 0");
  });

  it("reports a challenge stage, a ready discharge and a live inversion", () => {
    const driven = driver();
    startPosed(driven);
    driven.debug.setStage(3);
    driven.debug.setResonance(100);
    driven.debug.setInversion(2.5);
    const lines = [...driven.diagnostics.values()].map((source) =>
      String(source()),
    );
    expect(lines[0]).toContain("challenge");
    expect(lines[1]).toContain("READY");
    expect(lines[2]).toContain("active");
  });

  it("names a Prism's layer and a Flux's window", () => {
    const driven = driver();
    startPosed(driven);
    const prism = poseDrone(driven, "prism", 400, 200);
    expect(droneLine(driven.state, driven.state.drones[0]!)).toContain("shell");
    driven.debug.setDroneShell(prism, false);
    expect(droneLine(driven.state, driven.state.drones[0]!)).toContain("core");

    const flux = driver();
    startPosed(flux);
    const id = poseDrone(flux, "flux", 400, 200);
    expect(droneLine(flux.state, flux.state.drones[0]!)).toContain("hold");
    flux.debug.setDroneBandClock(id, 1.9);
    expect(droneLine(flux.state, flux.state.drones[0]!)).toContain("shimmer");
  });
});

describe("roster", () => {
  it("reads as none when it is empty, and summarizes a long one", () => {
    expect(roster([])).toBe("none");
    expect(roster(["a", "b"])).toBe("a  |  b");
    const many = Array.from({ length: ROSTER_LINES + 3 }, (_, at) =>
      String(at),
    );
    expect(roster(many)).toContain("+3 more");
  });
});
