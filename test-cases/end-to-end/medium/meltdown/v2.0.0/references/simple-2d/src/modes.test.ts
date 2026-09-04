// The derived figures of specs/modes.md and the wave progression of
// specs/waves.md, both as closed forms.

import { describe, expect, it } from "vitest";
import {
  BOTTLENECK_ZONE,
  WAVE_GROWTH,
  milestoneWaves,
  waveSize,
  waveType,
} from "./constants";
import {
  buildZoneOf,
  hpScaleOf,
  insideZone,
  interestOf,
  startLivesOf,
  startMoneyOf,
  unitTypeOf,
  waveCountOf,
  waveSizeOf,
} from "./modes";

describe("the derived figures", () => {
  it("gives Containment its three difficulties and nothing else", () => {
    expect(startMoneyOf("containment", "easy")).toBe(350);
    expect(waveCountOf("containment", "easy")).toBe(15);
    expect(startMoneyOf("containment", "medium")).toBe(250);
    expect(waveCountOf("containment", "medium")).toBe(20);
    expect(startMoneyOf("containment", "hard")).toBe(200);
    expect(waveCountOf("containment", "hard")).toBe(26);
    for (const difficulty of ["easy", "medium", "hard"] as const) {
      expect(startLivesOf("containment")).toBe(20);
      expect(interestOf("containment")).toBe(true);
      expect(buildZoneOf("containment")).toBeNull();
      expect(hpScaleOf("containment", 10)).toBeCloseTo(1 + 0.62 * 9, 12);
      void difficulty;
    }
  });

  it("gives each special mode its own row", () => {
    expect(startMoneyOf("hundred", "medium")).toBe(600);
    expect(waveCountOf("hundred", "medium")).toBe(1);
    expect(interestOf("hundred")).toBe(false);
    expect(startMoneyOf("deeppockets", "medium")).toBe(10000);
    expect(interestOf("deeppockets")).toBe(false);
    expect(startMoneyOf("bottleneck", "medium")).toBe(300);
    expect(buildZoneOf("bottleneck")).toEqual(BOTTLENECK_ZONE);
    expect(startLivesOf("suddendeath")).toBe(1);
  });

  it("marks Bottleneck's zone at columns 13..36 and rows 8..27", () => {
    const zone = BOTTLENECK_ZONE;
    expect(insideZone(zone, 13, 8)).toBe(true);
    expect(insideZone(zone, 36, 27)).toBe(true);
    expect(insideZone(zone, 12, 8)).toBe(false);
    expect(insideZone(zone, 13, 28)).toBe(false);
    // Both straight vent-to-exhaust corridors cross it.
    expect(insideZone(zone, 20, 17)).toBe(true);
    expect(insideZone(zone, 25, 20)).toBe(true);
  });
});

describe("the wave progression", () => {
  it("carries the opening list through wave 8", () => {
    const opening = [
      "mote",
      "mote",
      "sprint",
      "swarm",
      "mote",
      "drift",
      "mote",
      "hulk",
    ];
    opening.forEach((type, index) => {
      expect(waveType(index + 1, 20)).toBe(type);
    });
  });

  it("cycles from wave 9, with the two milestones overriding", () => {
    expect(milestoneWaves(20)).toEqual([10, 20]);
    const expected = [
      "mote",
      "core",
      "swarm",
      "drift",
      "hulk",
      "mote",
      "sprint",
      "swarm",
      "drift",
      "hulk",
      "mote",
      "core",
    ];
    for (let wave = 9; wave <= 20; wave += 1) {
      expect(waveType(wave, 20)).toBe(expected[wave - 9]);
    }
  });

  it("puts a Core on the halfway wave at every difficulty", () => {
    expect(waveType(8, 15)).toBe("core");
    expect(waveType(15, 15)).toBe("core");
    expect(waveType(13, 26)).toBe("core");
    expect(waveType(26, 26)).toBe("core");
  });

  it("grows a wave's count and gives a milestone exactly one Core", () => {
    expect(waveSize(1, 20)).toBe(12);
    expect(waveSize(19, 20)).toBe(Math.ceil(12 * (1 + WAVE_GROWTH * 18)));
    expect(waveSize(19, 20)).toBe(60);
    expect(waveSize(10, 20)).toBe(1);
    expect(waveSize(20, 20)).toBe(1);
  });

  it("replaces the progression entirely in The Hundred", () => {
    expect(waveSizeOf("hundred", 1, 1)).toBe(100);
    expect(hpScaleOf("hundred", 1)).toBe(6);
    const cycle = ["mote", "sprint", "swarm", "drift", "hulk"];
    for (let index = 0; index < 12; index += 1) {
      expect(unitTypeOf("hundred", 1, 1, index)).toBe(cycle[index % 5]);
    }
  });

  it("fields one type per wave everywhere else", () => {
    for (let index = 0; index < 20; index += 1) {
      expect(unitTypeOf("containment", 3, 20, index)).toBe("sprint");
    }
  });
});
