// Carom — bootstrap. CASE-PROVIDED. Do not edit.
//
// This is the build's fixed entry point, and it is deliberately the whole of the
// wiring. Everything that is the same in every browser game is the engine's: the
// frame loop and the delta time it measures, fitting the fixed 1280x720 logical
// field into the canvas (the uniform scale, the centered letterbox, the device
// pixel ratio, and the resync when any of them changes), rendering, collision
// detection, the keyboard, the audio bus and its first-interaction unlock, and
// the debug overlay. None of it appears here, and none of it belongs anywhere
// else in this project.
//
// What is left is `src/game.ts`. It does not exist yet — this module imports it,
// so the project does not type-check until you create it.

import { createEngine } from "@test-cabinet/structured-2d";
import { FIELD_H, FIELD_W, LAYOUT } from "./constants";
import { BACKGROUND, game } from "./game";

const canvas = document.getElementById("stage") as HTMLCanvasElement | null;
if (!canvas)
  throw new Error("Carom: the #stage canvas is missing from the page");

// The debug surface's type is inferred from `game`, so this module never
// names it.
const engine = createEngine({
  canvas,
  // The logical design size from specs/overview.md. The canvas element is sized
  // by CSS alone (index.html); the engine fits this field onto whatever size
  // that gives it, so no code here ever reads the window.
  width: FIELD_W,
  height: FIELD_H,
  game,
  // The field background, which the engine clears the canvas to each frame so
  // the letterbox bars match the field. The game owns the color.
  background: BACKGROUND,
  // Two paddles facing each other across the field: one vertical slider per side.
  layout: LAYOUT,
});

async function main(): Promise<void> {
  // The engine runs no frame until this resolves: the game instance has run its
  // `initialize` — whose returned debug surface the engine holds and hands back
  // as `engine.debug` (specs/instrumentation.md) — and the title level is open,
  // its actors spawned and its game mode begun.
  await engine.initialize();

  // Runs until the engine is destroyed.
  await engine.run();
}

void main().catch((error: unknown) => {
  console.error(error);
});
