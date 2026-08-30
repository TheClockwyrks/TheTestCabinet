// Meltdown — bootstrap. Supplied with the project. Do not edit.
//
// This is the build's fixed entry point, and it is deliberately the whole of the
// wiring. Everything that is the same in every browser game is the engine's: the
// frame loop and the delta time it measures, fitting the fixed 1280x720 logical
// field into the canvas (the uniform scale, the centered letterbox, the device
// pixel ratio, and the resync when any of them changes), the camera that
// projects world units into that field, the rendering pipeline, the keyboard,
// the pointer it maps into logical stage units, the audio bus and its
// first-interaction unlock, and the debug overlay. None of it appears here, and
// none of it belongs anywhere else in this project.
//
// What is left is `src/game.ts`. IT DOES NOT EXIST YET — this module imports it,
// so `npx tsc --noEmit` on a freshly seeded workspace fails on the missing
// module. That failure is the starting point, not a broken seed.

import { createEngine } from "@test-cabinet/structured-2d";
import { LAYOUT, STAGE_H, STAGE_W } from "./constants";
import { BACKGROUND, game } from "./game";

const canvas = document.getElementById("stage") as HTMLCanvasElement | null;
if (!canvas)
  throw new Error("Meltdown: the #stage canvas is missing from the page");

// The debug surface's type is inferred from `game`, so this module never names
// it.
const engine = createEngine({
  canvas,
  // The logical design size from specs/overview.md. The canvas element is sized
  // by CSS alone (index.html); the engine fits this field onto whatever size
  // that gives it, so no code here ever reads the window.
  width: STAGE_W,
  height: STAGE_H,
  game,
  // The stage background, which the engine clears the canvas to each frame so
  // the letterbox bars match the reactor. The game owns the color.
  background: BACKGROUND,
  // The floor is built on with the pointer, so the keyboard only moves a
  // highlight through the menus: a four-way pad and the menu vocabulary that
  // comes with it.
  layout: LAYOUT,
});

async function main(): Promise<void> {
  // The engine runs no frame until this resolves: it constructs the game
  // instance, runs its `initialize` — whose returned debug surface the engine
  // holds as `engine.debug` (specs/instrumentation.md) — and opens the start
  // level, so nothing here has to publish anything.
  await engine.initialize();

  // Runs until the engine is destroyed.
  await engine.run();
}

void main().catch((error: unknown) => {
  console.error(error);
});
