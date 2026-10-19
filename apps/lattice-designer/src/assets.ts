// The reused Lattice assets, imported once. The engine is
// `@clockwyrks/lattice-runtime`'s `lattice-core.wasm`; the sprite sheet is the
// console's vendored copy of the case's atlas (aliased as `@lattice-assets`, see
// `vite.config.ts`). Keeping them behind one module means the sim and the grid share
// a single cell size and the same engine + sprite sheet the console ships, so this
// designer draws pixel-identically to a real run's playback.

import type { Atlas } from "@clockwyrks/lattice-runtime";
import wasmUrl from "@clockwyrks/lattice-runtime/lattice-core.wasm?url";
import atlasJson from "@lattice-assets/sheet.json";
import sheetPngUrl from "@lattice-assets/sheet.png?url";

/** The sprite atlas (entity + item frames), typed. */
export const atlas = atlasJson as unknown as Atlas;

/** Pixels per grid tile — the renderer's cell size, used for canvas sizing and
 * pointer-to-tile mapping. */
export const CELL = atlas.cellSize;

export { wasmUrl, sheetPngUrl };
