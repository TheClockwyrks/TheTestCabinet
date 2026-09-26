// Facet — the frame, drawn, in two layers.
//
// The engine's pipeline collects every enabled, visible render component,
// orders it by layer, and calls each in turn, so the picture is split where the
// ordering matters: the FIELD LAYER draws the wash, the bench, the stones, and
// the effects a chain throws; the SCREEN LAYER draws the readouts and whichever
// screen's chrome is showing over them. `src/bench.ts` attaches one of each.
//
// The drawing itself is split by what it draws: the bench, the stones and where
// this instant puts them in `src/render.board.ts`, one gem in
// `src/render.gems.ts`, the readouts and the pause control in
// `src/render.hud.ts`, and the five screens around the board in
// `src/render.screens.ts`.
//
// The renderer is a PURE FUNCTION OF THE STATE it is handed, plus the produced
// files and the presentation layer's own decorative clocks. It reads nothing
// back and writes nothing anywhere, which is the direction
// `specs/instrumentation.md` fixes: "the simulation reads nothing from the
// renderer".
//
// Everything is drawn in world units. The engine has cleared the canvas to the
// stage background and installed the world-to-device transform, and the game
// leaves the camera at rest, so world units and the stage's logical units
// coincide and nothing here looks at the window or at a device pixel.

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
import type { FacetState } from "./game";
import type { Presentation } from "./effects";

/** Whether a board is on the stage behind whatever chrome is showing. */
export function showsBoard(state: FacetState): boolean {
  return (
    state.screen === "playing" ||
    state.screen === "paused" ||
    state.screen === "levelclear" ||
    state.screen === "gameover"
  );
}

/** The lower layer: the field the board sits on, the board, and its effects. */
export function renderBoardLayer(
  state: FacetState,
  ctx: CanvasRenderingContext2D,
  assets: AssetStore,
  presentation: Presentation,
): void {
  drawField(ctx);
  if (showsBoard(state)) drawBoard(ctx, assets, state, presentation);
}

/** The upper layer: the readouts, and the current screen's chrome over them. */
export function renderUiLayer(
  state: FacetState,
  ctx: CanvasRenderingContext2D,
  assets: AssetStore,
): void {
  switch (state.screen) {
    case "title":
      drawTitleScreen(ctx, assets, state);
      return;
    case "howto":
      drawHowToScreen(ctx);
      return;
    case "playing":
      drawHud(ctx, state);
      return;
    case "paused":
      drawHud(ctx, state);
      drawPausedScreen(ctx, state);
      return;
    case "levelclear":
      drawHud(ctx, state);
      drawLevelClearScreen(ctx, state);
      return;
    case "gameover":
      drawHud(ctx, state);
      drawGameOverScreen(ctx, state);
      return;
  }
}
