// Spectra — the entry point `index.html` loads.
//
// The whole of the wiring, and deliberately nothing else. It decodes the seeded art
// and the seeded particle system, finds the page's canvas, stands the runtime up
// over it at the fixed logical stage size, lets the game build its state, publishes
// the debug and automation surface over that state, and starts the loop.
//
// Everything it wires together lives elsewhere: the runtime in `src/runtime.ts` and
// the four modules under it, the game in `src/game.ts`, the surface in
// `src/debug.ts`.
//
// The art is decoded BEFORE the runtime is built, so the first frame the page
// presents is a complete one and no draw has to check whether its sprite has
// arrived. It is awaited with a `then` rather than at the top level, because the
// bundle targets ES2020 and a top-level await is not available there.

import { loadSprites } from "./assets";
import { STAGE_H, STAGE_W } from "./constants";
import { installDebugApi } from "./debug";
import { createGame } from "./game";
import { createRuntime } from "./runtime";
import { COLOR } from "./theme";
import type { SpectraState } from "./types";

const canvas = document.getElementById("stage") as HTMLCanvasElement | null;
if (canvas === null) {
  throw new Error("Spectra: the #stage canvas is missing from the page");
}

void loadSprites().then((sprites) => {
  const runtime = createRuntime<SpectraState>({
    canvas,
    // The logical stage from specs/overview.md. The canvas element is sized by CSS
    // alone (index.html); the runtime maps this stage onto whatever size that gives
    // it, so nothing in this build ever reads the window.
    width: STAGE_W,
    height: STAGE_H,
    game: createGame(sprites),
    // The stage background, which the runtime also clears the letterbox to.
    background: COLOR.bg,
  });

  // The state is complete before anything can observe it: `initialize` builds it in
  // one go and runs no frame.
  const state = runtime.initialize();

  // window.__spectra (see debug.ts and specs/instrumentation.md). Installed on every
  // build and inert during normal play. It is handed the runtime as well as the
  // state, because two of its operations — `setAutoStep` and `advance` — are about
  // the clock, and nothing outside this build owns that.
  installDebugApi(state, runtime);

  runtime.start();
});
