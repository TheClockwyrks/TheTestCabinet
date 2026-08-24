// Refract — the entry point `index.html` loads.
//
// The whole of the wiring, and deliberately nothing else. It finds the page's
// canvas, stands the runtime up over it at the fixed logical stage size, lets
// the game build its state, publishes the debug and automation surface over
// that state, and starts the loop.
//
// Everything it wires together lives elsewhere: the runtime in
// `src/runtime.ts` and the five modules under it, the game in `src/game.ts`,
// the surface in `src/debug.ts`.

import { STAGE_H, STAGE_W } from "./constants";
import { installDebugApi } from "./debug";
import { BACKGROUND, game } from "./game";
import { createRuntime } from "./runtime";

const canvas = document.getElementById("stage") as HTMLCanvasElement | null;
if (!canvas) {
  throw new Error("Refract: the #stage canvas is missing from the page");
}

// The state and debug surface types are inferred from `game`, so this module
// names neither.
const runtime = createRuntime({
  canvas,
  // The logical design size from specs/overview.md. The canvas element is
  // sized by CSS alone (index.html); the runtime maps this stage onto whatever
  // size that gives it, so nothing in this build ever reads the window.
  width: STAGE_W,
  height: STAGE_H,
  game,
  // The stage background, which the runtime also clears the letterbox bars to,
  // so the bars match the bench. The game owns the color.
  background: BACKGROUND,
});

// The state is complete before anything can observe it: `initialize` builds it
// in one go and runs no frame.
runtime.initialize();

// window.__refract (see debug.ts and specs/instrumentation.md). Installed on
// every build, and inert during normal play. It is handed the runtime as well
// as the pose surface, because two of its operations — `setAutoStep` and
// `advance` — are about the clock, and nothing outside this build owns that.
installDebugApi(runtime, runtime.debug);

runtime.start();
