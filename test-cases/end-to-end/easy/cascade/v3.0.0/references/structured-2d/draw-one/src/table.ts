// Cascade — the actors the level declares, and the draw components that render
// the game.
//
// Rendering belongs to the engine's pipeline: it collects every enabled,
// visible render component, orders it by layer and calls each in turn. Each
// `draw` below is a pure read of the world's `CascadeState` through the
// functions in `src/render.ts` and `src/screens.ts`, writing nothing back
// (specs/state.md, The contract). The order the pieces overlap in is therefore
// the pipeline's, taken from the layer table in `src/theme.ts` rather than from
// the order the calls are written in — which is what puts the painted layer
// beneath the cards still on the foundations and the cards in flight above them
// (specs/victory.md).
//
// The context a `DrawComponent` receives already carries the world-to-device
// transform, and the game leaves the camera at rest, so the drawing runs in
// world units that coincide with the stage's logical units and the painted
// layer blits at `(0, 0)`.
//
// Three actors carry the picture, each under the tag `src/constants.ts` fixes
// for it, so `world.byTag` finds them under the names the specification uses.

import { Actor, DrawComponent } from "@clockwyrks/structured-2d";
import type { DrawApi } from "@clockwyrks/structured-2d";
import { cascadeState, type CascadeState } from "./game";
import {
  renderDrag,
  renderDropTarget,
  renderFelt,
  renderFlyers,
  renderPiles,
  renderTrail,
} from "./render";
import { renderHud, renderScreens } from "./screens";
import { LAYER } from "./theme";

/** One layer of the picture, drawn from the live state at its own place. */
abstract class TableLayer extends DrawComponent {
  constructor(layer: number) {
    super();
    this.layer = layer;
  }

  draw(api: DrawApi): void {
    this.paint(cascadeState(this.actor.world), api.ctx);
  }

  protected abstract paint(
    state: CascadeState,
    ctx: CanvasRenderingContext2D,
  ): void;
}

/** The felt, under everything. */
class Felt extends TableLayer {
  constructor() {
    super(LAYER.felt);
  }

  protected override paint(
    _state: CascadeState,
    ctx: CanvasRenderingContext2D,
  ) {
    renderFelt(ctx);
  }
}

/** The thirteen piles and the drop-target highlight. */
class Piles extends TableLayer {
  constructor() {
    super(LAYER.piles);
  }

  protected override paint(state: CascadeState, ctx: CanvasRenderingContext2D) {
    renderPiles(state, ctx);
  }
}

/** The run in hand, over the piles it passes. */
class Drag extends TableLayer {
  constructor() {
    super(LAYER.drag);
  }

  protected override paint(state: CascadeState, ctx: CanvasRenderingContext2D) {
    renderDrag(state, ctx);
  }
}

/** The ring around the pile a held run would land on, over the run itself. */
class Highlight extends TableLayer {
  constructor() {
    super(LAYER.highlight);
  }

  protected override paint(state: CascadeState, ctx: CanvasRenderingContext2D) {
    renderDropTarget(state, ctx);
  }
}

/** The painted layer, over the felt and under everything still on the table. */
class Trail extends TableLayer {
  constructor() {
    super(LAYER.trail);
  }

  protected override paint(state: CascadeState, ctx: CanvasRenderingContext2D) {
    renderTrail(state, ctx);
  }
}

/** Every card in flight, over the table it is burying. */
class Flyers extends TableLayer {
  constructor() {
    super(LAYER.flyers);
  }

  protected override paint(state: CascadeState, ctx: CanvasRenderingContext2D) {
    renderFlyers(state, ctx);
  }
}

/** The HUD strip and its three controls. */
class HudStrip extends TableLayer {
  constructor() {
    super(LAYER.hud);
  }

  protected override paint(state: CascadeState, ctx: CanvasRenderingContext2D) {
    renderHud(state, ctx);
  }
}

/** Whichever screen is up, over everything else. */
class Screens extends TableLayer {
  constructor() {
    super(LAYER.screens);
  }

  protected override paint(state: CascadeState, ctx: CanvasRenderingContext2D) {
    renderScreens(state, ctx);
  }
}

/** The table itself: the felt, the thirteen piles, and the run in hand. */
export class CascadeTable extends Actor {
  constructor() {
    super();
    this.attach(new Felt());
    this.attach(new Piles());
    this.attach(new Drag());
    this.attach(new Highlight());
  }
}

/** The victory cascade: the painted layer it leaves, and the cards in flight. */
export class FlightDeck extends Actor {
  constructor() {
    super();
    this.attach(new Trail());
    this.attach(new Flyers());
  }
}

/** The HUD strip and the screens drawn over the table. */
export class Hud extends Actor {
  constructor() {
    super();
    this.attach(new HudStrip());
    this.attach(new Screens());
  }
}
