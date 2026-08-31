// The seeded generator: pure, replayed exactly, and held in one number.

import { describe, expect, it } from "vitest";
import { GEM_KINDS } from "../constants";
import { cursor, nextRandom } from "./rng";

describe("nextRandom", () => {
  it("is a pure function of the state it is handed", () => {
    expect(nextRandom(1)).toEqual(nextRandom(1));
    expect(nextRandom(1)).not.toEqual(nextRandom(2));
  });

  it("draws in [0, 1)", () => {
    let state = 12345;
    for (let i = 0; i < 2000; i++) {
      const [value, next] = nextRandom(state);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
      state = next;
    }
  });

  it("returns a whole-number state, so it can live in `rngState`", () => {
    let state = 7;
    for (let i = 0; i < 100; i++) {
      const [, next] = nextRandom(state);
      expect(Number.isInteger(next)).toBe(true);
      state = next;
    }
  });
});

describe("cursor", () => {
  it("replays exactly from one state", () => {
    const a = cursor(99);
    const b = cursor(99);
    const drawsA = Array.from({ length: 50 }, () => a.draw());
    const drawsB = Array.from({ length: 50 }, () => b.draw());
    expect(drawsA).toEqual(drawsB);
    expect(a.state).toBe(b.state);
  });

  it("advances exactly as folding nextRandom does", () => {
    const walked = cursor(5);
    walked.draw();
    walked.draw();
    walked.draw();
    let state = 5;
    for (let i = 0; i < 3; i++) [, state] = nextRandom(state);
    expect(walked.state).toBe(state);
  });

  it("resumes a sequence from a stored state", () => {
    const first = cursor(11);
    first.draw();
    first.draw();
    const resumed = cursor(first.state);
    const continued = cursor(11);
    continued.draw();
    continued.draw();
    expect(resumed.draw()).toBe(continued.draw());
  });

  it("draws whole numbers inside the bounds it is given", () => {
    const rng = cursor(3);
    for (let i = 0; i < 500; i++) {
      const value = rng.int(2, 5);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(2);
      expect(value).toBeLessThanOrEqual(5);
    }
  });

  it("picks every kind eventually, and only kinds", () => {
    const rng = cursor(17);
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) seen.add(rng.pick(GEM_KINDS));
    expect([...seen].sort()).toEqual([...GEM_KINDS].sort());
  });
});
