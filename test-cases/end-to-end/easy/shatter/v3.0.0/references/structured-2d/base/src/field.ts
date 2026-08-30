// Shatter — the field: the one actor the level declares, and the draw
// components that render the game.
//
// Rendering belongs to the engine's pipeline: it collects every enabled,
// visible render component, orders it by layer and calls each in turn. The
// field holds one `DrawComponent` per layer of the picture, and each `draw` is
// a pure read of the world's `ShatterState` through the functions in
// `src/render.ts`, writing nothing back (`specs/state.md`, The contract). The
// order the layers overlap in is therefore the pipeline's, taken from the layer
// table in `src/theme.ts` rather than from the order the calls are written in.
//
// The context a `DrawComponent` receives already carries the world-to-device
// transform, and the game leaves the camera at rest, so the drawing runs in
// world units that coincide with the field's logical units.
//
// The actor holds no authoritative state of its own: everything it draws is
// read off the world's game state at the call, so the picture is the frame this
// tick produced.

import { Actor, DrawComponent } from "@test-cabinet/structured-2d";
import type { DrawApi } from "@test-cabinet/structured-2d";
import { shatterState, type ShatterState } from "./game";
import {
  renderBullets,
  renderHud,
  renderRocks,
  renderSaucer,
  renderScreens,
  renderShip,
  renderSpace,
  renderStar,
} from "./render";
import { LAYER } from "./theme";

/** One layer of the picture, drawn from the live state at its own place. */
abstract class FieldLayer extends DrawComponent {
  constructor(layer: number) {
    super();
    this.layer = layer;
  }

  draw(api: DrawApi): void {
    this.paint(shatterState(this.actor.world), api.ctx);
  }

  protected abstract paint(
    state: ShatterState,
    ctx: CanvasRenderingContext2D,
  ): void;
}

/** Deep space, the ground every other layer is read against. */
class Space extends FieldLayer {
  constructor() {
    super(LAYER.space);
  }

  protected override paint(
    _state: ShatterState,
    ctx: CanvasRenderingContext2D,
  ): void {
    renderSpace(ctx);
  }
}

/** The star fixed at the field's centre, its core and its halo. */
class Star extends FieldLayer {
  constructor() {
    super(LAYER.star);
  }

  protected override paint(
    _state: ShatterState,
    ctx: CanvasRenderingContext2D,
  ): void {
    renderStar(ctx);
  }
}

/** Every rock drifting on the field. */
class Rocks extends FieldLayer {
  constructor() {
    super(LAYER.rocks);
  }

  protected override paint(
    state: ShatterState,
    ctx: CanvasRenderingContext2D,
  ): void {
    renderRocks(state, ctx);
  }
}

/** Every one of the ship's rounds, each with its tail. */
class Bullets extends FieldLayer {
  constructor() {
    super(LAYER.bullets);
  }

  protected override paint(
    state: ShatterState,
    ctx: CanvasRenderingContext2D,
  ): void {
    renderBullets(state, ctx);
  }
}

/** The ship, over the rocks it is threading. */
class Ship extends FieldLayer {
  constructor() {
    super(LAYER.ship);
  }

  protected override paint(
    state: ShatterState,
    ctx: CanvasRenderingContext2D,
  ): void {
    renderShip(state, ctx);
  }
}

/** The saucer while it is visiting, and its fire. */
class Saucer extends FieldLayer {
  constructor() {
    super(LAYER.saucer);
  }

  protected override paint(
    state: ShatterState,
    ctx: CanvasRenderingContext2D,
  ): void {
    renderSaucer(state, ctx);
  }
}

/** The HUD, the wave banner, and the notice an awarded ship raises. */
class Hud extends FieldLayer {
  constructor() {
    super(LAYER.hud);
  }

  protected override paint(
    state: ShatterState,
    ctx: CanvasRenderingContext2D,
  ): void {
    renderHud(state, ctx);
  }
}

/** Whichever of the five screens is up. */
class Screens extends FieldLayer {
  constructor() {
    super(LAYER.screens);
  }

  protected override paint(
    state: ShatterState,
    ctx: CanvasRenderingContext2D,
  ): void {
    renderScreens(state, ctx);
  }
}

/**
 * The field. The level declares one, at the world origin, and its eight layers
 * draw every screen of the game.
 */
export class Field extends Actor {
  constructor() {
    super();
    this.attach(new Space());
    this.attach(new Star());
    this.attach(new Rocks());
    this.attach(new Bullets());
    this.attach(new Ship());
    this.attach(new Saucer());
    this.attach(new Hud());
    this.attach(new Screens());
  }
}
