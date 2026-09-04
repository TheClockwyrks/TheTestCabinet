// Wick — bootstrap. Supplied with the project. Do not edit.
//
// This is the build's fixed entry point, and it is deliberately the whole of the
// wiring. Everything that is the same in every browser game is the engine's: the
// frame loop and the delta time it measures, fitting the fixed 1280x720 logical
// stage into the canvas (the uniform scale, the centered letterbox, the device
// pixel ratio, and the resync when any of them changes), the camera that
// projects world units into that stage, the rendering pipeline, the keyboard
// actions the game registers, the audio graph with its looping cues and its
// first-interaction unlock, the asset loader, and the debug overlay. None of it
// appears here, and none of it belongs anywhere else in this project.
//
// What is left is `src/game.ts`.

import { createEngine } from "@test-cabinet/structured-2d";
import { LAYOUT, STAGE_H, STAGE_W } from "./constants";
import { BACKGROUND, game } from "./game";

const canvas = document.getElementById("stage") as HTMLCanvasElement | null;
if (!canvas)
  throw new Error("Wick: the #stage canvas is missing from the page");

// The debug surface's type is inferred from `game`, so this module never names
// it. The asset root is left at its default, `assets/`, which is where this
// build commits the sprites and sounds it produces and the root every path in
// `src/constants.ts` is written against.
const engine = createEngine({
  canvas,
  // The logical design size from specs/overview.md. The canvas element is sized
  // by CSS alone (index.html); the engine maps this stage onto whatever size
  // that gives it, so no code here ever reads the window. The camera follows
  // the lamplighter at zoom 1, so a world point draws where the camera formula
  // of specs/world.md puts it.
  width: STAGE_W,
  height: STAGE_H,
  game,
  // The stage background, which the engine clears the canvas to each frame so
  // the letterbox bars match the night. The game owns the color.
  background: BACKGROUND,
  // The lamplighter only moves, so a four-way pad carries the whole game, with
  // the menu vocabulary that comes with it.
  layout: LAYOUT,
});

async function main(): Promise<void> {
  // The engine runs no frame until this resolves: it constructs the game
  // instance, runs its `initialize`, whose returned debug surface the engine
  // holds as `engine.debug` (specs/instrumentation.md), and opens the start
  // level, so nothing here has to publish anything.
  await engine.initialize();

  // Runs until the engine is destroyed.
  await engine.run();
}

void main().catch((error: unknown) => {
  console.error(error);
});
