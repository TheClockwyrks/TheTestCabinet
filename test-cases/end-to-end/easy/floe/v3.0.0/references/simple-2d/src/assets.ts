// Floe — the seeded sprite art (`specs/assets.md`).
//
// Seven folders sit under `assets/`, each holding one PNG per frame named by its
// index. They are read through the ENGINE's asset loader, which resolves every
// path under the fixed `assets/` root and against the page the build is served
// from, so the produced site works at a server's root and under a sub-path alike.
// Nothing here builds a URL of its own.
//
// A frame that could not be loaded is kept as `null` rather than failing the whole
// build. The strait is drawn from the art where the art is there and from shapes
// drawn in code where it is not, so the game still runs, still plays and still
// reports its state in a host that cannot decode an image at all — which is
// exactly what the build's own tests run in.

import {
  BEAR_FRAMES,
  CAR_FRAMES,
  CROSSER_FRAMES,
  DOGSLED_FRAMES,
  PAN_FRAMES,
  PLOW_FRAMES,
  RAFT_FRAMES,
} from "./constants";
import type { InitApi } from "@test-cabinet/simple-2d";

/** One folder's frames, in index order. A frame that failed to load is `null`. */
export type Frames = readonly (ImageBitmap | null)[];

/** Every folder the game draws from (`specs/assets.md`). */
export interface Sprites {
  /** Eight frames: a two-frame pair per facing. */
  readonly crosser: Frames;
  /** Eighteen: a four-facing run, a four-facing swim, and a lunge pair. */
  readonly bear: Frames;
  readonly plow: Frames;
  readonly dogsled: Frames;
  readonly car: Frames;
  readonly pan: Frames;
  /** Two: the three-tile raft in the left 96 x 32 of frame 0, the four-tile in 1. */
  readonly raft: Frames;
}

/** The folder each element lives in, and how many frames it holds. */
const FOLDERS = {
  crosser: { folder: "crosser", frames: CROSSER_FRAMES },
  bear: { folder: "bear", frames: BEAR_FRAMES },
  plow: { folder: "plow", frames: PLOW_FRAMES },
  dogsled: { folder: "dogsled", frames: DOGSLED_FRAMES },
  car: { folder: "car", frames: CAR_FRAMES },
  pan: { folder: "pan", frames: PAN_FRAMES },
  raft: { folder: "raft", frames: RAFT_FRAMES },
} as const satisfies Record<
  keyof Sprites,
  { readonly folder: string; readonly frames: number }
>;

/**
 * The first frame of each set of `assets/bear/`, as `specs/assets.md` tabulates
 * them: a run pair and a swim pair per facing, then the lunge pair.
 */
export const BEAR_RUN_FRAME = { down: 0, up: 2, left: 4, right: 6 } as const;
export const BEAR_SWIM_FRAME = {
  down: 8,
  up: 10,
  left: 12,
  right: 14,
} as const;
export const BEAR_LUNGE_FRAME = 16;

/** The first frame of each facing's pair in `assets/crosser/`. */
export const CROSSER_FRAME = { down: 0, up: 2, left: 4, right: 6 } as const;

type Loader = Pick<InitApi<never>["assets"], "loadImage">;

function loadFolder(
  assets: Loader,
  folder: string,
  count: number,
): Promise<Frames> {
  const frames: Promise<ImageBitmap | null>[] = [];
  for (let index = 0; index < count; index += 1) {
    frames.push(assets.loadImage(`${folder}/${index}.png`).catch(() => null));
  }
  return Promise.all(frames);
}

/** Every frame of every folder, loaded once, before the first frame is drawn. */
export async function loadSprites(assets: Loader): Promise<Sprites> {
  const names = Object.keys(FOLDERS) as (keyof Sprites)[];
  const loaded = await Promise.all(
    names.map((name) =>
      loadFolder(assets, FOLDERS[name].folder, FOLDERS[name].frames),
    ),
  );
  const sprites: Partial<Record<keyof Sprites, Frames>> = {};
  names.forEach((name, index) => {
    sprites[name] = loaded[index];
  });
  return sprites as Sprites;
}

/** A sprite set with every frame missing, which is what a headless host gets. */
export function emptySprites(): Sprites {
  const blank = (count: number): Frames => new Array<null>(count).fill(null);
  return {
    crosser: blank(CROSSER_FRAMES),
    bear: blank(BEAR_FRAMES),
    plow: blank(PLOW_FRAMES),
    dogsled: blank(DOGSLED_FRAMES),
    car: blank(CAR_FRAMES),
    pan: blank(PAN_FRAMES),
    raft: blank(RAFT_FRAMES),
  };
}
