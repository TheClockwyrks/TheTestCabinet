// Spectra — everything the game draws.
//
// One pure read of the state, per frame, into one 2D context already carrying the
// logical transform (`src/runtime.ts`). Nothing here writes to the state, so what
// a frame decides never depends on what was drawn — which is what makes the
// simulation driveable from code with no canvas at all.
//
// The stage's three regions come from `specs/field.md`, the readouts and the seven
// screens from `specs/ui.md`, and what is drawn from the seeded art against what
// is drawn in code from `specs/assets.md`. The palette and the type are this
// build's own (`src/theme.ts`).
//
// TWO RULES ABOUT BANDS RUN THROUGH THE WHOLE FILE:
//
//   * An entity is drawn in the band it READS as — its effective band — because
//     that is the band a player has to shoot or shield against. An inversion
//     therefore repaints the field, and the field-wide mark says why.
//   * A band is never colour alone. Cyan carries a ring and magenta a diamond,
//     drawn in code over the seeded silhouette, so the two stay apart for a
//     colourblind player.

import {
  BAND_LABELS,
  CHALLENGE_BANNER,
  CHALLENGE_TOTAL,
  DISCHARGE_MAX_R,
  ENEMY_BULLET_H,
  ENEMY_BULLET_W,
  FIELD_BOTTOM,
  FIELD_TOP,
  HUD_BOTTOM_TOP,
  HUD_STAGE_LABEL,
  HUD_TOP_H,
  PERFECT_TEXT,
  PLAYER_BULLET_H,
  PLAYER_BULLET_W,
  READY_TEXT,
  RESONANCE_MAX,
  SHIP_H,
  SHIP_W,
  SHIP_Y,
  STAGE_H,
  STAGE_W,
  TAGLINE_TEXT,
  TITLE_TEXT,
  isChallengeStage,
  type Band,
} from "./constants";
import {
  dischargeReady,
  droneFootprint,
  effectiveBulletBand,
  effectiveDroneBand,
  inversionActive,
  isShimmering,
} from "./bands";
import { drawBursts } from "./bursts";
import { highlightedItem, itemBaselineY, menuOf } from "./menus";
import { drawStars } from "./starfield";
import { BAND_COLOR, COLOR, FONT } from "./theme";
import type { Bullet, Drone, SpectraState } from "./types";

/** The play field's height, for the clip every field draw sits inside. */
const FIELD_H = FIELD_BOTTOM - FIELD_TOP;

/** How a run of text is placed. */
interface TextStyle {
  size: number;
  color?: string;
  align?: CanvasTextAlign;
  weight?: string;
  baseline?: CanvasTextBaseline;
}

/** One run of text, in the build's own type. */
function text(
  ctx: CanvasRenderingContext2D,
  content: string,
  x: number,
  y: number,
  style: TextStyle,
): void {
  ctx.font = `${style.weight ?? "500"} ${style.size}px ${FONT}`;
  ctx.fillStyle = style.color ?? COLOR.text;
  ctx.textAlign = style.align ?? "left";
  ctx.textBaseline = style.baseline ?? "alphabetic";
  ctx.fillText(content, x, y);
}

/** A band's accent, drawn in code: a ring for cyan, a diamond for magenta. */
export function drawAccent(
  ctx: CanvasRenderingContext2D,
  band: Band,
  x: number,
  y: number,
  radius: number,
): void {
  const color = BAND_COLOR[band];
  ctx.save();
  ctx.translate(x, y);
  ctx.shadowColor = color;
  ctx.shadowBlur = radius * 1.6;
  if (band === "cyan") {
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1.4, radius * 0.42);
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, -radius);
    ctx.lineTo(radius, 0);
    ctx.lineTo(0, radius);
    ctx.lineTo(-radius, 0);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/** The whole frame. */
export function renderSpectra(
  state: SpectraState,
  ctx: CanvasRenderingContext2D,
): void {
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  switch (state.screen) {
    case "title":
      drawTitle(state, ctx);
      break;
    case "howto":
      drawHowTo(state, ctx);
      break;
    default:
      drawStage(state, ctx);
      break;
  }

  ctx.restore();
}

/* -------------------------------------------------------------------------- */
/* The stage                                                                  */
/* -------------------------------------------------------------------------- */

/** The field, the HUD strips, and whatever the current screen lays over them. */
function drawStage(state: SpectraState, ctx: CanvasRenderingContext2D): void {
  // The three regions.
  ctx.fillStyle = COLOR.field;
  ctx.fillRect(0, FIELD_TOP, STAGE_W, FIELD_H);
  ctx.fillStyle = COLOR.hud;
  ctx.fillRect(0, 0, STAGE_W, HUD_TOP_H);
  ctx.fillRect(0, HUD_BOTTOM_TOP, STAGE_W, STAGE_H - HUD_BOTTOM_TOP);
  ctx.fillStyle = COLOR.rule;
  ctx.fillRect(0, FIELD_TOP - 1, STAGE_W, 1);
  ctx.fillRect(0, HUD_BOTTOM_TOP, STAGE_W, 1);

  // Everything the field carries is drawn INSIDE the field: the ship, the drones
  // and the bullets are the play field's, and clipping them there is what keeps
  // the two HUD strips carrying nothing but their own readouts. A drone crossing
  // a strip in transit — one flying in from above, or a dive wrapping through the
  // bottom — is off the field for those few frames and simply is not drawn.
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, FIELD_TOP, STAGE_W, FIELD_H);
  ctx.clip();
  drawStars(ctx, state.stars);
  if (inversionActive(state)) drawInversionWash(ctx);
  drawBursts(ctx, state);
  for (const drone of state.drones) drawDrone(state, ctx, drone);
  for (const bullet of state.bullets) drawBullet(state, ctx, bullet);
  if (state.screen === "inWave" && state.phase === "live") drawShip(state, ctx);
  if (state.discharge.active) drawDischarge(state, ctx);
  ctx.restore();
  if (inversionActive(state)) drawInversionFrame(state, ctx);

  drawHud(state, ctx);

  switch (state.screen) {
    case "stageIntro":
      drawStageIntro(state, ctx);
      break;
    case "inWave":
      if (state.phase === "ready") {
        banner(ctx, READY_TEXT, COLOR.text);
      }
      break;
    case "paused":
      drawPaused(state, ctx);
      break;
    case "stageCleared":
      drawStageCleared(state, ctx);
      break;
    case "gameOver":
      drawGameOver(state, ctx);
      break;
    default:
      break;
  }
}

/* -------------------------------------------------------------------------- */
/* The field                                                                  */
/* -------------------------------------------------------------------------- */

/** The ship, from the seeded fighter art, with its band on it. */
function drawShip(state: SpectraState, ctx: CanvasRenderingContext2D): void {
  const { x, band } = state.ship;
  const color = BAND_COLOR[band];
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = 12;
  ctx.drawImage(
    state.art.fighter[band],
    x - SHIP_W / 2,
    SHIP_Y - SHIP_H / 2,
    SHIP_W,
    SHIP_H,
  );
  ctx.restore();
  drawAccent(ctx, band, x, SHIP_Y, SHIP_W * 0.13);
}

/** One drone, from its seeded silhouette, in the band it reads as. */
function drawDrone(
  state: SpectraState,
  ctx: CanvasRenderingContext2D,
  drone: Drone,
): void {
  const band = effectiveDroneBand(state, drone);
  const size = droneFootprint(drone);
  const sprite = droneSprite(state, drone, band);
  const shimmering = isShimmering(state, drone);

  ctx.save();
  // A shimmering Flux is haloed white rather than in a band's colour, because it
  // is settled on neither.
  ctx.shadowColor = shimmering ? "#ffffff" : BAND_COLOR[band];
  ctx.shadowBlur = shimmering ? 16 : 9;
  ctx.drawImage(sprite, drone.x - size / 2, drone.y - size / 2, size, size);
  ctx.restore();

  if (shimmering) {
    // Both accents at once, faintly: it is between the two.
    ctx.save();
    ctx.globalAlpha = 0.5;
    drawAccent(ctx, "cyan", drone.x - size * 0.2, drone.y, size * 0.1);
    drawAccent(ctx, "magenta", drone.x + size * 0.2, drone.y, size * 0.1);
    ctx.restore();
    return;
  }
  drawAccent(ctx, band, drone.x, drone.y, size * 0.16);
}

/** The seeded silhouette a drone is drawn from, in the band it reads as. */
function droneSprite(
  state: SpectraState,
  drone: Drone,
  band: Band,
): CanvasImageSource {
  switch (drone.kind) {
    case "shard":
      return state.art.shard[band];
    case "flux":
      return isShimmering(state, drone)
        ? state.art.fluxShimmer
        : state.art.fluxHeld[band];
    case "prism":
      // `effectiveDroneBand` already exposes the core once the shell is broken,
      // so one key serves both layers.
      return drone.shellAlive
        ? state.art.prismFull[band]
        : state.art.prismCore[band];
  }
}

/**
 * A filled vertical capsule: a rectangle with a semicircular cap at each end.
 *
 * Written out rather than reached for through `roundRect`, so the same drawing
 * code runs through a browser context and through the one a test stands up. Both
 * bullets are taller than they are wide, which is the only case it covers.
 */
function capsule(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  w: number,
  h: number,
): void {
  const r = Math.min(w, h) / 2;
  const left = cx - w / 2;
  const right = cx + w / 2;
  const top = cy - h / 2;
  const bottom = cy + h / 2;
  ctx.beginPath();
  ctx.moveTo(left, top + r);
  ctx.arc(cx, top + r, r, Math.PI, 0);
  ctx.lineTo(right, bottom - r);
  ctx.arc(cx, bottom - r, r, 0, Math.PI);
  ctx.closePath();
  ctx.fill();
}

/** One bullet, drawn in code, in its band's colour and accent. */
function drawBullet(
  state: SpectraState,
  ctx: CanvasRenderingContext2D,
  bullet: Bullet,
): void {
  const band = effectiveBulletBand(state, bullet);
  const color = BAND_COLOR[band];
  const w = bullet.friendly ? PLAYER_BULLET_W : ENEMY_BULLET_W;
  const h = bullet.friendly ? PLAYER_BULLET_H : ENEMY_BULLET_H;
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;
  ctx.fillStyle = color;
  capsule(ctx, bullet.x, bullet.y, w, h);
  // A white core, so a bullet reads against the field along its whole lane.
  ctx.fillStyle = "#ffffff";
  ctx.globalAlpha = 0.75;
  ctx.fillRect(bullet.x - w / 4, bullet.y - h / 2 + 1, w / 2, h - 2);
  ctx.restore();
  // The band's accent, at the leading tip.
  const tip = bullet.friendly ? bullet.y - h / 2 - 2 : bullet.y + h / 2 + 2;
  drawAccent(ctx, band, bullet.x, tip, Math.max(2.4, w * 0.6));
}

/** The discharge wave: an expanding ring out of the ship. */
function drawDischarge(
  state: SpectraState,
  ctx: CanvasRenderingContext2D,
): void {
  const r = state.discharge.radius;
  if (r <= 0) return;
  const fade = Math.max(0, 1 - r / DISCHARGE_MAX_R);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.strokeStyle = COLOR.discharge;
  ctx.globalAlpha = 0.15 + 0.7 * fade;
  ctx.lineWidth = 6 + 26 * fade;
  ctx.beginPath();
  ctx.arc(state.ship.x, SHIP_Y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 0.12 * fade;
  ctx.fillStyle = COLOR.discharge;
  ctx.beginPath();
  ctx.arc(state.ship.x, SHIP_Y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** The field-wide wash a spectral inversion carries. */
function drawInversionWash(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.fillStyle = COLOR.inversion;
  ctx.globalAlpha = 0.13;
  ctx.fillRect(0, FIELD_TOP, STAGE_W, FIELD_H);
  ctx.globalAlpha = 0.16;
  ctx.strokeStyle = COLOR.inversion;
  ctx.lineWidth = 3;
  // A diagonal hatch across the whole field: unmistakable, and absent otherwise.
  for (let x = -FIELD_H; x < STAGE_W + FIELD_H; x += 34) {
    ctx.beginPath();
    ctx.moveTo(x, FIELD_TOP);
    ctx.lineTo(x + FIELD_H, FIELD_BOTTOM);
    ctx.stroke();
  }
  ctx.restore();
}

/** The inversion's border and label, over the field's own edge. */
function drawInversionFrame(
  state: SpectraState,
  ctx: CanvasRenderingContext2D,
): void {
  ctx.save();
  ctx.strokeStyle = COLOR.inversion;
  ctx.lineWidth = 4;
  ctx.globalAlpha = 0.85;
  ctx.strokeRect(2, FIELD_TOP + 2, STAGE_W - 4, FIELD_H - 4);
  ctx.restore();
  text(
    ctx,
    `SPECTRAL INVERSION  ${state.inversion.toFixed(1)}s`,
    STAGE_W / 2,
    FIELD_TOP + 26,
    { size: 15, color: COLOR.inversion, align: "center", weight: "700" },
  );
}

/* -------------------------------------------------------------------------- */
/* The HUD                                                                    */
/* -------------------------------------------------------------------------- */

/** The five readouts, and the mute indicator. */
function drawHud(state: SpectraState, ctx: CanvasRenderingContext2D): void {
  // Top strip: the score, the most prominent readout, and the stage.
  text(ctx, String(state.score).padStart(6, "0"), 28, 44, {
    size: 32,
    weight: "700",
  });
  text(ctx, `${HUD_STAGE_LABEL} ${state.stage}`, STAGE_W - 28, 42, {
    size: 20,
    color: COLOR.textDim,
    align: "right",
    weight: "600",
  });
  if (isChallengeStage(state.stage)) {
    text(ctx, CHALLENGE_BANNER, STAGE_W - 28, 20, {
      size: 12,
      color: BAND_COLOR.magenta,
      align: "right",
      weight: "700",
    });
  }

  drawLives(state, ctx);
  drawResonance(state, ctx);
  drawPolarity(state, ctx);
  if (state.muted) {
    text(ctx, "MUTE", STAGE_W - 28, 694, {
      size: 15,
      color: COLOR.textDim,
      align: "right",
      weight: "700",
    });
  }
}

/** The lives remaining, as a row of small fighters. */
function drawLives(state: SpectraState, ctx: CanvasRenderingContext2D): void {
  const shown = Math.max(0, Math.min(5, state.lives));
  for (let i = 0; i < shown; i += 1) {
    ctx.drawImage(state.art.fighter[state.ship.band], 26 + i * 30, 676, 26, 18);
  }
  if (state.lives > 5) {
    text(ctx, `x${state.lives}`, 26 + 5 * 30, 692, {
      size: 15,
      color: COLOR.textDim,
      weight: "700",
    });
  }
  text(ctx, "LIVES", 26, 670, { size: 10, color: COLOR.textFaint });
}

/** The resonance meter, as a bar that reads distinctly at full. */
function drawResonance(
  state: SpectraState,
  ctx: CanvasRenderingContext2D,
): void {
  const x = 250;
  const y = 678;
  const w = 340;
  const h = 16;
  const ready = dischargeReady(state);
  const filled = (Math.min(RESONANCE_MAX, state.resonance) / RESONANCE_MAX) * w;

  text(ctx, "RESONANCE", x, 670, { size: 10, color: COLOR.textFaint });
  ctx.save();
  ctx.fillStyle = COLOR.bg;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = ready ? COLOR.resonanceReady : COLOR.resonance;
  if (ready) {
    ctx.shadowColor = COLOR.resonanceReady;
    ctx.shadowBlur = 14;
  }
  ctx.fillRect(x, y, filled, h);
  ctx.restore();
  ctx.strokeStyle = ready ? COLOR.resonanceReady : COLOR.rule;
  ctx.lineWidth = ready ? 2 : 1;
  ctx.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1);
  if (ready) {
    text(ctx, "READY", x + w + 12, y + 13, {
      size: 13,
      color: COLOR.resonanceReady,
      weight: "700",
    });
  }
}

/** The polarity indicator: the ship's band, in its colour and its accent. */
function drawPolarity(
  state: SpectraState,
  ctx: CanvasRenderingContext2D,
): void {
  const band = state.ship.band;
  const x = 700;
  text(ctx, "POLARITY", x, 670, { size: 10, color: COLOR.textFaint });
  drawAccent(ctx, band, x + 12, 686, 9);
  text(ctx, BAND_LABELS[band], x + 30, 693, {
    size: 20,
    color: BAND_COLOR[band],
    weight: "700",
  });
}

/* -------------------------------------------------------------------------- */
/* The screens                                                                */
/* -------------------------------------------------------------------------- */

/** A dim veil over the field, for a menu or a report to sit on. */
function veil(ctx: CanvasRenderingContext2D, alpha: number): void {
  ctx.save();
  ctx.fillStyle = COLOR.bg;
  ctx.globalAlpha = alpha;
  ctx.fillRect(0, FIELD_TOP, STAGE_W, FIELD_H);
  ctx.restore();
}

/** One line of large centred copy over the field. */
function banner(
  ctx: CanvasRenderingContext2D,
  content: string,
  color: string,
  y = 360,
): void {
  ctx.save();
  ctx.shadowColor = COLOR.bg;
  ctx.shadowBlur = 18;
  text(ctx, content, STAGE_W / 2, y, {
    size: 52,
    color,
    align: "center",
    weight: "700",
  });
  ctx.restore();
}

/**
 * A vertical menu, its highlighted item drawn distinctly from the others.
 *
 * The geometry is `src/menus.ts`'s, which is also what the debug surface reports
 * through `menuItemRect` and what the pointer selects on: one layout, drawn and
 * reported from the same place.
 */
function drawMenu(state: SpectraState, ctx: CanvasRenderingContext2D): void {
  const menu = menuOf(state.screen);
  if (menu === null) return;
  const highlighted = highlightedItem(menu, state.menuIndex);
  menu.items.forEach((item, index) => {
    const selected = index === highlighted;
    const y = itemBaselineY(menu, index);
    if (selected) {
      drawAccent(ctx, state.ship.band, STAGE_W / 2 - 150, y - 8, 8);
    }
    text(ctx, item, STAGE_W / 2, y, {
      size: selected ? 30 : 24,
      color: selected ? COLOR.text : COLOR.textFaint,
      align: "center",
      weight: selected ? "700" : "500",
    });
  });
}

/** The title screen. */
function drawTitle(state: SpectraState, ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = COLOR.field;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
  ctx.save();
  ctx.globalAlpha = 0.7;
  drawStars(ctx, state.stars);
  ctx.restore();

  ctx.save();
  ctx.shadowColor = BAND_COLOR.cyan;
  ctx.shadowBlur = 26;
  text(ctx, TITLE_TEXT, STAGE_W / 2, 220, {
    size: 96,
    align: "center",
    weight: "700",
  });
  ctx.restore();
  drawAccent(ctx, "cyan", STAGE_W / 2 - 250, 196, 16);
  drawAccent(ctx, "magenta", STAGE_W / 2 + 250, 196, 16);
  text(ctx, TAGLINE_TEXT, STAGE_W / 2, 268, {
    size: 22,
    color: COLOR.textDim,
    align: "center",
    weight: "600",
  });

  drawMenu(state, ctx);

  text(
    ctx,
    "ARROWS or AD move  ·  SPACE fires  ·  F flips  ·  X discharges",
    STAGE_W / 2,
    640,
    { size: 15, color: COLOR.textFaint, align: "center" },
  );
  if (state.muted) {
    text(ctx, "MUTE", STAGE_W - 28, 694, {
      size: 15,
      color: COLOR.textDim,
      align: "right",
      weight: "700",
    });
  }
}

/** How to play, in a player's words. */
const HOWTO_LINES: readonly string[] = [
  "Clear every wave of drones before your last life is gone.",
  "",
  "Your fighter is tuned to one band at a time, CYAN or MAGENTA.",
  "Only a shot on the same band as a drone destroys it, and the band",
  "you hold is also your hull's shield: fire of your own band is",
  "absorbed, fire of the other band costs you a life. A drone's body",
  "always costs a life, whatever band it is.",
  "",
  "Flipping bands is instant, but it costs you a beat of fire, so a",
  "wave is a run of timed changes rather than a stream of shots.",
  "",
  "A Shard holds one band for life. A Flux swings between the two on",
  "a telegraphed beat, and shimmers as it turns - no shot touches it",
  "then. A Prism wears a shell over a core of the other band: break",
  "the shell, then the core. Let one reach the bottom and it inverts",
  "the whole field for a few seconds.",
  "",
  "Absorbing fire and destroying drones both build resonance. Fill",
  "the meter and you can release a discharge that sweeps every diving",
  "drone and every shot off the field.",
  "",
  "ARROWS or AD move  -  SPACE fires  -  F or SHIFT flips band",
  "X releases a discharge  -  P pauses  -  M mutes",
];

/** The how-to screen. */
function drawHowTo(state: SpectraState, ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = COLOR.field;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
  ctx.save();
  ctx.globalAlpha = 0.45;
  drawStars(ctx, state.stars);
  ctx.restore();

  text(ctx, "HOW TO PLAY", STAGE_W / 2, 84, {
    size: 40,
    align: "center",
    weight: "700",
  });
  HOWTO_LINES.forEach((line, index) => {
    text(ctx, line, 300, 140 + index * 22, {
      size: 16,
      color: index >= HOWTO_LINES.length - 2 ? COLOR.textDim : COLOR.text,
    });
  });
  text(ctx, "ESC returns to the menu", STAGE_W / 2, 688, {
    size: 15,
    color: COLOR.textFaint,
    align: "center",
  });
}

/** The stage-intro hold. */
function drawStageIntro(
  state: SpectraState,
  ctx: CanvasRenderingContext2D,
): void {
  veil(ctx, 0.55);
  banner(
    ctx,
    `${HUD_STAGE_LABEL} ${state.stage}`,
    COLOR.text,
    isChallengeStage(state.stage) ? 330 : 372,
  );
  if (isChallengeStage(state.stage)) {
    text(ctx, CHALLENGE_BANNER, STAGE_W / 2, 392, {
      size: 30,
      color: BAND_COLOR.magenta,
      align: "center",
      weight: "700",
    });
  }
}

/** The pause menu, over the frozen field. */
function drawPaused(state: SpectraState, ctx: CanvasRenderingContext2D): void {
  veil(ctx, 0.68);
  banner(ctx, "PAUSED", COLOR.text, 260);
  drawMenu(state, ctx);
}

/** The interstitial a finished stage opens, and what it reports. */
function drawStageCleared(
  state: SpectraState,
  ctx: CanvasRenderingContext2D,
): void {
  veil(ctx, 0.6);
  if (isChallengeStage(state.stage)) {
    const perfect = state.challengeHits >= CHALLENGE_TOTAL;
    banner(
      ctx,
      perfect ? PERFECT_TEXT : "CHALLENGE OVER",
      perfect ? COLOR.resonanceReady : COLOR.text,
      330,
    );
    text(
      ctx,
      perfect
        ? `ALL ${CHALLENGE_TOTAL} DRONES DESTROYED`
        : `${state.challengeHits} OF ${CHALLENGE_TOTAL} DRONES DESTROYED`,
      STAGE_W / 2,
      390,
      { size: 24, color: COLOR.textDim, align: "center", weight: "600" },
    );
    return;
  }
  banner(ctx, `${HUD_STAGE_LABEL} ${state.stage} CLEARED`, COLOR.text, 330);
  text(ctx, "STAGE BONUS  1000", STAGE_W / 2, 390, {
    size: 24,
    color: COLOR.resonance,
    align: "center",
    weight: "600",
  });
}

/** The game-over screen: the run's final score and the stage it reached. */
function drawGameOver(
  state: SpectraState,
  ctx: CanvasRenderingContext2D,
): void {
  veil(ctx, 0.74);
  banner(ctx, "GAME OVER", COLOR.text, 250);
  text(ctx, `FINAL SCORE  ${state.score}`, STAGE_W / 2, 306, {
    size: 26,
    color: COLOR.text,
    align: "center",
    weight: "600",
  });
  text(ctx, `${HUD_STAGE_LABEL} REACHED  ${state.stage}`, STAGE_W / 2, 342, {
    size: 22,
    color: COLOR.textDim,
    align: "center",
    weight: "600",
  });
  drawMenu(state, ctx);
}
