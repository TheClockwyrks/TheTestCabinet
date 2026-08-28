// Fathom — the trench: the one actor the level declares, and the draw
// components that render the game.
//
// Rendering belongs to the engine's pipeline: it collects every enabled,
// visible render component, orders it by layer and calls each in turn. The
// trench holds one `DrawComponent` per layer of the picture, and each `draw` is
// a pure read of the world's `FathomState` through the functions in
// `src/render.ts`, writing nothing back (`specs/state.md`, The contract). The
// order the layers overlap in is therefore the pipeline's, taken from the layer
// table in `src/theme.ts` rather than from the order the calls are written in.
//
// The context a `DrawComponent` receives already carries the world-to-device
// transform, and the game leaves the camera at rest, so the drawing runs in
// world units that coincide with the stage's logical units.
//
// The actor holds no authoritative state of its own: everything it draws is read
// off the world's game state at the call, so the picture is the frame this tick
// produced.

import { Actor, DrawComponent } from "@test-cabinet/structured-2d";
import type { DrawApi } from "@test-cabinet/structured-2d";
import {
  renderAmber,
  renderCreatures,
  renderEffects,
  renderHud,
  renderScreen,
  renderTrench,
} from "./render";
import { LAYER } from "./theme";
import { fathomState, type FathomState } from "./game";

/** One layer of the picture, drawn from the live state at its own place. */
abstract class TrenchLayer extends DrawComponent {
  constructor(layer: number) {
    super();
    this.layer = layer;
  }

  draw(api: DrawApi): void {
    this.paint(fathomState(this.actor.world), api.ctx);
  }

  protected abstract paint(
    state: FathomState,
    ctx: CanvasRenderingContext2D,
  ): void;
}

/** The tiles under their fog, the light pocket, the plankton and the ink. */
class TrenchGround extends TrenchLayer {
  constructor() {
    super(LAYER.trench);
  }

  protected override paint(
    state: FathomState,
    ctx: CanvasRenderingContext2D,
  ): void {
    renderTrench(state, ctx);
  }
}

/** The wavefronts, the flare blooms and the detection alerts. */
class TrenchEffects extends TrenchLayer {
  constructor() {
    super(LAYER.effects);
  }

  protected override paint(
    state: FathomState,
    ctx: CanvasRenderingContext2D,
  ): void {
    renderEffects(state, ctx);
  }
}

/** The bodies the fog is currently showing, and the forager. */
class TrenchCreatures extends TrenchLayer {
  constructor() {
    super(LAYER.creatures);
  }

  protected override paint(
    state: FathomState,
    ctx: CanvasRenderingContext2D,
  ): void {
    renderCreatures(state, ctx);
  }
}

/** The maze's two amber lights, over the bodies so they read at any distance. */
class TrenchAmber extends TrenchLayer {
  constructor() {
    super(LAYER.amber);
  }

  protected override paint(
    state: FathomState,
    ctx: CanvasRenderingContext2D,
  ): void {
    renderAmber(state, ctx);
  }
}

/** The strips above and below the maze, outside the fog entirely. */
class TrenchHud extends TrenchLayer {
  constructor() {
    super(LAYER.hud);
  }

  protected override paint(
    state: FathomState,
    ctx: CanvasRenderingContext2D,
  ): void {
    renderHud(state, ctx);
  }
}

/** The chrome of whichever screen the state names, over everything else. */
class TrenchScreens extends TrenchLayer {
  constructor() {
    super(LAYER.screens);
  }

  protected override paint(
    state: FathomState,
    ctx: CanvasRenderingContext2D,
  ): void {
    renderScreen(state, ctx);
  }
}

/**
 * The trench. The level declares one, at the world origin, and its six layers
 * draw every screen of the game.
 */
export class Trench extends Actor {
  constructor() {
    super();
    this.attach(new TrenchGround());
    this.attach(new TrenchEffects());
    this.attach(new TrenchCreatures());
    this.attach(new TrenchAmber());
    this.attach(new TrenchHud());
    this.attach(new TrenchScreens());
  }
}
