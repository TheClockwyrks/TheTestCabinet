// Wireworm — the seeded sprite art (`specs/assets.md`).
//
// Six folders sit under `assets/`, each holding one PNG per frame named by its
// index. They are read through the ENGINE's asset loader, which resolves every
// path under the fixed `assets/` root and against the page the build is served
// from, so the produced site works at a server root and under a sub-path alike.
// Nothing here builds a URL of its own.
//
// A frame that could not be loaded is kept as `null` rather than failing the
// whole build. The board is drawn from the art where the art is there and from
// shapes drawn in code where it is not, so the game still runs, still plays and
// still reports its state in a host that cannot decode an image at all, which is
// exactly what the build's own tests run in.

import {
  CORRUPTOR_FRAMES,
  CURSOR_FRAMES,
  DROPPER_FRAMES,
  GLITCH_FRAMES,
  NODE_FRAMES,
  WORM_FRAMES,
} from "./constants";
import type { InitApi } from "@clockwyrks/simple-2d";

/** One folder's frames, in index order. A frame that failed to load is `null`. */
export type Frames = readonly (ImageBitmap | null)[];

/** Every folder the game draws from (`specs/assets.md`). */
export interface Sprites {
  /** Five frames: one per charge state, plus the alternate critical frame. */
  readonly node: Frames;
  /** Six frames: a two-frame pair each for the head, the body and the tail. */
  readonly worm: Frames;
  readonly cursor: Frames;
  readonly glitch: Frames;
  readonly dropper: Frames;
  readonly corruptor: Frames;
}

/** The folder each element lives in, and how many frames it holds. */
const FOLDERS = {
  node: { folder: "node", frames: NODE_FRAMES },
  worm: { folder: "worm", frames: WORM_FRAMES },
  cursor: { folder: "cursor", frames: CURSOR_FRAMES },
  glitch: { folder: "glitch", frames: GLITCH_FRAMES },
  dropper: { folder: "dropper", frames: DROPPER_FRAMES },
  corruptor: { folder: "corruptor", frames: CORRUPTOR_FRAMES },
} as const satisfies Record<
  keyof Sprites,
  { readonly folder: string; readonly frames: number }
>;

/** The worm's three parts, as the index of the first frame of each pair. */
export const WORM_HEAD_FRAME = 0;
export const WORM_BODY_FRAME = 2;
export const WORM_TAIL_FRAME = 4;

/** The node frame the critical state alternates with. */
export const NODE_CRITICAL_ALT = 4;

type Loader = Pick<InitApi<never>["assets"], "loadImage">;

function loadFolder(
  assets: Loader,
  folder: string,
  count: number,
): Promise<Frames> {
  const frames: Promise<ImageBitmap | null>[] = [];
  for (let i = 0; i < count; i++) {
    frames.push(assets.loadImage(`${folder}/${i}.png`).catch(() => null));
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
    node: blank(NODE_FRAMES),
    worm: blank(WORM_FRAMES),
    cursor: blank(CURSOR_FRAMES),
    glitch: blank(GLITCH_FRAMES),
    dropper: blank(DROPPER_FRAMES),
    corruptor: blank(CORRUPTOR_FRAMES),
  };
}
