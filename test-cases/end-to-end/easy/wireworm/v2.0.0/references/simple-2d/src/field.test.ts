// The node field: what stands on a tile, what raises and lowers it, and the
// scatter a new run lays.

import { describe, expect, it } from "vitest";
import {
  CHARGE_MAX,
  COLS,
  SCATTER_BOTTOM_ROW,
  SCATTER_MAX_FRACTION,
  SCATTER_MIN_FRACTION,
  SCATTER_TOP_ROW,
  tileCX,
  tileCY,
} from "./constants";
import {
  SCATTER_TILES,
  bumpNode,
  dropNode,
  hasNode,
  nodeAt,
  putNode,
  scatterField,
  slamNode,
  tileOf,
} from "./field";
import { blankState } from "./flow";
import { newFrameEvents, toSim, type Sim } from "./sim";

function sim(): Sim {
  return toSim(blankState());
}

describe("the field", () => {
  it("keeps its nodes in ascending row, then column", () => {
    const s = sim();
    putNode(s, 5, 9, 0);
    putNode(s, 1, 2, 0);
    putNode(s, 9, 2, 0);
    putNode(s, 0, 9, 0);
    expect(s.nodes.map((node) => `${node.r}:${node.c}`)).toEqual([
      "2:1",
      "2:9",
      "9:0",
      "9:5",
    ]);
  });

  it("sets the node on a tile rather than laying a second one", () => {
    const s = sim();
    putNode(s, 4, 4, 1);
    putNode(s, 4, 4, 2);
    expect(s.nodes).toHaveLength(1);
    expect(nodeAt(s, 4, 4)?.charge).toBe(2);
  });

  it("holds a charge to a whole number inside the range", () => {
    const s = sim();
    expect(putNode(s, 4, 4, 9).charge).toBe(CHARGE_MAX);
    expect(putNode(s, 5, 4, -3).charge).toBe(0);
  });

  it("removes a node and reports whether one stood there", () => {
    const s = sim();
    putNode(s, 2, 2, 0);
    expect(dropNode(s, 2, 2)).toBe(true);
    expect(dropNode(s, 2, 2)).toBe(false);
    expect(hasNode(s, 2, 2)).toBe(false);
  });

  it("raises a bump by one and caps it at critical", () => {
    const ev = newFrameEvents();
    const s = sim();
    const node = putNode(s, 3, 3, 0);
    bumpNode(node, ev);
    expect(node.charge).toBe(1);
    expect(ev.cues.has("critical")).toBe(false);
    bumpNode(node, ev);
    bumpNode(node, ev);
    expect(node.charge).toBe(CHARGE_MAX);
    expect(ev.cues.has("critical")).toBe(true);
    bumpNode(node, ev);
    expect(node.charge).toBe(CHARGE_MAX);
  });

  it("slams a node straight to critical, and sounds nothing for one already there", () => {
    const first = newFrameEvents();
    const s = sim();
    const node = putNode(s, 3, 3, 1);
    slamNode(node, first);
    expect(node.charge).toBe(CHARGE_MAX);
    expect(first.cues.has("critical")).toBe(true);

    const again = newFrameEvents();
    slamNode(node, again);
    expect(again.cues.size).toBe(0);
  });

  it("reads the tile a stage position falls in", () => {
    expect(tileOf(tileCX(7), tileCY(11))).toEqual({ c: 7, r: 11 });
    expect(tileOf(0, 80)).toEqual({ c: 0, r: 0 });
    expect(tileOf(1279, 719)).toEqual({ c: 39, r: 19 });
  });
});

describe("the starting scatter", () => {
  it("covers between a tenth and a seventh of the scatter rows, all inert", () => {
    for (const seed of [1, 2, 17, 5000]) {
      const s = sim();
      s.rngState = seed;
      scatterField(s);
      expect(s.nodes.length).toBeGreaterThanOrEqual(
        Math.floor(SCATTER_MIN_FRACTION * SCATTER_TILES),
      );
      expect(s.nodes.length).toBeLessThanOrEqual(
        Math.ceil(SCATTER_MAX_FRACTION * SCATTER_TILES),
      );
      expect(s.nodes.every((node) => node.charge === 0)).toBe(true);
      expect(
        s.nodes.every(
          (node) =>
            node.r >= SCATTER_TOP_ROW &&
            node.r <= SCATTER_BOTTOM_ROW &&
            node.c >= 0 &&
            node.c < COLS,
        ),
      ).toBe(true);
    }
  });

  it("lays the same field twice from one seed and a different one from another", () => {
    const lay = (seed: number): string => {
      const s = sim();
      s.rngState = seed;
      scatterField(s);
      return s.nodes.map((node) => `${node.c},${node.r}`).join(" ");
    };
    expect(lay(4)).toBe(lay(4));
    expect(lay(4)).not.toBe(lay(5));
  });

  it("lays at most one node per tile", () => {
    const s = sim();
    s.rngState = 99;
    scatterField(s);
    const keys = new Set(s.nodes.map((node) => `${node.c},${node.r}`));
    expect(keys.size).toBe(s.nodes.length);
  });
});
