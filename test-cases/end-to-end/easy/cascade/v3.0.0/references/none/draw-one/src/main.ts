// Cascade — the entry point `index.html` loads.
//
// The whole of the wiring, and deliberately nothing else. It finds the page's
// canvas, stands the runtime up over it at the fixed logical stage size, lets
// the game build its state, publishes the debug and automation surface over
// that state, and starts the loop.
//
// Everything it wires together lives elsewhere: the runtime in
// `src/runtime.ts` and the five modules under it, the game in `src/game.ts`,
// the surface in `src/debug.ts`.

import {
  MENU_BACK_KEYS,
  MENU_CONFIRM_KEYS,
  MENU_DOWN_KEYS,
  MENU_UP_KEYS,
  STAGE_H,
  STAGE_W,
} from "./constants";
import { installDebugApi } from "./debug";
import { BACKGROUND, game, type CascadeState } from "./game";
import { createRuntime } from "./runtime";

const canvas = document.getElementById("stage") as HTMLCanvasElement | null;
if (!canvas) {
  throw new Error("Cascade: the #stage canvas is missing from the page");
}

const runtime = createRuntime<CascadeState>({
  canvas,
  // The logical design size from specs/overview.md. The canvas element is sized
  // by CSS alone (index.html); the runtime maps this stage onto whatever size
  // that gives it, so nothing in this build ever reads the window.
  width: STAGE_W,
  height: STAGE_H,
  game,
  // The table's own colour, which the runtime also clears the letterbox bars
  // to, so the bars carry the stage's background.
  background: BACKGROUND,
  // The four menu actions specs/controls.md names, each with the keys it binds.
  // The runtime reads the keyboard by `KeyboardEvent.code`, so they hold on any
  // layout.
  menuBindings: {
    "menu-up": MENU_UP_KEYS,
    "menu-down": MENU_DOWN_KEYS,
    "menu-confirm": MENU_CONFIRM_KEYS,
    "menu-back": MENU_BACK_KEYS,
  },
});

// The state is complete before anything can observe it: `initialize` builds it
// in one go and runs no frame.
const state = runtime.initialize();

// window.__cascade (see debug.ts and specs/instrumentation.md). Installed on
// every build, and inert during normal play. It is handed the runtime as well
// as the state, because two of its operations — `setAutoStep` and `advance` —
// are about the clock and nothing outside this build owns that, and because the
// HUD's SOUND control reaches the runtime's own mute bit.
installDebugApi(state, runtime, runtime.audio);

runtime.start();
