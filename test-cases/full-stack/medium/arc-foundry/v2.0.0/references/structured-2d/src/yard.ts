// Arc Foundry — the yard: the one actor the level declares, and the draw components
// that render the game.
//
// Rendering belongs to the engine's pipeline: it collects every enabled, visible render
// component, orders it by layer, and calls each in turn. Nothing the pipeline's built-in
// components can state would draw this stage — a tiled substrate under a maze of
// produced sprites, live particle fields composited additively, a panel of controls, and
// eight screens of chrome — so the yard holds two `DrawComponent`s, the yard layer under
// the heads-up layer, and each `draw` is a pure read of the world's `FoundryState`
// through the functions in `src/render.ts`, writing nothing back.
//
// The context a `DrawComponent` receives already carries the world-to-device transform,
// and the game leaves the camera at rest, so the drawing runs in world units that
// coincide with the stage's logical units and no coordinate is converted.
//
// The actor holds no authoritative state of its own: everything it draws is read off the
// world's game state at the call, so the picture is the frame this tick produced.

import { Actor, DrawComponent } from "@test-cabinet/structured-2d";
import type { DrawApi } from "@test-cabinet/structured-2d";
import { renderUiLayer, renderYardLayer } from "./render";
import { foundryState } from "./state";

/** The layers this build draws on, numbered in one place. */
export const LAYER = { yard: 0, hud: 10 } as const;

/** The lower layer: the yard, the Load, the shots, the bursts, and the build cursor. */
class YardLayer extends DrawComponent {
  constructor() {
    super();
    this.layer = LAYER.yard;
  }

  draw(api: DrawApi): void {
    renderYardLayer(foundryState(this.actor.world), api.ctx);
  }
}

/** The upper layer: the status bar, the build panel, the menus, and the overlays. */
class HudLayer extends DrawComponent {
  constructor() {
    super();
    this.layer = LAYER.hud;
  }

  draw(api: DrawApi): void {
    renderUiLayer(foundryState(this.actor.world), api.ctx);
  }
}

/**
 * The substation yard. The level declares one, at the world origin, and its two layers
 * draw every screen of the game.
 */
export class Yard extends Actor {
  constructor() {
    super();
    this.attach(new YardLayer());
    this.attach(new HudLayer());
  }
}
