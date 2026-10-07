import { describe, expect, it } from "vitest";
import {
  CELL_PITCH,
  FALL_SECONDS_PER_ROW,
  SWAP_SECONDS,
  WAVE_SECONDS,
} from "./constants";
import {
  NO_POUR,
  fallElapsed,
  fallRows,
  fallSeconds,
  gemCenter,
  gemShownAt,
  isPouredBoard,
  swapOrigin,
  swapProgress,
} from "./motion";
import {
  cellCenter,
  createInitialState,
  gemAt,
  loadBoard,
  type FacetState,
} from "./core";
import { quietRows } from "./core/fixtures";

/** A settled game on the quiet board. */
function posed(): FacetState {
  return loadBoard(createInitialState(), quietRows());
}

/** The same board with every gem carrying the `fell` named. */
function fallen(state: FacetState, fell: number): FacetState {
  return {
    ...state,
    board: {
      ...state.board,
      gems: state.board.gems.map((gem) => (gem ? { ...gem, fell } : gem)),
    },
  };
}

describe("fallSeconds", () => {
  it("is one FALL_SECONDS_PER_ROW per row traveled", () => {
    expect(fallSeconds(3)).toBeCloseTo(3 * FALL_SECONDS_PER_ROW, 9);
    expect(fallSeconds(0)).toBe(0);
  });
});

describe("fallRows", () => {
  it("holds the gem at its origin until the shattering has run", () => {
    expect(fallRows(4, 0)).toBe(4);
    expect(fallRows(4, -0.5)).toBe(4);
  });

  it("closes linearly on the cell over the fall's own span", () => {
    const span = fallSeconds(4);
    expect(fallRows(4, span / 2)).toBeCloseTo(2, 9);
    expect(fallRows(4, span)).toBe(0);
    expect(fallRows(4, span + 1)).toBe(0);
  });

  it("leaves a gem that did not move exactly where it stands", () => {
    expect(fallRows(0, 0)).toBe(0);
  });
});

describe("fallElapsed", () => {
  it("runs the step's fall off stepTimer, past the shattering", () => {
    const state: FacetState = {
      ...posed(),
      phase: "resolving",
      chainStep: 1,
      lastWaves: 3,
      stepTimer: 3 * WAVE_SECONDS + 0.02,
    };
    expect(fallElapsed(state, NO_POUR)).toBeCloseTo(0.02, 9);
  });

  it("runs a dealt board's pour off the presentation's own clock", () => {
    expect(fallElapsed(posed(), 0.4)).toBe(0.4);
  });
});

describe("swapOrigin and swapProgress", () => {
  it("names the other cell of the swap in motion, and nothing else", () => {
    const swapping: FacetState = {
      ...posed(),
      phase: "swapping",
      swapTimer: 0,
      chainSwap: { a: { col: 2, row: 2 }, b: { col: 3, row: 2 } },
    };
    expect(swapOrigin(swapping, { col: 2, row: 2 })).toEqual({
      col: 3,
      row: 2,
    });
    expect(swapOrigin(swapping, { col: 3, row: 2 })).toEqual({
      col: 2,
      row: 2,
    });
    expect(swapOrigin(swapping, { col: 0, row: 0 })).toBeNull();
    expect(swapOrigin({ ...swapping, phase: "idle" }, { col: 2, row: 2 })).toBe(
      null,
    );
  });

  it("runs from 0 to 1 over SWAP_SECONDS and stops there", () => {
    const state = posed();
    expect(swapProgress({ ...state, swapTimer: 0 })).toBe(0);
    expect(swapProgress({ ...state, swapTimer: SWAP_SECONDS / 2 })).toBeCloseTo(
      0.5,
      9,
    );
    expect(swapProgress({ ...state, swapTimer: SWAP_SECONDS * 2 })).toBe(1);
  });
});

describe("gemCenter", () => {
  it("puts a resting gem on the cell center specs/board.md fixes", () => {
    expect(gemCenter(posed(), { col: 5, row: 6 }, NO_POUR)).toEqual(
      cellCenter({ col: 5, row: 6 }),
    );
  });

  it("carries a swapped gem from the cell it came from", () => {
    const swapping: FacetState = {
      ...posed(),
      phase: "swapping",
      swapTimer: SWAP_SECONDS / 2,
      chainSwap: { a: { col: 2, row: 2 }, b: { col: 3, row: 2 } },
    };
    const [x, y] = gemCenter(swapping, { col: 2, row: 2 }, NO_POUR);
    const [ax] = cellCenter({ col: 2, row: 2 });
    const [bx] = cellCenter({ col: 3, row: 2 });
    expect(x).toBeCloseTo((ax + bx) / 2, 6);
    expect(y).toBeCloseTo(cellCenter({ col: 2, row: 2 })[1], 6);
  });

  it("holds a falling gem the rows it fell above its cell", () => {
    const falling: FacetState = {
      ...fallen(posed(), 3),
      phase: "resolving",
      chainStep: 1,
      lastWaves: 1,
      stepTimer: 0,
    };
    const [, y] = gemCenter(falling, { col: 1, row: 5 }, NO_POUR);
    expect(y).toBeCloseTo(
      cellCenter({ col: 1, row: 5 })[1] - 3 * CELL_PITCH,
      6,
    );
  });

  it("lands it on its cell once the fall's span has run", () => {
    const landed: FacetState = {
      ...fallen(posed(), 3),
      phase: "resolving",
      chainStep: 1,
      lastWaves: 1,
      stepTimer: WAVE_SECONDS + fallSeconds(3),
    };
    expect(gemCenter(landed, { col: 1, row: 5 }, NO_POUR)).toEqual(
      cellCenter({ col: 1, row: 5 }),
    );
  });

  it("pours a dealt board in off the pour clock instead", () => {
    const dealt = fallen(posed(), 4);
    const [, high] = gemCenter(dealt, { col: 0, row: 3 }, 0);
    const [, low] = gemCenter(dealt, { col: 0, row: 3 }, fallSeconds(4));
    expect(high).toBeCloseTo(
      cellCenter({ col: 0, row: 3 })[1] - 4 * CELL_PITCH,
      6,
    );
    expect(low).toBeCloseTo(cellCenter({ col: 0, row: 3 })[1], 6);
  });
});

describe("gemShownAt", () => {
  it("draws the two gems an offer names in each other's cells", () => {
    const state = posed();
    const held: FacetState = {
      ...state,
      selection: { col: 1, row: 1 },
      offer: { col: 2, row: 1 },
    };
    expect(gemShownAt(held, { col: 1, row: 1 })).toBe(
      gemAt(state.board, { col: 2, row: 1 }),
    );
    expect(gemShownAt(held, { col: 2, row: 1 })).toBe(
      gemAt(state.board, { col: 1, row: 1 }),
    );
    // Every other cell shows the gem it holds.
    expect(gemShownAt(held, { col: 4, row: 4 })).toBe(
      gemAt(state.board, { col: 4, row: 4 }),
    );
  });

  it("changes nothing while a selection stands with no offer", () => {
    const state = posed();
    const held: FacetState = { ...state, selection: { col: 1, row: 1 } };
    expect(gemShownAt(held, { col: 1, row: 1 })).toBe(
      gemAt(state.board, { col: 1, row: 1 }),
    );
  });
});

describe("isPouredBoard", () => {
  it("is true of a board every gem of which came in from above it", () => {
    const state = posed();
    const dealt: FacetState = {
      ...state,
      board: {
        ...state.board,
        gems: state.board.gems.map((gem, index) =>
          gem
            ? { ...gem, fell: Math.floor(index / state.board.cols) + 1 }
            : gem,
        ),
      },
    };
    expect(isPouredBoard(dealt)).toBe(true);
  });

  it("is false of a posed board, whose gems are standing still", () => {
    expect(isPouredBoard(posed())).toBe(false);
  });

  it("is false with no board in play at all", () => {
    expect(isPouredBoard(createInitialState())).toBe(false);
  });
});
