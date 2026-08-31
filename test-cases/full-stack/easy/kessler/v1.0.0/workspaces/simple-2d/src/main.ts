// Kessler — bootstrap. Supplied with the project. Do not edit.
//
// This is the build's fixed entry point, and it is deliberately the whole of the
// wiring. Everything that is the same in every browser game is the engine's: the
// frame loop and the delta time it measures, fitting the fixed 1000x1000 logical
// stage into the canvas (the uniform scale, the centered letterbox, the device
// pixel ratio, and the resync when any of them changes), the keyboard actions
// the game registers, the audio graph and its first-interaction unlock, loading
// the produced assets, and the debug overlay. None of it appears here, and none
// of it belongs anywhere else in this project.
//
// What is left is `src/game.ts`.

import { createEngine } from "@test-cabinet/simple-2d";
import { STAGE_H, STAGE_W } from "./constants";
import { BACKGROUND, game } from "./game";

const canvas = document.getElementById("stage") as HTMLCanvasElement | null;
if (!canvas)
  throw new Error("Kessler: the #stage canvas is missing from the page");

// The state and debug surface types are inferred from `game`, so this module
// names neither. The asset root is left at its default, `assets/`, which is
// where this build writes the sprites, particle systems, and sounds it produces
// and the root every path in `src/constants.ts` is written against.
const engine = createEngine({
  canvas,
  // The logical design size from specs/overview.md. The canvas element is sized
  // by CSS alone (index.html); the engine maps this stage onto whatever size
  // that gives it, so no code here ever reads the window.
  width: STAGE_W,
  height: STAGE_H,
  game,
  // The stage background, which the engine clears the canvas to each frame so
  // the letterbox bars match the field. The game owns the color.
  background: BACKGROUND,
  // No touch layout is selected: Kessler is played from the keyboard alone
  // (specs/controls.md), and its actions are its own rather than a layout's
  // vocabulary, so the game registers every one of them from ACTIONS.
});

async function main(): Promise<void> {
  // The engine runs no frame until this resolves. The game's own `initialize`
  // returns the debug surface beside its state (specs/instrumentation.md), so by
  // the time this returns the engine is holding it and nothing here has to
  // publish anything.
  await engine.initialize();

  // Runs until the engine is destroyed.
  await engine.run();
}

void main().catch((error: unknown) => {
  console.error(error);
});
