import { describe, expect, it } from "vitest";
import {
  MAX_STEP_PX,
  TILE,
  type Board,
  type ItemPoint,
  type Snapshot,
  itemFrame,
  matchItems,
  placeItems,
  tweenItems,
} from "./interpolate";

const CELL = 32;

/** A board of `n` east-facing belt tiles in a row at y = 1. */
function beltRow(n: number, dir: "E" | "W" | "N" | "S" = "E"): Board {
  return {
    version: 1,
    grid: { width: n + 2, height: 4 },
    ticks: 100,
    snapshots: [100],
    entities: Array.from({ length: n }, (_, i) => ({
      type: "belt" as const,
      x: dir === "E" || dir === "W" ? i : 1,
      y: dir === "E" || dir === "W" ? 1 : i,
      dir,
      tier: "fast",
      tiles: [
        [dir === "E" || dir === "W" ? i : 1, dir === "E" || dir === "W" ? 1 : i],
      ] as [number, number][],
    })),
  };
}

/** A snapshot whose belts carry the given per-tile lane contents. */
function beltSnapshot(
  tick: number,
  lanes: { left: { pos: number; item: string }[]; right: { pos: number; item: string }[] }[],
): Snapshot {
  return {
    tick,
    checksum: `fnv1a64:${tick}`,
    entities: lanes.map((l) => ({ belt: l })),
  };
}

const ore = (pos: number) => ({ pos, item: "iron-ore" });

describe("placeItems", () => {
  it("puts an item at the output edge when its position is zero", () => {
    // pos counts back from the output edge, so 0 is fully travelled: the east
    // edge of tile 0, which is x = 32.
    const board = beltRow(1);
    const items = placeItems(board, beltSnapshot(1, [{ left: [ore(0)], right: [] }]), CELL);
    expect(items).toHaveLength(1);
    expect(items[0]!.x).toBeCloseTo(32);
  });

  it("puts an item at the input edge when its position is a full tile", () => {
    const board = beltRow(1);
    const items = placeItems(board, beltSnapshot(1, [{ left: [ore(TILE)], right: [] }]), CELL);
    expect(items[0]!.x).toBeCloseTo(0);
  });

  it("separates the two lanes across the belt", () => {
    const board = beltRow(1);
    const items = placeItems(
      board,
      beltSnapshot(1, [{ left: [ore(128)], right: [ore(128)] }]),
      CELL,
    );
    const [left, right] = [items[0]!, items[1]!];
    // Same distance along, opposite sides of the tile's centre line (y = 48).
    expect(left.x).toBeCloseTo(right.x);
    expect(left.y).toBeCloseTo(48 - CELL / 4);
    expect(right.y).toBeCloseTo(48 + CELL / 4);
    expect(left.line).not.toBe(right.line);
  });

  it("makes a tile boundary a non-event in world space", () => {
    // An item at the output edge of tile 0 and an item at the input edge of tile 1
    // are the SAME world point — which is what lets a hand-off match like any
    // other small forward step.
    const board = beltRow(2);
    const a = placeItems(board, beltSnapshot(1, [{ left: [ore(0)], right: [] }, { left: [], right: [] }]), CELL);
    const b = placeItems(board, beltSnapshot(2, [{ left: [], right: [] }, { left: [ore(TILE)], right: [] }]), CELL);
    expect(a[0]!.x).toBeCloseTo(b[0]!.x);
    expect(a[0]!.line).toBe(b[0]!.line);
  });

  it("runs travel the right way for every facing", () => {
    for (const dir of ["E", "W", "N", "S"] as const) {
      const board = beltRow(2, dir);
      const back = placeItems(board, beltSnapshot(1, [{ left: [ore(TILE)], right: [] }, { left: [], right: [] }]), CELL);
      const front = placeItems(board, beltSnapshot(1, [{ left: [ore(0)], right: [] }, { left: [], right: [] }]), CELL);
      // `along` always grows in the direction of travel, whichever way that is.
      expect(front[0]!.along).toBeGreaterThan(back[0]!.along);
    }
  });
});

describe("matchItems", () => {
  it("follows each item forward on a packed belt", () => {
    // THE regression this module exists for. A packed lane advances by one
    // spacing: naively pairing "whatever is in slot i" sees an item at each
    // position both ticks and reads as frozen. Matching must instead report every
    // item moving forward.
    const board = beltRow(2);
    const packed = [64, 128, 192].map(ore);
    const advanced = [0, 64, 128].map(ore);
    const prev = placeItems(board, beltSnapshot(1, [{ left: packed, right: [] }, { left: [], right: [] }]), CELL);
    const next = placeItems(board, beltSnapshot(2, [{ left: advanced, right: [] }, { left: [], right: [] }]), CELL);

    const pairs = matchItems(prev, next);
    const moved = pairs.filter((p) => p.from && p.to);
    expect(moved).toHaveLength(3);
    for (const { from, to } of moved) {
      // 64 fixed-point units of a 256-unit tile at 32 px = 8 px of real motion.
      expect(to!.along - from!.along).toBeCloseTo(8);
    }
  });

  it("hands an item across a tile boundary as an ordinary step", () => {
    const board = beltRow(2);
    const prev = placeItems(board, beltSnapshot(1, [{ left: [ore(32)], right: [] }, { left: [], right: [] }]), CELL);
    const next = placeItems(board, beltSnapshot(2, [{ left: [], right: [] }, { left: [ore(224)], right: [] }]), CELL);
    const pairs = matchItems(prev, next);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.from).not.toBeNull();
    expect(pairs[0]!.to).not.toBeNull();
    expect(pairs[0]!.to!.along - pairs[0]!.from!.along).toBeCloseTo(8);
  });

  it("treats an item appearing at the back as entering, not as motion", () => {
    const board = beltRow(1);
    const prev = placeItems(board, beltSnapshot(1, [{ left: [ore(64)], right: [] }], ), CELL);
    const next = placeItems(board, beltSnapshot(2, [{ left: [ore(0), ore(TILE)], right: [] }]), CELL);
    const pairs = matchItems(prev, next);
    const entering = pairs.filter((p) => !p.from && p.to);
    const moving = pairs.filter((p) => p.from && p.to);
    expect(moving).toHaveLength(1);
    expect(entering).toHaveLength(1);
    // The newcomer is the one at the upstream edge, not the one that advanced.
    expect(entering[0]!.to!.x).toBeCloseTo(0);
  });

  it("treats an item vanishing off the end as leaving", () => {
    const board = beltRow(1);
    const prev = placeItems(board, beltSnapshot(1, [{ left: [ore(0), ore(64)], right: [] }]), CELL);
    const next = placeItems(board, beltSnapshot(2, [{ left: [ore(0)], right: [] }]), CELL);
    const pairs = matchItems(prev, next);
    expect(pairs.filter((p) => p.from && !p.to)).toHaveLength(1);
    expect(pairs.filter((p) => p.from && p.to)).toHaveLength(1);
  });

  it("never pairs items backwards", () => {
    const board = beltRow(1);
    // A lane whose contents moved backwards cannot be a forward step, so the
    // matcher must decline rather than animate a reversal.
    const prev = placeItems(board, beltSnapshot(1, [{ left: [ore(0)], right: [] }]), CELL);
    const next = placeItems(board, beltSnapshot(2, [{ left: [ore(TILE)], right: [] }]), CELL);
    const pairs = matchItems(prev, next);
    expect(pairs.every((p) => !(p.from && p.to))).toBe(true);
  });

  it("does not pair items across a gap between separate belt runs", () => {
    // Two runs far apart on the same lane line. The displacement between them
    // exceeds anything one tick can produce, so they must not be matched.
    const board = beltRow(10);
    const lanes = Array.from({ length: 10 }, () => ({ left: [] as ReturnType<typeof ore>[], right: [] as ReturnType<typeof ore>[] }));
    const prevLanes = lanes.map((l, i) => (i === 0 ? { ...l, left: [ore(0)] } : l));
    const nextLanes = lanes.map((l, i) => (i === 8 ? { ...l, left: [ore(0)] } : l));
    const prev = placeItems(board, beltSnapshot(1, prevLanes), CELL);
    const next = placeItems(board, beltSnapshot(2, nextLanes), CELL);
    const pairs = matchItems(prev, next);
    expect(pairs.every((p) => !(p.from && p.to))).toBe(true);
  });

  it("keeps distinct item kinds apart", () => {
    const board = beltRow(1);
    const prev = placeItems(board, beltSnapshot(1, [{ left: [{ pos: 64, item: "iron-ore" }], right: [] }]), CELL);
    const next = placeItems(board, beltSnapshot(2, [{ left: [{ pos: 0, item: "copper-ore" }], right: [] }]), CELL);
    const pairs = matchItems(prev, next);
    expect(pairs.every((p) => !(p.from && p.to))).toBe(true);
  });

  it("accepts a step up to the cap and rejects one beyond it", () => {
    const line = "E|1|left";
    const at = (along: number): ItemPoint => ({ line, along, x: along, y: 0, item: "iron-ore" });
    expect(matchItems([at(0)], [at(MAX_STEP_PX)]).filter((p) => p.from && p.to)).toHaveLength(1);
    expect(
      matchItems([at(0)], [at(MAX_STEP_PX + 1)]).filter((p) => p.from && p.to),
    ).toHaveLength(0);
  });
});

describe("tweenItems", () => {
  it("glides a matched item and clamps outside 0..1", () => {
    const line = "E|1|left";
    const from: ItemPoint = { line, along: 0, x: 0, y: 10, item: "iron-ore" };
    const to: ItemPoint = { line, along: 8, x: 8, y: 10, item: "iron-ore" };
    expect(tweenItems([{ from, to }], 0.5)[0]!.x).toBeCloseTo(4);
    expect(tweenItems([{ from, to }], 0)[0]!.x).toBeCloseTo(0);
    expect(tweenItems([{ from, to }], 1)[0]!.x).toBeCloseTo(8);
    expect(tweenItems([{ from, to }], 2)[0]!.x).toBeCloseTo(8);
    expect(tweenItems([{ from, to }], -1)[0]!.x).toBeCloseTo(0);
  });

  it("holds a one-sided item still rather than sliding it in from nowhere", () => {
    const line = "E|1|left";
    const p: ItemPoint = { line, along: 5, x: 5, y: 10, item: "iron-ore" };
    expect(tweenItems([{ from: null, to: p }], 0.5)[0]).toMatchObject({ x: 5, y: 10 });
    expect(tweenItems([{ from: p, to: null }], 0.5)[0]).toMatchObject({ x: 5, y: 10 });
  });
});

describe("itemFrame", () => {
  it("maps an engine item id to its atlas frame, and reports an unknown one", () => {
    const ids = ["iron-ore", "iron-plate", "iron-gear", "copper-ore", "copper-plate", "copper-cable", "circuit"];
    expect(itemFrame(ids, "iron-ore")).toBe(0);
    expect(itemFrame(ids, "copper-cable")).toBe(5);
    expect(itemFrame(ids, "circuit")).toBe(6);
    expect(itemFrame(ids, "stone")).toBe(-1);
  });
});
