// Spectra — every pixel the game draws, in logical stage units.
//
// `api.ctx` arrives cleared to `BACKGROUND` and already carrying the logical
// transform, so everything here is written in the fixed 1280x720 space and nothing
// reads the canvas element's size. The state arrives read-only, so the type is what
// guarantees that drawing changes nothing.
//
// The ship and the three drones are drawn from the seeded art under `assets/`, each
// centred on its entity and scaled to that entity's footprint, and each composited
// with its band's tint so one silhouette serves both bands. A destroyed drone pops
// with the seeded particle system, drawn additively from the particles the
// simulation reports. Everything else is drawn in code: the field and its
// starfield, every bullet, the discharge wave, the inversion's mark, both HUD
// strips, every screen and all text. A host that could not decode a sprite draws
// the shape this file falls back to, so the game still reads.
//
// The two HUD strips are painted after the field, so a drone crossing a strip in
// transit is hidden behind it rather than drawn over the readouts.

import {
  BAND_LABELS,
  BURST_FIELD,
  CHALLENGE_BANNER,
  CHALLENGE_TOTAL,
  FIELD_BOTTOM,
  FIELD_TOP,
  GAME_OVER_ITEMS,
  HUD_BOTTOM_TOP,
  HUD_STAGE_LABEL,
  HUD_TOP_H,
  OVERLOAD_AT,
  PAUSE_ITEMS,
  PERFECT_TEXT,
  PLAYER_BULLET_H,
  PLAYER_BULLET_W,
  PRISM_CORE_SIZE,
  READY_TEXT,
  RESONANCE_MAX,
  SCORE_STAGE_CLEAR,
  SHIP_H,
  SHIP_W,
  SHIP_Y,
  STAGE_H,
  ENEMY_BULLET_H,
  ENEMY_BULLET_W,
  TAGLINE_TEXT,
  TITLE_ITEMS,
  TITLE_TEXT,
  isChallengeStage,
} from "./constants";
import {
  droneFootprint,
  effectiveDroneBand,
  inversionActive,
  opposite,
  shimmering,
  shipAlive,
} from "./bands";
import { nextRandom } from "./rng";
import {
  BAND_COLOR,
  BAND_DIM,
  BAND_LIGHT,
  BAND_TINT,
  COLOR,
  GLOW,
  TINT,
  font,
} from "./theme";
import type { Band, BurstState, DroneState, SpectraState } from "./game";
import type { SpriteName } from "./assets";
import type { DeepReadonly } from "ts-essentials";

/** How many marks the starfield carries, and the seed its layout is drawn from. */
const STAR_COUNT = 130;
const STAR_SEED = 0x5eed;

/** The colour each charge level of the Overload telegraph burns at. */
const CHARGE_COLORS = ["#ffb43c", "#fff6d0"] as const;

/** One mark of the starfield. */
interface Star {
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly color: string;
}

/** The starfield's layout, drawn once from a fixed seed and never again. */
const STARS: readonly Star[] = buildStars();

function buildStars(): Star[] {
  const stars: Star[] = [];
  let rng = STAR_SEED;
  const draw = (): number => {
    const [value, next] = nextRandom(rng);
    rng = next;
    return value;
  };
  const palette = [COLOR.starFar, COLOR.starMid, COLOR.starNear];
  for (let i = 0; i < STAR_COUNT; i++) {
    const depth = Math.floor(draw() * 3);
    stars.push({
      x: draw() * 1280,
      y: FIELD_TOP + draw() * (FIELD_BOTTOM - FIELD_TOP),
      size: 1 + depth * 0.6,
      color: palette[depth] ?? COLOR.starFar,
    });
  }
  return stars;
}

/** Text drawn at a point, with the alignment given. */
function label(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  color: string,
  align: CanvasTextAlign = "left",
  weight: "bold" | "normal" = "bold",
): void {
  ctx.font = font(size, weight);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(text, x, y);
}

/** The band's shape accent: a ring for cyan, a diamond for magenta. */
function accent(
  ctx: CanvasRenderingContext2D,
  band: Band,
  cx: number,
  cy: number,
  radius: number,
  width = 2,
): void {
  ctx.strokeStyle = BAND_COLOR[band];
  ctx.lineWidth = width;
  ctx.beginPath();
  if (band === "cyan") {
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  } else {
    ctx.moveTo(cx, cy - radius);
    ctx.lineTo(cx + radius, cy);
    ctx.lineTo(cx, cy + radius);
    ctx.lineTo(cx - radius, cy);
    ctx.closePath();
  }
  ctx.stroke();
}

/** A soft halo in the band's colour, drawn in code around a sprite. */
function glow(
  ctx: CanvasRenderingContext2D,
  band: Band,
  cx: number,
  cy: number,
  radius: number,
  strength = 0.5,
): void {
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  gradient.addColorStop(0, BAND_COLOR[band]);
  gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.save();
  ctx.globalAlpha = strength;
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * Draw one seeded sprite centred on `(cx, cy)`, tinted to `band`.
 *
 * The seeded bitmap is the source of both passes: the first lays the art down as
 * it is, and the second composites the band over its own alpha alone, so the shape
 * on screen is the seeded silhouette in the band's colour and nothing outside that
 * silhouette is touched. Reports whether the art was there to draw.
 */
function drawSprite(
  ctx: CanvasRenderingContext2D,
  art: DeepReadonly<SpectraState>["art"],
  name: SpriteName,
  cx: number,
  cy: number,
  w: number,
  h: number,
  band: Band | null,
  strength: number,
): boolean {
  const bitmap = art.sprites[name];
  if (bitmap === null) return false;
  const x = cx - w / 2;
  const y = cy - h / 2;
  ctx.drawImage(bitmap as ImageBitmap, x, y, w, h);
  if (band !== null) {
    ctx.save();
    ctx.globalAlpha = strength;
    ctx.filter = BAND_TINT[band];
    ctx.drawImage(bitmap as ImageBitmap, x, y, w, h);
    ctx.filter = "none";
    ctx.restore();
  }
  return true;
}

/** The shape a missing sprite falls back to, so the band still reads. */
function fallbackBody(
  ctx: CanvasRenderingContext2D,
  band: Band,
  cx: number,
  cy: number,
  size: number,
): void {
  ctx.fillStyle = BAND_COLOR[band];
  ctx.beginPath();
  ctx.moveTo(cx, cy - size / 2);
  ctx.lineTo(cx + size / 2, cy);
  ctx.lineTo(cx, cy + size / 2);
  ctx.lineTo(cx - size / 2, cy);
  ctx.closePath();
  ctx.fill();
}

// ---- The field -----------------------------------------------------------

function drawField(
  ctx: CanvasRenderingContext2D,
  state: DeepReadonly<SpectraState>,
): void {
  ctx.fillStyle = COLOR.field;
  ctx.fillRect(0, FIELD_TOP, 1280, FIELD_BOTTOM - FIELD_TOP);

  for (const star of STARS) {
    ctx.fillStyle = star.color;
    ctx.fillRect(star.x, star.y, star.size, star.size);
  }

  // A vignette down both edges, so the field reads as depth rather than a slab.
  const edge = ctx.createLinearGradient(0, 0, 1280, 0);
  edge.addColorStop(0, COLOR.fieldEdge);
  edge.addColorStop(0.18, "rgba(0, 0, 0, 0)");
  edge.addColorStop(0.82, "rgba(0, 0, 0, 0)");
  edge.addColorStop(1, COLOR.fieldEdge);
  ctx.fillStyle = edge;
  ctx.fillRect(0, FIELD_TOP, 1280, FIELD_BOTTOM - FIELD_TOP);

  if (!inversionActive(state.inversion)) return;
  // A spectral inversion marks the whole field, so the swap reads at a glance.
  ctx.fillStyle = COLOR.inversion;
  ctx.fillRect(0, FIELD_TOP, 1280, FIELD_BOTTOM - FIELD_TOP);
  ctx.strokeStyle = COLOR.inversionEdge;
  ctx.lineWidth = 4;
  ctx.strokeRect(2, FIELD_TOP + 2, 1276, FIELD_BOTTOM - FIELD_TOP - 4);
}

// ---- The entities --------------------------------------------------------

function drawShip(
  ctx: CanvasRenderingContext2D,
  state: DeepReadonly<SpectraState>,
): void {
  const band = state.ship.band;
  const x = state.ship.x;
  glow(ctx, band, x, SHIP_Y, SHIP_W * GLOW.ship.reach, GLOW.ship.strength);
  const drawn = drawSprite(
    ctx,
    state.art,
    "fighter",
    x,
    SHIP_Y,
    SHIP_W,
    SHIP_H,
    band,
    TINT.ship,
  );
  if (!drawn) fallbackBody(ctx, band, x, SHIP_Y, SHIP_W * 0.7);
  // A white-hot rail along the hull, so the ship reads as a ship rather than as
  // one more drone of its band however a reader samples it.
  ctx.fillStyle = COLOR.textBright;
  ctx.fillRect(x - SHIP_W * 0.34, SHIP_Y - SHIP_H * 0.16, SHIP_W * 0.68, 3);

  // The ship's own band core, which always agrees with the polarity indicator. It
  // burns lighter than a drone of the same band, so the hull reads as the hull.
  ctx.fillStyle = BAND_LIGHT[band];
  ctx.beginPath();
  ctx.arc(x, SHIP_Y + 1, 6, 0, Math.PI * 2);
  ctx.fill();
  accent(ctx, band, x, SHIP_Y + 1, 10, 2);
}

function drawCharge(
  ctx: CanvasRenderingContext2D,
  drone: DeepReadonly<DroneState>,
  size: number,
): void {
  if (drone.charge <= 0) return;
  const level = Math.min(drone.charge, CHARGE_COLORS.length);
  const color = CHARGE_COLORS[level - 1] ?? CHARGE_COLORS[0];
  const share = Math.min(1, drone.charge / OVERLOAD_AT);

  // A growing arc around the drone's body, and a brightening core, so the charge
  // reads both from the drone's outline and from its centre.
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(3, size * 0.16);
  ctx.beginPath();
  ctx.arc(
    drone.x,
    drone.y,
    size * 0.42,
    -Math.PI / 2,
    -Math.PI / 2 + share * Math.PI * 2,
  );
  ctx.stroke();

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(drone.x, drone.y, 2 + 3.2 * drone.charge, 0, Math.PI * 2);
  ctx.fill();
}

function drawDrone(
  ctx: CanvasRenderingContext2D,
  state: DeepReadonly<SpectraState>,
  drone: DeepReadonly<DroneState>,
): void {
  const size = droneFootprint(drone);
  const effective = effectiveDroneBand(drone, state.stage, state.inversion);
  const shimmer = shimmering(drone, state.stage);

  const halo = GLOW[drone.kind];
  glow(ctx, effective, drone.x, drone.y, size * halo.reach, halo.strength);

  switch (drone.kind) {
    case "shard": {
      const drawn = drawSprite(
        ctx,
        state.art,
        "shard",
        drone.x,
        drone.y,
        size,
        size,
        effective,
        TINT.shard,
      );
      if (!drawn) fallbackBody(ctx, effective, drone.x, drone.y, size);
      accent(ctx, effective, drone.x, drone.y, size * 0.3, 1.5);
      break;
    }
    case "flux": {
      // A shimmering Flux is drawn as the seeded still, which carries both bands
      // at once; a settled one takes its held band's tint and a hot core.
      const drawn = drawSprite(
        ctx,
        state.art,
        "flux",
        drone.x,
        drone.y,
        size,
        size,
        shimmer ? null : effective,
        TINT.flux,
      );
      if (!drawn) fallbackBody(ctx, effective, drone.x, drone.y, size);
      if (shimmer) {
        ctx.strokeStyle = COLOR.textBright;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(drone.x, drone.y, size * 0.46, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.fillStyle = COLOR.textBright;
        ctx.beginPath();
        ctx.arc(drone.x, drone.y, size * 0.24, 0, Math.PI * 2);
        ctx.fill();
        // The band's own colour rings the pale body, so a settled Flux still
        // reads as the band it is holding.
        accent(ctx, effective, drone.x, drone.y, size * 0.4, 3);
      }
      break;
    }
    case "prism": {
      const drawn = drawSprite(
        ctx,
        state.art,
        "prism",
        drone.x,
        drone.y,
        size,
        size,
        effective,
        TINT.prism,
      );
      if (!drawn) fallbackBody(ctx, effective, drone.x, drone.y, size);
      if (drone.shellAlive) {
        // The core sits inside the standing shell, in the other band, so the two
        // layers read as two layers.
        const core = opposite(effective);
        ctx.fillStyle = BAND_COLOR[core];
        ctx.beginPath();
        ctx.arc(drone.x, drone.y, PRISM_CORE_SIZE * 0.42, 0, Math.PI * 2);
        ctx.fill();
        accent(ctx, core, drone.x, drone.y, PRISM_CORE_SIZE * 0.58, 2);
      } else {
        accent(ctx, effective, drone.x, drone.y, size * 0.42, 2);
      }
      break;
    }
  }

  drawCharge(ctx, drone, size);
}

function drawBullets(
  ctx: CanvasRenderingContext2D,
  state: DeepReadonly<SpectraState>,
): void {
  for (const bullet of state.bullets) {
    const band = bullet.band;
    const w = bullet.friendly ? PLAYER_BULLET_W : ENEMY_BULLET_W;
    const h = bullet.friendly ? PLAYER_BULLET_H : ENEMY_BULLET_H;
    glow(ctx, band, bullet.x, bullet.y, h, 0.36);
    ctx.fillStyle = BAND_COLOR[band];
    ctx.fillRect(bullet.x - w / 2, bullet.y - h / 2, w, h);
    // The band's accent on the leading tip, so a bullet's band reads by shape.
    const tip = bullet.friendly ? bullet.y - h / 2 : bullet.y + h / 2;
    accent(ctx, band, bullet.x, tip, w, 1.5);
  }
}

function drawBurst(
  ctx: CanvasRenderingContext2D,
  burst: DeepReadonly<BurstState>,
): void {
  const scale = burst.size / BURST_FIELD;
  const unit = BURST_FIELD * 0.02 * scale;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const particle of burst.sim.capture()) {
    const px = burst.x + (particle.position[0] - BURST_FIELD / 2) * scale;
    const py = burst.y + (BURST_FIELD / 2 - particle.position[1]) * scale;
    const radius = Math.max(0.6, particle.size * unit);
    const r = Math.round(Math.min(1, Math.max(0, particle.color[0])) * 255);
    const g = Math.round(Math.min(1, Math.max(0, particle.color[1])) * 255);
    const b = Math.round(Math.min(1, Math.max(0, particle.color[2])) * 255);
    ctx.globalAlpha = Math.min(1, Math.max(0, particle.opacity));
    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
    ctx.beginPath();
    ctx.arc(px, py, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawDischarge(
  ctx: CanvasRenderingContext2D,
  state: DeepReadonly<SpectraState>,
): void {
  if (!state.discharge.active) return;
  const radius = Math.max(1, state.discharge.radius);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, FIELD_TOP, 1280, FIELD_BOTTOM - FIELD_TOP);
  ctx.clip();
  ctx.fillStyle = COLOR.dischargeHalo;
  ctx.beginPath();
  ctx.arc(state.ship.x, SHIP_Y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = COLOR.dischargeRim;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(state.ship.x, SHIP_Y, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawPlay(
  ctx: CanvasRenderingContext2D,
  state: DeepReadonly<SpectraState>,
): void {
  for (const drone of state.drones) drawDrone(ctx, state, drone);
  if (shipAlive(state.phase)) drawShip(ctx, state);
  drawBullets(ctx, state);
  for (const burst of state.bursts) drawBurst(ctx, burst);
  drawDischarge(ctx, state);
}

// ---- The HUD -------------------------------------------------------------

function drawStrips(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = COLOR.hud;
  ctx.fillRect(0, 0, 1280, HUD_TOP_H);
  ctx.fillRect(0, HUD_BOTTOM_TOP, 1280, STAGE_H - HUD_BOTTOM_TOP);
  ctx.fillStyle = COLOR.hudEdge;
  ctx.fillRect(0, HUD_TOP_H - 1, 1280, 1);
  ctx.fillRect(0, HUD_BOTTOM_TOP, 1280, 1);
}

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

function drawHud(
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

// ---- The screens ---------------------------------------------------------

function scrim(ctx: CanvasRenderingContext2D, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(0, FIELD_TOP, 1280, FIELD_BOTTOM - FIELD_TOP);
}

/**
 * A vertical menu, its highlighted row drawn distinctly.
 *
 * Each item is drawn as its own text and nothing else, so what the screen shows is
 * the entry the specification names; the carets that mark the highlight are drawn
 * beside it rather than around it.
 */
function drawMenu(
  ctx: CanvasRenderingContext2D,
  items: readonly string[],
  index: number,
  y: number,
  step: number,
  size: number,
): void {
  items.forEach((item, i) => {
    const chosen = i === index;
    const at = y + i * step;
    label(
      ctx,
      item,
      640,
      at,
      size,
      chosen ? COLOR.accent : COLOR.textDim,
      "center",
    );
    if (!chosen) return;
    const half = ctx.measureText(item).width / 2 + size * 0.7;
    label(ctx, ">", 640 - half, at, size, COLOR.accent, "center");
    label(ctx, "<", 640 + half, at, size, COLOR.accent, "center");
  });
}

function drawTitle(
  ctx: CanvasRenderingContext2D,
  state: DeepReadonly<SpectraState>,
): void {
  scrim(ctx, COLOR.scrim);
  label(ctx, TITLE_TEXT, 640, 250, 92, COLOR.textBright, "center");
  label(ctx, TAGLINE_TEXT, 640, 296, 26, COLOR.accent, "center");
  // The two bands, side by side, so the pair reads before the first wave.
  accent(ctx, "cyan", 560, 340, 14, 3);
  accent(ctx, "magenta", 720, 340, 14, 3);
  drawMenu(ctx, TITLE_ITEMS, state.menuIndex, 430, 52, 32);
  label(ctx, "ENTER OR SPACE TO CHOOSE", 640, 600, 16, COLOR.textDim, "center");
}

/** The how-to-play screen, in a player's words. */
const HOWTO_LINES: readonly string[] = [
  "Clear every wave of drones before your last life is spent.",
  "",
  "Your fighter is tuned to one band at a time, CYAN or MAGENTA.",
  "Only a shot of the band you hold destroys a drone, and that same",
  "band is your shield: enemy fire of your own band is absorbed.",
  "Flipping costs a beat of fire, so change on the right beat.",
  "",
  "A Shard keeps one band. A Flux swaps bands on a telegraphed",
  "rhythm and can be hit on neither while it shimmers. A Prism",
  "wears two layers, and inverts the whole field if it gets past you.",
  "",
  "Absorbing fire and matching kills fill the resonance meter.",
  "A full meter pays one discharge, which clears every diver.",
  "",
  "MOVE      ARROWS   or   AD",
  "FIRE      SPACE",
  "FLIP      F   or   SHIFT",
  "DISCHARGE X          PAUSE  P          MUTE  M",
];

function drawHowTo(ctx: CanvasRenderingContext2D): void {
  scrim(ctx, COLOR.scrim);
  label(ctx, "HOW TO PLAY", 640, 130, 44, COLOR.textBright, "center");
  HOWTO_LINES.forEach((line, i) => {
    label(ctx, line, 200, 190 + i * 24, 18, COLOR.text);
  });
  label(ctx, "ESC TO GO BACK", 640, 632, 16, COLOR.textDim, "center");
}

function drawStageIntro(
  ctx: CanvasRenderingContext2D,
  state: DeepReadonly<SpectraState>,
): void {
  scrim(ctx, COLOR.scrimLight);
  label(ctx, HUD_STAGE_LABEL, 640, 300, 40, COLOR.text, "center");
  label(ctx, String(state.stage), 640, 400, 96, COLOR.textBright, "center");
  if (isChallengeStage(state.stage)) {
    label(ctx, CHALLENGE_BANNER, 640, 470, 34, COLOR.accent, "center");
  }
}

function drawStageCleared(
  ctx: CanvasRenderingContext2D,
  state: DeepReadonly<SpectraState>,
): void {
  scrim(ctx, COLOR.scrim);
  if (!isChallengeStage(state.stage)) {
    label(ctx, "STAGE CLEARED", 640, 320, 56, COLOR.textBright, "center");
    label(
      ctx,
      `BONUS ${SCORE_STAGE_CLEAR}`,
      640,
      390,
      30,
      COLOR.accent,
      "center",
    );
    return;
  }
  if (state.challengeHits >= CHALLENGE_TOTAL) {
    label(ctx, PERFECT_TEXT, 640, 320, 72, COLOR.accent, "center");
  } else {
    label(ctx, "CHALLENGE OVER", 640, 300, 44, COLOR.textBright, "center");
  }
  label(
    ctx,
    `${state.challengeHits} / ${CHALLENGE_TOTAL} DESTROYED`,
    640,
    390,
    30,
    COLOR.text,
    "center",
  );
}

function drawGameOver(
  ctx: CanvasRenderingContext2D,
  state: DeepReadonly<SpectraState>,
): void {
  scrim(ctx, COLOR.scrim);
  label(ctx, "GAME OVER", 640, 230, 68, COLOR.textBright, "center");
  label(ctx, "SCORE", 500, 300, 32, COLOR.textDim, "right");
  label(ctx, String(state.score), 520, 300, 32, COLOR.text);
  label(ctx, HUD_STAGE_LABEL, 500, 344, 26, COLOR.textDim, "right");
  label(ctx, String(state.stage), 520, 344, 26, COLOR.text);
  drawMenu(ctx, GAME_OVER_ITEMS, state.menuIndex, 440, 50, 30);
}

function drawPaused(
  ctx: CanvasRenderingContext2D,
  state: DeepReadonly<SpectraState>,
): void {
  scrim(ctx, COLOR.scrim);
  label(ctx, "PAUSED", 640, 250, 60, COLOR.textBright, "center");
  drawMenu(ctx, PAUSE_ITEMS, state.menuIndex, 350, 52, 30);
}

/** Whether the screen shows the live field behind it. */
function showsField(screen: DeepReadonly<SpectraState>["screen"]): boolean {
  return (
    screen === "inWave" ||
    screen === "paused" ||
    screen === "stageIntro" ||
    screen === "stageCleared"
  );
}

/** Draw the whole frame. */
export function renderGame(
  state: DeepReadonly<SpectraState>,
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  ctx.fillStyle = COLOR.background;
  ctx.fillRect(0, 0, width, height);

  drawField(ctx, state);
  if (showsField(state.screen)) drawPlay(ctx, state);
  drawStrips(ctx);
  if (showsField(state.screen)) drawHud(ctx, state);

  switch (state.screen) {
    case "title":
      drawTitle(ctx, state);
      break;
    case "howto":
      drawHowTo(ctx);
      break;
    case "stageIntro":
      drawStageIntro(ctx, state);
      break;
    case "stageCleared":
      drawStageCleared(ctx, state);
      break;
    case "paused":
      drawPaused(ctx, state);
      break;
    case "gameOver":
      drawGameOver(ctx, state);
      break;
    case "inWave":
      if (!shipAlive(state.phase)) {
        scrim(ctx, COLOR.scrimLight);
        label(ctx, READY_TEXT, 640, 380, 64, COLOR.accent, "center");
      }
      break;
  }

  // The mute indicator is the only thing about the HUD or the field that mute
  // changes, and it is drawn on every screen because mute works on every screen.
  if (state.muted) {
    label(ctx, "MUTE", 1240, 695, 20, COLOR.accent, "right");
  }
}
