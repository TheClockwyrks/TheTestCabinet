// Cascade — the actors the level places, and the draw components that render it.
//
// Rendering belongs to the engine's pipeline: it collects every enabled, visible
// render component, orders it by layer and calls each in turn. So the order the
// picture overlaps in is the pipeline's, taken from the layer table in
// `src/theme.ts` rather than from the order the calls happen to be written in —
// which is what puts the painted layer under the piles, the cards in flight over
// them, the run in hand over those, and the HUD and the screens over everything.
//
// Each `draw` is a pure read of the world's `CascadeState` through the functions
// in `src/render.ts`, writing nothing back, so no actor here holds authoritative
// state of its own and the picture is the frame this tick produced.
//
// The context a `DrawComponent` receives already carries the world-to-device
// transform, and the game leaves the camera at rest, so the drawing runs in world
// units that coincide with the stage's logical units.
//
// Three actors, one per entry of `TAGS`, so `world.byTag` finds each under the
// name the specification uses.

import { Actor, DrawComponent } from "@test-cabinet/structured-2d";
import type { DrawApi } from "@test-cabinet/structured-2d";
import { cascadeState, type CascadeState } from "./game";
import {
  renderCards,
  renderFelt,
  renderFlyers,
  renderHand,
  renderHowto,
  renderHud,
  renderSlots,
  renderTitle,
  renderTrail,
  renderWon,
} from "./render";
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

/** Whether the table itself is on show, which the two menu screens quiet. */
function onTable(state: CascadeState): boolean {
  return state.screen === "playing" || state.screen === "won";
}

class Felt extends TableLayer {
  constructor() {
    super(LAYER.felt);
  }

  protected override paint(
    _state: CascadeState,
    ctx: CanvasRenderingContext2D,
  ): void {
    renderFelt(ctx);
  }
}

class Slots extends TableLayer {
  constructor() {
    super(LAYER.slots);
  }

  protected override paint(
    state: CascadeState,
    ctx: CanvasRenderingContext2D,
  ): void {
    // The empty-slot marks belong to live play. While the cascade buries the
    // table they would sit over the painted layer, and the specification draws
    // that layer under the cards alone.
    if (state.screen !== "playing") return;
    renderSlots(state, ctx);
  }
}

class Cards extends TableLayer {
  constructor() {
    super(LAYER.cards);
  }

  protected override paint(
    state: CascadeState,
    ctx: CanvasRenderingContext2D,
  ): void {
    if (!onTable(state)) return;
    renderCards(state, ctx);
  }
}

class Hand extends TableLayer {
  constructor() {
    super(LAYER.hand);
  }

  protected override paint(
    state: CascadeState,
    ctx: CanvasRenderingContext2D,
  ): void {
    if (state.screen !== "playing") return;
    renderHand(state, ctx);
  }
}

class Screens extends TableLayer {
  constructor() {
    super(LAYER.screens);
  }

  protected override paint(
    state: CascadeState,
    ctx: CanvasRenderingContext2D,
  ): void {
    if (state.screen === "title") renderTitle(ctx);
    else if (state.screen === "howto") renderHowto(ctx);
    else if (state.screen === "won") renderWon(state, ctx);
  }
}

class PaintedLayer extends TableLayer {
  constructor() {
    super(LAYER.trail);
  }

  protected override paint(
    state: CascadeState,
    ctx: CanvasRenderingContext2D,
  ): void {
    if (!onTable(state)) return;
    renderTrail(state, ctx);
  }
}

class Flyers extends TableLayer {
  constructor() {
    super(LAYER.flyers);
  }

  protected override paint(
    state: CascadeState,
    ctx: CanvasRenderingContext2D,
  ): void {
    if (!onTable(state)) return;
    renderFlyers(state, ctx);
  }
}

class HudStrip extends TableLayer {
  constructor() {
    super(LAYER.hud);
  }

  protected override paint(
    state: CascadeState,
    ctx: CanvasRenderingContext2D,
  ): void {
    if (state.screen !== "playing") return;
    renderHud(ctx);
  }
}

/** The felt, the thirteen piles, the run in hand, and the screens over them. */
export class CascadeTable extends Actor {
  constructor() {
    super();
    this.attach(new Felt());
    this.attach(new Slots());
    this.attach(new Cards());
    this.attach(new Hand());
    this.attach(new Screens());
  }
}

/** The victory cascade: the painted layer under the piles, the flyers over them. */
export class FlyingCards extends Actor {
  constructor() {
    super();
    this.attach(new PaintedLayer());
    this.attach(new Flyers());
  }
}

/** The strip along the bottom of the table, drawn while the game is played. */
export class Hud extends Actor {
  constructor() {
    super();
    this.attach(new HudStrip());
  }
}
