import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { Engine, Renderer, type Atlas, type Board, type Sheet, type Snapshot } from "./renderer";
import { matchItems, placeItems } from "./interpolate";
import { ChecksumVerifier, type RecordedCheck } from "./verify";

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

  it("reports no motion while a belt is backed up", () => {
    // A congested lane holds its items at minimum spacing and they genuinely do
    // not advance. The matcher must report that honestly rather than manufacturing
    // movement — inventing motion here would be as wrong as the frozen-belt bug
    // interpolation exists to prevent.
    engine.reset();
    let prev: Snapshot | null = null;
    let next: Snapshot | null = null;
    for (let i = 0; i < 60; i++) prev = engine.step();
    next = engine.step();
    const pairs = matchItems(
      placeItems(board, prev!, atlas.cellSize),
      placeItems(board, next!, atlas.cellSize),
    );
    const matched = pairs.filter((p) => p.from && p.to);
    expect(matched.length).toBeGreaterThan(0);
    // This scenario's splitter has only one output belt, so the line stalls.
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

  it("verifies a replay against the checksums a run recorded", () => {
    // The whole point of Phase 5: playback proves it is drawing the graded run's
    // factory. Here the "recorded" checksums stand in for a run record's — and
    // because a correct run's checksums ARE the engine's, replaying reproduces
    // them exactly.
    engine.reset();
    const recorded: RecordedCheck[] = [];
    for (let i = 0; i < board.ticks; i++) {
      const snap = engine.step();
      if (!snap) break;
      if (board.snapshots.includes(snap.tick)) {
        recorded.push({ tick: snap.tick, checksum: snap.checksum });
      }
    }
    expect(recorded).toHaveLength(board.snapshots.length);

    engine.reset();
    const verifier = new ChecksumVerifier(recorded);
    for (let i = 0; i < board.ticks; i++) {
      const snap = engine.step();
      if (!snap) break;
      verifier.observe(snap.tick, snap.checksum);
    }
    expect(verifier.state()).toMatchObject({
      status: "verified",
      matched: recorded.length,
      mismatch: null,
    });
  });

  it("detects a playback engine that has drifted from the graded run", () => {
    // The failure mode the check exists for: a vendored wasm that no longer agrees
    // with the engine that produced the run's numbers.
    engine.reset();
    const stale: RecordedCheck[] = board.snapshots.map((tick) => ({
      tick,
      checksum: "fnv1a64:deadbeefdeadbeef",
    }));
    const verifier = new ChecksumVerifier(stale);
    for (let i = 0; i < board.ticks; i++) {
      const snap = engine.step();
      if (!snap) break;
      verifier.observe(snap.tick, snap.checksum);
    }
    const state = verifier.state();
    expect(state.status).toBe("drifted");
    expect(state.mismatch?.tick).toBe(board.snapshots[0]);
    expect(state.mismatch?.replayed).toMatch(/^fnv1a64:[0-9a-f]{16}$/);
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
