// Wireworm — the seeded art, loaded through the engine's asset loader.
//
// `specs/assets.md` seeds six folders under `assets/`, one 32x32 PNG per frame
// named by its frame index, and the engine resolves every path under that one
// root relative to the page the build is served from. The game instance's
// `initialize` loads them all, once, and holds the decoded frames here: they are
// immutable art rather than game state, they outlive every world, and the engine
// documents this as where a loaded asset is kept.
//
// A frame that did not arrive is held as `null` rather than failing the build.
// The engine reports a host with no image decoding by name, and a game that let
// that rejection escape `initialize` would run no frame at all; `src/render.ts`
// draws every element from its folder where the folder arrived and from shapes
// in code where it did not, so the game still plays.

import type { InitApi } from "@clockwyrks/structured-2d";
import {
  CORRUPTOR_FRAMES,
  CURSOR_FRAMES,
  DROPPER_FRAMES,
  GLITCH_FRAMES,
  NODE_FRAMES,
  WORM_FRAMES,
} from "./constants";

/** One frame of one folder, or `null` where it did not arrive. */
export type Frame = ImageBitmap | null;

/** The six folders, each a dense array indexed by frame number. */
export interface Art {
  readonly node: readonly Frame[];
  readonly worm: readonly Frame[];
  readonly cursor: readonly Frame[];
  readonly glitch: readonly Frame[];
  readonly dropper: readonly Frame[];
  readonly corruptor: readonly Frame[];
}

/** Each folder under the asset root and how many frames it holds. */
const FOLDERS = {
  node: { folder: "node", frames: NODE_FRAMES },
  worm: { folder: "worm", frames: WORM_FRAMES },
  cursor: { folder: "cursor", frames: CURSOR_FRAMES },
  glitch: { folder: "glitch", frames: GLITCH_FRAMES },
  dropper: { folder: "dropper", frames: DROPPER_FRAMES },
  corruptor: { folder: "corruptor", frames: CORRUPTOR_FRAMES },
} as const satisfies Record<keyof Art, { folder: string; frames: number }>;

function empty(): Art {
  const blank = (count: number): Frame[] => new Array<Frame>(count).fill(null);
  return {
    node: blank(FOLDERS.node.frames),
    worm: blank(FOLDERS.worm.frames),
    cursor: blank(FOLDERS.cursor.frames),
    glitch: blank(FOLDERS.glitch.frames),
    dropper: blank(FOLDERS.dropper.frames),
    corruptor: blank(FOLDERS.corruptor.frames),
  };
}

let held: Art = empty();

/** The frames the load produced, ready to draw. */
export function art(): Art {
  return held;
}

async function loadFolder(
  assets: InitApi["assets"],
  folder: string,
  frames: number,
): Promise<Frame[]> {
  return Promise.all(
    Array.from({ length: frames }, (_unused, index) =>
      assets.loadImage(`${folder}/${index}.png`).catch(() => null),
    ),
  );
}

/**
 * Load every frame of every folder, writing each path relative to the asset
 * root. A frame the host cannot fetch or decode is held as `null`.
 */
export async function loadArt(assets: InitApi["assets"]): Promise<void> {
  const names = Object.keys(FOLDERS) as (keyof Art)[];
  const loaded = await Promise.all(
    names.map((name) =>
      loadFolder(assets, FOLDERS[name].folder, FOLDERS[name].frames),
    ),
  );
  const next = empty() as Record<keyof Art, Frame[]>;
  names.forEach((name, index) => {
    next[name] = loaded[index];
  });
  held = next;
}
