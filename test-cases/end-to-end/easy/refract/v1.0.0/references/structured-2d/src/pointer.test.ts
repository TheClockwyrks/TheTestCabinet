// The pointer's screen handling: hover, press, release, and the board behind
// the targets (specs/controls.md, Operating a screen with the pointer).
//
// The state is live, so each resolver writes the state it was handed and the
// assertions read that same object back.

import { describe, expect, it } from "vitest";
import { cellCenter, emptyBeams, parseBoard } from "./board";
import { startMode } from "./flow";
import { RefractState, type PointerDevice } from "./game";
import { targetsFor } from "./layout";
import { pointerDown, pointerMove, pointerUp } from "./pointer";

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
): void {
  pointerDown(state, at.x, at.y, device);
  pointerUp(state, device);
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
  const state = new RefractState();
  state.board = parseBoard(notation);
  state.beams = emptyBeams(state.board);
  state.screen = "playing";
  return state;
}

describe("hover", () => {
  it("highlights the item the pointer is over, and takes nothing", () => {
    const title = new RefractState();
    const at = center(title, "menu-2");
    pointerMove(title, at.x, at.y);

    expect(title.menuIndex).toBe(2);
    expect(title.screen).toBe("title");
    expect(title.armedTarget).toBeNull();
  });

  it("leaves the highlight where it is over no target", () => {
    const title = new RefractState();
    title.menuIndex = 1;
    pointerMove(title, 4, 4);

    expect(title.menuIndex).toBe(1);
    expect(title.pointer).toEqual({
      x: 4,
      y: 4,
      down: false,
      device: "mouse",
    });
  });

  it("highlights the grid cell the pointer is over on select", () => {
    const select = new RefractState();
    startMode(select, "campaign");
    const at = center(select, "board-8");
    pointerMove(select, at.x, at.y);

    expect(select.selectIndex).toBe(7);
  });
});

describe("press and release", () => {
  it("arms the pressed target and moves the highlight to it", () => {
    const title = new RefractState();
    const at = center(title, "menu-1");
    pointerDown(title, at.x, at.y);

    expect(title.armedTarget).toBe("menu-1");
    expect(title.menuIndex).toBe(1);
    expect(title.screen).toBe("title");
    expect(title.pointer.down).toBe(true);
  });

  it("takes the target on a release inside it", () => {
    const title = new RefractState();
    tap(title, center(title, "menu-2"));

    expect(title.screen).toBe("howto");
    expect(title.armedTarget).toBeNull();
  });

  it("takes nothing on a release outside the armed target", () => {
    const title = new RefractState();
    const at = center(title, "menu-2");
    pointerDown(title, at.x, at.y);
    pointerMove(title, 4, 4);
    pointerUp(title);

    expect(title.screen).toBe("title");
    expect(title.menuIndex).toBe(2);
    expect(title.armedTarget).toBeNull();
  });

  it("takes a target driven from a touch exactly as from a mouse", () => {
    const title = new RefractState();
    tap(title, center(title, "menu-2"), "touch");

    expect(title.screen).toBe("howto");
    expect(title.pointer.device).toBe("touch");
  });

  it("arms nothing on a press outside every target", () => {
    const title = new RefractState();
    pointerDown(title, 4, 4);
    expect(title.armedTarget).toBeNull();

    const other = new RefractState();
    tap(other, { x: 4, y: 4 });
    expect(other.screen).toBe("title");
  });
});

describe("the board behind the targets", () => {
  it("begins no trace on a press inside a playing target", () => {
    const board = playing(["TT"]);
    const at = center(board, "clear");
    pointerDown(board, at.x, at.y);

    expect(board.tracing).toBeNull();
    expect(board.armedTarget).toBe("clear");
  });

  it("empties every beam when the clear target is taken", () => {
    const board = playing(["Ttt", "..T"]);
    const start = cell(board, 0, 0);
    const along = cell(board, 1, 0);
    pointerDown(board, start.x, start.y);
    pointerMove(board, along.x, along.y);
    pointerUp(board);
    expect(board.beams[0]?.cells.length).toBe(2);

    tap(board, center(board, "clear"));

    expect(board.beams.every((beam) => beam.cells.length === 0)).toBe(true);
    expect(board.board.nodes.length).toBeGreaterThan(0);
  });

  it("leaves the board when the back target is taken", () => {
    const board = playing(["TT"]);
    board.mode = "cascade";
    tap(board, center(board, "back"));

    expect(board.screen).toBe("title");
  });

  it("draws on the board through a press outside every target", () => {
    const board = playing(["Ttt", "..T"]);
    const start = cell(board, 0, 0);
    pointerDown(board, start.x, start.y);

    expect(board.tracing).not.toBeNull();
    expect(board.armedTarget).toBeNull();
  });
});
