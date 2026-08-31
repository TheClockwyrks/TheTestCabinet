// Wick — one frame's picture, by screen (specs/ui.md "Screens").
//
// The world is drawn beneath every screen but `howto`, frozen where the last
// tick left it, and the screen's own chrome over it.

import type { Assets } from "../assets";
import type { WickState } from "../state";
import { drawHud } from "./hud";
import {
  drawChest,
  drawEnd,
  drawHowto,
  drawLevelUp,
  drawPaused,
  drawTitle,
} from "./screens";
import { drawWorld } from "./world";

/** Draw the frame `state` describes onto a context in logical units. */
export function render(
  ctx: CanvasRenderingContext2D,
  state: WickState,
  assets: Assets,
): void {
  const { run } = state;
  switch (state.screen) {
    case "title":
      drawWorld(ctx, run, assets);
      drawTitle(ctx, state, assets);
      break;
    case "howto":
      drawWorld(ctx, run, assets);
      drawHowto(ctx);
      break;
    case "playing":
      drawWorld(ctx, run, assets);
      drawHud(ctx, run, assets);
      break;
    case "levelup":
      drawWorld(ctx, run, assets);
      drawHud(ctx, run, assets);
      drawLevelUp(ctx, state, assets);
      break;
    case "chest":
      drawWorld(ctx, run, assets);
      drawHud(ctx, run, assets);
      drawChest(ctx, state, assets);
      break;
    case "paused":
      drawWorld(ctx, run, assets);
      drawHud(ctx, run, assets);
      drawPaused(ctx);
      break;
    case "fallen":
    case "dawn":
      drawWorld(ctx, run, assets);
      drawEnd(ctx, state);
      break;
  }
}
