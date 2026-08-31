// Wick — one frame's picture, by screen (specs/ui.md "Screens").
//
// The world is drawn beneath every screen, frozen where the last tick left
// it, and the screen's own chrome over it. The state arrives read-only and
// the produced sprites come from the module table `src/assets.ts` holds.

import type { DeepReadonly } from "ts-essentials";
import type { WickState } from "../game";
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
export function renderGame(
  ctx: CanvasRenderingContext2D,
  state: DeepReadonly<WickState>,
): void {
  const { run } = state;
  ctx.imageSmoothingEnabled = false;
  switch (state.screen) {
    case "title":
      drawWorld(ctx, run);
      drawTitle(ctx, state);
      break;
    case "howto":
      drawWorld(ctx, run);
      drawHowto(ctx);
      break;
    case "playing":
      drawWorld(ctx, run);
      drawHud(ctx, run);
      break;
    case "levelup":
      drawWorld(ctx, run);
      drawHud(ctx, run);
      drawLevelUp(ctx, state);
      break;
    case "chest":
      drawWorld(ctx, run);
      drawHud(ctx, run);
      drawChest(ctx, state);
      break;
    case "paused":
      drawWorld(ctx, run);
      drawHud(ctx, run);
      drawPaused(ctx);
      break;
    case "fallen":
    case "dawn":
      drawWorld(ctx, run);
      drawEnd(ctx, state);
      break;
  }
}
