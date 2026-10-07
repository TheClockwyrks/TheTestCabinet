// Spectra — the two HUD strips and the five readouts they carry
// (`specs/field.md`, `specs/ui.md`).
//
// The strips are painted after the field, so a drone crossing one in transit is
// hidden behind it rather than drawn over a readout. The mute indicator is the one
// thing about either strip that muting changes, and it is drawn on every screen
// because mute is reached from every screen.

import {
  BAND_LABELS,
  HUD_BOTTOM_TOP,
  HUD_STAGE_LABEL,
  HUD_TOP_H,
  RESONANCE_MAX,
  STAGE_H,
} from "./constants";
import { accent, drawSprite, fallbackBody, label } from "./draw";
import { BAND_COLOR, BAND_DIM, COLOR, TINT, font } from "./theme";
import type { SpectraState } from "./game";
import type { DeepReadonly } from "ts-essentials";

/** Both strips, and the rule that separates each from the play field. */
export function drawStrips(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = COLOR.hud;
  ctx.fillRect(0, 0, 1280, HUD_TOP_H);
  ctx.fillRect(0, HUD_BOTTOM_TOP, 1280, STAGE_H - HUD_BOTTOM_TOP);
  ctx.fillStyle = COLOR.hudEdge;
  ctx.fillRect(0, HUD_TOP_H - 1, 1280, 1);
  ctx.fillRect(0, HUD_BOTTOM_TOP, 1280, 1);
}

/** The lives remaining, as a row of fighters. */
function drawLives(
  ctx: CanvasRenderingContext2D,
  state: DeepReadonly<SpectraState>,
): void {
  const y = 688;
  const shown = Math.min(state.lives, 5);
  for (let i = 0; i < shown; i++) {
    const x = 52 + i * 30;
    const drawn = drawSprite(
      ctx,
      state.art,
      "fighter",
      x,
      y,
      24,
      17,
      state.ship.band,
      TINT.ship,
    );
    if (!drawn) fallbackBody(ctx, state.ship.band, x, y, 16);
  }
  if (state.lives > 5) {
    label(ctx, `x${state.lives}`, 52 + 5 * 30, y + 6, 20, COLOR.text);
  }
}

/** The resonance meter, and the mark a full one carries. */
function drawResonance(
  ctx: CanvasRenderingContext2D,
  state: DeepReadonly<SpectraState>,
): void {
  const x = 300;
  const y = 678;
  const w = 300;
  const h = 20;
  const full = state.resonance >= RESONANCE_MAX;
  ctx.fillStyle = BAND_DIM[state.ship.band];
  ctx.fillRect(x, y, w, h);
  const share = Math.max(0, Math.min(1, state.resonance / RESONANCE_MAX));
  ctx.fillStyle = full ? COLOR.textBright : BAND_COLOR[state.ship.band];
  ctx.fillRect(x, y, w * share, h);
  ctx.strokeStyle = full ? COLOR.accent : COLOR.hudEdge;
  ctx.lineWidth = full ? 3 : 1;
  ctx.strokeRect(x - 1, y - 1, w + 2, h + 2);
  label(ctx, "RESONANCE", x, y - 5, 12, COLOR.textDim);
  if (full) label(ctx, "DISCHARGE READY", x + w + 10, y + 15, 14, COLOR.accent);
}

/** The polarity indicator, which always agrees with the band drawn on the ship. */
function drawPolarity(
  ctx: CanvasRenderingContext2D,
  state: DeepReadonly<SpectraState>,
): void {
  const band = state.ship.band;
  const x = 1000;
  const y = 688;
  ctx.fillStyle = BAND_DIM[band];
  ctx.fillRect(x - 24, y - 20, 210, 40);
  ctx.fillStyle = BAND_COLOR[band];
  ctx.beginPath();
  ctx.arc(x, y, 11, 0, Math.PI * 2);
  ctx.fill();
  accent(ctx, band, x, y, 17, 2.5);
  label(ctx, BAND_LABELS[band], x + 30, y + 7, 22, BAND_COLOR[band]);
}

/** Every readout the run's own screens carry. */
export function drawHud(
  ctx: CanvasRenderingContext2D,
  state: DeepReadonly<SpectraState>,
): void {
  label(ctx, String(state.score), 40, 46, 36, COLOR.textBright);
  // The label and the digits are drawn apart, so each reads as itself.
  label(ctx, String(state.stage), 1240, 44, 24, COLOR.textBright, "right");
  ctx.font = font(24);
  const digits = ctx.measureText(String(state.stage)).width;
  label(ctx, HUD_STAGE_LABEL, 1228 - digits, 44, 24, COLOR.text, "right");
  drawLives(ctx, state);
  drawResonance(ctx, state);
  drawPolarity(ctx, state);
}

/** The mute indicator, drawn while sound is muted and absent while it is not. */
export function drawMuteIndicator(ctx: CanvasRenderingContext2D): void {
  label(ctx, "MUTE", 1240, 695, 20, COLOR.accent, "right");
}
