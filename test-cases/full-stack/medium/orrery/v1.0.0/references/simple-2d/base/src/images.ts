// Orrery — the decoded sprites the drawing asks for (specs/assets.md).
//
// The drawing asks for a PATH — the one `src/constants.ts` names the sprite
// under — and is handed either the decoded image or `null`. `null` is a
// first-class answer: a file this build never produced, a path the engine's
// loader refused, and an image that would not decode all arrive here the same
// way, and each leaves the game running, because the drawing code falls back
// to what it draws in code.
//
// The store is module-level because `OrreryState` is fixed by `specs/state.md`
// and holds no assets, and because `render` is handed nothing but the state
// and the engine's `RenderApi`. It is set once, from `initialize`, before the
// first frame; nothing reads it before that and nothing writes it after, so it
// is a constant for the life of the engine rather than something a frame
// carries. `installSprites` replaces it wholesale, which is what a test that
// stands up a second engine does.

/** What the drawing code asks of the loaded sprites. */
export interface Sprites {
  /** The decoded sprite at a path under the asset root, or `null`. */
  get(path: string): CanvasImageSource | null;
}

/** A store holding nothing, which is what a failed load leaves. */
export const NO_SPRITES: Sprites = { get: () => null };

/** The decoded set, held by the path each sprite was loaded under. */
export class SpriteStore implements Sprites {
  private readonly decoded: ReadonlyMap<string, CanvasImageSource>;

  constructor(decoded: ReadonlyMap<string, CanvasImageSource> = new Map()) {
    this.decoded = decoded;
  }

  /** The decoded sprite at a path, or `null` when it is not there. */
  get(path: string): CanvasImageSource | null {
    return this.decoded.get(path) ?? null;
  }

  /** How many sprites decoded, which the diagnostics overlay reports. */
  get size(): number {
    return this.decoded.size;
  }
}

/** The set the frames draw with, until `initialize` installs the produced one. */
let installed: Sprites = NO_SPRITES;

/** Install the decoded set. Called once, from `initialize`. */
export function installSprites(sprites: Sprites): void {
  installed = sprites;
}

/** The decoded set the frame draws with. */
export function sprites(): Sprites {
  return installed;
}
