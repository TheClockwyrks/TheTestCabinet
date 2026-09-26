// Facet — the frame, drawn.
//
// One entry point, one switch on `state.screen`, and the drawing itself split
// by what it draws: the bench and the stones in `src/render.board.ts`, where a
// stone is at this instant in `src/motion.ts`, one gem in
// `src/render.gems.ts`, the readouts in `src/render.hud.ts`, and the five
// screens around the board in `src/render.screens.ts`.
//
// The renderer is a PURE FUNCTION OF THE STATE it is handed, plus the produced
// files and the presentation layer's own decorative clock. It reads nothing
// back and writes nothing anywhere, which is the direction
// `specs/instrumentation.md` fixes: "the simulation reads nothing from the
// renderer".
//
// Everything is drawn in logical units on the fixed 1280 x 720 stage. The
// runtime has already cleared the canvas to the stage background and installed
// the scale, the letterbox offset, and nearest-neighbor sampling, so nothing
// here looks at the window or at a device pixel.

import { drawBoard, drawField } from "./render.board";
import { drawHud } from "./render.hud";
import {
  drawGameOverScreen,
  drawHowToScreen,
  drawLevelClearScreen,
  drawPausedScreen,
  drawTitleScreen,
} from "./render.screens";
import type { AssetStore } from "./assets";
import type { FacetState } from "./core";
import type { Presentation } from "./effects";

/** Draw one frame of the game. */
export function renderGame(
  state: FacetState,
  ctx: CanvasRenderingContext2D,
  assets: AssetStore,
  presentation: Presentation,
): void {
  drawField(ctx);
  switch (state.screen) {
    case "title":
      drawTitleScreen(ctx, assets, state);
      return;
    case "howto":
      drawHowToScreen(ctx);
      return;
    case "playing":
      drawBoard(ctx, assets, state, presentation);
      drawHud(ctx, state);
      return;
    case "paused":
      drawBoard(ctx, assets, state, presentation);
      drawHud(ctx, state);
      drawPausedScreen(ctx, state);
      return;
    case "levelclear":
      drawBoard(ctx, assets, state, presentation);
      drawHud(ctx, state);
      drawLevelClearScreen(ctx, state);
      return;
    case "gameover":
      drawBoard(ctx, assets, state, presentation);
      drawHud(ctx, state);
      drawGameOverScreen(ctx, state);
      return;
  }
}
