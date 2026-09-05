// One frame of simulation, and what it does when the world is not a whole one.

import { describe, expect, it, vi } from "vitest";
import type { World } from "@clockwyrks/structured-2d";
import { advanceFrame } from "./frame";
import { applyCore } from "./bridge";
import { FacetState } from "./game";
import { createInitialState, loadBoard, requestSwap } from "./core";
import { quietRowsWith } from "./core/fixtures";
import { CUES } from "./constants";

/** A board whose first step drops jades into a second run in row 7. */
const CASCADE = quietRowsWith({
  "3,4": "J0",
  "3,5": "R0",
  "3,6": "C0",
  "3,7": "R0",
  "4,6": "R0",
  "2,7": "J0",
  "4,7": "J0",
});

/**
 * A world with no player controller and no bench: the two things `advanceFrame`
 * reaches for beside the state. Neither is required for the simulation to run,
 * and a frame that found neither must still carry the game forward.
 */
function bareWorld(): { world: World; played: string[]; looped: string[] } {
  const played: string[] = [];
  const looped: string[] = [];
  const world = {
    players: () => [],
    find: () => null,
    audio: {
      play: (cue: string) => played.push(cue),
      loop: (cue: string) => looped.push(cue),
      stop: () => {},
      looping: () => false,
      setMuted: () => {},
      muted: () => false,
    },
  } as unknown as World;
  return { world, played, looped };
}

describe("advanceFrame", () => {
  it("carries the chain forward with no controller and no bench", () => {
    const { world, played, looped } = bareWorld();
    const state = new FacetState();
    applyCore(
      state,
      requestSwap(loadBoard(createInitialState(), CASCADE), {
        a: { col: 3, row: 6 },
        b: { col: 4, row: 6 },
      }).state,
    );

    advanceFrame(world, state, 1);
    expect(state.phase).toBe("idle");
    expect(state.simTime).toBe(1);
    expect(state.score).toBeGreaterThanOrEqual(90);
    // The chain's own second step still sounds, and the play bed is still
    // asked for, with no controller and no bench in the world.
    expect(played).toContain(CUES.clear);
    expect(looped).toEqual(["music-play"]);
  });

  it("accumulates simTime on a screen where nothing else advances", () => {
    const { world } = bareWorld();
    const state = new FacetState();
    advanceFrame(world, state, 0.5);
    advanceFrame(world, state, 0.5);
    expect(state.simTime).toBe(1);
    expect(state.screen).toBe("title");
    expect(state.board.cells).toEqual([]);
  });

  it("ignores a first player that is not Facet's own controller", () => {
    const { world, played } = bareWorld();
    const spy = vi.spyOn(world, "players");
    spy.mockReturnValue([{} as never]);
    const state = new FacetState();
    expect(() => advanceFrame(world, state, 1 / 60)).not.toThrow();
    expect(played).toEqual([]);
  });
});
