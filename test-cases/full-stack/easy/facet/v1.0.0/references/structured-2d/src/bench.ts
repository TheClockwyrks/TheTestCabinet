// Facet — the bench: the one actor the level declares, its two draw layers, and
// the presentation layer they draw.
//
// Rendering belongs to the engine's pipeline: it collects every enabled,
// visible render component, orders it by layer, and calls each in turn. The
// bench holds two `DrawComponent`s — the field layer under the screen layer —
// and each `draw` is a pure read of the world's `FacetState` through the
// functions in `src/render.ts`, writing nothing back (specs/state.md, The
// contract). The context a `DrawComponent` receives already carries the
// world-to-device transform, and the game leaves the camera at rest, so the
// drawing runs in world units that coincide with the stage's logical units.
//
// The produced sprites are pixel art drawn at native size, so both layers clear
// `imageSmoothingEnabled` before they draw and restore the context after
// (specs/assets.md, Sprites).
//
// The actor holds no authoritative state. What it does hold is the
// PRESENTATION: the break sheets and particle bursts a chain throws, the aura
// every cut stone carries, and the clock a freshly dealt board pours on, all of
// which are decoration deliberately kept out of the state (`src/effects.ts`).
// It ages them in its own tick — actors tick before the game mode, so a burst
// the mode spawns this frame is drawn at age zero and first aged on the next —
// and `FacetMode.tick` reaches it through `world.find(Bench)` to hand it what
// the frame's transitions threw and to bring its auras level with the board.

import { Actor, DrawComponent } from "@test-cabinet/structured-2d";
import type { DrawApi } from "@test-cabinet/structured-2d";
import { assets } from "./assets";
import { domScratch, Presentation } from "./effects";
import { facetState } from "./game";
import { renderBoardLayer, renderUiLayer } from "./render";

/** The bench's own layers, numbered in one place and left with room between. */
export const LAYER = { field: 0, screen: 10 } as const;

/** The lower layer: the field, the board, the stones, and the effects. */
class FieldLayer extends DrawComponent {
  constructor() {
    super();
    this.layer = LAYER.field;
  }

  draw(api: DrawApi): void {
    const bench = this.actor as Bench;
    api.ctx.save();
    api.ctx.imageSmoothingEnabled = false;
    renderBoardLayer(
      facetState(this.world),
      api.ctx,
      assets(),
      bench.presentation,
    );
    api.ctx.restore();
  }
}

/** The upper layer: the readouts, and the current screen's chrome. */
class ScreenLayer extends DrawComponent {
  constructor() {
    super();
    this.layer = LAYER.screen;
  }

  draw(api: DrawApi): void {
    api.ctx.save();
    api.ctx.imageSmoothingEnabled = false;
    renderUiLayer(facetState(this.world), api.ctx, assets());
    api.ctx.restore();
  }
}

/**
 * The lapidary's bench. The level declares one, at the world origin, and its
 * two layers draw every screen of the game.
 */
export class Bench extends Actor {
  /** Everything decoration puts in motion; see `src/effects.ts`. */
  readonly presentation = new Presentation(domScratch());

  constructor() {
    super();
    this.attach(new FieldLayer());
    this.attach(new ScreenLayer());
  }

  /**
   * Age everything still running by the frame's delta. Actors tick before the
   * game mode, so what this frame's chain spawns is drawn at age zero and is
   * first aged on the next frame.
   */
  override tick(dt: number): void {
    this.presentation.advance(dt);
  }
}
