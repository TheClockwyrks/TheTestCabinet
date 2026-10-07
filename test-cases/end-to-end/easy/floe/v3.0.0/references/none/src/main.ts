// Floe — the entry point `index.html` loads.
//
// The whole of the wiring, and deliberately nothing else. It finds the page's
// canvas, draws a holding card while the sprite art decodes, stands the runtime
// up over the fixed stage, lets the game build its state, publishes the debugging
// and automation surface over that state, and starts the loop.
//
// Everything it wires together lives elsewhere: the runtime in `src/runtime.ts`
// and the five modules under it, the art in `src/assets.ts`, the game in
// `src/game.ts`, the surface in `src/debug.ts`.

import { loadArt } from "./assets";
import { STAGE_H, STAGE_W, TITLE_TEXT } from "./constants";
import { installDebugApi } from "./debug";
import { createFloe } from "./game";
import { createRuntime } from "./runtime";
import { COLOR, UI_FONT } from "./theme";
import type { FloeState } from "./types";

const canvas = document.getElementById("stage") as HTMLCanvasElement | null;
if (canvas === null) {
  throw new Error("Floe: the #stage canvas is missing from the page");
}

/**
 * A holding card while the frames decode, drawn straight onto the canvas.
 *
 * The runtime is not up yet, so this is the one draw in the build that does its
 * own fit: the stage is stretched onto the whole element rather than letterboxed,
 * which for two lines of centered text is indistinguishable.
 */
function drawHoldingCard(message: string, color: string): void {
  const ctx = canvas?.getContext("2d");
  if (!ctx || canvas === null) return;
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
  ctx.setTransform(canvas.width / STAGE_W, 0, 0, canvas.height / STAGE_H, 0, 0);
  ctx.fillStyle = COLOR.background;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
  ctx.textAlign = "center";
  ctx.fillStyle = COLOR.text;
  ctx.font = `700 64px ${UI_FONT}`;
  ctx.fillText(TITLE_TEXT, STAGE_W / 2, STAGE_H / 2 - 16);
  ctx.fillStyle = color;
  ctx.font = `16px ${UI_FONT}`;
  ctx.fillText(message, STAGE_W / 2, STAGE_H / 2 + 28);
}

drawHoldingCard("crossing the strait", COLOR.textDim);

loadArt()
  .then((art) => {
    const runtime = createRuntime<FloeState>({
      canvas,
      // The stage of specs/overview.md. The canvas element is sized by CSS alone
      // (index.html); the runtime maps this stage onto whatever size that gives
      // it, so nothing in this build ever reads the window.
      width: STAGE_W,
      height: STAGE_H,
      game: createFloe(art),
      // The stage background, which the runtime also clears the letterbox bars
      // to, so the bars carry the stage's own ground.
      background: COLOR.background,
    });

    // The state is complete before anything can observe it: `initialize` builds
    // it in one go and runs no tick.
    const state = runtime.initialize();

    // window.__floe (see debug.ts and specs/instrumentation.md). Installed on
    // every build and inert during normal play. It is handed the runtime as well
    // as the state, because two of its operations — `setAutoStep` and `advance` —
    // are about the clock, and nothing outside this build owns that.
    installDebugApi(state, runtime);

    runtime.start();
  })
  .catch((error: unknown) => {
    console.error(error);
    drawHoldingCard("the sprite art could not be loaded", COLOR.bayFilled);
  });
