// Carom — bootstrap. CASE-PROVIDED. Do not edit.
//
// This is the build's fixed entry point, and it is deliberately the whole of the
// wiring. Everything that is the same in every browser game is the engine's: the
// frame loop and the delta time it measures, fitting the fixed 1280x720 logical
// field into the canvas (the uniform scale, the centered letterbox, the device
// pixel ratio, and the resync when any of them changes), the keyboard, the audio
// graph and its first-interaction unlock, and the debug overlay. None of it
// appears here, and none of it belongs anywhere else in this project.
//
// What is left is `src/game.ts`.

import { createEngine } from "@test-cabinet/simple-2d";
import { COLOR, FIELD_H, FIELD_W, LAYOUT } from "./constants";
import { installDebugApi } from "./debug";
import { game } from "./game";
import type { CaromState } from "./game";

const canvas = document.getElementById("stage") as HTMLCanvasElement | null;
if (!canvas)
  throw new Error("Carom: the #stage canvas is missing from the page");

const engine = createEngine<CaromState>({
  canvas,
  // The logical design size from specs/overview.md. The canvas element is sized
  // by CSS alone (index.html); the engine maps this field onto whatever size that
  // gives it, so no code here ever reads the window.
  width: FIELD_W,
  height: FIELD_H,
  game,
  background: COLOR.bg,
  // Two paddles facing each other across the field: one vertical slider per side.
  layout: LAYOUT,
});

async function main(): Promise<void> {
  // The engine runs no frame until this resolves, so the state the debug API is
  // installed over is complete before anything can observe it.
  const state = await engine.initialize();

  // window.__carom (see debug.ts and specs/instrumentation.md). Installed on
  // every build, and inert during normal play.
  installDebugApi(state);

  // Runs until the engine is destroyed.
  await engine.run();
}

void main().catch((error: unknown) => {
  console.error(error);
});
