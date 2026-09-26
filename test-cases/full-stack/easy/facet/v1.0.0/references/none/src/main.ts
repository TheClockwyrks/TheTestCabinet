// Facet — the entry point `index.html` loads.
//
// The whole of the wiring, and deliberately nothing else. It finds the page's
// canvas, stands the runtime up over it at the fixed logical stage size, lets
// the game build its state, publishes the debug and automation surface over
// that state, and starts the loop.
//
// Everything it wires together lives elsewhere: the runtime in
// `src/runtime.ts` and the modules under it, the game in `src/game.ts` over the
// core in `src/core/`, the surface in `src/debug.ts`.

import { STAGE_H, STAGE_W } from "./constants";
import { installDebugApi } from "./debug";
import { BACKGROUND, createGame } from "./game";
import { createRuntime, domScratchCanvas } from "./runtime";

const canvas = document.getElementById("stage") as HTMLCanvasElement | null;
if (!canvas) {
  throw new Error("Facet: the #stage canvas is missing from the page");
}

// The particle systems are composited through offscreen canvases the runtime
// also hands the game, so both sides draw through the same factory.
const scratch = domScratchCanvas();

// The state and debug surface types are inferred from the game, so this module
// names neither.
const runtime = createRuntime({
  canvas,
  // The logical design size from specs/overview.md. The canvas element is
  // sized by CSS alone (index.html); the runtime maps this stage onto whatever
  // size that gives it, so nothing in this build ever reads the window.
  width: STAGE_W,
  height: STAGE_H,
  game: createGame(scratch),
  // The stage background, which the runtime also clears the letterbox bars to,
  // so the bars match the bench. The game owns the color.
  background: BACKGROUND,
  scratch,
});

// The state is complete before anything can observe it: `initialize` builds it
// in one go and runs no frame. It also starts the produced files loading, which
// the frames after it draw and sound as each one arrives.
runtime.initialize();
runtime.start();

// window.__facet (see debug.ts and specs/instrumentation.md). Installed on
// every build, and inert during normal play. It is handed the runtime as well
// as the pose surface, because two of its operations — `setAutoStep` and
// `advance` — are about the clock, and nothing outside this build owns that.
//
// Installed once the load has settled: specs/assets.md makes the load part of
// initialization, and specs/instrumentation.md puts the surface up once the
// game has initialized, so a frame driven through it draws from the produced
// art rather than from the fallback a still-loading frame draws.
void runtime.loaded().then(() => {
  installDebugApi(runtime, runtime.debug);
});
