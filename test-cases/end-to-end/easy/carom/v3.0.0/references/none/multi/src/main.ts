// Carom — the entry point `index.html` loads.
//
// The whole of the wiring, and deliberately nothing else. It finds the page's
// canvas, stands the runtime up over it at the fixed logical field size, lets the
// game build its state, publishes the debug and automation surface over that
// state, and starts the loop.
//
// Everything it wires together lives elsewhere: the runtime in `src/runtime.ts`
// and the four modules under it, the game in `src/game.ts`, the surface in
// `src/debug.ts`.

import { COLOR, FIELD_H, FIELD_W } from "./constants";
import { installDebugApi } from "./debug";
import { game } from "./game";
import type { CaromState } from "./game";
import { createRuntime } from "./runtime";

const canvas = document.getElementById("stage") as HTMLCanvasElement | null;
if (!canvas) {
  throw new Error("Carom: the #stage canvas is missing from the page");
}

const runtime = createRuntime<CaromState>({
  canvas,
  // The logical design size from specs/overview.md. The canvas element is sized
  // by CSS alone (index.html); the runtime maps this field onto whatever size
  // that gives it, so nothing in this build ever reads the window.
  width: FIELD_W,
  height: FIELD_H,
  game,
  background: COLOR.bg,
});

// The state is complete before anything can observe it: `initialize` builds it in
// one go and runs no frame.
const state = runtime.initialize();

// window.__carom (see debug.ts and specs/instrumentation.md). Installed on every
// build, and inert during normal play. It is handed the runtime as well as the
// state, because two of its operations — `setAutoStep` and `advance` — are about
// the clock, and nothing outside this build owns that.
installDebugApi(state, runtime);

runtime.start();
