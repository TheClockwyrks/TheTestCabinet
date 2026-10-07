// Orrery — drawing the frame (specs/ui.md, specs/editor.md, specs/assets.md).
//
// Everything here is in the stage's logical units: the runtime has already put
// the canvas into the letterboxed transform, so a hex center drawn at
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
import type { Effects } from "./effects";
import { drawFieldScreen } from "./fielddraw";
import type { Game } from "./game";
import { drawHeading, drawReadout } from "./hud";
import type { Sprites } from "./images";
import { NO_SPRITES } from "./images";
import { drawFaultBanner, drawSolvedPanel } from "./panels";
import { drawHowto, drawSelect, drawTitle } from "./screens";
import { drawTapePanel } from "./tapedraw";
import { COLORS } from "./theme";
import { drawTray } from "./traydraw";

/** What the frame draws with: the produced sprites, and the live effects. */
export interface Presentation {
  /** The decoded sprites; `NO_SPRITES` where none loaded. */
  readonly sprites: Sprites;
  /** The particle effects playing right now, or `null` where none are. */
  readonly effects: Effects | null;
}

/** A presentation with no produced asset at all, which still draws a frame. */
export const PLAIN: Presentation = { sprites: NO_SPRITES, effects: null };

/** Draw the whole frame the state describes. */
export function render(
  ctx: CanvasRenderingContext2D,
  game: Game,
  view: Presentation = PLAIN,
): void {
  const { state } = game;
  ctx.save();
  ctx.fillStyle = COLORS.sky;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
  switch (state.screen) {
    case "title":
      drawTitle(ctx, state, view.sprites);
      break;
    case "howto":
      drawHowto(ctx, state);
      break;
    case "select":
      drawSelect(ctx, game);
      break;
    case "editor":
      drawEditor(ctx, game, view);
      break;
  }
  ctx.restore();
}

/**
 * The editor screen: the field and the run inside their region, then the three
 * panels around them, then whichever of the two overlays the run's status puts
 * up (specs/ui.md "The solved panel", "The fault display").
 */
function drawEditor(
  ctx: CanvasRenderingContext2D,
  game: Game,
  view: Presentation,
): void {
  const { state } = game;
  ctx.save();
  ctx.beginPath();
  ctx.rect(
    TRAY_REGION_W,
    HEADING_H,
    READOUT_X0 - TRAY_REGION_W,
    TAPE_Y0 - HEADING_H,
  );
  ctx.clip();
  drawFieldScreen(ctx, state, view.sprites);
  view.effects?.draw(ctx);
  ctx.restore();

  drawTray(ctx, state);
  drawTapePanel(ctx, state, view.sprites);
  drawReadout(ctx, state);
  drawHeading(ctx, game);

  const status = state.sim?.status ?? null;
  if (status === "faulted") drawFaultBanner(ctx, state);
  if (status === "complete") drawSolvedPanel(ctx, game);
}
