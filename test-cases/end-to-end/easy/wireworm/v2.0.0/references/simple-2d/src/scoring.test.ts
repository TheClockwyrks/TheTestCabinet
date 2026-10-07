// Scoring, and the bonus life the score earns as it climbs.

import { describe, expect, it } from "vitest";
import { BONUS_LIFE_EVERY } from "./constants";
import { blankState } from "./flow";
import { addScore } from "./scoring";
import { toSim, type Sim } from "./sim";

function sim(): Sim {
  return toSim(blankState());
}

describe("the score", () => {
  it("pays a figure and grants nothing below the boundary", () => {
    const s = sim();
    s.lives = 3;
    addScore(s, 500);
    expect(s.score).toBe(500);
    expect(s.lives).toBe(3);
  });

  it("grants one life for each multiple a single award crosses", () => {
    const s = sim();
    s.lives = 3;
    s.score = BONUS_LIFE_EVERY - 1;
    addScore(s, 1);
    expect(s.lives).toBe(4);

    addScore(s, BONUS_LIFE_EVERY * 2);
    expect(s.lives).toBe(6);
  });

  it("grants nothing for a payment of nothing", () => {
    const s = sim();
    s.lives = 3;
    s.score = BONUS_LIFE_EVERY;
    addScore(s, 0);
    expect(s.lives).toBe(3);
  });
});
