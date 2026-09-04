import { beforeEach, describe, expect, it } from "vitest";

import { createDebugApi, type SpectraDebugApi } from "./debug";
import { harnessWith, stubArt, type Harness } from "./harness.test-support";

let h: Harness;
let d: SpectraDebugApi;

beforeEach(() => {
  h = harnessWith(stubArt());
  d = createDebugApi(h.state, h.clock);
  d.reset();
});

/** Every registered source's current line, joined. */
function readAll(): string {
  return [...h.diagnostics]
    .map(([name, source]) => `${name} ${String(source())}`)
    .join("\n");
}

describe("the overlay's sources", () => {
  it("registers everything the specification asks for", () => {
    const names = [...h.diagnostics.keys()];
    for (const wanted of [
      "screen",
      "stage",
      "run",
      "resonance",
      "inversion",
      "ship",
      "wave",
      "rosters",
      "simTime",
    ]) {
      expect(names).toContain(wanted);
    }
    // And a line per drone, so a formation is readable at a glance.
    expect(names.filter((name) => name.startsWith("drone "))).not.toEqual([]);
  });

  it("reports the screen, the phase and whichever hold is running", () => {
    d.setScreen("inWave");
    d.setPhase("ready");
    d.setPhaseTimer(1.3);
    expect(String(h.diagnostics.get("screen")?.())).toContain("inWave/ready");
    expect(String(h.diagnostics.get("screen")?.())).toContain("1.3");
  });

  it("reports the stage and whether it is a challenge stage", () => {
    d.setStage(4);
    expect(String(h.diagnostics.get("stage")?.())).toBe("4");
    d.setStage(6);
    expect(String(h.diagnostics.get("stage")?.())).toContain("CHALLENGE");
  });

  it("reports the score, the lives, the meter and whether it is ready", () => {
    d.setScore(1234);
    d.setLives(2);
    d.setResonance(100);
    const run = String(h.diagnostics.get("run")?.());
    expect(run).toContain("1234");
    expect(run).toContain("2");
    expect(String(h.diagnostics.get("resonance")?.())).toContain("READY");
    d.setResonance(40);
    expect(String(h.diagnostics.get("resonance")?.())).not.toContain("READY");
  });

  it("reports the inversion, both ways", () => {
    expect(String(h.diagnostics.get("inversion")?.())).toBe("off");
    d.setInversion(3.5);
    expect(String(h.diagnostics.get("inversion")?.())).toContain("3.5");
  });

  it("reports the ship's lane position, its band and its lockout", () => {
    d.setShipX(420);
    d.setShipBand("magenta");
    d.setFireLockout(0.3);
    const ship = String(h.diagnostics.get("ship")?.());
    expect(ship).toContain("420");
    expect(ship).toContain("magenta");
    expect(ship).toContain("0.3");
  });

  it("reports each drone's id, kind, bands, position, phase and state", () => {
    d.setScreen("inWave");
    const flux = d.addDrone("flux", 300, 200);
    d.setDroneBand(flux, "magenta");
    d.setDroneBandClock(flux, 1.7);
    const prism = d.addDrone("prism", 700, 260);
    d.setDroneShell(prism, false);
    const first = String(h.diagnostics.get("drone 0")?.());
    expect(first).toContain(`#${flux}`);
    expect(first).toContain("flux");
    expect(first).toContain("magenta");
    expect(first).toContain("300");
    expect(first).toContain("formation");
    expect(first).toContain("shimmer");
    const second = String(h.diagnostics.get("drone 1")?.());
    expect(second).toContain("prism");
    expect(second).toContain("core");
    // A line with no drone behind it reads as absent rather than throwing.
    expect(String(h.diagnostics.get("drone 7")?.())).toBe("-");
  });

  it("reports how many bullets are in flight and how many bursts play", () => {
    d.addPlayerBullet(300, 400, "cyan");
    d.addEnemyBullet(500, 200, "cyan");
    d.addDrone("shard", 100, 100);
    expect(String(h.diagnostics.get("rosters")?.())).toBe(
      "1 drones 2 bullets 0 bursts",
    );
  });

  it("leaves the game exactly as it is when it is read", () => {
    d.setScreen("inWave");
    d.addDrone("prism", 400, 200);
    d.addPlayerBullet(300, 400, "cyan");
    const before = JSON.stringify(d.snapshot());
    readAll();
    readAll();
    expect(JSON.stringify(d.snapshot())).toBe(before);
  });

  it("keeps every line short enough to read", () => {
    d.setScreen("inWave");
    for (let i = 0; i < 8; i += 1) d.addDrone("prism", 100 + i * 60, 200);
    for (const line of readAll().split("\n")) {
      expect(line.length).toBeLessThan(80);
    }
  });
});
