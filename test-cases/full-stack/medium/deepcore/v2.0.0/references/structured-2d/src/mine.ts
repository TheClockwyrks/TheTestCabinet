// Deepcore — the mine: the one actor the level declares, and the layers that
// draw everything but the miner.
//
// Rendering belongs to the engine's pipeline: it collects every enabled, visible
// render component, orders it by layer, and calls each in turn. The mine holds
// four `DrawComponent`s, and each `draw` is a pure read of the world's
// `DeepcoreState` through the functions in `src/render.ts`, writing nothing back.
//
// Three of them draw in WORLD units, through the camera the game positioned
// (src/camera.ts): the context a `DrawComponent` receives already carries the
// world-to-device transform, so the mine scrolls because the camera moved and
// not because anything here translated. The fourth is the chrome, which is the
// stage's rather than the mine's, so it takes the camera back out and draws in
// logical units.
//
// The actor holds no authoritative state of its own: everything it draws is read
// off the world's game state at the call, so the picture is the frame the tick
// produced.

import { Actor, DrawComponent } from "@clockwyrks/structured-2d";
import type { DrawApi } from "@clockwyrks/structured-2d";
import { cameraCorner } from "./camera";
import { STAGE_H, STAGE_W } from "./constants";
import { drawEffects } from "./effects";
import { deepcoreState } from "./game";
import { LAYER } from "./layers";
import {
  closeView,
  openView,
  renderHud,
  renderTerrain,
  renderWorldOverlays,
  showsMine,
} from "./render";

/** The rock, the carved tunnels, the surface camp, and the ground items. */
class TerrainLayer extends DrawComponent {
  constructor() {
    super();
    this.layer = LAYER.terrain;
  }

  draw(api: DrawApi): void {
    const state = deepcoreState(this.world);
    if (!showsMine(state)) return;
    const corner = cameraCorner(this.world);
    openView(api.ctx, state, corner);
    renderTerrain(api.ctx, state, corner);
    closeView(api.ctx);
  }
}

/** The produced particle bursts, drawn in the mine's own space. */
class EffectsLayer extends DrawComponent {
  constructor() {
    super();
    this.layer = LAYER.effects;
  }

  draw(api: DrawApi): void {
    const state = deepcoreState(this.world);
    if (!showsMine(state)) return;
    openView(api.ctx, state, cameraCorner(this.world));
    drawEffects(api.ctx);
    closeView(api.ctx);
  }
}

/** The scanner's indicator and the prompt over a building, over the mine. */
class OverlayLayer extends DrawComponent {
  constructor() {
    super();
    this.layer = LAYER.overlays;
  }

  draw(api: DrawApi): void {
    const state = deepcoreState(this.world);
    if (!showsMine(state)) return;
    const corner = cameraCorner(this.world);
    openView(api.ctx, state, corner);
    renderWorldOverlays(api.ctx, state, corner);
    closeView(api.ctx);
  }
}

/**
 * The chrome, in the stage's logical units.
 *
 * The engine's camera maps a world point to `width / 2 + (world - camera)` in
 * logical units at a zoom of `1`, so translating by the camera's offset from the
 * field's center leaves the context drawing in logical units exactly. The status
 * bar, the panels, and the menus are the stage's rather than the mine's, so this
 * is where they belong.
 */
class HudLayer extends DrawComponent {
  constructor() {
    super();
    this.layer = LAYER.hud;
  }

  draw(api: DrawApi): void {
    const state = deepcoreState(this.world);
    const camera = api.camera();
    api.ctx.save();
    api.ctx.translate(camera.x - STAGE_W / 2, camera.y - STAGE_H / 2);
    renderHud(api.ctx, state);
    api.ctx.restore();
  }
}

/**
 * The mine. The level declares one, and its four layers draw every screen of the
 * game around the prospector, which draws itself between the terrain and the
 * effects.
 */
export class Mine extends Actor {
  constructor() {
    super();
    this.attach(new TerrainLayer());
    this.attach(new EffectsLayer());
    this.attach(new OverlayLayer());
    this.attach(new HudLayer());
  }
}
