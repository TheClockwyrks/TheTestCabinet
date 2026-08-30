// Wireworm — the board: the one actor the level declares, and the draw
// components that render the game.
//
// Rendering belongs to the engine's pipeline: it collects every enabled, visible
// render component, orders it by layer and calls each in turn. The board holds
// one `DrawComponent` per layer of the picture, and each `draw` is a pure read of
// the world's `WirewormState` through the functions in `src/render.ts`, writing
// nothing back (`specs/state.md`, The contract). The order the layers overlap in
// is therefore the pipeline's, taken from the layer table in `src/theme.ts`
// rather than from the order the calls are written in.
//
// The context a `DrawComponent` receives already carries the world-to-device
// transform, and the game leaves the camera at rest, so the drawing runs in world
// units that coincide with the stage's logical units.
//
// The actor holds no authoritative state of its own: everything it draws is read
// off the world's game state at the call, so the picture is the frame this tick
// produced.

import { Actor, DrawComponent } from "@test-cabinet/structured-2d";
import type { DrawApi } from "@test-cabinet/structured-2d";
import { wirewormState, type WirewormState } from "./game";
import {
  renderArcs,
  renderBolts,
  renderCursor,
  renderFoes,
  renderGround,
  renderNodes,
  renderUi,
  renderWorms,
} from "./render";
import { LAYER } from "./theme";

/** One layer of the picture, drawn from the live state at its own place. */
abstract class BoardLayer extends DrawComponent {
  constructor(layer: number) {
    super();
    this.layer = layer;
  }

  draw(api: DrawApi): void {
    this.paint(wirewormState(this.actor.world), api.ctx);
  }

  protected abstract paint(
    state: WirewormState,
    ctx: CanvasRenderingContext2D,
  ): void;
}

/** The substrate, its traces, the player band, and the HUD bar behind it. */
class Ground extends BoardLayer {
  constructor() {
    super(LAYER.ground);
  }

  protected override paint(
    state: WirewormState,
    ctx: CanvasRenderingContext2D,
  ) {
    renderGround(state, ctx);
  }
}

/** Every node standing on the board, at its own charge. */
class Nodes extends BoardLayer {
  constructor() {
    super(LAYER.nodes);
  }

  protected override paint(
    state: WirewormState,
    ctx: CanvasRenderingContext2D,
  ) {
    renderNodes(state, ctx);
  }
}

/** Every worm, over the field it winds through. */
class Worms extends BoardLayer {
  constructor() {
    super(LAYER.worms);
  }

  protected override paint(
    state: WirewormState,
    ctx: CanvasRenderingContext2D,
  ) {
    renderWorms(state, ctx);
  }
}

/** The three support foes. */
class Foes extends BoardLayer {
  constructor() {
    super(LAYER.foes);
  }

  protected override paint(
    state: WirewormState,
    ctx: CanvasRenderingContext2D,
  ) {
    renderFoes(state, ctx);
  }
}

/** Every bolt in flight. */
class Bolts extends BoardLayer {
  constructor() {
    super(LAYER.bolts);
  }

  protected override paint(
    state: WirewormState,
    ctx: CanvasRenderingContext2D,
  ) {
    renderBolts(state, ctx);
  }
}

/** The cursor, inside its band. */
class Cursor extends BoardLayer {
  constructor() {
    super(LAYER.cursor);
  }

  protected override paint(
    state: WirewormState,
    ctx: CanvasRenderingContext2D,
  ) {
    renderCursor(state, ctx);
  }
}

/** The arcs of a live discharge, over everything they cross. */
class Arcs extends BoardLayer {
  constructor() {
    super(LAYER.arcs);
  }

  protected override paint(
    state: WirewormState,
    ctx: CanvasRenderingContext2D,
  ) {
    renderArcs(state, ctx);
  }
}

/** The HUD, the level banner, and whichever screen is up. */
class Ui extends BoardLayer {
  constructor() {
    super(LAYER.ui);
  }

  protected override paint(
    state: WirewormState,
    ctx: CanvasRenderingContext2D,
  ) {
    renderUi(state, ctx);
  }
}

/**
 * The circuit board. The level declares one, at the world origin, and its eight
 * layers draw every screen of the game.
 */
export class Board extends Actor {
  constructor() {
    super();
    this.attach(new Ground());
    this.attach(new Nodes());
    this.attach(new Worms());
    this.attach(new Foes());
    this.attach(new Bolts());
    this.attach(new Cursor());
    this.attach(new Arcs());
    this.attach(new Ui());
  }
}
