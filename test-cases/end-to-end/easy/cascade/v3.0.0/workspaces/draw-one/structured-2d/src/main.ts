// Cascade — bootstrap. Supplied with the project. Do not edit.
//
// This is the build's fixed entry point, and it is deliberately the whole of the
// wiring. Everything that is the same in every browser game is the engine's: the
// frame loop and the delta time it measures, fitting the fixed 1280x720 logical
// stage into the canvas (the uniform scale, the centered letterbox, the device
// pixel ratio, and the resync when any of them changes), rendering, the pointer
// it maps into logical stage units, the audio bus and its first-interaction
// unlock, and the debug overlay. None of it appears here, and none of it belongs
// anywhere else in this project.
//
// What is left is `src/game.ts`. IT DOES NOT EXIST YET — this module imports it,
// so `npx tsc --noEmit` on a freshly seeded workspace fails on the missing
// module. That failure is the starting point, not a broken seed; creating the
// module clears it.

import { createEngine } from "@clockwyrks/structured-2d";
import { STAGE_H, STAGE_W } from "./constants";
import { BACKGROUND, game } from "./game";

const canvas = document.getElementById("stage") as HTMLCanvasElement | null;
if (!canvas)
  throw new Error("Cascade: the #stage canvas is missing from the page");

// The debug surface's type is inferred from `game`, so this module never names
// it.
const engine = createEngine({
  canvas,
  // The logical design size from specs/overview.md. The canvas element is sized
  // by CSS alone (index.html); the engine fits this stage onto whatever size that
  // gives it, so no code here ever reads the window.
  width: STAGE_W,
  height: STAGE_H,
  game,
  // The table background, which the engine clears the canvas to each frame so the
  // letterbox bars match the table. The game owns the color.
  background: BACKGROUND,
  // No `layout`. The engine reports the pointer without any registration, and the
  // four menu actions specs/controls.md names are registered by the game itself,
  // through `InitApi.input.register` from its `initialize` (see `engine/input.md`).
});

async function main(): Promise<void> {
  // The engine runs no frame until this resolves: the game instance has run its
  // `initialize` — whose returned debug surface the engine holds and hands back as
  // `engine.debug` (specs/instrumentation.md) — and the table level is open, its
  // actors spawned and its game mode begun.
  await engine.initialize();

  // Runs until the engine is destroyed.
  await engine.run();
}

void main().catch((error: unknown) => {
  console.error(error);
});
