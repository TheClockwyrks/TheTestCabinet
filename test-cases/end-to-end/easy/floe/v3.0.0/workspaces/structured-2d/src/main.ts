// Floe — bootstrap. Supplied with the project. Do not edit.
//
// This is the build's fixed entry point, and it is deliberately the whole of the
// wiring. Everything that is the same in every browser game is the engine's: the
// frame loop and the delta time it measures, fitting the fixed 1280x720 logical
// stage into the canvas (the uniform scale, the centered letterbox, the device
// pixel ratio, and the resync when any of them changes), the camera that projects
// world units into that stage, the rendering pipeline, the keyboard, the audio
// graph and its first-interaction unlock, asset loading, and the debug overlay.
// None of it appears here, and none of it belongs anywhere else in this project.
//
// The FIXED STEP is not the engine's. The engine ticks the world against the
// frame's real elapsed seconds; turning that into whole `TICK_DT` ticks with the
// remainder carried is the game's own work, and `specs/overview.md` states the
// rule.
//
// What is left is `src/game.ts` — AND IT DOES NOT EXIST YET. This module imports
// it, so `npx tsc --noEmit` on a freshly seeded workspace fails on the missing
// module. That failure is the starting point, not a broken seed: create
// `src/game.ts`, export `BACKGROUND` and `game` from it, and the project
// compiles.

import { createEngine } from "@test-cabinet/structured-2d";
import { LAYOUT, STAGE_H, STAGE_W } from "./constants";
import { BACKGROUND, game } from "./game";

const canvas = document.getElementById("stage") as HTMLCanvasElement | null;
if (!canvas)
  throw new Error("Floe: the #stage canvas is missing from the page");

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
  // The stage background, which the engine clears the canvas to each frame so
  // the letterbox bars match the strait. The game owns the color.
  background: BACKGROUND,
  // Four-way movement and no action button, plus the menu and system vocabulary
  // that comes with the layout. specs/controls.md states which key drives which.
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
