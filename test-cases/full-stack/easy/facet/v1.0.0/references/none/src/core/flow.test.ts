// The screens, their menus, and the transitions between them (specs/ui.md).

import { describe, expect, it } from "vitest";
import {
  GAMEOVER_ITEMS,
  LEVEL_TARGET_STEP,
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
  goBack,
  menuItemsFor,
  moveHorizontal,
  moveMenu,
  moveVertical,
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
  });

  it("carries the cursor rather than the highlight on the board", () => {
    const board = playing();
    expect(moveVertical(board, 1).cursor).toEqual({ col: 0, row: 1 });
    expect(moveHorizontal(board, 1).cursor).toEqual({ col: 1, row: 0 });
    expect(moveVertical(title(), 1).menuIndex).toBe(1);
    expect(moveHorizontal(title(), 1).cursor).toEqual({ col: 0, row: 0 });
  });
});

describe("starting a round", () => {
  it("deals an opening board and puts every figure back to its opening value", () => {
    const started = startRound({
      ...title(),
      score: 900,
      level: 4,
      levelScore: 700,
    });
    expect(started.screen).toBe("playing");
    expect(started.score).toBe(0);
    expect(started.level).toBe(1);
    expect(started.levelScore).toBe(0);
    expect(started.phase).toBe("idle");
    expect(started.chainStep).toBe(0);
    expect(started.menuIndex).toBe(0);
    expect(started.cursor).toEqual({ col: 0, row: 0 });
    expect(started.selection).toBeNull();
    expect(started.refusal).toBeNull();
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

describe("moving between the screens", () => {
  it("opens how to play from the title menu, and comes back", () => {
    const howto = confirmMenu(moveMenu(title(), 1));
    expect(howto.screen).toBe("howto");
    expect(howto.menuIndex).toBe(0);
    expect(goBack(howto).screen).toBe("title");
    expect(goBack(howto).menuIndex).toBe(0);
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
    expect(resumed.phase).toBe("resolving");
    expect(resumed.chainStep).toBe(1);
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

  it("leaves paused with back as well", () => {
    expect(goBack(pauseGame(playing())).screen).toBe("playing");
  });

  it("quits to the title, abandoning the board but keeping the figures", () => {
    const scored = { ...playing(), score: 1234, level: 3, levelScore: 500 };
    const quit = quitToTitle(scored);
    expect(quit.screen).toBe("title");
    expect(quit.menuIndex).toBe(0);
    expect(quit.board).toEqual(EMPTY_BOARD);
    expect(quit.phase).toBe("idle");
    expect(quit.selection).toBeNull();
    expect(quit.score).toBe(1234);
    expect(quit.level).toBe(3);
    expect(quit.levelScore).toBe(500);
  });

  it("is what QUIT chooses from both menus that offer it", () => {
    const paused = { ...pauseGame(playing()), menuIndex: 1 };
    expect(confirmMenu(paused).screen).toBe("title");
    const over = {
      ...playing(),
      screen: "gameover",
      menuIndex: 1,
    } as FacetState;
    expect(confirmMenu(over).screen).toBe("title");
  });

  it("leaves game over with back", () => {
    const over = { ...playing(), screen: "gameover" } as FacetState;
    expect(goBack(over).screen).toBe("title");
    expect(goBack(over).menuIndex).toBe(0);
  });

  it("does nothing on back from the title or the board", () => {
    expect(goBack(title()).screen).toBe("title");
    expect(goBack(playing()).screen).toBe("playing");
  });

  it("carries the round's score across a level, and not across a round", () => {
    const carried = { ...playing(), score: 2000, levelScore: 0, level: 2 };
    expect(quitToTitle(carried).score).toBe(2000);
    expect(startRound(carried).score).toBe(0);
    expect(startRound(carried).level).toBe(1);
    expect(LEVEL_TARGET_STEP).toBe(2000);
  });
});

describe("the confirm action", () => {
  it("takes the highlighted item on a menu screen", () => {
    expect(confirm(title()).state.screen).toBe("playing");
  });

  it("acts on the cursor's cell on the board", () => {
    const acted = confirm(playing());
    expect(acted.state.screen).toBe("playing");
    expect(acted.state.selection).toEqual({ col: 0, row: 0 });
    expect(acted.events.select).toBe(true);
  });

  it("does nothing on a screen with no menu and no board", () => {
    const howto = openHowTo(title());
    expect(confirm(howto).state).toEqual(howto);
  });
});
