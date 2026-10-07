import { describe, expect, it } from "vitest";
import { BOARD_Y, TILE, tileCX, tileCY } from "./constants";
import { playingState } from "./fixtures";
import {
  chebyshev,
  dropNode,
  nodeAt,
  putNode,
  segmentAt,
  tileColumn,
  tileRow,
} from "./grid";
import { poseWorm } from "./fixtures";

describe("the board as a data structure", () => {
  it("keeps the node roster in ascending row then column", () => {
    const state = playingState();
    putNode(state, 9, 4, 1);
    putNode(state, 2, 7, 2);
    putNode(state, 3, 4, 0);
    putNode(state, 1, 4, 3);
    expect(state.nodes.map((node) => [node.r, node.c])).toEqual([
      [4, 1],
      [4, 3],
      [4, 9],
      [7, 2],
    ]);
  });

  it("replaces the charge of a tile that already holds a node", () => {
    const state = playingState();
    putNode(state, 5, 5, 1);
    putNode(state, 5, 5, 3);
    expect(state.nodes).toHaveLength(1);
    expect(nodeAt(state.nodes, 5, 5)?.charge).toBe(3);
  });

  it("lays nothing off the board", () => {
    const state = playingState();
    expect(putNode(state, -1, 4, 1)).toBeNull();
    expect(putNode(state, 4, 20, 1)).toBeNull();
    expect(state.nodes).toHaveLength(0);
  });

  it("removes a node and reports whether one stood there", () => {
    const state = playingState();
    putNode(state, 6, 6, 2);
    expect(dropNode(state, 6, 6)).toBe(true);
    expect(dropNode(state, 6, 6)).toBe(false);
    expect(nodeAt(state.nodes, 6, 6)).toBeNull();
  });

  it("finds the segment standing on a tile, and its place in the chain", () => {
    const state = playingState();
    const worm = poseWorm(state, 10, 3, 4);
    expect(segmentAt(state.worms, 10, 3)).toEqual({ worm, index: 0 });
    expect(segmentAt(state.worms, 8, 3)).toEqual({ worm, index: 2 });
    expect(segmentAt(state.worms, 10, 4)).toBeNull();
  });

  it("reads the tile a center falls in, the inverse of the tile map", () => {
    expect(tileColumn(tileCX(17))).toBe(17);
    expect(tileRow(tileCY(11))).toBe(11);
    expect(tileColumn(0)).toBe(0);
    expect(tileColumn(TILE - 0.001)).toBe(0);
    expect(tileRow(BOARD_Y)).toBe(0);
    expect(tileRow(BOARD_Y + TILE)).toBe(1);
  });

  it("measures the distance a discharge reaches by", () => {
    expect(chebyshev(4, 4, 6, 5)).toBe(2);
    expect(chebyshev(4, 4, 4, 4)).toBe(0);
    expect(chebyshev(4, 4, 1, 4)).toBe(3);
  });
});
