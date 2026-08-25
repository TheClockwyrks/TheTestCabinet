// Refract — the bench: the one actor the level declares, and the draw
// components that render the game.
//
// Rendering belongs to the engine's pipeline: it collects every enabled,
// visible render component, orders it by layer, and calls each in turn. The
// bench holds two `DrawComponent`s — the board layer under the UI layer — and
// each `draw` is a pure read of the world's `RefractState` through the
// functions in `src/render.ts`, writing nothing back (specs/state.md, The
// contract). The context a `DrawComponent` receives already carries the
// world-to-device transform, and the game leaves the camera at rest, so the
// drawing runs in world units that coincide with the stage's logical units.
//
// The actor holds no authoritative state of its own: everything it draws is
// read off the world's game state at the call, so the picture is the frame
// this tick produced.

import { Actor, DrawComponent } from "@test-cabinet/structured-2d";
import type { DrawApi } from "@test-cabinet/structured-2d";
import { refractState } from "./game";
import { renderBoardLayer, renderUiLayer } from "./render";

/** The lower layer: the bench glow, the board, and the beams drawn on it. */
class BoardLayer extends DrawComponent {
  draw(api: DrawApi): void {
    renderBoardLayer(refractState(this.actor.world), api.ctx);
  }
}

/** The upper layer: the current screen's chrome, menus, and overlays. */
class UiLayer extends DrawComponent {
  constructor() {
    super();
    this.layer = 1;
  }

  draw(api: DrawApi): void {
    renderUiLayer(refractState(this.actor.world), api.ctx);
  }
}

/**
 * The optical bench. The level declares one, at the world origin, and its two
 * layers draw every screen of the game.
 */
export class Bench extends Actor {
  constructor() {
    super();
    this.attach(new BoardLayer());
    this.attach(new UiLayer());
  }
}
