// The flow: the state's title-screen initializers, mode entry, campaign
// progression, and the solve transitions both modes run on the frame R9
// holds. Every transition mutates the live state, so each check builds a bare
// `RefractState` and reads the fields back.

import { describe, expect, it } from "vitest";
import { campaignBoard } from "./campaign";
import { CAMPAIGN_LENGTH, DEFAULT_SEED } from "./constants";
import {
  campaignSolvedItems,
  enterCampaignBoard,
  nextCascadeBoard,
  onSolved,
  resetState,
  restartCascade,
  startMode,
  toTitle,
} from "./flow";
import { RefractState } from "./game";

/** The declared fields of a state, as a plain comparable record. */
function declared(state: RefractState): Record<string, unknown> {
  return {
    screen: state.screen,
    mode: state.mode,
    menuIndex: state.menuIndex,
    board: state.board,
    beams: state.beams,
    tracing: state.tracing,
    boardIndex: state.boardIndex,
    solvedBoards: state.solvedBoards,
    unlockedCount: state.unlockedCount,
    selectIndex: state.selectIndex,
    solvedCount: state.solvedCount,
    tier: state.tier,
    pointer: state.pointer,
    simTime: state.simTime,
    muted: state.muted,
    rngState: state.rngState,
  };
}

describe("the state's initializers", () => {
  it("holds every declared field at its title-screen value", () => {
    const state = new RefractState();
    expect(declared(state)).toEqual({
      screen: "title",
      mode: "campaign",
      menuIndex: 0,
      board: { cols: 0, rows: 0, nodes: [] },
      beams: [],
      tracing: null,
      boardIndex: 0,
      solvedBoards: [],
      unlockedCount: 1,
      selectIndex: 0,
      solvedCount: 0,
      tier: 1,
      pointer: { x: 0, y: 0, down: false },
      simTime: 0,
      muted: false,
      rngState: DEFAULT_SEED,
    });
    // The framework's inherited fields rest where the engine leaves them: the
    // mode never calls setPhase, so phase stays "waiting" and elapsed 0.
    expect(state.phase).toBe("waiting");
    expect(state.elapsed).toBe(0);
    expect(state.players).toEqual([]);
  });
});

describe("resetState", () => {
  it("restores every declared field, seeds the generator, and keeps mute", () => {
    const state = new RefractState();
    startMode(state, "cascade");
    onSolved(state);
    state.muted = true;
    state.simTime = 12.5;

    resetState(state, 99);
    expect(declared(state)).toEqual({
      ...declared(new RefractState()),
      muted: true,
      rngState: 99,
    });
  });
});

describe("entering the modes", () => {
  it("opens the campaign on its select grid", () => {
    const state = new RefractState();
    startMode(state, "campaign");
    expect(state.screen).toBe("select");
    expect(state.mode).toBe("campaign");
  });

  it("keeps campaign progress across a return to the title", () => {
    const state = new RefractState();
    startMode(state, "campaign");
    enterCampaignBoard(state, 0);
    onSolved(state);
    toTitle(state);
    startMode(state, "campaign");
    expect(state.solvedBoards).toEqual([0]);
    expect(state.unlockedCount).toBe(2);
  });

  it("starts cascade fresh on a generated board at tier 1", () => {
    const state = new RefractState();
    startMode(state, "cascade");
    expect(state.mode).toBe("cascade");
    expect(state.screen).toBe("playing");
    expect(state.solvedCount).toBe(0);
    expect(state.tier).toBe(1);
    expect(state.board.nodes.length).toBeGreaterThan(0);
    expect(state.beams.every((beam) => beam.cells.length === 0)).toBe(true);
    // Generating consumed the seeded generator.
    expect(state.rngState).not.toBe(DEFAULT_SEED);
  });
});

describe("entering a campaign board", () => {
  it("poses the board fresh with the highlight following it", () => {
    const state = new RefractState();
    enterCampaignBoard(state, 4);
    expect(state.screen).toBe("playing");
    expect(state.boardIndex).toBe(4);
    expect(state.selectIndex).toBe(4);
    expect(state.board).toEqual(campaignBoard(4));
    expect(state.beams.every((beam) => beam.cells.length === 0)).toBe(true);
    expect(state.tracing).toBeNull();
  });
});

describe("the campaign solve transition", () => {
  function solvedAt(index: number, base?: Partial<RefractState>): RefractState {
    const state = new RefractState();
    enterCampaignBoard(state, index);
    Object.assign(state, base);
    onSolved(state);
    return state;
  }

  it("records the board, unlocks the next, and lands on the solved screen", () => {
    const state = solvedAt(0);
    expect(state.screen).toBe("solved");
    expect(state.solvedBoards).toEqual([0]);
    expect(state.unlockedCount).toBe(2);
    expect(state.selectIndex).toBe(0);
    expect(state.tracing).toBeNull();
    expect(state.menuIndex).toBe(0);
  });

  it("keeps solvedBoards ascending and unique across replays", () => {
    const state = solvedAt(2, { solvedBoards: [0, 2, 5], unlockedCount: 6 });
    expect(state.solvedBoards).toEqual([0, 2, 5]);
    expect(state.unlockedCount).toBe(6);
    state.boardIndex = 1;
    onSolved(state);
    expect(state.solvedBoards).toEqual([0, 1, 2, 5]);
  });

  it("goes to complete on the solve that leaves no board unsolved", () => {
    const allButLast = Array.from(
      { length: CAMPAIGN_LENGTH - 1 },
      (_, index) => index,
    );
    const state = solvedAt(CAMPAIGN_LENGTH - 1, {
      solvedBoards: allButLast,
      unlockedCount: CAMPAIGN_LENGTH,
    });
    expect(state.screen).toBe("complete");
    expect(state.solvedBoards).toHaveLength(CAMPAIGN_LENGTH);
    expect(state.unlockedCount).toBe(CAMPAIGN_LENGTH);
  });

  it("offers next board before the last board, and not on it", () => {
    expect(campaignSolvedItems(0)).toHaveLength(3);
    expect(campaignSolvedItems(0)[0]).toBe("NEXT BOARD");
    expect(campaignSolvedItems(CAMPAIGN_LENGTH - 1)).toHaveLength(2);
  });
});

describe("the cascade solve transition", () => {
  it("counts the solve and recomputes the tier from the ladder", () => {
    const state = new RefractState();
    startMode(state, "cascade");
    for (let solve = 1; solve <= 5; solve++) {
      onSolved(state);
      expect(state.screen).toBe("solved");
      nextCascadeBoard(state);
    }
    expect(state.solvedCount).toBe(5);
    expect(state.tier).toBe(2);
  });

  it("restarts at tier 1 without reseeding", () => {
    const state = new RefractState();
    startMode(state, "cascade");
    onSolved(state);
    nextCascadeBoard(state);
    const before = state.rngState;
    restartCascade(state);
    expect(state.solvedCount).toBe(0);
    expect(state.tier).toBe(1);
    expect(state.screen).toBe("playing");
    expect(state.rngState).not.toBe(before);
  });
});
