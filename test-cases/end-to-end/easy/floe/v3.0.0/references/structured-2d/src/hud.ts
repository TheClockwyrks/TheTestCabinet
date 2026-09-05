// Floe — the HUD bar, drawn in code.
//
// `specs/ui.md` fixes the five readouts the bar carries and leaves their
// arrangement and styling to the build, so the figures behind the layout live in
// `src/theme.ts`. The bar itself is `specs/strait.md`'s full-width strip above
// the strait, and nothing drawn on the strait is drawn inside it: the bar is an
// opaque panel on the HUD layer, above every body and below the screens.

import { Actor, DrawComponent, type DrawApi } from "@clockwyrks/structured-2d";
import {
  BAY_COUNT,
  HUD_H,
  HUD_LEVEL_LABEL,
  STAGE_W,
  TOTAL_LEVELS,
} from "./constants";
import { bayCenterX } from "./grid";
import { floeState } from "./game";
import { COLOR, HUD, LAYER, MONO_FONT } from "./theme";

class HudArt extends DrawComponent {
  draw(api: DrawApi): void {
    const { ctx } = api;
    const state = floeState(this.world);

    ctx.fillStyle = COLOR.panel;
    ctx.fillRect(0, 0, STAGE_W, HUD_H);
    ctx.fillStyle = COLOR.panelEdge;
    ctx.fillRect(0, HUD_H - 2, STAGE_W, 2);

    ctx.font = `700 ${HUD.fontPx}px ${MONO_FONT}`;
    ctx.fillStyle = COLOR.text;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(`SCORE ${state.score}`, HUD.scoreX, HUD.textY);
    ctx.fillText(`LIVES ${state.lives}`, HUD.livesX, HUD.textY);
    ctx.fillText(
      `${HUD_LEVEL_LABEL} ${state.level} / ${TOTAL_LEVELS}`,
      HUD.levelX,
      HUD.textY,
    );
    ctx.textAlign = "right";
    ctx.fillText(`TIME ${Math.ceil(state.timer)}`, HUD.timerX, HUD.textY);
    ctx.textAlign = "left";

    // The fifth readout: one mark per bay, each above that bay's own columns.
    for (let bay = 0; bay < BAY_COUNT; bay += 1) {
      const x = bayCenterX(bay) - HUD.bayW / 2;
      ctx.fillStyle = state.bays[bay] ? COLOR.bayFilled : COLOR.bayOpen;
      ctx.fillRect(x, HUD.bayY, HUD.bayW, HUD.bayH);
      ctx.strokeStyle = COLOR.textDim;
      ctx.lineWidth = 2;
      ctx.strokeRect(x, HUD.bayY, HUD.bayW, HUD.bayH);
    }
  }
}

/** The HUD bar and its five readouts. */
export class Hud extends Actor {
  constructor() {
    super();
    this.attach(new HudArt()).layer = LAYER.hud;
  }
}
