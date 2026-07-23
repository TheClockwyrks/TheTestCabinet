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
      // The engine resolves the tier's SPEED for the renderer; `fast` is 64
      // fixed-point units per tick, i.e. 8 px at a 32 px cell.
      speed: 64,
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

  it("keeps every item on its own step when one is inserted mid-line", () => {
    // The stutter regression. An inserter/side-load drops an item into the MIDDLE
    // of a packed run. Every pre-existing item still advances by exactly one
    // speed; only the newcomer is unmatched. Modelling entry as a single count of
    // items arriving at the upstream end instead paired each item with its
    // NEIGHBOUR's next-tick slot — drawing it a whole spacing too far forward and
    // then snapping it back on the following tick.
    const board = beltRow(2);
    // Tile 0 packed at 64/128/192; all advance 64 and a newcomer lands at 192.
    const prev = placeItems(
      board,
      beltSnapshot(1, [{ left: [64, 128, 192].map(ore), right: [] }, { left: [], right: [] }]),
      CELL,
    );
    const next = placeItems(
      board,
      beltSnapshot(2, [{ left: [0, 64, 128, 192].map(ore), right: [] }, { left: [], right: [] }]),
      CELL,
    );

    const pairs = matchItems(prev, next);
    const moved = pairs.filter((p) => p.from && p.to);
    const entered = pairs.filter((p) => !p.from && p.to);

    expect(moved).toHaveLength(3);
    expect(entered).toHaveLength(1);
    // Every matched item advances one spacing — 8 px — and none is dragged a
    // slot further to make room for the newcomer.
    for (const { from, to } of moved) {
      expect(to!.along - from!.along).toBeCloseTo(8);
    }
    // The unmatched item is the one forced in at the back of the run — `along`
    // grows toward the output end, so that is the smallest of them.
    expect(entered[0]!.to!.along).toBeCloseTo(Math.min(...next.map((p) => p.along)));
  });

  it("matches each run independently when two share a lane line", () => {
    // Two separate belt runs on the same row (so the same line key) with an item
    // forced into the second. Previously no single upstream-entry count could
    // explain both runs at once, so the matcher gave up and returned every item
    // one-sided — freezing and double-drawing the whole line for a tick.
    const board = beltRow(12);
    const empty = () => ({ left: [] as ReturnType<typeof ore>[], right: [] as ReturnType<typeof ore>[] });
    const prevLanes = Array.from({ length: 12 }, (_, i) =>
      i === 0 ? { ...empty(), left: [128, 192].map(ore) }
      : i === 9 ? { ...empty(), left: [128].map(ore) }
      : empty(),
    );
    const nextLanes = Array.from({ length: 12 }, (_, i) =>
      i === 0 ? { ...empty(), left: [64, 128].map(ore) }
      : i === 9 ? { ...empty(), left: [64, 192].map(ore) }
      : empty(),
    );
    const prev = placeItems(board, beltSnapshot(1, prevLanes), CELL);
    const next = placeItems(board, beltSnapshot(2, nextLanes), CELL);

    const pairs = matchItems(prev, next);
    const moved = pairs.filter((p) => p.from && p.to);
    // All three pre-existing items are followed; only the forced-in one is new.
    expect(moved).toHaveLength(3);
    expect(pairs.filter((p) => !p.from && p.to)).toHaveLength(1);
    for (const { from, to } of moved) {
      expect(to!.along - from!.along).toBeCloseTo(8);
    }
  });

  it("accepts a step up to the cap and rejects one beyond it", () => {
    const line = "E|1|left";
    const at = (along: number): ItemPoint => ({
      line,
      along,
      x: along,
      y: 0,
      item: "iron-ore",
      step: 8,
    });
    expect(matchItems([at(0)], [at(MAX_STEP_PX)]).filter((p) => p.from && p.to)).toHaveLength(1);
    expect(
      matchItems([at(0)], [at(MAX_STEP_PX + 1)]).filter((p) => p.from && p.to),
    ).toHaveLength(0);
  });
});

describe("tweenItems", () => {
  it("glides a matched item and clamps outside 0..1", () => {
    const line = "E|1|left";
    const from: ItemPoint = { line, along: 0, x: 0, y: 10, item: "iron-ore", step: 8 };
    const to: ItemPoint = { line, along: 8, x: 8, y: 10, item: "iron-ore", step: 8 };
    expect(tweenItems([{ from, to }], 0.5)[0]!.x).toBeCloseTo(4);
    expect(tweenItems([{ from, to }], 0)[0]!.x).toBeCloseTo(0);
    expect(tweenItems([{ from, to }], 1)[0]!.x).toBeCloseTo(8);
    expect(tweenItems([{ from, to }], 2)[0]!.x).toBeCloseTo(8);
    expect(tweenItems([{ from, to }], -1)[0]!.x).toBeCloseTo(0);
  });

  it("holds a one-sided item still rather than sliding it in from nowhere", () => {
    const line = "E|1|left";
    const p: ItemPoint = { line, along: 5, x: 5, y: 10, item: "iron-ore", step: 8 };
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

describe("splitter handoff", () => {
  // A splitter covering (1,1)-(1,2) feeding a belt at (2,1); the belt's upstream
  // tile is the splitter, so its just-appeared items are ones emerging from it.
  const board: Board = {
    version: 1,
    grid: { width: 4, height: 4 },
    ticks: 1,
    snapshots: [1],
    entities: [
      { type: "splitter", x: 1, y: 1, dir: "E", tiles: [[1, 1], [1, 2]] },
      { type: "belt", x: 2, y: 1, dir: "E", tiles: [[2, 1]], speed: 64 },
    ],
  };
  const snap = (items: { pos: number; item: string }[]): Snapshot => ({
    tick: 1,
    checksum: "",
    entities: [
      { splitter: { out_pref: 0, in_first: 0 } },
      { belt: { left: items, right: [] } },
    ],
  });

  it("flags items on a splitter-fed belt as emerging from the splitter", () => {
    const pts = placeItems(board, snap([{ pos: TILE - 64, item: "iron-ore" }]), CELL);
    expect(pts).toHaveLength(1);
    expect(pts[0]!.fromSplitter).toBe(true);
  });

  it("hides a just-emerged splitter item mid-tween, then shows it once it persists", () => {
    const prev = placeItems(board, snap([]), CELL); // nothing on the output yet
    const next = placeItems(board, snap([{ pos: TILE - 64, item: "iron-ore" }]), CELL); // emerged
    // to-only (from = null) AND fromSplitter: hidden "inside" the splitter this tween.
    expect(tweenItems(matchItems(prev, next), 0.5)).toHaveLength(0);
    // Once it is on the belt across both ticks it is matched and draws normally.
    expect(tweenItems(matchItems(next, next), 0.5)).toHaveLength(1);
  });
});
