// Fathom — the entry point `index.html` loads.
//
// The whole of the wiring, and deliberately nothing else. It finds the page's
// canvas, draws a holding card while the art decodes, stands the runtime up
// over the fixed logical stage, lets the game build its state, publishes the
// debug and automation surface over that state, and starts the loop.
//
// Everything it wires together lives elsewhere: the runtime in `src/runtime.ts`
// and the five modules under it, the art in `src/assets.ts`, the game in
// `src/game.ts`, the surface in `src/debug.ts`.

import { loadAssets } from "./assets";
import { STAGE_H, STAGE_W, TICK_DT } from "./constants";
import { installDebugApi } from "./debug";
import { createFathom, type FathomState } from "./game";
import { createRuntime } from "./runtime";
import { COLOR, MONO } from "./theme";

const canvas = document.getElementById("stage") as HTMLCanvasElement | null;
if (canvas === null) {
  throw new Error("Fathom: the #stage canvas is missing from the page");
}

/**
 * A holding card while the sheets decode, drawn straight onto the canvas.
 *
 * The runtime is not up yet, so this is the one draw in the build that does its
 * own fit: the stage is stretched onto the whole element rather than
 * letterboxed, which for two lines of centered text is indistinguishable.
 */
function drawHoldingCard(message: string, color: string): void {
  const ctx = canvas?.getContext("2d");
  if (!ctx || canvas === null) return;
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
  ctx.setTransform(canvas.width / STAGE_W, 0, 0, canvas.height / STAGE_H, 0, 0);
  ctx.fillStyle = COLOR.fog;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
  ctx.textAlign = "center";
  ctx.fillStyle = COLOR.forager;
  ctx.font = `700 32px ${MONO}`;
  ctx.fillText("FATHOM", STAGE_W / 2, STAGE_H / 2 - 12);
  ctx.fillStyle = color;
  ctx.font = `16px ${MONO}`;
  ctx.fillText(message, STAGE_W / 2, STAGE_H / 2 + 24);
}

drawHoldingCard("descending", COLOR.textDim);

loadAssets()
  .then((assets) => {
    const runtime = createRuntime<FathomState>({
      canvas,
      // The logical design size from specs/overview.md. The canvas element is
      // sized by CSS alone (index.html); the runtime maps this stage onto
      // whatever size that gives it, so nothing in this build reads the window.
      width: STAGE_W,
      height: STAGE_H,
      // The fixed timestep specs/movement.md fixes: 120 ticks a second.
      tickSeconds: TICK_DT,
      game: createFathom(assets),
      // The stage background, which the runtime also clears the letterbox to.
      background: COLOR.fog,
    });

    // The state is complete before anything can observe it: `initialize` builds
    // it in one go and runs no tick.
    const state = runtime.initialize();

    // window.__fathom (see debug.ts and specs/instrumentation.md). Installed on
    // every build, and inert during normal play. It is handed the runtime as
    // well as the state, because three of its operations — `setAutoStep`,
    // `advance`, and the `autoStep` the snapshot reports — are about the clock,
    // and nothing outside this build owns that.
    installDebugApi(state, runtime);

    runtime.start();
  })
  .catch((error: unknown) => {
    console.error(error);
    drawHoldingCard("the art could not be loaded", COLOR.flarefish);
  });
