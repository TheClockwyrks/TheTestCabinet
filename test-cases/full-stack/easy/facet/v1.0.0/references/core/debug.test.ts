// The debug and automation surface's logic: the snapshot projection and the
// poses (specs/instrumentation.md).

import { describe, expect, it } from "vitest";
import {
  DEFAULT_SEED,
  FACET_DEBUG_VERSION,
  GRID_COLS,
  GRID_ROWS,
  LEVEL_TARGET_STEP,
  MAX_MULTIPLIER,
  STEP_SECONDS,
  SWAP_SECONDS,
} from "../constants";
import { cellX, cellY, formatBoard, withGem } from "./board";
import { requestSwap, stepHold, tick } from "./chain";
import {
  clearBoard,
  clearChain,
  clearOffer,
  clearRefusal,
  clearSelection,
  dealBoard,
  loadBoard,
  poseSwap,
  reset,
  setBestChain,
  setBestMove,
  setGem,
  setLevel,
  setLevelScore,
  setMenuIndex,
  setMoveScore,
  setOffer,
  setScore,
  setScreen,
  setSelection,
  snapshot,
} from "./debug";
import { quietRows, quietRowsWith } from "./fixtures";
import {
  continueLevel,
  openHowTo,
  pauseGame,
  quitToTitle,
  resumeGame,
  startRound,
} from "./flow";
import { targetsFor } from "./targets";
import { createInitialState, type FacetState } from "./state";

const title = () => createInitialState(1);

const play = (edits: Readonly<Record<string, string>> = {}): FacetState =>
  setScreen(loadBoard(createInitialState(1), quietRowsWith(edits)), "playing");

const ROW_RUN = { "3,3": "R0", "4,4": "R0" };
const ROW_RUN_SWAP = { a: { col: 3, row: 3 }, b: { col: 3, row: 4 } };

/** A move accepted and its animation run out, so step 1 has resolved. */
const move = (state: FacetState): FacetState =>
  tick(requestSwap(state, ROW_RUN_SWAP).state, SWAP_SECONDS).state;

describe("snapshot", () => {
  it("reports every field, at its resting value, on the title screen", () => {
    const shot = snapshot(title());
    expect(shot).toEqual({
      version: FACET_DEBUG_VERSION,
      screen: "title",
      menuIndex: 0,
      score: 0,
      level: 1,
      levelScore: 0,
      levelTarget: LEVEL_TARGET_STEP,
      phase: "idle",
      chainStep: 0,
      multiplier: 0,
      swapTimer: 0,
      stepTimer: 0,
      stepHold: STEP_SECONDS,
      board: { cols: 0, rows: 0, cells: [] },
      selection: null,
      offer: null,
      refusal: null,
      lastCleared: 0,
      lastPoints: 0,
      lastWaves: 0,
      lastFall: 0,
      moveScore: 0,
      bestMove: 0,
      bestChain: 0,
      legalSwap: false,
      rngState: 1,
      pointer: { x: 0, y: 0, down: false, device: "mouse" },
      armedTarget: null,
      targets: targetsFor("title").map((target) => ({ ...target })),
      muted: false,
      simTime: 0,
    });
  });

  it("lists every cell in reading order, at the center board.md fixes", () => {
    const shot = snapshot(play());
    expect(shot.board.cols).toBe(GRID_COLS);
    expect(shot.board.rows).toBe(GRID_ROWS);
    expect(shot.board.cells).toHaveLength(GRID_COLS * GRID_ROWS);
    expect(shot.board.cells[0]).toEqual({
      col: 0,
      row: 0,
      x: cellX(0),
      y: cellY(0),
      kind: "ruby",
      cut: "plain",
      strain: 0,
      fell: 0,
    });
    expect(shot.board.cells[9]).toMatchObject({ col: 1, row: 1 });
    expect(shot.board.cells[63]).toMatchObject({
      col: 7,
      row: 7,
      x: cellX(7),
      y: cellY(7),
    });
  });

  it("reports a prism's kind as null", () => {
    const shot = snapshot(play({ "3,4": "X2" }));
    const prism = shot.board.cells.find(
      (cell) => cell.col === 3 && cell.row === 4,
    );
    expect(prism).toMatchObject({ kind: null, cut: "prism", strain: 2 });
  });

  it("derives the level target, the multiplier, and the legal swap", () => {
    expect(snapshot(setLevel(title(), 4)).levelTarget).toBe(
      4 * LEVEL_TARGET_STEP,
    );
    const resolving = move(play(ROW_RUN));
    expect(snapshot(resolving).chainStep).toBe(1);
    expect(snapshot(resolving).multiplier).toBe(1);
    expect(
      snapshot({ ...resolving, chainStep: MAX_MULTIPLIER + 5 }).multiplier,
    ).toBe(MAX_MULTIPLIER);
    expect(snapshot(play(ROW_RUN)).legalSwap).toBe(true);
    expect(snapshot(play()).legalSwap).toBe(false);
  });

  it("reports how far the step fell and how long it holds, both derived", () => {
    const resolving = move(play(ROW_RUN));
    const shot = snapshot(resolving);
    expect(shot.lastWaves).toBe(0);
    expect(shot.lastFall).toBe(1);
    expect(shot.stepHold).toBeCloseTo(stepHold(resolving));
    // Every cell reports the rows the gem in it traveled.
    const dropped = shot.board.cells.find(
      (cell) => cell.col === 3 && cell.row === 3,
    );
    expect(dropped?.fell).toBe(1);
  });

  it("reports the swap in motion while one is", () => {
    const swapping = requestSwap(play(ROW_RUN), ROW_RUN_SWAP).state;
    const partway = tick(swapping, SWAP_SECONDS / 2).state;
    const shot = snapshot(partway);
    expect(shot.phase).toBe("swapping");
    expect(shot.swapTimer).toBeCloseTo(SWAP_SECONDS / 2);
    expect(shot.stepTimer).toBe(0);
    expect(shot.chainStep).toBe(0);
  });

  it("reports the selection, the offer, and the refusal, and null for none", () => {
    expect(snapshot(setSelection(play(), 2, 3)).selection).toEqual({
      col: 2,
      row: 3,
    });
    expect(snapshot(setOffer(play(), 2, 4)).offer).toEqual({
      col: 2,
      row: 4,
    });
    const refused = requestSwap(play(), {
      a: { col: 0, row: 0 },
      b: { col: 1, row: 0 },
    }).state;
    expect(snapshot(refused).refusal).toEqual({
      a: { col: 0, row: 0 },
      b: { col: 1, row: 0 },
    });
    expect(snapshot(play()).selection).toBeNull();
    expect(snapshot(play()).offer).toBeNull();
    expect(snapshot(play()).refusal).toBeNull();
  });

  it("reports the current screen's targets, in the order controls.md fixes", () => {
    for (const screen of [
      "title",
      "howto",
      "playing",
      "paused",
      "levelclear",
      "gameover",
    ] as const) {
      const shot = snapshot({ ...play(), screen });
      expect(shot.targets).toEqual(
        targetsFor(screen).map((target) => ({ ...target })),
      );
    }
    // A target's rectangle is the one the game hit-tests against, so pressing
    // at a listed target's center is what takes it.
    const shot = snapshot(play());
    expect(shot.targets.map((target) => target.id)).toEqual(["pause"]);
  });

  it("reports the armed target and the device that armed it", () => {
    const armed = { ...play(), armedTarget: "pause" };
    expect(snapshot(armed).armedTarget).toBe("pause");
    const touched = {
      ...play(),
      pointer: { x: 12, y: 34, down: true, device: "touch" as const },
    };
    expect(snapshot(touched).pointer).toEqual({
      x: 12,
      y: 34,
      down: true,
      device: "touch",
    });
  });

  it("reports the level's figures as the level earns them", () => {
    const resolving = move(play(ROW_RUN));
    const shot = snapshot(resolving);
    expect(shot.moveScore).toBe(30);
    expect(shot.bestChain).toBe(1);
    expect(shot.bestMove).toBe(0);
    const settled = snapshot(tick(resolving, stepHold(resolving)).state);
    expect(settled.bestMove).toBe(30);
  });

  it("reports a cell holding nothing at its resting values", () => {
    const midStep = {
      ...play(),
      board: withGem(play().board, { col: 3, row: 4 }, null),
    };
    const cell = snapshot(midStep).board.cells[4 * 8 + 3];
    expect(cell).toEqual({
      col: 3,
      row: 4,
      x: cellX(3),
      y: cellY(4),
      kind: null,
      cut: "plain",
      strain: 0,
      fell: 0,
    });
  });

  it("changes nothing about the state it reads", () => {
    const state = play(ROW_RUN);
    const before = JSON.stringify(state);
    snapshot(state);
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe("reset", () => {
  it("restores every declared field to its title-screen value", () => {
    const played = move({
      ...play(ROW_RUN),
      score: 500,
      level: 3,
      simTime: 12,
    });
    expect(snapshot(reset(played))).toEqual(snapshot(title()));
  });

  it("seeds rngState, defaulting to DEFAULT_SEED", () => {
    expect(reset(title()).rngState).toBe(DEFAULT_SEED);
    expect(reset(title(), {}).rngState).toBe(DEFAULT_SEED);
    expect(reset(title(), { seed: 99 }).rngState).toBe(99);
  });

  it("leaves muted alone, because the runtime owns muting", () => {
    expect(reset({ ...title(), muted: true }).muted).toBe(true);
    expect(reset({ ...title(), muted: false }).muted).toBe(false);
  });

  it("plus start is a round from a known deal", () => {
    const first = startRound(reset(title(), { seed: 4242 }));
    const second = startRound(reset(play(), { seed: 4242 }));
    expect(formatBoard(first.board)).toEqual(formatBoard(second.board));
  });
});

describe("loadBoard", () => {
  it("writes the board and nothing else", () => {
    const before = { ...title(), armedTarget: "menu-0", menuIndex: 1 };
    const posed = loadBoard(before, quietRows());
    expect(formatBoard(posed.board)).toEqual(quietRows());
    expect(posed.screen).toBe("title");
    expect(posed.menuIndex).toBe(1);
    expect(posed.armedTarget).toBe("menu-0");
  });

  it("stands every gem of a posed board still, so every cell reports 0", () => {
    const posed = loadBoard(title(), quietRows());
    expect(snapshot(posed).board.cells.every((cell) => cell.fell === 0)).toBe(
      true,
    );
    expect(snapshot(posed).lastFall).toBe(0);
  });

  it("leaves the round's figures, the generator, and simTime alone", () => {
    const mid = {
      ...play(),
      score: 700,
      level: 3,
      levelScore: 120,
      moveScore: 40,
      bestMove: 260,
      bestChain: 3,
      simTime: 9,
      rngState: 55,
    };
    const posed = loadBoard(mid, quietRows());
    expect(posed.score).toBe(700);
    expect(posed.level).toBe(3);
    expect(posed.levelScore).toBe(120);
    expect(posed.moveScore).toBe(40);
    expect(posed.bestMove).toBe(260);
    expect(posed.bestChain).toBe(3);
    expect(posed.simTime).toBe(9);
    expect(posed.rngState).toBe(55);
  });

  it("rests exactly as written until a swap is accepted on it", () => {
    const posed = play(ROW_RUN);
    const held = tick(tick(posed, 1).state, 1).state;
    expect(formatBoard(held.board)).toEqual(formatBoard(posed.board));
    expect(held.phase).toBe("idle");
  });

  it("refuses a board that is not the notation", () => {
    expect(() => loadBoard(title(), ["R0"])).toThrow();
  });
});

describe("the single-element poses", () => {
  it("setScreen shows a screen and touches nothing else", () => {
    const before = play(ROW_RUN);
    const after = setScreen(before, "paused");
    expect(after).toEqual({ ...before, screen: "paused" });
  });

  it("setMenuIndex highlights an item and touches nothing else", () => {
    const before = title();
    expect(setMenuIndex(before, 1)).toEqual({ ...before, menuIndex: 1 });
  });

  it("dealBoard deals an opening board and leaves the screen alone", () => {
    const before = title();
    const after = dealBoard(before);
    expect(after.screen).toBe("title");
    expect(after.board.cols).toBe(GRID_COLS);
    expect(after.board.rows).toBe(GRID_ROWS);
    expect(snapshot(after).legalSwap).toBe(true);
  });

  it("clearBoard leaves no board in play and touches nothing else", () => {
    const before = play();
    const after = clearBoard(before);
    expect(after.board).toEqual({ cols: 0, rows: 0, gems: [] });
    expect(after.screen).toBe("playing");
  });

  it("clearChain settles resolution and leaves the board as it found it", () => {
    const running = move(play(ROW_RUN));
    expect(running.phase).toBe("resolving");
    const settled = clearChain(running);
    expect(settled.phase).toBe("idle");
    expect(settled.chainStep).toBe(0);
    expect(settled.swapTimer).toBe(0);
    expect(settled.stepTimer).toBe(0);
    expect(formatBoard(settled.board)).toEqual(formatBoard(running.board));
  });

  it("clearRefusal drops a standing refusal and touches nothing else", () => {
    const refused = poseSwap(play(), 0, 0, 1, 0);
    expect(refused.refusal).not.toBeNull();
    const cleared = clearRefusal(refused);
    expect(cleared.refusal).toBeNull();
    expect(formatBoard(cleared.board)).toEqual(formatBoard(refused.board));
  });

  it("setMoveScore sets moveScore and leaves bestMove alone", () => {
    const before = setBestMove(play(), 900);
    const after = setMoveScore(before, 120);
    expect(after.moveScore).toBe(120);
    expect(after.bestMove).toBe(900);
  });
});

describe("the writing poses", () => {
  it("writes one cell, standing still, and leaves everything else", () => {
    const posed = setSelection(play(), 1, 1);
    const written = setGem(posed, 3, 4, "J3b");
    expect(formatBoard(written.board)[4].split(" ")[3]).toBe("J3b");
    expect(written.board.gems[4 * 8 + 3]?.fell).toBe(0);
    expect(written.selection).toEqual({ col: 1, row: 1 });
    expect(written.screen).toBe("playing");
    expect(written.phase).toBe("idle");
    // Every other cell is as it was.
    expect(formatBoard(written.board)[0]).toBe(formatBoard(posed.board)[0]);
  });

  it("refuses to write a cell that is not on the board", () => {
    expect(() => setGem(play(), 8, 0, "R0")).toThrow();
    expect(() => setGem(play(), 0, 0, "nonsense")).toThrow();
    expect(() => setSelection(play(), -1, 0)).toThrow();
    expect(() => setOffer(play(), 0, 8)).toThrow();
  });

  it("sets the score and the level score as separate figures", () => {
    const scored = setLevelScore(setScore(play(), 4000), 250);
    expect(scored.score).toBe(4000);
    expect(scored.levelScore).toBe(250);
    expect(setScore(scored, 10).levelScore).toBe(250);
  });

  it("sets the level, which the target follows from", () => {
    expect(snapshot(setLevel(play(), 5)).levelTarget).toBe(
      5 * LEVEL_TARGET_STEP,
    );
    expect(setLevel(play(), 0).level).toBe(1);
    expect(setLevel(play(), -3).level).toBe(1);
  });

  it("sets the two figures a finished level is reported by", () => {
    const posed = setBestMove(setBestChain(play(), 6), 1280);
    expect(posed.bestChain).toBe(6);
    expect(posed.bestMove).toBe(1280);
    expect(posed.moveScore).toBe(0);
    expect(setBestChain(play(), -2).bestChain).toBe(0);
  });

  it("holds and offers a cell without asking for a swap", () => {
    const posed = setOffer(setSelection(play(ROW_RUN), 3, 3), 3, 4);
    expect(posed.selection).toEqual({ col: 3, row: 3 });
    expect(posed.offer).toEqual({ col: 3, row: 4 });
    expect(posed.phase).toBe("idle");
    expect(formatBoard(posed.board)).toEqual(formatBoard(play(ROW_RUN).board));
  });

  it("clears the selection and the offer each without the other", () => {
    const posed = setOffer(setSelection(play(), 3, 3), 3, 4);
    expect(clearSelection(posed).selection).toBeNull();
    expect(clearSelection(posed).offer).toEqual({ col: 3, row: 4 });
    expect(clearOffer(posed).offer).toBeNull();
    expect(clearOffer(posed).selection).toEqual({ col: 3, row: 3 });
    expect(clearOffer(posed).phase).toBe("idle");
  });
});

describe("poseSwap", () => {
  it("routes through the acceptance path, so R1, R2 and R3 decide it", () => {
    const accepted = poseSwap(play(ROW_RUN), 3, 3, 3, 4);
    expect(accepted.phase).toBe("swapping");
    expect(accepted.lastCleared).toBe(0);
    // The chain's first step resolves once the animation has run.
    expect(tick(accepted, SWAP_SECONDS).state.lastCleared).toBe(3);

    const refused = poseSwap(play(), 3, 3, 3, 4);
    expect(refused.phase).toBe("idle");
    expect(refused.refusal).toEqual({
      a: { col: 3, row: 3 },
      b: { col: 3, row: 4 },
    });

    const diagonal = poseSwap(play(ROW_RUN), 3, 3, 4, 4);
    expect(diagonal.phase).toBe("idle");
  });

  it("leaves the selection and the offer where they were, either way", () => {
    const posed = setOffer(setSelection(play(ROW_RUN), 7, 7), 6, 7);
    expect(poseSwap(posed, 3, 3, 3, 4).selection).toEqual({ col: 7, row: 7 });
    expect(poseSwap(posed, 3, 3, 3, 4).offer).toEqual({ col: 6, row: 7 });
    expect(poseSwap(posed, 0, 0, 1, 0).selection).toEqual({ col: 7, row: 7 });
  });
});

describe("the screen poses", () => {
  it("poses PLAY, which is what start does", () => {
    const started = startRound(title());
    expect(snapshot(started).screen).toBe("playing");
    expect(snapshot(started).legalSwap).toBe(true);
  });

  it("poses HOW TO PLAY, pause, resume, and quit", () => {
    expect(openHowTo(title()).screen).toBe("howto");
    const paused = pauseGame(play());
    expect(paused.screen).toBe("paused");
    expect(resumeGame(paused).screen).toBe("playing");
    const quit = quitToTitle(play());
    expect(quit.screen).toBe("title");
    expect(snapshot(quit).board).toEqual({ cols: 0, rows: 0, cells: [] });
  });

  it("poses CONTINUE from the level-clear menu", () => {
    const cleared = {
      ...play(),
      screen: "levelclear" as const,
      score: 2100,
      levelScore: 2100,
      bestMove: 400,
      bestChain: 3,
    };
    const shot = snapshot(continueLevel(cleared));
    expect(shot.screen).toBe("playing");
    expect(shot.level).toBe(2);
    expect(shot.levelScore).toBe(0);
    expect(shot.bestMove).toBe(0);
    expect(shot.bestChain).toBe(0);
    expect(shot.score).toBe(2100);
    expect(shot.legalSwap).toBe(true);
  });
});
