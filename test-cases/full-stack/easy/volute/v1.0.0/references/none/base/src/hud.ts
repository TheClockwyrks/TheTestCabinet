// Volute — the HUD, the danger read, and the screens (specs/ui.md).
//
// Everything in this file is drawn in code over the finished hall, except the two
// produced icons the HUD's cells and gauge are marked with and the core sprites it
// draws the loaded and queued charges as.
//
// WHERE THE HUD SITS is not decoration. The channel winds through most of the
// field, and the HUD "draws over the hall and hides none of them", so it takes the
// one band the polyline leaves clear along its whole width: between the leg at
// `y = 120` and the leg at `y = 220`, clear of every leg by more than the plate's
// own half-width.

import { LEVEL_COUNT, PRESSURE_MAX, TITLE_TEXT } from "./constants";
import type { Assets } from "./assets";
import { CHARGE_COLOR, COLOR, FONT, fade } from "./theme";
import type { ChargeId } from "./constants";
import type { ReadonlyState } from "./types";

/**
 * The band the HUD occupies, in logical units: between the channel's leg at
 * `y = 120` and its leg at `y = 220`, clear of both by more than the plate's own
 * half-width.
 */
export const HUD = {
  x: 140,
  y: 145,
  w: 680,
  h: 50,
} as const;

/** Draw one line of text, and report how wide it was. */
export function text(
  ctx: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  options: {
    size?: number;
    color?: string;
    align?: CanvasTextAlign;
    baseline?: CanvasTextBaseline;
    mono?: boolean;
    weight?: string;
    tracking?: number;
  } = {},
): void {
  const size = options.size ?? 14;
  ctx.save();
  ctx.font = `${options.weight ?? "600"} ${size}px ${options.mono ? FONT.mono : FONT.family}`;
  ctx.fillStyle = options.color ?? COLOR.steelLit;
  ctx.textAlign = options.align ?? "left";
  ctx.textBaseline = options.baseline ?? "alphabetic";
  if (options.tracking !== undefined && options.tracking !== 0) {
    // Letter-spacing is not universally available, so a tracked label is drawn
    // glyph by glyph. Only short labels are set this way.
    const glyphs = [...value];
    const widths = glyphs.map((glyph) => ctx.measureText(glyph).width);
    const total =
      widths.reduce((sum, width) => sum + width, 0) +
      options.tracking * (glyphs.length - 1);
    let cursor =
      ctx.textAlign === "center"
        ? x - total / 2
        : ctx.textAlign === "right"
          ? x - total
          : x;
    ctx.textAlign = "left";
    glyphs.forEach((glyph, index) => {
      ctx.fillText(glyph, cursor, y);
      cursor += widths[index] + options.tracking!;
    });
  } else {
    ctx.fillText(value, x, y);
  }
  ctx.restore();
}

/** A filled rounded rectangle, the shape every panel in the game is cut from. */
export function panel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  stroke?: string,
): void {
  const radius = Math.min(10, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke !== undefined) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

/** One core sprite, centered, at a chosen size. */
export function drawCore(
  ctx: CanvasRenderingContext2D,
  assets: Assets,
  charge: ChargeId,
  x: number,
  y: number,
  size: number,
): void {
  const image = assets.cores[charge];
  ctx.drawImage(
    image,
    0,
    0,
    image.width,
    image.height,
    x - size / 2,
    y - size / 2,
    size,
    size,
  );
}

/**
 * The HUD: the score, the level, the cells, the pressure gauge, and the loaded and
 * queued charges.
 *
 * Drawn on `playing`, `paused`, `cleared` and `setback`.
 */
export function drawHud(
  ctx: CanvasRenderingContext2D,
  state: ReadonlyState,
  assets: Assets,
): void {
  panel(
    ctx,
    HUD.x,
    HUD.y,
    HUD.w,
    HUD.h,
    fade(COLOR.plateDeep, 0.9),
    fade(COLOR.plateBevel, 0.9),
  );

  const label = (value: string, x: number): void => {
    text(ctx, value, x, HUD.y + 16, {
      size: 9,
      color: COLOR.condensation,
      tracking: 1.5,
    });
  };

  label("SCORE", HUD.x + 18);
  text(ctx, String(state.score), HUD.x + 18, HUD.y + 40, {
    size: 22,
    mono: true,
    color: COLOR.lampLit,
  });

  label("LEVEL", HUD.x + 140);
  text(ctx, String(state.level), HUD.x + 140, HUD.y + 40, {
    size: 22,
    mono: true,
    color: COLOR.steelLit,
  });

  label("CELLS", HUD.x + 204);
  for (let i = 0; i < state.cells; i += 1) {
    ctx.drawImage(
      assets.cellIcon,
      0,
      0,
      assets.cellIcon.width,
      assets.cellIcon.height,
      HUD.x + 202 + i * 26,
      HUD.y + 20,
      24,
      24,
    );
  }

  drawGauge(ctx, state, assets, HUD.x + 292, HUD.y + HUD.h / 2);

  label("LOADED", HUD.x + 556);
  if (state.loaded !== null) {
    ctx.save();
    ctx.strokeStyle = fade(CHARGE_COLOR[state.loaded], 0.85);
    ctx.lineWidth = 1.5;
    ctx.strokeRect(HUD.x + 554, HUD.y + 20, 32, 26);
    ctx.restore();
    drawCore(ctx, assets, state.loaded, HUD.x + 570, HUD.y + 33, 26);
  }

  label("NEXT", HUD.x + 628);
  if (state.queued !== null) {
    ctx.save();
    ctx.globalAlpha = 0.8;
    drawCore(ctx, assets, state.queued, HUD.x + 640, HUD.y + 34, 20);
    ctx.restore();
  }
}

/** The pressure gauge: the produced icon, and a bar filled in proportion. */
function drawGauge(
  ctx: CanvasRenderingContext2D,
  state: ReadonlyState,
  assets: Assets,
  x: number,
  centerY: number,
): void {
  ctx.drawImage(
    assets.pressureIcon,
    0,
    0,
    assets.pressureIcon.width,
    assets.pressureIcon.height,
    x,
    centerY - 12,
    24,
    24,
  );

  const barX = x + 30;
  const barY = centerY - 9;
  const barW = 208;
  const barH = 18;

  ctx.save();
  ctx.fillStyle = fade("#05080a", 0.95);
  ctx.fillRect(barX, barY, barW, barH);

  const filled = Math.max(0, Math.min(1, state.pressure / PRESSURE_MAX));
  if (filled > 0) {
    const gradient = ctx.createLinearGradient(barX, 0, barX + barW, 0);
    gradient.addColorStop(0, COLOR.lamp);
    gradient.addColorStop(1, "#ff4a2c");
    ctx.fillStyle = gradient;
    ctx.fillRect(barX + 2, barY + 2, (barW - 4) * filled, barH - 4);
  }

  ctx.strokeStyle = fade(COLOR.plateBevel, 0.95);
  ctx.lineWidth = 1.5;
  ctx.strokeRect(barX, barY, barW, barH);
  ctx.strokeStyle = fade(COLOR.condensation, 0.8);
  for (let i = 1; i < 4; i += 1) {
    const tick = barX + (barW * i) / 4;
    ctx.beginPath();
    ctx.moveTo(tick, barY);
    ctx.lineTo(tick, barY + 4);
    ctx.stroke();
  }
  ctx.restore();
}

/** The warning the field carries while the run is in danger. */
export function drawDanger(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.strokeStyle = fade("#ff3f5e", 0.7);
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, 952, 532);
  ctx.restore();
  panel(ctx, 646, 246, 148, 34, fade("#3a0a14", 0.9), fade("#ff3f5e", 0.9));
  text(ctx, "DANGER", 720, 269, {
    size: 16,
    color: "#ff8090",
    align: "center",
    tracking: 3,
  });
}

/** A full-field scrim, so a screen's copy reads over whatever the hall is doing. */
function scrim(ctx: CanvasRenderingContext2D, alpha: number): void {
  ctx.save();
  ctx.fillStyle = fade(COLOR.field, alpha);
  ctx.fillRect(0, 0, 960, 540);
  ctx.restore();
}

/** The front door. */
export function drawTitle(ctx: CanvasRenderingContext2D, assets: Assets): void {
  scrim(ctx, 0.82);
  text(ctx, TITLE_TEXT, 480, 168, {
    size: 84,
    align: "center",
    color: COLOR.lampLit,
    tracking: 14,
  });
  text(ctx, "GEOTHERMAL PUMP HALL", 480, 198, {
    size: 12,
    align: "center",
    color: COLOR.condensation,
    tracking: 6,
  });

  panel(
    ctx,
    250,
    232,
    460,
    208,
    fade(COLOR.plateBase, 0.9),
    fade(COLOR.plateBevel, 0.9),
  );

  text(ctx, "PRESS ENTER TO BEGIN", 480, 268, {
    size: 20,
    align: "center",
    color: COLOR.steelLit,
    tracking: 2,
  });

  const rows: [string, string][] = [
    ["AIM", "MOUSE  /  ←  →"],
    ["FIRE", "SPACE  /  LEFT CLICK"],
    ["SWAP", "X  /  RIGHT CLICK"],
    ["PAUSE", "ESC"],
    ["MUTE", "M"],
  ];
  rows.forEach(([label, keys], index) => {
    const y = 306 + index * 26;
    text(ctx, label, 286, y, {
      size: 12,
      color: COLOR.condensation,
      tracking: 2,
    });
    text(ctx, keys, 674, y, { size: 12, color: COLOR.steel, align: "right" });
  });

  // The swap row names the two cores it exchanges, so the control reads without
  // the player having to be told which charge is which.
  drawCore(ctx, assets, "halide", 468, 353, 20);
  drawCore(ctx, assets, "garnet", 494, 353, 20);
}

/** The hall held still. */
export function drawPaused(ctx: CanvasRenderingContext2D): void {
  scrim(ctx, 0.55);
  panel(
    ctx,
    330,
    258,
    300,
    84,
    fade(COLOR.plateBase, 0.94),
    fade(COLOR.plateBevel, 0.9),
  );
  text(ctx, "PAUSED", 480, 300, {
    size: 32,
    align: "center",
    color: COLOR.lampLit,
    tracking: 6,
  });
  text(ctx, "ESC TO RESUME", 480, 326, {
    size: 12,
    align: "center",
    color: COLOR.condensation,
    tracking: 3,
  });
}

/** The interlude after a cleared level. */
export function drawCleared(
  ctx: CanvasRenderingContext2D,
  state: ReadonlyState,
): void {
  scrim(ctx, 0.5);
  panel(
    ctx,
    300,
    250,
    360,
    100,
    fade(COLOR.plateBase, 0.94),
    fade(COLOR.plateBevel, 0.9),
  );
  text(ctx, `LEVEL ${state.level} CLEAR`, 480, 292, {
    size: 28,
    align: "center",
    color: COLOR.lampLit,
    tracking: 4,
  });
  text(ctx, `SCORE ${state.score}`, 480, 324, {
    size: 16,
    align: "center",
    color: COLOR.steelLit,
    mono: true,
  });
}

/** The interlude after a core reached the intake. */
export function drawSetback(
  ctx: CanvasRenderingContext2D,
  state: ReadonlyState,
): void {
  scrim(ctx, 0.5);
  panel(ctx, 300, 250, 360, 100, fade("#2a1218", 0.94), fade("#ff3f5e", 0.8));
  text(ctx, "CELL SPENT", 480, 292, {
    size: 28,
    align: "center",
    color: "#ff8090",
    tracking: 4,
  });
  text(
    ctx,
    state.cells === 1 ? "1 CELL REMAINS" : `${state.cells} CELLS REMAIN`,
    480,
    324,
    { size: 16, align: "center", color: COLOR.steelLit },
  );
}

/** The end of a run with no cells left. */
export function drawGameOver(
  ctx: CanvasRenderingContext2D,
  state: ReadonlyState,
): void {
  scrim(ctx, 0.86);
  text(ctx, "GAME OVER", 480, 210, {
    size: 58,
    align: "center",
    color: "#ff8090",
    tracking: 10,
  });
  panel(
    ctx,
    320,
    250,
    320,
    120,
    fade(COLOR.plateBase, 0.92),
    fade(COLOR.plateBevel, 0.9),
  );
  text(ctx, "FINAL SCORE", 480, 282, {
    size: 11,
    align: "center",
    color: COLOR.condensation,
    tracking: 3,
  });
  text(ctx, String(state.score), 480, 316, {
    size: 30,
    align: "center",
    color: COLOR.lampLit,
    mono: true,
  });
  text(ctx, `REACHED LEVEL ${state.level} OF ${LEVEL_COUNT}`, 480, 350, {
    size: 13,
    align: "center",
    color: COLOR.steel,
  });
  text(ctx, "PRESS ENTER TO RETURN TO THE TITLE", 480, 404, {
    size: 13,
    align: "center",
    color: COLOR.steelLit,
    tracking: 2,
  });
}

/** The end of a run that cleared the last level. */
export function drawVictory(
  ctx: CanvasRenderingContext2D,
  state: ReadonlyState,
): void {
  scrim(ctx, 0.86);
  text(ctx, "HALL RUN CLEAN", 480, 210, {
    size: 52,
    align: "center",
    color: COLOR.lampLit,
    tracking: 8,
  });
  panel(
    ctx,
    320,
    250,
    320,
    120,
    fade(COLOR.plateBase, 0.92),
    fade(COLOR.plateBevel, 0.9),
  );
  text(ctx, "FINAL SCORE", 480, 282, {
    size: 11,
    align: "center",
    color: COLOR.condensation,
    tracking: 3,
  });
  text(ctx, String(state.score), 480, 316, {
    size: 30,
    align: "center",
    color: COLOR.lampLit,
    mono: true,
  });
  text(ctx, `ALL ${LEVEL_COUNT} LEVELS CLEARED`, 480, 350, {
    size: 13,
    align: "center",
    color: COLOR.steel,
  });
  text(ctx, "PRESS ENTER TO RETURN TO THE TITLE", 480, 404, {
    size: 13,
    align: "center",
    color: COLOR.steelLit,
    tracking: 2,
  });
}
