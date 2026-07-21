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
const VENDORED = join(here, "assets");

// Kept in sync with scripts/vendor-lattice-assets.mjs (the renderer is excluded —
// it is a manual port, not a copy).
const VENDORED_ASSETS = ["lattice-core.wasm", "sheet.png", "sheet.json"];

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
      "inserter",
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
    for (const name of ["belt", "splitter", "inserter", "source", "sink"]) {
      expect(entity(name).rotatable).toBe(true);
    }
  });

  it("keeps item icons in the engine's canonical item order", () => {
    // Frame index IS the engine's item index, so the renderer indexes straight
    // from a belt's canonical state. Reordering these breaks that silently.
    expect(atlas.items.ids).toEqual([
      "iron-ore",
      "iron-plate",
      "iron-gear",
      "copper-ore",
      "copper-plate",
      "copper-cable",
      "circuit",
    ]);
    expect(atlas.items.frames).toHaveLength(atlas.items.ids.length);
  });

  it("keeps every frame inside the sheet", () => {
    const all = [
      ...Object.values(atlas.entities).flatMap((e) => e.frames),
      ...(atlas.items.frames as { x: number; y: number; w: number; h: number }[]),
    ];
    expect(all.length).toBe(55);
    for (const r of all) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(atlas.sheet.width);
      expect(r.y + r.h).toBeLessThanOrEqual(atlas.sheet.height);
    }
  });
});
