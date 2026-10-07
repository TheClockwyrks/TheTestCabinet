// Coil — loading the produced sprite set (specs/assets.md).
//
// The snake's sprites were produced with `draw` and `draw-sheet`, committed under
// `assets/`, and are bundled by the build. Nothing here invokes a binary: the
// build ships the files and loads them, so it runs unchanged wherever the
// generation binaries are absent.
//
// Every path is asked of the ENGINE'S asset loader, relative to the one root it
// resolves under, so the build constructs no URL of its own and the same game
// loads from a served page, from a build output, and from a test process.
//
// A load that fails leaves the game running: the sprite is simply `null`, the
// renderer draws the cell without it, and the game keeps its board, its rules and
// its input. That costs the game its polish rather than its playability.

import { HEAD_FRAMES, SPRITE_PATHS } from "./constants";
import type { InitApi } from "@clockwyrks/structured-2d";

/** The snake's produced sprite set, `null` wherever a file did not arrive. */
export interface SnakeSprites {
  /** The head sheet: frame 0 at rest, then the three frames of the bite. */
  readonly head: readonly (ImageBitmap | null)[];
  readonly body: ImageBitmap | null;
  readonly corner: ImageBitmap | null;
  readonly tail: ImageBitmap | null;
}

/** A sprite set with nothing in it, which is what a failed load leaves behind. */
export const NO_SPRITES: SnakeSprites = {
  head: Array.from({ length: HEAD_FRAMES }, () => null),
  body: null,
  corner: null,
  tail: null,
};

function loadOne(
  api: Pick<InitApi, "assets">,
  path: string,
): Promise<ImageBitmap | null> {
  return api.assets.loadImage(path).catch(() => null);
}

/** Load every produced sprite the renderer draws the snake from. */
export async function loadSprites(
  api: Pick<InitApi, "assets">,
): Promise<SnakeSprites> {
  const [head, body, corner, tail] = await Promise.all([
    Promise.all(SPRITE_PATHS.head.map((path) => loadOne(api, path))),
    loadOne(api, SPRITE_PATHS.body),
    loadOne(api, SPRITE_PATHS.corner),
    loadOne(api, SPRITE_PATHS.tail),
  ]);
  return { head, body, corner, tail };
}
