// Refract — the flow: the transitions between screens, written onto the live
// state.
//
// The framework's states are live objects, so every transition here MUTATES
// the `RefractState` it is handed — the world's one instance — writing the
// fields it changes in place and leaving the rest alone. Each transition is
// shared by the menus in `src/controller.ts` and the debug surface in
// `src/debug.ts`, so choosing a mode from the title and posing it through
// `startMode` are the same code path (specs/instrumentation.md).
//
// The mode-specific facts live where the specs put them: Campaign's course,
// unlocking, and select highlight follow `specs/modes/campaign.md`, and
// Cascade's count, tier ladder, and generated boards follow
// `specs/modes/cascade.md`. The fields belonging to the mode that is not being
// played keep the values they carried before it was entered (specs/state.md).

import { emptyBeams } from "./board";
import { campaignBoard } from "./campaign";
import { generateBoard, tierFor } from "./cascade";
import { CAMPAIGN_LENGTH, TITLE_ITEMS } from "./constants";
import { RefractState, type BoardState, type Mode } from "./game";

/**
 * Every declared field back at its title-screen value (specs/state.md), copied
 * off a freshly constructed state so the class's field initializers stay the
 * single statement of those values, with `rngState` seeded by the caller.
 * `muted` is deliberately left as it stands: muting is a player preference the
 * runtime owns, and the inherited `phase`, `elapsed`, and `players` are the
 * framework's rather than declared fields, so a reset never touches them.
 */
export function resetState(state: RefractState, seed: number): void {
  const fresh = new RefractState();
  state.screen = fresh.screen;
  state.mode = fresh.mode;
  state.menuIndex = fresh.menuIndex;
  state.board = fresh.board;
  state.beams = fresh.beams;
  state.tracing = fresh.tracing;
  state.boardIndex = fresh.boardIndex;
  state.solvedBoards = fresh.solvedBoards;
  state.unlockedCount = fresh.unlockedCount;
  state.selectIndex = fresh.selectIndex;
  state.solvedCount = fresh.solvedCount;
  state.tier = fresh.tier;
  state.pointer = fresh.pointer;
  state.armedTarget = fresh.armedTarget;
  state.simTime = fresh.simTime;
  state.rngState = seed;
}

/**
 * Where each title entry sits in `TITLE_ITEMS`. A return to the title
 * highlights the entry that led away (specs/ui.md), so every transition back
 * names the one it came from.
 */
export const TITLE_INDEX = {
  campaign: TITLE_ITEMS.indexOf("CAMPAIGN"),
  cascade: TITLE_ITEMS.indexOf("CASCADE"),
  howto: TITLE_ITEMS.indexOf("HOW TO PLAY"),
} as const;

/** Back to the title, with the entry that led away highlighted. */
export function toTitle(state: RefractState, menuIndex: number): void {
  state.screen = "title";
  state.menuIndex = menuIndex;
  state.tracing = null;
}

/** Back to the grid, with the highlight where it stands. */
function toSelect(state: RefractState): void {
  state.screen = "select";
  state.menuIndex = 0;
  state.tracing = null;
}

/**
 * A board put in play: fresh, with every beam empty and no trace live,
 * whether it is a first attempt or a replay (specs/modes/campaign.md).
 */
function enterBoard(state: RefractState, board: BoardState): void {
  state.board = board;
  state.beams = emptyBeams(board);
  state.tracing = null;
  state.screen = "playing";
  state.menuIndex = 0;
}

/**
 * A campaign board entered from the select grid, the solved screen, or a
 * replay. The highlight follows the board most recently entered or solved, so
 * a solve is seen landing on the grid.
 */
export function enterCampaignBoard(state: RefractState, index: number): void {
  enterBoard(state, campaignBoard(index));
  state.boardIndex = index;
  state.selectIndex = index;
}

/** The next cascade board, generated at the current tier. */
export function nextCascadeBoard(state: RefractState): void {
  const { board, rngState } = generateBoard(state.rngState, state.tier);
  enterBoard(state, board);
  state.rngState = rngState;
}

/**
 * Cascade's `RESTART`: back to tier 1 with the count at zero, WITHOUT
 * reseeding — the generator carries on from the state it holds, so a restart
 * drops the player onto boards they have not seen (specs/modes/cascade.md).
 */
export function restartCascade(state: RefractState): void {
  state.solvedCount = 0;
  state.tier = 1;
  nextCascadeBoard(state);
}

/**
 * A mode chosen from the title menu, and the identical pose the debug
 * surface's `startMode` applies. Campaign opens on its select grid with the
 * session's progress as it stands; Cascade begins a fresh sequence from
 * tier 1 (specs/modes/cascade.md, The sequence).
 */
export function startMode(state: RefractState, mode: Mode): void {
  state.mode = mode;
  if (mode === "campaign") {
    state.screen = "select";
    state.menuIndex = 0;
    state.tracing = null;
    return;
  }
  restartCascade(state);
}

/**
 * The choices the campaign's solved screen offers, in the fixed order: next
 * board when the solved board is not the last, then replay, then back to the
 * grid (specs/modes/campaign.md). The wording is this build's; the order and
 * effects are the specification's, and `src/controller.ts` confirms by
 * position in this same list.
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
export function onSolved(state: RefractState): void {
  state.tracing = null;
  state.menuIndex = 0;
  if (state.mode === "campaign") {
    if (!state.solvedBoards.includes(state.boardIndex)) {
      state.solvedBoards.push(state.boardIndex);
      state.solvedBoards.sort((a, b) => a - b);
    }
    state.unlockedCount = Math.max(
      state.unlockedCount,
      Math.min(state.boardIndex + 2, CAMPAIGN_LENGTH),
    );
    state.selectIndex = state.boardIndex;
    state.screen =
      state.solvedBoards.length === CAMPAIGN_LENGTH ? "complete" : "solved";
    return;
  }
  state.solvedCount += 1;
  state.tier = tierFor(state.solvedCount);
  state.screen = "solved";
}

// ---- What a choice does, wherever it was made ----------------------------
//
// The keyboard's `confirm` and `back` and the pointer's targets reach these two
// functions and nothing else, so a choice means the same thing however it was
// made (specs/controls.md, Operating a screen with the pointer). Each is a
// transition over the whole state machine rather than a per-screen handler,
// because the screen is what decides the meaning of the choice.

/** What `confirm` with the highlight at `index` does on the current screen. */
export function confirmItem(state: RefractState, index: number): void {
  switch (state.screen) {
    case "title":
      if (index === 0) startMode(state, "campaign");
      else if (index === 1) startMode(state, "cascade");
      else {
        state.screen = "howto";
        state.menuIndex = 0;
      }
      return;
    case "select":
      state.selectIndex = index;
      enterSelected(state);
      return;
    case "solved":
      if (state.mode === "campaign") takeCampaignSolved(state, index);
      else if (index === 0) nextCascadeBoard(state);
      else restartCascade(state);
      return;
    case "complete":
      if (index === 0) toSelect(state);
      else toTitle(state, TITLE_INDEX.campaign);
      return;
    case "howto":
    case "playing":
      return;
  }
}

/**
 * Enter the highlighted board, which a locked board refuses: `confirm` on one
 * does nothing and leaves the highlight where it is (specs/modes/campaign.md).
 */
export function enterSelected(state: RefractState): void {
  if (state.selectIndex >= state.unlockedCount) return;
  enterCampaignBoard(state, state.selectIndex);
}

/** The campaign's solved menu, in the order `campaignSolvedItems` lists. */
function takeCampaignSolved(state: RefractState, index: number): void {
  const item = campaignSolvedItems(state.boardIndex)[index];
  if (item === "NEXT BOARD") enterCampaignBoard(state, state.boardIndex + 1);
  else if (item === "REPLAY") enterCampaignBoard(state, state.boardIndex);
  else toSelect(state);
}

/** What `back` does on the current screen. */
export function goBack(state: RefractState): void {
  switch (state.screen) {
    case "title":
      return;
    case "howto":
      toTitle(state, TITLE_INDEX.howto);
      return;
    case "select":
      toTitle(state, TITLE_INDEX.campaign);
      return;
    case "playing":
      // The beams drawn on the board are discarded either way
      // (specs/modes/campaign.md, Leaving a board).
      if (state.mode === "campaign") {
        for (const beam of state.beams) beam.cells = [];
        toSelect(state);
      } else {
        toTitle(state, TITLE_INDEX.cascade);
      }
      return;
    case "solved":
      if (state.mode === "campaign") toSelect(state);
      else toTitle(state, TITLE_INDEX.cascade);
      return;
    case "complete":
      toSelect(state);
      return;
  }
}
