// The screens, their menus, and the transitions between them (specs/ui.md).

import { describe, expect, it } from "vitest";
import {
  GAMEOVER_ITEMS,
  LEVEL_TARGET_STEP,
  LEVELCLEAR_ITEMS,
  PAUSED_ITEMS,
  TITLE_ITEMS,
} from "../constants";
import { formatBoard } from "./board";
import { requestSwap, tick } from "./chain";
import { loadBoard } from "./debug";
import { isOpeningBoard } from "./deal";
import { quietRowsWith } from "./fixtures";
import {
  confirm,
  confirmMenu,
  continueLevel,
  goBack,
  menuItemsFor,
  moveMenu,
  openHowTo,
  pauseGame,
  quitToTitle,
  resumeGame,
  startRound,
  togglePause,
} from "./flow";
import { createInitialState, EMPTY_BOARD, type FacetState } from "./state";

const title = () => createInitialState(1);

const playing = (edits: Readonly<Record<string, string>> = {}): FacetState =>
  loadBoard(createInitialState(1), quietRowsWith(edits));

describe("the menus", () => {
  it("names the menu each screen carries", () => {
    expect(menuItemsFor("title")).toEqual(TITLE_ITEMS);
    expect(menuItemsFor("paused")).toEqual(PAUSED_ITEMS);
    expect(menuItemsFor("levelclear")).toEqual(LEVELCLEAR_ITEMS);
    expect(menuItemsFor("gameover")).toEqual(GAMEOVER_ITEMS);
    expect(menuItemsFor("howto")).toEqual([]);
    expect(menuItemsFor("playing")).toEqual([]);
  });

  it("moves the highlight by one and wraps at both ends", () => {
    const first = title();
    expect(moveMenu(first, 1).menuIndex).toBe(1);
    expect(moveMenu(moveMenu(first, 1), 1).menuIndex).toBe(0);
    expect(moveMenu(first, -1).menuIndex).toBe(TITLE_ITEMS.length - 1);
  });

  it("keeps menuIndex at 0 on a screen carrying no menu", () => {
    const howto = { ...title(), screen: "howto", menuIndex: 3 } as FacetState;
    expect(moveMenu(howto, 1).menuIndex).toBe(0);
    // The board is played with the pointer alone, so up and down have no
    // second job there and the highlight simply rests at 0.
    expect(moveMenu(playing(), 1).menuIndex).toBe(0);
    expect(moveMenu(playing(), -1).menuIndex).toBe(0);
  });

  it("carries the highlight on every screen that has one", () => {
    for (const screen of ["title", "paused", "levelclear", "gameover"]) {
      const state = { ...playing(), screen } as FacetState;
      expect(moveMenu(state, 1).menuIndex).toBe(1);
    }
  });
});

describe("starting a round", () => {
  it("deals an opening board and puts every figure back to its opening value", () => {
    const started = startRound({
      ...title(),
      score: 900,
      level: 4,
      levelScore: 700,
      moveScore: 120,
      bestMove: 640,
      bestChain: 5,
    });
    expect(started.screen).toBe("playing");
    expect(started.score).toBe(0);
    expect(started.level).toBe(1);
    expect(started.levelScore).toBe(0);
    expect(started.moveScore).toBe(0);
    expect(started.bestMove).toBe(0);
    expect(started.bestChain).toBe(0);
    expect(started.phase).toBe("idle");
    expect(started.chainStep).toBe(0);
    expect(started.swapTimer).toBe(0);
    expect(started.menuIndex).toBe(0);
    expect(started.selection).toBeNull();
    expect(started.offer).toBeNull();
    expect(started.refusal).toBeNull();
    expect(started.armedTarget).toBeNull();
    expect(isOpeningBoard(started.board)).toBe(true);
  });

  it("advances the generator by the deal rather than reseeding it", () => {
    const started = startRound(title());
    expect(started.rngState).not.toBe(title().rngState);
    expect(started.simTime).toBe(title().simTime);
    expect(started.muted).toBe(title().muted);
  });

  it("is what both PLAY and PLAY AGAIN choose", () => {
    expect(confirmMenu(title()).screen).toBe("playing");
    const over = {
      ...playing(),
      screen: "gameover",
      menuIndex: 0,
    } as FacetState;
    expect(confirmMenu(over).screen).toBe("playing");
    expect(confirmMenu(over).score).toBe(0);
  });
});

describe("opening the next level", () => {
  it("raises the level and returns what the level was measured by to 0", () => {
    const cleared = {
      ...playing(),
      screen: "levelclear" as const,
      score: 3400,
      level: 2,
      levelScore: 4100,
      moveScore: 700,
      bestMove: 700,
      bestChain: 4,
    };
    const next = continueLevel(cleared);
    expect(next.screen).toBe("playing");
    expect(next.menuIndex).toBe(0);
    expect(next.level).toBe(3);
    expect(next.levelScore).toBe(0);
    expect(next.moveScore).toBe(0);
    expect(next.bestMove).toBe(0);
    expect(next.bestChain).toBe(0);
    // The round's score is the round's, so it carries across a level.
    expect(next.score).toBe(3400);
    expect(next.phase).toBe("idle");
    expect(next.selection).toBeNull();
    expect(next.offer).toBeNull();
    expect(next.refusal).toBeNull();
    expect(next.armedTarget).toBeNull();
    expect(isOpeningBoard(next.board)).toBe(true);
  });

  it("is what CONTINUE chooses, and QUIT the other way out", () => {
    const cleared = {
      ...playing(),
      screen: "levelclear",
      menuIndex: 0,
    } as FacetState;
    expect(confirmMenu(cleared).screen).toBe("playing");
    expect(confirmMenu(cleared).level).toBe(2);
    expect(confirmMenu({ ...cleared, menuIndex: 1 }).screen).toBe("title");
  });
});

describe("moving between the screens", () => {
  it("opens how to play from the title menu, and comes back to that item", () => {
    const howto = confirmMenu(moveMenu(title(), 1));
    expect(howto.screen).toBe("howto");
    expect(howto.menuIndex).toBe(0);
    expect(goBack(howto).screen).toBe("title");
    // A player who came in to read the rules is put back where they were.
    expect(goBack(howto).menuIndex).toBe(TITLE_ITEMS.indexOf("HOW TO PLAY"));
    expect(TITLE_ITEMS.indexOf("HOW TO PLAY")).toBe(1);
    expect(openHowTo(title()).screen).toBe("howto");
  });

  it("pauses and resumes with the board exactly as it was left", () => {
    const resolving = requestSwap(playing({ "3,3": "R0", "4,4": "R0" }), {
      a: { col: 3, row: 3 },
      b: { col: 3, row: 4 },
    }).state;
    const paused = pauseGame(resolving);
    expect(paused.screen).toBe("paused");
    expect(paused.menuIndex).toBe(0);

    const held = tick(paused, 5).state;
    const resumed = resumeGame(held);
    expect(resumed.screen).toBe("playing");
    expect(resumed.phase).toBe("swapping");
    expect(formatBoard(resumed.board)).toEqual(formatBoard(resolving.board));
  });

  it("enters and leaves paused with the one pause action", () => {
    const board = playing();
    expect(togglePause(board).screen).toBe("paused");
    expect(togglePause(togglePause(board)).screen).toBe("playing");
    expect(togglePause(title()).screen).toBe("title");
    expect(pauseGame(title()).screen).toBe("title");
    expect(resumeGame(title()).screen).toBe("title");
  });

  it("is what RESUME chooses from the pause menu", () => {
    const paused = pauseGame(playing());
    expect(paused.menuIndex).toBe(0);
    expect(confirmMenu(paused).screen).toBe("playing");
  });

  it("quits to the title, abandoning the board but keeping the figures", () => {
    const scored = { ...playing(), score: 1234, level: 3, levelScore: 500 };
    const quit = quitToTitle(scored);
    expect(quit.screen).toBe("title");
    expect(quit.menuIndex).toBe(0);
    expect(quit.board).toEqual(EMPTY_BOARD);
    expect(quit.phase).toBe("idle");
    expect(quit.selection).toBeNull();
    expect(quit.offer).toBeNull();
    expect(quit.armedTarget).toBeNull();
    expect(quit.score).toBe(1234);
    expect(quit.level).toBe(3);
    expect(quit.levelScore).toBe(500);
  });

  it("is what QUIT chooses from all three menus that offer it", () => {
    const paused = { ...pauseGame(playing()), menuIndex: 1 };
    expect(confirmMenu(paused).screen).toBe("title");
    for (const screen of ["levelclear", "gameover"]) {
      const state = { ...playing(), screen, menuIndex: 1 } as FacetState;
      expect(confirmMenu(state).screen).toBe("title");
    }
  });

  it("leaves game over with back", () => {
    const over = { ...playing(), screen: "gameover" } as FacetState;
    expect(goBack(over).screen).toBe("title");
    expect(goBack(over).menuIndex).toBe(0);
  });

  it("does nothing on back from the title, the board, paused, or level clear", () => {
    expect(goBack(title()).screen).toBe("title");
    expect(goBack(playing()).screen).toBe("playing");
    // These two are left by taking one of their items, not by backing out.
    const paused = pauseGame(playing());
    expect(goBack(paused)).toBe(paused);
    const cleared = { ...playing(), screen: "levelclear" } as FacetState;
    expect(goBack(cleared)).toBe(cleared);
  });

  it("disarms whatever was armed on the screen it leaves", () => {
    const armed = { ...playing(), armedTarget: "pause" };
    expect(pauseGame(armed).armedTarget).toBeNull();
    expect(quitToTitle(armed).armedTarget).toBeNull();
    expect(startRound(armed).armedTarget).toBeNull();
    expect(openHowTo(armed).armedTarget).toBeNull();
    const overArmed = {
      ...playing(),
      screen: "gameover",
      armedTarget: "menu-0",
    } as FacetState;
    expect(goBack(overArmed).armedTarget).toBeNull();
  });

  it("carries the round's score across a level, and not across a round", () => {
    const carried = { ...playing(), score: 2000, levelScore: 0, level: 2 };
    expect(quitToTitle(carried).score).toBe(2000);
    expect(continueLevel(carried).score).toBe(2000);
    expect(startRound(carried).score).toBe(0);
    expect(startRound(carried).level).toBe(1);
    expect(LEVEL_TARGET_STEP).toBe(2000);
  });
});

describe("the confirm action", () => {
  it("takes the highlighted item on a menu screen", () => {
    expect(confirm(title()).screen).toBe("playing");
  });

  it("does nothing at all on the board, which the pointer plays alone", () => {
    const board = playing();
    expect(confirm(board)).toEqual(board);
  });

  it("does nothing on a screen with no menu and no board", () => {
    const howto = openHowTo(title());
    expect(confirm(howto)).toEqual(howto);
  });
});
