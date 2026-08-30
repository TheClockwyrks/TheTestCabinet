// Volute — bootstrap. Supplied with the project. Do not edit.
//
// This is the build's fixed entry point, and it is deliberately the whole of the
// wiring. Everything that is the same in every browser game is the engine's: the
// frame loop and the delta time it measures, fitting the fixed 960x540 logical
// field into the canvas (the uniform scale, the centered letterbox, the device
// pixel ratio, and the resync when any of them changes), the keyboard, the
// pointer it maps into logical field units, the audio graph with its looping
// cues and its first-interaction unlock, the asset loader, and the debug
// overlay. None of it appears here, and none of it belongs anywhere else in this
// project.
//
// What is left is `src/game.ts`. It does not exist yet — this module imports it,
// so the project does not type-check until you create it.

import { createEngine } from "@test-cabinet/simple-2d";
import { FIELD_H, FIELD_W, LAYOUT } from "./constants";
import { BACKGROUND, game } from "./game";

const canvas = document.getElementById("stage") as HTMLCanvasElement | null;
if (!canvas)
  throw new Error("Volute: the #stage canvas is missing from the page");

// The state and debug surface types are inferred from `game`, so this module
// names neither.
const engine = createEngine({
  canvas,
  // The logical design size from specs/overview.md. The canvas element is sized
  // by CSS alone (index.html); the engine maps this field onto whatever size
  // that gives it, so no code here ever reads the window.
  width: FIELD_W,
  height: FIELD_H,
  game,
  // The field background, which the engine clears the canvas to each frame so
  // the letterbox bars match the hall. The game owns the color.
  background: BACKGROUND,
  // The injector turns and fires from one place: a four-way pad and the two
  // buttons the shot and the swap sit on, with the menu vocabulary that comes
  // with them.
  layout: LAYOUT,
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
