// The reused Lattice assets, imported once from the console UI package (aliased as
// `@lattice`, see `vite.config.ts`). Keeping them behind one module means the sim
// and the grid share a single cell size and the same vendored `lattice-core.wasm`
// + sprite sheet the console ships, so this designer draws pixel-identically to a
// real run's playback.

import atlasJson from "@lattice/assets/sheet.json";
import wasmUrl from "@lattice/assets/lattice-core.wasm?url";
import sheetPngUrl from "@lattice/assets/sheet.png?url";
import type { Atlas } from "@lattice/renderer";

/** The sprite atlas (entity + item frames), typed. */
export const atlas = atlasJson as unknown as Atlas;

/** Pixels per grid tile — the renderer's cell size, used for canvas sizing and
 * pointer-to-tile mapping. */
export const CELL = atlas.cellSize;

export { wasmUrl, sheetPngUrl };
