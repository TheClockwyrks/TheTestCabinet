// Refract — the flow: building the state and the transitions between screens.
//
// Every transition here is shared by the menus in `src/game.ts` and the debug
// surface in `src/debug.ts`, so choosing a mode from the title and posing it
// through `startMode` are the same code path (specs/instrumentation.md). Each
// one takes the current state and returns the next, spreading what it keeps
// around what it changes; nothing here holds anything.
//
// The mode-specific facts live where the specs put them: Campaign's course,
// unlocking, and select highlight follow `specs/modes/campaign.md`, and
// Cascade's count, tier ladder, and generated boards follow
// `specs/modes/cascade.md`. The fields belonging to the mode that is not being
// played keep the values they carried before it was entered (specs/state.md).

import { emptyBeams } from "./board";
import { campaignBoard } from "./campaign";
import { generateBoard, tierFor } from "./cascade";
import { CAMPAIGN_LENGTH, DEFAULT_SEED } from "./constants";
import type { BoardState, Mode, RefractState } from "./game";

/**
 * The resting board the title screen holds: no board is in play there, and a
 * board declares 1 to 3 channels, so this channel-less single cell is
 * recognizably not one.
 */
export const EMPTY_BOARD: BoardState = { cols: 1, rows: 1, nodes: [] };

/**
 * Every declared field at its title-screen value (specs/state.md). The debug
 * surface's `reset` restores exactly this, seed and mute aside, so these
 * fields are the whole of the authoritative state.
 */
export function createInitialState(): RefractState {
  return {
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

    pointer: { x: 0, y: 0, down: false },
    simTime: 0,
    muted: false,
    rngState: DEFAULT_SEED,
  };
}

/** Back to the title, with its first item highlighted. */
export function toTitle(state: RefractState): RefractState {
  return { ...state, screen: "title", menuIndex: 0, tracing: null };
}

/**
 * A board put in play: fresh, with every beam empty and no trace live,
 * whether it is a first attempt or a replay (specs/modes/campaign.md).
 */
function enterBoard(state: RefractState, board: BoardState): RefractState {
  return {
    ...state,
    board,
    beams: emptyBeams(board),
    tracing: null,
    screen: "playing",
    menuIndex: 0,
  };
}

/**
 * A campaign board entered from the select grid, the solved screen, or a
 * replay. The highlight follows the board most recently entered or solved, so
 * a solve is seen landing on the grid.
 */
export function enterCampaignBoard(
  state: RefractState,
  index: number,
): RefractState {
  return {
    ...enterBoard(state, campaignBoard(index)),
    boardIndex: index,
    selectIndex: index,
  };
}

/** The next cascade board, generated at the current tier. */
export function nextCascadeBoard(state: RefractState): RefractState {
  const { board, rngState } = generateBoard(state.rngState, state.tier);
  return { ...enterBoard(state, board), rngState };
}

/**
 * Cascade's `RESTART`: back to tier 1 with the count at zero, WITHOUT
 * reseeding — the generator carries on from the state it holds, so a restart
 * drops the player onto boards they have not seen (specs/modes/cascade.md).
 */
export function restartCascade(state: RefractState): RefractState {
  return nextCascadeBoard({ ...state, solvedCount: 0, tier: 1 });
}

/**
 * A mode chosen from the title menu, and the identical pose the debug
 * surface's `startMode` applies. Campaign opens on its select grid with the
 * session's progress as it stands; Cascade begins a fresh sequence from
 * tier 1 (specs/modes/cascade.md, The sequence).
 */
export function startMode(state: RefractState, mode: Mode): RefractState {
  if (mode === "campaign") {
    return {
      ...state,
      mode,
      screen: "select",
      menuIndex: 0,
      tracing: null,
    };
  }
  return restartCascade({ ...state, mode });
}

/**
 * The choices the campaign's solved screen offers, in the fixed order: next
 * board when the solved board is not the last, then replay, then back to the
 * grid (specs/modes/campaign.md). The wording is this build's; the order and
 * effects are the specification's, and `src/game.ts` confirms by position in
 * this same list.
 */
export function campaignSolvedItems(boardIndex: number): string[] {
  const items = ["REPLAY", "BACK TO SELECT"];
  if (boardIndex + 1 < CAMPAIGN_LENGTH) items.unshift("NEXT BOARD");
  return items;
}

/**
 * The solve transition, run on the very frame a change satisfies R9: the
 * trace ends, the beams stay exactly as drawn, and the mode's own progression
 * advances. In Campaign the board is recorded solved (once — a replay changes
 * no unlock state), the next board unlocks, and the solve that leaves no
 * board unsolved goes to `complete` instead of `solved`. In Cascade the count
 * rises and the tier is recomputed from the ladder.
 */
export function onSolved(state: RefractState): RefractState {
  const ended: RefractState = { ...state, tracing: null, menuIndex: 0 };
  if (state.mode === "campaign") {
    const solvedBoards = state.solvedBoards.includes(state.boardIndex)
      ? state.solvedBoards
      : [...state.solvedBoards, state.boardIndex].sort((a, b) => a - b);
    return {
      ...ended,
      solvedBoards,
      unlockedCount: Math.max(
        state.unlockedCount,
        Math.min(state.boardIndex + 2, CAMPAIGN_LENGTH),
      ),
      selectIndex: state.boardIndex,
      screen: solvedBoards.length === CAMPAIGN_LENGTH ? "complete" : "solved",
    };
  }
  const solvedCount = state.solvedCount + 1;
  return {
    ...ended,
    solvedCount,
    tier: tierFor(solvedCount),
    screen: "solved",
  };
}
