// Gantry — bootstrap. Supplied with the project. Do not edit.
//
// This is the build's fixed entry point, and it is deliberately the whole of
// the wiring. Everything that is the same in every browser game is the
// engine's: the gameplay framework the game is written inside, the frame loop
// and the delta time it measures, fitting the fixed 1280x720 logical stage into
// the canvas (the uniform scale, the centered letterbox, the device pixel
// ratio, and the resync when any of them changes), the rendering pipeline that
// draws every render component through the world's camera and composites the 2D
// screen layer over the picture, collision detection, the keyboard, the pointer
// it maps into logical stage units, the audio graph and its first-interaction
// unlock, loading the produced files under the asset root, and the debug
// overlay the Backquote key toggles. None of it appears here, and none of it
// belongs anywhere else in this project.
//
// What is left is `src/game.ts`.

import { createEngine } from "@clockwyrks/structured-3d";
import { ASSET_ROOT, LAYOUT, STAGE_H, STAGE_W } from "./constants";
import { BACKGROUND, game } from "./game";

const canvas = document.getElementById("stage") as HTMLCanvasElement | null;
if (!canvas)
  throw new Error("Gantry: the #stage canvas is missing from the page");

// The debug surface's type is inferred from `game`, so this module never names
// it.
const engine = createEngine({
  canvas,
  // The logical design size from specs/overview.md. The canvas element is sized
  // by CSS alone (index.html); the engine maps this stage onto whatever size
  // that gives it, so no code here ever reads the window.
  width: STAGE_W,
  height: STAGE_H,
  game,
  // The stage background, which the engine clears the whole canvas to each
  // frame so the letterbox bars match the yard. The game owns the color.
  background: BACKGROUND,
  // The scene is worked with the pointer, so the keyboard drives the menus and
  // the camera: a four-way pad and the menu vocabulary that comes with it.
  layout: LAYOUT,
  // The one root every produced model and sound of specs/assets.md is loaded
  // under, resolved relative to the page so the built site runs at any base
  // path.
  assetRoot: ASSET_ROOT,
  // Shadow maps, which can only be asked for here. Turning them on costs
  // nothing on its own — a light casts and a surface receives only where the
  // game says so, and both default to off — so the switch is left open and the
  // yard's lighting is the build's to decide.
  shadows: true,
  // There is no projection option: the projection is the world camera's own
  // (`world.camera.projection`), a perspective frustum until the game says
  // otherwise, which is what Gantry's free orbit wants.
});

async function main(): Promise<void> {
  // The engine runs no frame until this resolves: it constructs the game
  // instance, runs its `initialize` — whose returned debug surface the engine
  // holds as `engine.debug` (specs/instrumentation.md) — and opens the start
  // level, so by the time this returns the world's actors and its game mode
  // have begun play and nothing here has to publish anything.
  await engine.initialize();

  // Runs until the engine is destroyed.
  await engine.run();
}

void main().catch((error: unknown) => {
  console.error(error);
});
