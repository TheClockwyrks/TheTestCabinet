// The flow: the initial state, mode entry, campaign progression, and the
// solve transitions both modes run on the frame R9 holds.

import { describe, expect, it } from "vitest";
import { campaignBoard } from "./campaign";
import { CAMPAIGN_LENGTH } from "./constants";
import {
  campaignSolvedItems,
  createInitialState,
  EMPTY_BOARD,
  enterCampaignBoard,
  goBack,
  nextCascadeBoard,
  onSolved,
  restartCascade,
  startMode,
  TITLE_INDEX,
  toTitle,
} from "./flow";
import type { RefractState } from "./game";

describe("the initial state", () => {
  it("opens on the title with every field at its declared resting value", () => {
    const state = createInitialState();
    expect(state).toEqual({
      screen: "title",
      mode: "campaign",
      menuIndex: 0,
      board: EMPTY_BOARD,
      beams: [],
      tracing: null,
      boardIndex: 0,
      solvedBoards: [],
      unlockedCount: 1,
      selectIndex: 0,
      solvedCount: 0,
      tier: 1,
      pointer: { x: 0, y: 0, down: false, device: "mouse" },
      armedTarget: null,
      simTime: 0,
      muted: false,
    });
  });
});

describe("entering the modes", () => {
  it("opens the campaign on its select grid", () => {
    const state = startMode(createInitialState(), "campaign");
    expect(state.screen).toBe("select");
    expect(state.mode).toBe("campaign");
  });

  it("keeps campaign progress across a return to the title", () => {
    let state = enterCampaignBoard(
      startMode(createInitialState(), "campaign"),
      0,
    );
    state = onSolved(state);
    state = toTitle(state, TITLE_INDEX.campaign);
    state = startMode(state, "campaign");
    expect(state.solvedBoards).toEqual([0]);
    expect(state.unlockedCount).toBe(2);
  });

  it("starts cascade fresh on a generated board at tier 1", () => {
    const state = startMode(createInitialState(), "cascade");
    expect(state.mode).toBe("cascade");
    expect(state.screen).toBe("playing");
    expect(state.solvedCount).toBe(0);
    expect(state.tier).toBe(1);
    expect(state.board.nodes.length).toBeGreaterThan(0);
    expect(state.beams.every((beam) => beam.cells.length === 0)).toBe(true);
  });
});

describe("entering a campaign board", () => {
  it("poses the board fresh with the highlight following it", () => {
    const state = enterCampaignBoard(createInitialState(), 4);
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
    return onSolved({
      ...enterCampaignBoard(createInitialState(), index),
      ...base,
    });
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
    let state = solvedAt(2, { solvedBoards: [0, 2, 5], unlockedCount: 6 });
    expect(state.solvedBoards).toEqual([0, 2, 5]);
    expect(state.unlockedCount).toBe(6);
    state = onSolved({ ...state, boardIndex: 1 });
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
    let state = startMode(createInitialState(), "cascade");
    for (let solve = 1; solve <= 5; solve++) {
      state = onSolved(state);
      expect(state.screen).toBe("solved");
      state = nextCascadeBoard(state);
    }
    expect(state.solvedCount).toBe(5);
    expect(state.tier).toBe(2);
  });

  it("restarts at tier 1 on a fresh board", () => {
    let state = startMode(createInitialState(), "cascade");
    state = nextCascadeBoard(onSolved(state));
    const restarted = restartCascade(state);
    expect(restarted.solvedCount).toBe(0);
    expect(restarted.tier).toBe(1);
    expect(restarted.screen).toBe("playing");
    expect(restarted.board.nodes.length).toBeGreaterThan(0);
    expect(restarted.beams.every((beam) => beam.cells.length === 0)).toBe(true);
  });
});

describe("returning to the title", () => {
  it("highlights the entry that led away (specs/ui.md)", () => {
    const fromHowto = goBack({ ...createInitialState(), screen: "howto" });
    expect(fromHowto.screen).toBe("title");
    expect(fromHowto.menuIndex).toBe(TITLE_INDEX.howto);

    const fromCascade = goBack(startMode(createInitialState(), "cascade"));
    expect(fromCascade.screen).toBe("title");
    expect(fromCascade.menuIndex).toBe(TITLE_INDEX.cascade);

    const fromCampaign = goBack(startMode(createInitialState(), "campaign"));
    expect(fromCampaign.screen).toBe("title");
    expect(fromCampaign.menuIndex).toBe(TITLE_INDEX.campaign);
  });
});
