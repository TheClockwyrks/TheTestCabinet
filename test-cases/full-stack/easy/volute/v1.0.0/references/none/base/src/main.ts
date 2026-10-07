// Volute — the entry point `index.html` loads.
//
// The whole of the wiring, and deliberately nothing else. It finds the page's
// canvas, loads the produced files, stands the runtime up over the canvas at the
// fixed logical field size, publishes the debug and automation surface, and starts
// the loop.
//
// Everything it wires together lives elsewhere: the runtime in `src/runtime.ts`
// and the modules under it, the simulation in `src/sim.ts` and `src/train.ts`, the
// picture in `src/render.ts`, and the surface in `src/debug.ts`.

import { loadAssets } from "./assets";
import { installDebugApi } from "./debug";
import { createRuntime } from "./runtime";

async function boot(): Promise<void> {
  const canvas = document.getElementById("stage") as HTMLCanvasElement | null;
  if (canvas === null) {
    throw new Error("Volute: the #stage canvas is missing from the page");
  }

  // Awaited before the runtime exists, so nothing is still decoding on the first
  // frame and the first thing drawn is the finished hall.
  const assets = await loadAssets();

  const runtime = createRuntime({ canvas, assets });

  // window.__volute (see src/debug.ts and specs/instrumentation.md). Installed on
  // every build, and inert during normal play.
  installDebugApi(runtime);

  runtime.start();
}

void boot();
