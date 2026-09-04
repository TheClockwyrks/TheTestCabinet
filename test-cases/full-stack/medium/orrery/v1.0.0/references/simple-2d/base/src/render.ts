// Orrery — drawing the frame (specs/ui.md, specs/editor.md, specs/assets.md).
//
// Everything here is in the stage's logical units: the engine hands `render` a
// context already carrying the letterboxed transform, so a hex center drawn at
// `hexX(q, r)` lands where the pointer targets it, and a sprite drawn at its
// native canvas size covers exactly the units specs/assets.md says it covers.
//
// This module is the composer and nothing else. Each screen and each region of
// the editor is drawn by the module that owns it — `src/screens.ts`,
// `src/fielddraw.ts`, `src/traydraw.ts`, `src/tapedraw.ts`, `src/hud.ts` and
// `src/panels.ts` — and what is decided here is only the ORDER they are drawn
// in and what each is handed.
//
// The field is drawn CLIPPED to its own region. Motes rest off the field
// freely, and an effect is a soft cloud around its event, so clipping is what
// keeps the run inside the region specs/editor.md gives it rather than spilling
// over the tray and the readout.

import {
  HEADING_H,
  READOUT_X0,
  STAGE_H,
  STAGE_W,
  TAPE_Y0,
  TRAY_REGION_W,
} from "./constants";
import { drawEffects } from "./effects";
import { drawFieldScreen } from "./fielddraw";
import { drawHeading, drawReadout } from "./hud";
import { sprites } from "./images";
import { drawFaultBanner, drawSolvedPanel } from "./panels";
import { drawHowto, drawSelect, drawTitle } from "./screens";
import { drawTapePanel } from "./tapedraw";
import { COLORS } from "./theme";
import { drawTray } from "./traydraw";
import type { OrreryState } from "./types";

/** Draw the whole frame the state describes. */
export function render(
  ctx: CanvasRenderingContext2D,
  state: OrreryState,
): void {
  ctx.save();
  ctx.fillStyle = COLORS.sky;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
  switch (state.screen) {
    case "title":
      drawTitle(ctx, state, sprites());
      break;
    case "howto":
      drawHowto(ctx, state);
      break;
    case "select":
      drawSelect(ctx, state);
      break;
    case "editor":
      drawEditor(ctx, state);
      break;
  }
  ctx.restore();
}

/**
 * The editor screen: the field and the run inside their region, then the three
 * panels around them, then whichever of the two overlays the run's status puts
 * up (specs/ui.md "The solved panel", "The fault display").
 */
function drawEditor(ctx: CanvasRenderingContext2D, state: OrreryState): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(
    TRAY_REGION_W,
    HEADING_H,
    READOUT_X0 - TRAY_REGION_W,
    TAPE_Y0 - HEADING_H,
  );
  ctx.clip();
  drawFieldScreen(ctx, state, sprites());
  drawEffects(ctx);
  ctx.restore();

  drawTray(ctx, state);
  drawTapePanel(ctx, state, sprites());
  drawReadout(ctx, state);
  drawHeading(ctx, state);

  const status = state.sim?.status ?? null;
  if (status === "faulted") drawFaultBanner(ctx, state);
  if (status === "complete") drawSolvedPanel(ctx, state);
}
