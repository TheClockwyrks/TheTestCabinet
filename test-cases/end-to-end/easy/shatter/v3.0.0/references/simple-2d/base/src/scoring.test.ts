// Every score figure, and the extra ship a crossing grants.

import { describe, expect, it } from "vitest";
import { EXTRA_LIFE_STEP, START_LIVES } from "./constants";
import { openingState } from "./flow";
import { addScore } from "./scoring";
import { newTickEvents, toSim } from "./sim";

describe("the score", () => {
  it("only ever rises", () => {
    const sim = toSim(openingState());
    addScore(sim, 20, newTickEvents());
    addScore(sim, 0, newTickEvents());
    addScore(sim, -100, newTickEvents());
    expect(sim.score).toBe(20);
  });

  it("grants one ship on each multiple the score crosses", () => {
    const sim = toSim(openingState());
    const events = newTickEvents();
    addScore(sim, EXTRA_LIFE_STEP - 20, events);
    expect(sim.lives).toBe(START_LIVES);
    expect(events.cues.size).toBe(0);

    addScore(sim, 100, events);
    expect(sim.lives).toBe(START_LIVES + 1);
    expect(events.cues.has("extra-life")).toBe(true);
    expect(sim.extraLifeNotice).toBeGreaterThan(0);
  });

  it("grants one ship for each multiple a single award carries it past", () => {
    const sim = toSim(openingState());
    addScore(sim, EXTRA_LIFE_STEP * 3 + 5, newTickEvents());
    expect(sim.lives).toBe(START_LIVES + 3);
  });
});
