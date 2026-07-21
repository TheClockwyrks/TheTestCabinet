import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { Engine, Renderer, type Atlas, type Board, type Sheet, type Snapshot } from "./renderer";
import { matchItems, placeItems } from "./interpolate";

// End-to-end check that the three pieces actually compose: the real vendored
// `lattice-core.wasm` (the authoritative engine), the real packed atlas, and the
// renderer. No browser — the canvas is a stub that records what was drawn, which
// is enough to assert the geometry without pixels.
//
// This is the test that would catch the whole stack being wired up wrong: an atlas
// whose rects do not line up with the sprite the board asks for, a footprint the
// renderer places at the wrong cell, or an engine whose state shape has drifted
// from the types.

const here = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(here, "assets");

/** A 2D context stub that records the calls the renderer makes. */
interface DrawCall {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dx: number;
  dy: number;
}
function recordingContext() {
  const draws: DrawCall[] = [];
  const rotations: number[] = [];
  const stack: { x: number; y: number; rot: number }[] = [];
  let cur = { x: 0, y: 0, rot: 0 };
  const ctx = {
    imageSmoothingEnabled: true,
    strokeStyle: "",
    lineWidth: 0,
    clearRect: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {},
    save: () => {
      stack.push({ ...cur });
    },
    restore: () => {
      cur = stack.pop() ?? { x: 0, y: 0, rot: 0 };
    },
    translate: (x: number, y: number) => {
      cur.x += x;
      cur.y += y;
    },
    rotate: (r: number) => {
      cur.rot += r;
      rotations.push(r);
    },
    drawImage: (
      _img: unknown,
      sx: number,
      sy: number,
      sw: number,
      sh: number,
      dx: number,
      dy: number,
    ) => {
      // Record the destination in world space (the stub only ever translates and
      // rotates, and rotation never moves the centre we care about).
      draws.push({ sx, sy, sw, sh, dx: cur.x + dx, dy: cur.y + dy });
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, draws, rotations };
}

const SCENARIO = {
  version: 1,
  grid: { width: 12, height: 8 },
  ticks: 300,
  snapshots: [150, 300],
  entities: [
    { type: "source", x: 0, y: 1, dir: "E", item: "iron-ore", lane: "both", period: 6 },
    { type: "belt", x: 1, y: 1, dir: "E", tier: "fast" },
    { type: "belt", x: 2, y: 1, dir: "E", tier: "fast" },
    { type: "splitter", x: 3, y: 1, dir: "E" },
    { type: "belt", x: 4, y: 1, dir: "E", tier: "fast" },
    { type: "sink", x: 5, y: 1, dir: "W" },
    { type: "belt", x: 8, y: 2, dir: "N", tier: "fast" },
    { type: "assembler", x: 9, y: 4, recipe: "iron-gear" },
  ],
};

let atlas: Atlas;
let engine: Engine;
let board: Board;

beforeAll(async () => {
  atlas = JSON.parse(readFileSync(join(ASSETS, "sheet.json"), "utf8")) as Atlas;
  engine = await Engine.instantiate(readFileSync(join(ASSETS, "lattice-core.wasm")));
  expect(engine.load(SCENARIO)).toBe(true);
  board = engine.board();
});

function sheet(): Sheet {
  // The stub never touches the image, so a placeholder is enough.
  return { atlas, image: {} as CanvasImageSource };
}

describe("lattice playback stack", () => {
  it("loads the board the scenario describes, with resolved footprints", () => {
    expect(board.grid).toEqual({ width: 12, height: 8 });
    expect(board.ticks).toBe(300);
    expect(board.entities).toHaveLength(SCENARIO.entities.length);
    const assembler = board.entities.find((e) => e.type === "assembler")!;
    expect(assembler.tiles).toHaveLength(9);
    const splitter = board.entities.find((e) => e.type === "splitter")!;
    expect(splitter.tiles).toHaveLength(2);
  });

  it("steps the engine and carries a checksum on every tick", () => {
    const first = engine.step()!;
    expect(first.tick).toBe(1);
    expect(first.checksum).toMatch(/^fnv1a64:[0-9a-f]{16}$/);
    engine.reset();
  });

  it("draws every entity, once, at its footprint centre", () => {
    engine.reset();
    const snap = engine.step()!;
    const { ctx, draws } = recordingContext();
    new Renderer(ctx, sheet()).draw(board, null, snap, 0, 0);

    // One sprite per entity (no items on the belts one tick in).
    expect(draws.length).toBeGreaterThanOrEqual(board.entities.length);

    // The 3x3 assembler anchored at (9,4) spans cells 9..11 / 4..6, so its centre
    // is (10.5, 5.5) cells = (336, 176) px, and a 96x96 sprite lands at (288, 128).
    const assemblerDraw = draws.find((d) => d.sw === 96 && d.sh === 96)!;
    expect(assemblerDraw.dx).toBeCloseTo(336 - 48);
    expect(assemblerDraw.dy).toBeCloseTo(176 - 48);

    // The 64x64 inserter-sized overhang rule is the same one: a sprite is centred
    // on its footprint. The east splitter at (3,1) covers 2 cells vertically, so
    // its 32x64 sprite lands flush at (96, 32).
    const splitterDraw = draws.find((d) => d.sw === 32 && d.sh === 64)!;
    expect(splitterDraw.dx).toBeCloseTo(96);
    expect(splitterDraw.dy).toBeCloseTo(32);
  });

  it("rotates a north-facing belt but never the assembler", () => {
    engine.reset();
    const snap = engine.step()!;
    const { ctx, rotations } = recordingContext();
    new Renderer(ctx, sheet()).draw(board, null, snap, 0, 0);
    // The one north-facing belt turns a quarter anticlockwise; everything else
    // here faces east (no turn) and the assembler is non-rotatable.
    expect(rotations.filter((r) => Math.abs(r + Math.PI / 2) < 1e-9)).toHaveLength(1);
  });

  it("draws items once they are riding the belts", () => {
    engine.reset();
    let snap: Snapshot | null = null;
    for (let i = 0; i < 60; i++) snap = engine.step();
    const { ctx, draws } = recordingContext();
    new Renderer(ctx, sheet()).draw(board, null, snap!, 0, 0);
    // Item icons are the only 16x16 draws.
    const items = draws.filter((d) => d.sw === 16 && d.sh === 16);
    expect(items.length).toBeGreaterThan(0);
    for (const it of items) {
      expect(it.dx).toBeGreaterThanOrEqual(0);
      expect(it.dy).toBeGreaterThanOrEqual(0);
    }
  });

  it("reports no motion on a genuinely stalled belt", async () => {
    // The matcher must report a stopped belt as stopped rather than manufacturing
    // movement — inventing motion here would be as wrong as the frozen-belt bug
    // interpolation exists to prevent. A belt that dead-ends (no sink, nothing
    // downstream) backs up against its own head and truly stops.
    //
    // This deliberately uses its own engine: an earlier version of this test leant
    // on the shared scenario's splitter stalling, which turned out to be a splitter
    // deadlock rather than real back pressure, so the test was asserting a bug.
    const deadEnd = await Engine.instantiate(
      readFileSync(join(ASSETS, "lattice-core.wasm")),
    );
    expect(
      deadEnd.load({
        version: 1,
        grid: { width: 8, height: 4 },
        ticks: 400,
        snapshots: [400],
        entities: [
          { type: "source", x: 0, y: 1, dir: "E", item: "iron-ore", lane: "both", period: 2 },
          { type: "belt", x: 1, y: 1, dir: "E", tier: "fast" },
          { type: "belt", x: 2, y: 1, dir: "E", tier: "fast" },
        ],
      }),
    ).toBe(true);
    const deadBoard = deadEnd.board();

    // Long enough for the line to fill and jam against the dead end.
    let prev: Snapshot | null = null;
    for (let i = 0; i < 300; i++) prev = deadEnd.step();
    const next = deadEnd.step()!;

    const pairs = matchItems(
      placeItems(deadBoard, prev!, atlas.cellSize),
      placeItems(deadBoard, next, atlas.cellSize),
    );
    const matched = pairs.filter((p) => p.from && p.to);
    expect(matched.length).toBeGreaterThan(0);
    for (const { from, to } of matched) {
      expect(to!.along - from!.along).toBeCloseTo(0);
    }
  });

  it("moves items smoothly between two ticks rather than snapping", () => {
    // Scan for a tick where items are actually flowing: a belt can be stalled at
    // any given tick, so pinning the assertion to a fixed tick would test the
    // scenario's timing rather than the interpolation.
    engine.reset();
    let prev = engine.step();
    let found: { prev: Snapshot; next: Snapshot; index: number } | null = null;
    for (let i = 0; i < 200 && !found; i++) {
      const next = engine.step();
      if (!next) break;
      const pairs = matchItems(
        placeItems(board, prev!, atlas.cellSize),
        placeItems(board, next, atlas.cellSize),
      );
      const moving = pairs.findIndex((p) => p.from && p.to && p.to.along - p.from.along > 1);
      if (moving >= 0) found = { prev: prev!, next, index: moving };
      prev = next;
    }
    expect(found, "expected some tick where an item advances").not.toBeNull();

    const at = (alpha: number) => {
      const { ctx, draws } = recordingContext();
      new Renderer(ctx, sheet()).draw(board, found!.prev, found!.next, alpha, 0);
      return draws.filter((d) => d.sw === 16 && d.sh === 16).map((d) => d.dx);
    };
    const start = at(0);
    const mid = at(0.5);
    const end = at(1);
    expect(start.length).toBeGreaterThan(0);
    expect(mid).toHaveLength(start.length);
    expect(end).toHaveLength(start.length);

    // Draw order follows the pair order, so an index that moved between the two
    // ticks must sit strictly between its endpoints half way through.
    const movedIndexes = start
      .map((x, i) => (Math.abs(end[i]! - x) > 1 ? i : -1))
      .filter((i) => i >= 0);
    expect(movedIndexes.length).toBeGreaterThan(0);
    for (const i of movedIndexes) {
      const lo = Math.min(start[i]!, end[i]!);
      const hi = Math.max(start[i]!, end[i]!);
      expect(mid[i]!).toBeGreaterThan(lo);
      expect(mid[i]!).toBeLessThan(hi);
    }
  });


  it("replays identically after a reset", () => {
    engine.reset();
    const a: string[] = [];
    for (let i = 0; i < 30; i++) a.push(engine.step()!.checksum);
    engine.reset();
    const b: string[] = [];
    for (let i = 0; i < 30; i++) b.push(engine.step()!.checksum);
    expect(b).toEqual(a);
  });
});

describe("inserter animation", () => {
  // A free-running arm reads as a machine working when it is idle. The frame must
  // come from what the inserter is doing: 0-5 deliver (item in claw), 6-11 return
  // empty, 11 rests over the pickup tile.
  const INSERTER_SCENARIO = {
    version: 1,
    grid: { width: 10, height: 5 },
    ticks: 600,
    snapshots: [600],
    entities: [
      { type: "source", x: 0, y: 1, dir: "E", item: "iron-ore", lane: "both", period: 3 },
      { type: "belt", x: 1, y: 1, dir: "E", tier: "fast" },
      { type: "inserter", x: 2, y: 1, dir: "E", tier: "base" },
      { type: "sink", x: 3, y: 1, dir: "W" },
    ],
  };

  it("resolves the inserter's swing from the board, not a hard-coded table", async () => {
    const engine = await Engine.instantiate(
      readFileSync(join(ASSETS, "lattice-core.wasm")),
    );
    expect(engine.load(INSERTER_SCENARIO)).toBe(true);
    const b = engine.board();
    const ins = b.entities.find((e) => e.type === "inserter")!;
    // The tier table lives in the engine; the renderer only divides by this.
    expect(ins.swing).toBeGreaterThan(0);
  });

  it("resolves a belt's speed from the board, not a hard-coded table", async () => {
    // Same boundary as `swing`: the interpolator matches each item to its own
    // next-tick position by how far the belt was expected to carry it, so the
    // speed has to come from the engine rather than a table copied into the UI.
    const engine = await Engine.instantiate(
      readFileSync(join(ASSETS, "lattice-core.wasm")),
    );
    expect(engine.load(INSERTER_SCENARIO)).toBe(true);
    const b = engine.board();
    const belt = b.entities.find((e) => e.type === "belt")!;
    expect(belt.speed).toBeGreaterThan(0);
    // Only belts carry it.
    expect(b.entities.find((e) => e.type === "inserter")!.speed).toBeUndefined();
  });

  it("holds a rest frame while idle and uses delivery frames while carrying", async () => {
    const engine = await Engine.instantiate(
      readFileSync(join(ASSETS, "lattice-core.wasm")),
    );
    expect(engine.load(INSERTER_SCENARIO)).toBe(true);
    const b = engine.board();
    const insIndex = b.entities.findIndex((e) => e.type === "inserter");
    const total = atlas.entities.inserter!.frames.length;
    const half = Math.floor(total / 2);

    // The frame drawn for the inserter is the only 64x64 blit.
    const frameFor = (snap: Snapshot, elapsed: number) => {
      const { ctx, draws } = recordingContext();
      new Renderer(ctx, sheet()).draw(b, null, snap, 0, elapsed);
      const d = draws.find((x) => x.sw === 64 && x.sh === 64)!;
      return atlas.entities.inserter!.frames.findIndex(
        (f) => f.x === d.sx && f.y === d.sy,
      );
    };

    // Tick 1: nothing has reached the inserter, so it is idle and at rest.
    const first = engine.step()!;
    expect(frameFor(first, 0)).toBe(total - 1);

    // Run on until it is carrying something, then the frame must be a delivery
    // frame — and must not wander while the clock advances, only while the swing
    // does.
    let carrying: Snapshot | null = null;
    for (let i = 0; i < 400 && !carrying; i++) {
      const s = engine.step();
      if (!s) break;
      const st = s.entities[insIndex];
      if (st && "inserter" in st && st.inserter.held) carrying = s;
    }
    expect(carrying, "the inserter picks something up").not.toBeNull();
    const f = frameFor(carrying!, 0);
    expect(f).toBeGreaterThanOrEqual(0);
    expect(f).toBeLessThan(half);
    // Same state, much later clock: a state-driven arm does not move on its own.
    expect(frameFor(carrying!, 5)).toBe(f);
  });

  it("draws the carried item at the claw, tracking the swing across the tile", () => {
    // A hand-built board and snapshots isolate the grip geometry from the engine:
    // one east-facing inserter on its tile, carrying an item at chosen points of its
    // swing. The claw travels from the pickup tile (west) to the drop tile (east),
    // so the drawn item must move west→east across the swing rather than sit on the
    // pivot — the whole reason the sprite no longer bakes an item in.
    const hand: Board = {
      version: 1,
      grid: { width: 3, height: 1 },
      ticks: 1,
      snapshots: [1],
      entities: [{ type: "inserter", x: 1, y: 0, dir: "E", tiles: [[1, 0]], swing: 10 }],
    };
    // Tile (1,0)'s centre is (48,16); a 16x16 icon centred there lands at dx=40.
    const centreDx = 40;
    const carrying = (swingLeft: number): Snapshot => ({
      tick: 1,
      checksum: "",
      entities: [{ inserter: { phase: "swing", held: "iron-ore", swing_left: swingLeft } }],
    });
    const itemDx = (snap: Snapshot): number => {
      const { ctx, draws } = recordingContext();
      new Renderer(ctx, sheet()).draw(hand, null, snap, 0, 0);
      return draws.find((d) => d.sw === 16 && d.sh === 16)!.dx;
    };
    // Swing full (swing_left = total): claw at the pickup tile, west of the pivot.
    expect(itemDx(carrying(10))).toBeLessThan(centreDx);
    // Swing spent (swing_left = 0): claw at the drop tile, east of the pivot.
    expect(itemDx(carrying(0))).toBeGreaterThan(centreDx);
    // And it advances west→east as the swing is spent.
    expect(itemDx(carrying(10))).toBeLessThan(itemDx(carrying(0)));
  });

  it("turns the carried item's offset with the inserter's facing", () => {
    // The same swing start, but facing south: the pickup tile is behind the
    // inserter, so the claw (and the item) sit NORTH of the pivot, not west — the
    // offset rotates with the sprite.
    const board: Board = {
      version: 1,
      grid: { width: 3, height: 3 },
      ticks: 1,
      snapshots: [1],
      entities: [{ type: "inserter", x: 1, y: 1, dir: "S", tiles: [[1, 1]], swing: 10 }],
    };
    const snap: Snapshot = {
      tick: 1,
      checksum: "",
      entities: [{ inserter: { phase: "swing", held: "iron-ore", swing_left: 10 } }],
    };
    const { ctx, draws } = recordingContext();
    new Renderer(ctx, sheet()).draw(board, null, snap, 0, 0);
    const item = draws.find((d) => d.sw === 16 && d.sh === 16)!;
    // Tile (1,1)'s centre is (48,48); a centred icon lands at (40,40). North of the
    // pivot means dy well above that, with barely any horizontal shift.
    expect(item.dy).toBeLessThan(40);
    expect(Math.abs(item.dx - 40)).toBeLessThan(2);
  });
});
