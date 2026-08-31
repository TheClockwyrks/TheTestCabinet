// The one seam between the engine's live state and the core's.

import { describe, expect, it } from "vitest";
import {
  applyCore,
  boardFromCore,
  boardToCore,
  gemAtCell,
  toCore,
} from "./bridge";
import { FacetState } from "./game";
import { EMPTY_BOARD, createInitialState, parseBoard } from "./core";
import { quietRows, quietRowsWith } from "./core/fixtures";
import { GRID_COLS, GRID_ROWS } from "./constants";

/** A live state at its title-screen values, built without a world. */
function liveState(): FacetState {
  return new FacetState();
}

describe("boards cross the seam unchanged", () => {
  it("carries every cell in reading order, both ways", () => {
    const core = parseBoard(quietRows());
    const live = boardFromCore(core);
    expect(live.cols).toBe(GRID_COLS);
    expect(live.rows).toBe(GRID_ROWS);
    expect(live.cells).toHaveLength(GRID_COLS * GRID_ROWS);
    expect(live.cells[0]).toEqual({
      col: 0,
      row: 0,
      kind: "ruby",
      cut: "plain",
      strain: 0,
      fell: 0,
    });
    expect(boardToCore(live)).toEqual(core);
  });

  it("carries a prism, a cut, and a strain digit", () => {
    const core = parseBoard(
      quietRowsWith({ "2,3": "X0", "4,4": "S1b", "5,5": "C2s", "1,1": "J3" }),
    );
    const live = boardFromCore(core);
    expect(gemAtCell(live, 2, 3)).toMatchObject({ kind: null, cut: "prism" });
    expect(gemAtCell(live, 4, 4)).toMatchObject({
      kind: "sapphire",
      cut: "brilliant",
      strain: 1,
    });
    expect(gemAtCell(live, 5, 5)).toMatchObject({ cut: "star", strain: 2 });
    expect(gemAtCell(live, 1, 1)).toMatchObject({ kind: "jade", strain: 3 });
    expect(boardToCore(live)).toEqual(core);
  });

  it("reads an empty board as the core's own resting value", () => {
    expect(boardToCore({ cols: 0, rows: 0, cells: [] })).toBe(EMPTY_BOARD);
  });

  it("names a cell that is empty on a board that has settled", () => {
    const core = parseBoard(quietRows());
    const broken = { ...core, gems: [...core.gems] };
    broken.gems[9] = null;
    expect(() => boardFromCore(broken)).toThrow(/\(1, 1\) is empty/);
  });

  it("answers null off the board", () => {
    const live = boardFromCore(parseBoard(quietRows()));
    expect(gemAtCell(live, -1, 0)).toBeNull();
    expect(gemAtCell(live, 0, GRID_ROWS)).toBeNull();
    expect(gemAtCell(live, GRID_COLS, 0)).toBeNull();
    expect(gemAtCell(live, 0, -1)).toBeNull();
  });
});

describe("the state crosses the seam unchanged", () => {
  it("round-trips a title-screen state", () => {
    const live = liveState();
    expect(toCore(live)).toEqual(createInitialState());
  });

  it("carries the refusal's timer into and out of the core's own field", () => {
    const live = liveState();
    applyCore(live, {
      ...createInitialState(),
      refusal: { a: { col: 1, row: 2 }, b: { col: 2, row: 2 } },
      refusalTimer: 0.12,
    });
    expect(live.refusal).toEqual({
      a: { col: 1, row: 2 },
      b: { col: 2, row: 2 },
      timer: 0.12,
    });
    const core = toCore(live);
    expect(core.refusalTimer).toBeCloseTo(0.12, 6);
    expect(core.refusal).toEqual({
      a: { col: 1, row: 2 },
      b: { col: 2, row: 2 },
    });
  });

  it("carries the one bookkeeping field the rules need", () => {
    const live = liveState();
    applyCore(live, {
      ...createInitialState(),
      chainSwap: { a: { col: 0, row: 0 }, b: { col: 1, row: 0 } },
    });
    expect(live.chainSwap?.b).toEqual({ col: 1, row: 0 });
    expect(toCore(live).chainSwap?.a).toEqual({ col: 0, row: 0 });
  });

  it("carries the hold, the armed target, and the pointer's device", () => {
    const live = liveState();
    applyCore(live, {
      ...createInitialState(),
      selection: { col: 2, row: 3 },
      offer: { col: 3, row: 3 },
      armedTarget: "menu-1",
      pointer: { x: 12, y: 34, down: true, device: "touch" },
    });
    expect(live.selection).toEqual({ col: 2, row: 3 });
    expect(live.offer).toEqual({ col: 3, row: 3 });
    expect(live.armedTarget).toBe("menu-1");
    expect(live.pointer).toEqual({ x: 12, y: 34, down: true, device: "touch" });
    const core = toCore(live);
    expect(core.offer).toEqual({ col: 3, row: 3 });
    expect(core.armedTarget).toBe("menu-1");
    expect(core.pointer.device).toBe("touch");
  });

  it("carries the figures a level is measured by, and the step it left", () => {
    const live = liveState();
    applyCore(live, {
      ...createInitialState(),
      swapTimer: 0.07,
      lastWaves: 2,
      moveScore: 320,
      bestMove: 640,
      bestChain: 5,
    });
    expect(live.swapTimer).toBeCloseTo(0.07, 6);
    expect(live.lastWaves).toBe(2);
    expect(live.moveScore).toBe(320);
    expect(live.bestMove).toBe(640);
    expect(live.bestChain).toBe(5);
    expect(toCore(live).bestChain).toBe(5);
  });

  it("carries how far every gem fell to reach its cell", () => {
    const core = parseBoard(quietRows());
    const dropped = {
      ...core,
      gems: core.gems.map((gem, index) =>
        gem === null ? gem : { ...gem, fell: index % 4 },
      ),
    };
    const live = boardFromCore(dropped);
    expect(live.cells.map((cell) => cell.fell).slice(0, 5)).toEqual([
      0, 1, 2, 3, 0,
    ]);
    expect(boardToCore(live)).toEqual(dropped);
  });

  it("leaves the mute bit alone, because the engine owns it", () => {
    const live = liveState();
    live.muted = true;
    applyCore(live, { ...createInitialState(), muted: false });
    expect(live.muted).toBe(true);
  });

  it("writes in place, because the engine built the one instance", () => {
    const live = liveState();
    const same = live;
    applyCore(live, { ...createInitialState(), score: 400, level: 3 });
    expect(same.score).toBe(400);
    expect(same.level).toBe(3);
  });

  it("copies cells rather than aliasing the core's objects", () => {
    const core = createInitialState();
    const selection = { col: 3, row: 4 };
    const live = liveState();
    applyCore(live, { ...core, selection });
    selection.col = 7;
    expect(toCore(live).selection).toEqual({ col: 3, row: 4 });
  });
});
