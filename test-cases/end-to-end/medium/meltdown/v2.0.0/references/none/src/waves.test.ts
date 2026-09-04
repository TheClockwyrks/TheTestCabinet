import { describe, expect, it } from "vitest";
import { HUNDRED_UNITS, hpScale } from "./constants";
import {
  hundredTypeAt,
  isMilestone,
  milestoneWaves,
  releaseCount,
  releaseHpScale,
  releaseTypeAt,
  wavePreview,
  waveSize,
  waveType,
} from "./waves";

describe("the wave progression", () => {
  it("puts the Core on the midpoint and the finale", () => {
    expect(milestoneWaves(20)).toEqual([10, 20]);
    expect(milestoneWaves(15)).toEqual([8, 15]);
    expect(milestoneWaves(26)).toEqual([13, 26]);
    expect(isMilestone(10, 20)).toBe(true);
    expect(isMilestone(9, 20)).toBe(false);
  });

  it("introduces the roster over the opening eight waves", () => {
    const opening = [1, 2, 3, 4, 5, 6, 7, 8].map((w) => waveType(w, 20));
    expect(opening).toEqual([
      "mote",
      "mote",
      "sprint",
      "swarm",
      "mote",
      "drift",
      "mote",
      "hulk",
    ]);
  });

  it("cycles five types from wave nine on, with the milestones overriding", () => {
    const rest = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20].map((w) =>
      waveType(w, 20),
    );
    expect(rest).toEqual([
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
    ]);
  });

  it("sizes a wave from its type's base count and the wave number", () => {
    expect(waveSize(1, 20)).toBe(12);
    expect(waveSize(19, 20)).toBe(60);
    expect(waveSize(10, 20)).toBe(1);
    expect(waveSize(4, 20)).toBe(Math.ceil(24 * (1 + 0.22 * 3)));
  });

  it("scales hp with the wave and nothing else", () => {
    expect(hpScale(1)).toBe(1);
    expect(hpScale(20)).toBeCloseTo(1 + 0.62 * 19, 10);
  });
});

describe("The Hundred's override", () => {
  it("releases exactly a hundred units", () => {
    expect(releaseCount("hundred", 1, 1)).toBe(HUNDRED_UNITS);
  });

  it("cycles the five types one unit at a time", () => {
    const first = [0, 1, 2, 3, 4, 5].map(hundredTypeAt);
    expect(first).toEqual(["mote", "sprint", "swarm", "drift", "hulk", "mote"]);
    expect(releaseTypeAt("hundred", 1, 1, 99)).toBe(hundredTypeAt(99));
  });

  it("carries one flat hp factor rather than the per-wave scaling", () => {
    expect(releaseHpScale("hundred", 1)).toBe(6);
    expect(releaseHpScale("hundred", 14)).toBe(6);
    expect(releaseHpScale("containment", 3)).toBeCloseTo(hpScale(3), 10);
  });

  it("previews the onslaught as a hundred units opening on a Mote", () => {
    expect(wavePreview("hundred", 1, 1)).toEqual({ type: "mote", count: 100 });
  });
});

describe("the next-wave preview", () => {
  it("reports the type and count of a wave in the run", () => {
    expect(wavePreview("containment", 3, 20)).toEqual({
      type: "sprint",
      count: waveSize(3, 20),
    });
  });

  it("reports nothing past the last wave", () => {
    expect(wavePreview("containment", 21, 20)).toBeNull();
    expect(wavePreview("containment", 0, 20)).toBeNull();
  });
});
