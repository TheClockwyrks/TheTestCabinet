// The game's screen handling under the pointer: hover, press, release, and the board behind
// the targets (specs/controls.md, Operating a screen with the pointer).

import { describe, expect, it } from "vitest";
import { cellCenter, emptyBeams, parseBoard } from "./board";
import { createInitialState, startMode } from "./flow";
import type { PointerDevice, RefractState } from "./game";
import { targetsFor } from "./layout";
import { pointerDown, pointerMove, pointerUp } from "./game-pointer";

/** The middle of the named target on `state`'s screen. */
function center(state: RefractState, id: string): { x: number; y: number } {
  const target = targetsFor(state).find((entry) => entry.id === id);
  if (target === undefined) throw new Error(`no target ${id}`);
  return { x: target.x + target.w / 2, y: target.y + target.h / 2 };
}

/** A press and a release at one point, the gesture that takes a target. */
function tap(
  state: RefractState,
  at: { x: number; y: number },
  device: PointerDevice = "mouse",
): RefractState {
  const pressed = pointerDown(state, at.x, at.y, device).state;
  return pointerUp(pressed, device).state;
}

/** A cell's center on `state`'s board (specs/board.md). */
function cell(
  state: RefractState,
  col: number,
  row: number,
): { x: number; y: number } {
  const [x, y] = cellCenter({ col, row }, state.board);
  return { x, y };
}

/** A board posed onto `playing`, as the debug surface's `loadBoard` does. */
function playing(notation: readonly string[]): RefractState {
  const board = parseBoard(notation);
  return {
    ...createInitialState(),
    board,
    beams: emptyBeams(board),
    screen: "playing",
  };
}

describe("hover", () => {
  it("highlights the item the pointer is over, and takes nothing", () => {
    const title = createInitialState();
    const at = center(title, "menu-2");
    const moved = pointerMove(title, at.x, at.y).state;

    expect(moved.menuIndex).toBe(2);
    expect(moved.screen).toBe("title");
    expect(moved.armedTarget).toBeNull();
  });

  it("leaves the highlight where it is over no target", () => {
    const title = { ...createInitialState(), menuIndex: 1 };
    const moved = pointerMove(title, 4, 4).state;

    expect(moved.menuIndex).toBe(1);
    expect(moved.pointer).toEqual({
      x: 4,
      y: 4,
      down: false,
      device: "mouse",
    });
  });

  it("highlights the grid cell the pointer is over on select", () => {
    const select = startMode(createInitialState(), "campaign");
    const at = center(select, "board-8");
    const moved = pointerMove(select, at.x, at.y).state;

    expect(moved.selectIndex).toBe(7);
  });
});

describe("press and release", () => {
  it("arms the pressed target and moves the highlight to it", () => {
    const title = createInitialState();
    const at = center(title, "menu-1");
    const pressed = pointerDown(title, at.x, at.y).state;

    expect(pressed.armedTarget).toBe("menu-1");
    expect(pressed.menuIndex).toBe(1);
    expect(pressed.screen).toBe("title");
    expect(pressed.pointer.down).toBe(true);
  });

  it("takes the target on a release inside it", () => {
    const title = createInitialState();
    const taken = tap(title, center(title, "menu-2"));

    expect(taken.screen).toBe("howto");
    expect(taken.armedTarget).toBeNull();
  });

  it("takes nothing on a release outside the armed target", () => {
    const title = createInitialState();
    const at = center(title, "menu-2");
    let next = pointerDown(title, at.x, at.y).state;
    next = pointerMove(next, 4, 4).state;
    next = pointerUp(next).state;

    expect(next.screen).toBe("title");
    expect(next.menuIndex).toBe(2);
    expect(next.armedTarget).toBeNull();
  });

  it("takes a target driven from a touch exactly as from a mouse", () => {
    const title = createInitialState();
    const taken = tap(title, center(title, "menu-2"), "touch");

    expect(taken.screen).toBe("howto");
    expect(taken.pointer.device).toBe("touch");
  });

  it("arms nothing on a press outside every target", () => {
    const title = createInitialState();
    const pressed = pointerDown(title, 4, 4).state;

    expect(pressed.armedTarget).toBeNull();
    expect(tap(title, { x: 4, y: 4 }).screen).toBe("title");
  });
});

describe("the board behind the targets", () => {
  it("begins no trace on a press inside a playing target", () => {
    const board = playing(["TT"]);
    const pressed = pointerDown(board, center(board, "clear").x, center(board, "clear").y)
      .state;

    expect(pressed.tracing).toBeNull();
    expect(pressed.armedTarget).toBe("clear");
  });

  it("empties every beam when the clear target is taken", () => {
    const board = playing(["Ttt", "..T"]);
    const start = cell(board, 0, 0);
    const along = cell(board, 1, 0);
    let next = pointerDown(board, start.x, start.y).state;
    next = pointerMove(next, along.x, along.y).state;
    next = pointerUp(next).state;
    expect(next.beams[0]?.cells.length).toBe(2);

    const cleared = tap(next, center(next, "clear"));

    expect(cleared.beams.every((beam) => beam.cells.length === 0)).toBe(true);
    expect(cleared.board.nodes.length).toBeGreaterThan(0);
  });

  it("leaves the board when the back target is taken", () => {
    const board = { ...playing(["TT"]), mode: "cascade" as const };
    const left = tap(board, center(board, "back"));

    expect(left.screen).toBe("title");
  });

  it("draws on the board through a press outside every target", () => {
    const board = playing(["Ttt", "..T"]);
    const start = cell(board, 0, 0);
    const pressed = pointerDown(board, start.x, start.y).state;

    expect(pressed.tracing).not.toBeNull();
    expect(pressed.armedTarget).toBeNull();
  });
});
