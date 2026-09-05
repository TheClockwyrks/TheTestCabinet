// Volute — the HUD, the danger read, and the seven screens (specs/ui.md).
//
// Everything here is drawn in code over the finished hall, except the two
// produced icons the cells and the gauge are marked with and the core sprites
// the loaded and queued charges are drawn as — `specs/ui.md` asks that wherever
// a screen names a charge it draws that charge's core.
//
// WHERE THE HUD SITS is not decoration. The channel winds through most of the
// field and the HUD "draws over the hall and hides none of them", so it takes
// the one band the polyline leaves clear along its whole width: between the leg
// at `y = 120` and the leg at `y = 220`, clear of both by more than the plate's
// own half-width.

import { Actor, DrawComponent, type DrawApi } from "@clockwyrks/structured-2d";
import { assets } from "./assets";
import {
  FIELD_H,
  FIELD_W,
  LEVEL_COUNT,
  PRESSURE_MAX,
  TITLE_TEXT,
} from "./constants";
import { panel, sprite, text } from "./draw";
import { HallMode, inDanger } from "./hall-mode";
import type { HallState } from "./state";
import { CHARGE_COLOR, COLOR, LAYER, fade } from "./theme";

/**
 * The band the HUD occupies, in logical units: between the channel's leg at
 * `y = 120` and its leg at `y = 220`, clear of both by more than the plate's own
 * half-width.
 */
export const HUD = { x: 140, y: 145, w: 680, h: 50 } as const;

/** The screens the HUD is drawn on (specs/ui.md, "The HUD"). */
function hudIsDrawn(state: HallState): boolean {
  return (
    state.screen === "playing" ||
    state.screen === "paused" ||
    state.screen === "cleared" ||
    state.screen === "setback"
  );
}

/** The run's six readouts, and the danger the hall carries while it holds. */
class HudDraw extends DrawComponent {
  constructor() {
    super();
    this.layer = LAYER.hud;
  }

  draw(api: DrawApi): void {
    if (api.mode !== "shaded") return;
    const mode = this.world.mode;
    if (!(mode instanceof HallMode)) return;
    const state = mode.state;
    const { ctx } = api;

    if (hudIsDrawn(state)) drawHud(ctx, mode);
    // The pause draws the hall exactly as the tick that paused it left it, so
    // the warning stands through a pause as well.
    if (
      (state.screen === "playing" || state.screen === "paused") &&
      inDanger(state)
    ) {
      drawDanger(ctx);
    }
  }
}

/** The HUD: the score, the level, the cells, the gauge, the loaded and queued. */
function drawHud(ctx: CanvasRenderingContext2D, mode: HallMode): void {
  const state = mode.state;
  const art = assets();
  const injector = mode.injector();

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
    sprite(ctx, art.cellIcon, HUD.x + 214 + i * 26, HUD.y + 32, 24);
  }

  drawGauge(ctx, state, HUD.x + 292, HUD.y + HUD.h / 2);

  label("LOADED", HUD.x + 556);
  if (injector.loaded !== null) {
    ctx.save();
    ctx.strokeStyle = fade(CHARGE_COLOR[injector.loaded], 0.85);
    ctx.lineWidth = 1.5;
    ctx.strokeRect(HUD.x + 554, HUD.y + 20, 32, 26);
    ctx.restore();
    sprite(ctx, art.cores[injector.loaded], HUD.x + 570, HUD.y + 33, 26);
  }

  label("NEXT", HUD.x + 628);
  if (injector.queued !== null) {
    ctx.save();
    ctx.globalAlpha = 0.8;
    sprite(ctx, art.cores[injector.queued], HUD.x + 640, HUD.y + 34, 20);
    ctx.restore();
  }
}

/** The pressure gauge: the produced icon, and a bar filled in proportion. */
function drawGauge(
  ctx: CanvasRenderingContext2D,
  state: HallState,
  x: number,
  centerY: number,
): void {
  sprite(ctx, assets().pressureIcon, x + 12, centerY, 24);

  const barX = x + 30;
  const barY = centerY - 9;
  const barW = 208;
  const barH = 18;

  ctx.save();
  ctx.fillStyle = "rgba(5, 8, 10, 0.95)";
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
function drawDanger(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.strokeStyle = fade(COLOR.alarm, 0.7);
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, FIELD_W - 8, FIELD_H - 8);
  ctx.restore();
  panel(
    ctx,
    646,
    246,
    148,
    34,
    "rgba(58, 10, 20, 0.9)",
    fade(COLOR.alarm, 0.9),
  );
  text(ctx, "DANGER", 720, 269, {
    size: 16,
    color: COLOR.alarmLit,
    align: "center",
    tracking: 3,
  });
}

/** The run's readouts, over the hall. */
export class Hud extends Actor {
  constructor() {
    super();
    this.attach(new HudDraw());
    this.tickEnabled = false;
  }
}

/** A full-field scrim, so a screen's copy reads over whatever the hall is doing. */
function scrim(ctx: CanvasRenderingContext2D, alpha: number): void {
  ctx.save();
  ctx.fillStyle = fade(COLOR.field, alpha);
  ctx.fillRect(0, 0, FIELD_W, FIELD_H);
  ctx.restore();
}

/** Whichever of the seven screens the game is showing, over everything else. */
class ScreensDraw extends DrawComponent {
  constructor() {
    super();
    this.layer = LAYER.screen;
  }

  draw(api: DrawApi): void {
    if (api.mode !== "shaded") return;
    const mode = this.world.mode;
    if (!(mode instanceof HallMode)) return;
    const state = mode.state;
    const { ctx } = api;

    switch (state.screen) {
      case "title":
        drawTitle(ctx);
        break;
      case "paused":
        drawPaused(ctx);
        break;
      case "cleared":
        drawCleared(ctx, state);
        break;
      case "setback":
        drawSetback(ctx, state);
        break;
      case "gameover":
        drawEnding(ctx, state, "over");
        break;
      case "victory":
        drawEnding(ctx, state, "won");
        break;
      case "playing":
        break;
    }
  }
}

/** The front door. */
function drawTitle(ctx: CanvasRenderingContext2D): void {
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

  const rows: readonly (readonly [string, string])[] = [
    ["AIM", "MOUSE  /  ←  →"],
    ["FIRE", "SPACE  /  CLICK"],
    ["SWAP", "X"],
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
  const art = assets();
  sprite(ctx, art.cores.halide, 468, 353, 20);
  sprite(ctx, art.cores.garnet, 494, 353, 20);
}

/** The hall held still. */
function drawPaused(ctx: CanvasRenderingContext2D): void {
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
function drawCleared(ctx: CanvasRenderingContext2D, state: HallState): void {
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
function drawSetback(ctx: CanvasRenderingContext2D, state: HallState): void {
  scrim(ctx, 0.5);
  panel(
    ctx,
    300,
    250,
    360,
    100,
    "rgba(42, 18, 24, 0.94)",
    fade(COLOR.alarm, 0.8),
  );
  text(ctx, "CELL SPENT", 480, 292, {
    size: 28,
    align: "center",
    color: COLOR.alarmLit,
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

/** Either ending: the run that ran out of cells, and the run that cleared the hall. */
function drawEnding(
  ctx: CanvasRenderingContext2D,
  state: HallState,
  outcome: "over" | "won",
): void {
  const won = outcome === "won";
  scrim(ctx, 0.86);
  text(ctx, won ? "HALL RUN CLEAN" : "GAME OVER", 480, 210, {
    size: won ? 52 : 58,
    align: "center",
    color: won ? COLOR.lampLit : COLOR.alarmLit,
    tracking: won ? 8 : 10,
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
  text(
    ctx,
    won
      ? `ALL ${LEVEL_COUNT} LEVELS CLEARED`
      : `REACHED LEVEL ${state.level} OF ${LEVEL_COUNT}`,
    480,
    350,
    { size: 13, align: "center", color: COLOR.steel },
  );
  text(ctx, "PRESS ENTER TO RETURN TO THE TITLE", 480, 404, {
    size: 13,
    align: "center",
    color: COLOR.steelLit,
    tracking: 2,
  });
}

/** Whichever screen is showing, drawn last. */
export class Screens extends Actor {
  constructor() {
    super();
    this.attach(new ScreensDraw());
    this.tickEnabled = false;
  }
}
