import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Drift guard for the vendored Lattice playback assets.
//
// The UI bundles its own copy of the case's playback engine + sprite atlas so
// every host replays a run identically without fetching the case bundle. That copy
// is a vendored snapshot, and the two silently drifting matters more here than
// almost anywhere else: the wasm IS the simulation, so a stale engine would draw a
// factory that never happened while the run's recorded checksums said otherwise.
//
// These assets are pure data, so lockstep is cheap to enforce: each must be
// byte-identical to the bundle's. The renderer is a hand TS port and cannot be
// byte-compared — but a renderer rework in practice always reshapes the atlas (new
// frames, rates, offsets), so guarding the assets catches the drift that matters.
// Resync with:
//   node scripts/vendor-lattice-assets.mjs

const here = dirname(fileURLToPath(import.meta.url));
// here = packages/ui/src/app/pages/runs/lattice  ->  repo root is seven levels up.
const repoRoot = join(here, "..", "..", "..", "..", "..", "..", "..");

const BUNDLE = join(
  repoRoot,
  "test-cases/performance/hard/lattice/v1.0.0/replay/assets",
);
const CASES = join(
  repoRoot,
  "test-cases/performance/hard/lattice/v1.0.0/cases",
);
const VENDORED = join(here, "assets");

// Kept in sync with scripts/vendor-lattice-assets.mjs (the renderer is excluded —
// it is a manual port, not a copy).
const VENDORED_ASSETS = [
  "lattice-core.wasm",
  "sheet.png",
  "sheet.json",
  "reference-small.json",
  "reference-medium.json",
  "reference-large.json",
];

describe("vendored lattice assets", () => {
  for (const name of VENDORED_ASSETS) {
    it(`${name} matches the case bundle byte-for-byte`, () => {
      const bundle = readFileSync(join(BUNDLE, name));
      const vendored = readFileSync(join(VENDORED, name));
      expect(
        vendored.equals(bundle),
        `packages/ui/.../lattice/assets/${name} is stale vs the case bundle. ` +
          `Resync: node scripts/vendor-lattice-assets.mjs`,
      ).toBe(true);
    });
  }
});

// The Reference tab plays these three through the vendored engine. They are the
// SCORED scenarios with their timelines windowed (see the bundle's
// `gen-reference.mjs`), and the tab's whole claim is that a reader is watching the
// factory a run is actually graded on. Guard both halves of that claim: the layout
// must be the scored one, and the window must be playable.
describe("lattice reference scenarios", () => {
  interface Scenario {
    version: number;
    grid: { width: number; height: number };
    ticks: number;
    snapshots: number[];
    entities: unknown[];
  }
  const read = (path: string): Scenario =>
    JSON.parse(readFileSync(path, "utf8")) as Scenario;

  // Mirrors `PLAYBACK_WINDOW_TICKS` in `crates/lattice-sdk/src/lib.rs`, which bounds
  // a submission's playback. The reference is cut to the same window so the two are
  // watched over identical ticks — a run's factory and the reference's are directly
  // comparable only if they cover the same stretch.
  const WINDOW_TICKS = 2500;

  for (const name of ["small", "medium", "large"]) {
    describe(name, () => {
      const reference = read(join(VENDORED, `reference-${name}.json`));
      const scored = read(join(CASES, `${name}.json`));

      it("is the scored layout, entity for entity", () => {
        // The point of playing the scored scenarios rather than fresh ones: what a
        // reader sees IS the graded factory. A crop or a re-seed would quietly break
        // that, and nothing else would notice.
        expect(reference.version).toBe(scored.version);
        expect(reference.grid).toEqual(scored.grid);
        expect(reference.entities).toEqual(scored.entities);
      });

      it("is windowed to a length the browser can hold", () => {
        // The reference engine's playback driver emits a full canonical state EVERY
        // tick with no cap of its own, so an unwindowed scored scenario (50k-360k
        // ticks) would exhaust the tab. The cut happens in the committed file.
        expect(scored.ticks).toBeGreaterThan(WINDOW_TICKS);
        expect(reference.ticks).toBe(WINDOW_TICKS);
      });

      it("keeps a snapshot schedule the engine will accept", () => {
        // `Scenario::parse` rejects a schedule that is empty, out of order, or
        // outside `1..=ticks` — and a rejected scenario fails the load with no
        // diagnostic beyond "the engine rejected this scenario". The committed
        // schedule ends at the SCORED tick, so windowing has to rewrite it.
        expect(reference.snapshots.length).toBeGreaterThan(0);
        for (const tick of reference.snapshots) {
          expect(tick).toBeGreaterThanOrEqual(1);
          expect(tick).toBeLessThanOrEqual(reference.ticks);
        }
        const ascending = [...reference.snapshots].sort((a, b) => a - b);
        expect(reference.snapshots).toEqual(ascending);
        expect(new Set(reference.snapshots).size).toBe(
          reference.snapshots.length,
        );
      });
    });
  }
});

// The atlas is what couples the engine's canonical state to the art, so guard the
// couplings a renderer would otherwise have to assume. These mirror facts verified
// against the engine (`World::footprints()`), not preferences.
describe("lattice atlas contract", () => {
  const atlas = JSON.parse(
    readFileSync(join(VENDORED, "sheet.json"), "utf8"),
  ) as {
    cellSize: number;
    sheet: { width: number; height: number };
    entities: Record<
      string,
      {
        frames: { x: number; y: number; w: number; h: number }[];
        fps: number;
        cells: [number, number];
        offset: [number, number];
        rotatable: boolean;
      }
    >;
    items: { frames: unknown[]; ids: string[] };
  };

  // Indexed lookups are `T | undefined` here, and a missing entity should fail as
  // "the atlas lost the inserter", not as an inscrutable undefined-property error.
  const entity = (name: string) => {
    const found = atlas.entities[name];
    if (!found) throw new Error(`atlas is missing entity "${name}"`);
    return found;
  };

  it("declares every placed entity the simulation can render", () => {
    expect(Object.keys(atlas.entities).sort()).toEqual([
      "assembler",
      "belt",
      "furnace",
      "inserter",
      "lane-splitter",
      "sink",
      "source",
      "splitter",
    ]);
  });

  it("registers sprites to the 32px simulation cell", () => {
    expect(atlas.cellSize).toBe(32);
    // A splitter covers two cells across its flow; an assembler is 3x3. Both
    // anchor at their top-left cell, so they need no offset.
    expect(entity("splitter").cells).toEqual([1, 2]);
    expect(entity("assembler").cells).toEqual([3, 3]);
    expect(entity("assembler").offset).toEqual([0, 0]);
    // The inserter occupies ONE cell but is drawn 64x64, so it is centred on its
    // anchor and overhangs by half a cell on each side.
    expect(entity("inserter").cells).toEqual([1, 1]);
    expect(entity("inserter").offset).toEqual([-16, -16]);
  });

  it("marks the assembler non-rotatable and the rest rotatable", () => {
    // Flat ground entities are drawn facing east and rotated by the renderer; the
    // assembler is a symmetric square machine with no facing.
    expect(entity("assembler").rotatable).toBe(false);
    for (const name of ["belt", "splitter", "lane-splitter", "inserter", "source", "sink"]) {
      expect(entity(name).rotatable).toBe(true);
    }
  });

  it("keeps item icons in the engine's canonical item order", () => {
    // Frame index IS the engine's item index, so the renderer indexes straight
    // from a belt's canonical state. Reordering these breaks that silently.
    // Frames 0-6 are the engine's items; 7-15 are provisional machine icons the
    // engine's recipe phase must reuse in this exact order, and 16 is coal, a
    // provisional base material appended last (the engine's table stops at 15 today).
    expect(atlas.items.ids).toEqual([
      "iron-ore",
      "iron-plate",
      "iron-gear",
      "copper-ore",
      "copper-plate",
      "copper-cable",
      "circuit",
      "transport-belt",
      "fast-transport-belt",
      "express-transport-belt",
      "assembler",
      "fast-assembler",
      "express-assembler",
      "inserter",
      "fast-inserter",
      "express-inserter",
      "coal",
    ]);
    expect(atlas.items.frames).toHaveLength(atlas.items.ids.length);
  });

  it("carries the belt/inserter/assembler upgrade tiers", () => {
    // The tiered entities each declare three tiers of frame indices; the renderer
    // picks one and plays it at that tier's own rate. The untiered entities do not.
    const tiers = (name: string) =>
      (
        atlas.entities[name] as {
          tiers?: { fps: number; loop: number[]; curve?: number[] }[];
        }
      ).tiers;
    expect(tiers("belt")?.map((t) => t.fps)).toEqual([12, 16, 20]);
    // Each belt tier is a straight loop plus a parallel curve loop.
    for (const t of tiers("belt")!) {
      expect(t.loop).toHaveLength(8);
      expect(t.curve).toHaveLength(8);
    }
    expect(tiers("inserter")?.map((t) => t.fps)).toEqual([12, 16, 20]);
    expect(tiers("inserter")!.every((t) => t.loop.length === 12)).toBe(true);
    expect(tiers("assembler")?.map((t) => t.fps)).toEqual([8, 11, 13]);
    expect(tiers("assembler")!.every((t) => t.loop.length === 8)).toBe(true);
    // The single-tier entities stay flat.
    expect(tiers("splitter")).toBeUndefined();
    expect(tiers("source")).toBeUndefined();
    expect(tiers("sink")).toBeUndefined();
    expect(tiers("furnace")).toBeUndefined();
  });

  it("carries the furnace's off and smelting states", () => {
    // The furnace is untiered but has two named working-state loops rather than one
    // flat cycle: the renderer plays `off` while idle and `smelting` while working,
    // each at its own rate. (Provisional — the engine places no furnace yet.)
    const furnace = atlas.entities.furnace as {
      cells: [number, number];
      rotatable: boolean;
      states?: Record<string, { fps: number; loop: number[] }>;
    };
    expect(furnace.cells).toEqual([2, 2]);
    expect(furnace.rotatable).toBe(false);
    expect(furnace.states?.off).toEqual({ fps: 6, loop: [0, 1, 2, 3] });
    expect(furnace.states?.smelting).toEqual({
      fps: 12,
      loop: [4, 5, 6, 7, 8, 9, 10, 11],
    });
  });

  it("keeps every frame inside the sheet", () => {
    const all = [
      ...Object.values(atlas.entities).flatMap((e) => e.frames),
      ...(atlas.items.frames as {
        x: number;
        y: number;
        w: number;
        h: number;
      }[]),
    ];
    expect(all.length).toBe(165);
    for (const r of all) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(atlas.sheet.width);
      expect(r.y + r.h).toBeLessThanOrEqual(atlas.sheet.height);
    }
  });
});
