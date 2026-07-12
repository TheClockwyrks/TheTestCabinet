// Hollowdeep — worldgen: build the starting World from the mode (specs/world.md).
//
// Deterministic from a seed (via src/rng.ts): a bedrock border seals the world, a body of
// dirt with scattered rock and contiguous ORE SEAMS fills the rest, and a modest OPENING
// CAVERN is carved near the top and seeded with the finite pocket of breathable oxygen
// (specs/gas.md). The cavern sits on a solid floor so the crew has ground to stand on, and
// three spawn tiles on that floor are returned for src/sim.ts to place the delvers. Ore
// seams are placed within reach of the cavern so the first dig->refine->build chain is
// achievable before the air runs down (specs/flow.md).

import { Rng } from "./rng";
import { ZOOM_DEFAULT, WORLD_H, WORLD_W } from "./constants";
import type { TileKind, World } from "./types";
import { centerCameraOn, idx, makeTile } from "./world";
import type { ColonyMode } from "./mode";

// The opening cavern: an open box near the top of the world. Open tiles are `[x0,x1] x
// [y0,y1]` inclusive; the row just below (`y1+1`) is left solid as the cavern floor so the
// delvers stand on it. Chosen so there is dirt/rock all around to dig into and ore within
// reach below.
export const CAVERN = { x0: 25, y0: 5, x1: 38, y1: 11 } as const;

export interface GenResult {
  world: World;
  spawns: { tx: number; ty: number }[];
}

function isBorder(tx: number, ty: number): boolean {
  // Cols 0 & w-1, the bottom row, and the top two cap rows are the indestructible seal.
  return tx === 0 || tx === WORLD_W - 1 || ty === WORLD_H - 1 || ty <= 1;
}

export function generateWorld(mode: ColonyMode, seed: number): GenResult {
  const rng = new Rng(seed);
  const w = WORLD_W;
  const h = WORLD_H;
  const tiles = new Array(w * h);

  // 1. Base fill: bedrock border, dirt everywhere else.
  for (let ty = 0; ty < h; ty++) {
    for (let tx = 0; tx < w; tx++) {
      const kind: TileKind = isBorder(tx, ty) ? "bedrock" : "dirt";
      tiles[idx(w, tx, ty)] = makeTile(kind);
    }
  }

  const set = (tx: number, ty: number, kind: TileKind): void => {
    if (isBorder(tx, ty)) return; // never overwrite the seal
    tiles[idx(w, tx, ty)]!.kind = kind;
  };
  const kindOf = (tx: number, ty: number): TileKind => tiles[idx(w, tx, ty)]!.kind;

  // 2. Rock patches: a handful of dense blobs, mostly in the deeper rows, gating expansion.
  const rockBlobs = 26;
  for (let i = 0; i < rockBlobs; i++) {
    const cx = rng.int(2, w - 3);
    const cy = rng.int(14, h - 3);
    const rw = rng.int(1, 3);
    const rh = rng.int(1, 3);
    for (let dy = -rh; dy <= rh; dy++) {
      for (let dx = -rw; dx <= rw; dx++) {
        if (rng.next() < 0.35) continue; // ragged edges
        const tx = cx + dx;
        const ty = cy + dy;
        if (tx > 0 && tx < w - 1 && ty > 1 && ty < h - 1 && kindOf(tx, ty) === "dirt") {
          set(tx, ty, "rock");
        }
      }
    }
  }

  // 3. Ore seams: contiguous runs (not scattered singles), several within reach of the
  //    cavern, some deeper. Each ore tile yields 2..4 ore.
  const seams = 7;
  for (let i = 0; i < seams; i++) {
    const near = i < 4; // the first few sit close under/around the cavern
    let tx = near ? rng.int(CAVERN.x0 - 4, CAVERN.x1 + 4) : rng.int(3, w - 4);
    let ty = near ? rng.int(CAVERN.y1 + 2, CAVERN.y1 + 9) : rng.int(16, h - 4);
    const len = rng.int(4, 7);
    const horizontal = rng.next() < 0.5;
    for (let s = 0; s < len; s++) {
      if (tx > 0 && tx < w - 1 && ty > 1 && ty < h - 1) {
        const k = kindOf(tx, ty);
        if (k === "dirt" || k === "rock") {
          set(tx, ty, "ore");
          tiles[idx(w, tx, ty)]!.oreRich = rng.int(2, 4);
        }
      }
      // wander the seam so it reads as a natural vein
      if (horizontal) {
        tx += 1;
        ty += rng.next() < 0.4 ? (rng.next() < 0.5 ? 1 : -1) : 0;
      } else {
        ty += 1;
        tx += rng.next() < 0.4 ? (rng.next() < 0.5 ? 1 : -1) : 0;
      }
    }
  }

  // 4. Carve the opening cavern and seed its oxygen pocket. Leave the row below solid as
  //    the floor the delvers stand on.
  for (let ty = CAVERN.y0; ty <= CAVERN.y1; ty++) {
    for (let tx = CAVERN.x0; tx <= CAVERN.x1; tx++) {
      set(tx, ty, "open");
      const t = tiles[idx(w, tx, ty)]!;
      if (t.kind === "open") {
        t.oxygen = mode.startOxygen;
        t.co2 = mode.startCo2;
        t.oreRich = 0;
      }
    }
  }
  // Guarantee a solid floor directly beneath the cavern's open floor row.
  for (let tx = CAVERN.x0; tx <= CAVERN.x1; tx++) {
    if (kindOf(tx, CAVERN.y1 + 1) === "open") set(tx, CAVERN.y1 + 1, "dirt");
  }

  const world: World = {
    w,
    h,
    tiles,
    machines: [],
    farms: [],
    refineries: [],
    camera: { x: 0, y: 0, zoom: ZOOM_DEFAULT },
  };

  // 5. Spawn tiles: on the cavern floor row (open tiles standing on the solid floor),
  //    spread across the middle so the crew starts together but not stacked.
  const floorRow = CAVERN.y1;
  const mid = Math.floor((CAVERN.x0 + CAVERN.x1) / 2);
  const spawns: { tx: number; ty: number }[] = [];
  const offsets = [-2, 0, 2, -4, 4, -1, 1];
  for (let i = 0; i < mode.delverCount; i++) {
    const off = offsets[i % offsets.length]!;
    spawns.push({ tx: mid + off, ty: floorRow });
  }

  // Center the camera on the cavern so the crew and their opening space show on load.
  centerCameraOn(world, mid, Math.floor((CAVERN.y0 + CAVERN.y1) / 2));

  return { world, spawns };
}
