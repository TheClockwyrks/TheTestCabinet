// Spectra — the picture, drawn from the live state (specs/overview.md,
// specs/assets.md, specs/ui.md).
//
// Every function here is a PURE READ of the state: rendering reads and writes
// nothing (`specs/state.md`). The engine's pipeline calls them through the draw
// components in `src/actors.ts`, with the context already carrying the
// world-to-device transform and the camera left at rest, so everything below is
// drawn in the stage's own logical units.
//
// HOW A BAND REACHES A SEEDED SPRITE. Each entity is drawn from its own seeded
// silhouette, scaled to that entity's footprint and sampled without smoothing.
// The band comes from `bandFilter` in `src/theme.ts`, a filter chain composited
// over the drawn pixels at draw time, which is one of the two routes
// `specs/assets.md` allows and the one that needs no second canvas. The seeded
// bitmap is therefore what `drawImage` is always handed, and the band's own shape
// accent — the ring for cyan, the diamond for magenta — is drawn in code over it,
// so the pair always agree and a cyan diamond or a magenta ring never appears.
//
// WHICH BAND IS DRAWN is the entity's EFFECTIVE band, because that is the band a
// player has to match and the band the entity counts as. A shimmering Flux is
// settled on neither and is drawn from the seeded shimmer art, which carries both
// at once.

import {
  BAND_LABELS,
  BURST_FIELD,
  CHALLENGE_BANNER,
  CHALLENGE_TOTAL,
  ENEMY_BULLET_H,
  ENEMY_BULLET_W,
  FIELD_BOTTOM,
  FIELD_LEFT,
  FIELD_RIGHT,
  FIELD_TOP,
  HUD_BOTTOM_TOP,
  HUD_STAGE_LABEL,
  HUD_TOP_H,
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
  STAGE_W,
  TAGLINE_TEXT,
  TITLE_TEXT,
  isChallengeStage,
} from "./constants";
import { droneEffectiveBand, opposite, shimmering } from "./bands";
import { droneFootprint } from "./drones";
import { highlightedItem, itemRect, itemRowY, menuOf } from "./menus";
import {
  BAND,
  BAND_LIGHT,
  BAND_LUMA,
  CENTER_X,
  COLOR,
  FONT,
  bandAlpha,
  bandFilter,
  goldAlpha,
} from "./theme";
import { art } from "./sprites";
import type {
  Band,
  BulletState,
  BurstState,
  DroneState,
  Screen,
  SpectraState,
} from "./game";

/** How deep the Prism's shell is drawn, so two drones of one band read apart. */
const SHELL_VALUE = 0.7;
/** Where a Prism's core ends, as a fraction of its half-footprint. */
const CORE_RATIO = 0.58;
/** The core's region inside the seeded Prism art, in its own 64-unit space. */
const PRISM_CORE_SOURCE = { x: 15, y: 15, width: 34, height: 34 };

/** How many marks the starfield carries, comfortably above the stated floor. */
const STARS = 96;

// ---- Small drawing helpers ----------------------------------------------

/** Run `paint` inside a saved context, with the filter always returned to none. */
function layer(
  ctx: CanvasRenderingContext2D,
  paint: (ctx: CanvasRenderingContext2D) => void,
): void {
  ctx.save();
  paint(ctx);
  ctx.filter = "none";
  ctx.restore();
}

/** A filled circle. */
function disc(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  fill: string,
): void {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

/**
 * A soft round glow, drawn additively so overlapping light reads as light. It
 * falls off from the centre, so a body's own light has no edge of its own.
 */
function glow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string,
): void {
  layer(ctx, (target) => {
    target.globalCompositeOperation = "lighter";
    const fade = target.createRadialGradient(x, y, 0, x, y, radius);
    fade.addColorStop(0, color);
    fade.addColorStop(0.55, color);
    fade.addColorStop(1, "rgba(0, 0, 0, 0)");
    target.fillStyle = fade;
    target.beginPath();
    target.arc(x, y, radius, 0, Math.PI * 2);
    target.fill();
  });
}

/** The path of a diamond about a centre. */
function diamondPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x, y - radius);
  ctx.lineTo(x + radius, y);
  ctx.lineTo(x, y + radius);
  ctx.lineTo(x - radius, y);
  ctx.closePath();
}

/**
 * A band's shape accent: the ring for cyan, the diamond for magenta.
 *
 * It is the same mark everywhere a band appears — a drone, the ship, a bullet, the
 * polarity indicator — so the bands stay legible without colour.
 */
export function bandAccent(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  band: Band,
  width = 2,
): void {
  ctx.lineWidth = width;
  ctx.strokeStyle = BAND[band];
  if (band === "cyan") {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();
    return;
  }
  diamondPath(ctx, x, y, radius);
  ctx.stroke();
}

/** Centred text at one place, in one font and one colour. */
function text(
  ctx: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  font: string,
  fill: string,
  align: CanvasTextAlign = "center",
): void {
  ctx.font = font;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.fillStyle = fill;
  ctx.fillText(value, x, y);
}

// ---- The field and the strips -------------------------------------------

/** The play field, the two HUD strips, and the rules between them. */
export function renderField(
  state: SpectraState,
  ctx: CanvasRenderingContext2D,
): void {
  void state;
  ctx.fillStyle = COLOR.field;
  ctx.fillRect(
    FIELD_LEFT,
    FIELD_TOP,
    FIELD_RIGHT - FIELD_LEFT,
    FIELD_BOTTOM - FIELD_TOP,
  );
  ctx.fillStyle = COLOR.strip;
  ctx.fillRect(0, 0, STAGE_W, HUD_TOP_H);
  ctx.fillRect(0, HUD_BOTTOM_TOP, STAGE_W, STAGE_H - HUD_BOTTOM_TOP);
  ctx.fillStyle = COLOR.rule;
  ctx.fillRect(0, HUD_TOP_H - 2, STAGE_W, 2);
  ctx.fillRect(0, HUD_BOTTOM_TOP, STAGE_W, 2);
}

/** A whole number drawn from `index`, spread over `span`. */
function hash(index: number, salt: number, span: number): number {
  const mixed = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453;
  return Math.abs(mixed - Math.floor(mixed)) * span;
}

/**
 * The starfield behind the play field: fixed marks, none of them as bright as a
 * drone of either band, so nothing on it is mistaken for something to shoot.
 */
export function renderStarfield(
  state: SpectraState,
  ctx: CanvasRenderingContext2D,
): void {
  void state;
  for (let index = 0; index < STARS; index += 1) {
    const x = 8 + hash(index, 1, FIELD_RIGHT - 16);
    const y = FIELD_TOP + 8 + hash(index, 2, FIELD_BOTTOM - FIELD_TOP - 16);
    const near = index % 3 === 0;
    ctx.fillStyle = near ? COLOR.starNear : COLOR.starFar;
    const size = near ? 3 : 2;
    ctx.fillRect(Math.round(x), Math.round(y), size, size);
  }
}

/**
 * The field-wide mark a spectral inversion carries: a two-tone wash over the whole
 * play field with a band of scan bars, unmistakable and absent otherwise.
 */
export function renderInversion(
  state: SpectraState,
  ctx: CanvasRenderingContext2D,
): void {
  if (state.inversion <= 0) return;
  if (!fieldShown(state)) return;
  const height = FIELD_BOTTOM - FIELD_TOP;
  layer(ctx, (target) => {
    target.globalCompositeOperation = "lighter";
    target.fillStyle = bandAlpha("magenta", 0.09);
    target.fillRect(FIELD_LEFT, FIELD_TOP, FIELD_RIGHT, height / 2);
    target.fillStyle = bandAlpha("cyan", 0.09);
    target.fillRect(
      FIELD_LEFT,
      FIELD_TOP + height / 2,
      FIELD_RIGHT,
      height / 2,
    );
    for (let y = FIELD_TOP; y < FIELD_BOTTOM; y += 16) {
      target.fillStyle = "rgba(234, 240, 251, 0.05)";
      target.fillRect(FIELD_LEFT, y, FIELD_RIGHT, 2);
    }
  });
  ctx.strokeStyle = bandAlpha("magenta", 0.55);
  ctx.lineWidth = 3;
  ctx.strokeRect(3, FIELD_TOP + 3, FIELD_RIGHT - 6, height - 6);
}

/**
 * Whether the screen showing is one the play field stands on.
 *
 * The title and the how-to are pages rather than the field, so the ship, the
 * drones, the bullets, the bursts and the inversion's mark are not drawn behind
 * them; a dim slice of the starfield is (`specs/ui.md`).
 */
export function fieldShown(state: SpectraState): boolean {
  return state.screen !== "title" && state.screen !== "howto";
}

// ---- The entities -------------------------------------------------------

/** Draw one seeded sprite, unsmoothed, through `filter`. */
function sprite(
  ctx: CanvasRenderingContext2D,
  image: ImageBitmap,
  x: number,
  y: number,
  size: number,
  filter: string,
  source?: { x: number; y: number; width: number; height: number },
): void {
  layer(ctx, (target) => {
    target.imageSmoothingEnabled = false;
    target.filter = filter;
    const half = size / 2;
    if (source === undefined) {
      target.drawImage(image, x - half, y - half, size, size);
      return;
    }
    target.drawImage(
      image,
      source.x,
      source.y,
      source.width,
      source.height,
      x - half,
      y - half,
      size,
      size,
    );
  });
}

/** The fallback body a kind is drawn as where its sprite did not arrive. */
function fallbackBody(
  ctx: CanvasRenderingContext2D,
  drone: DroneState,
  x: number,
  y: number,
  size: number,
  band: Band,
): void {
  const half = size / 2;
  ctx.fillStyle = BAND[band];
  if (drone.kind === "shard") {
    diamondPath(ctx, x, y, half * 0.9);
    ctx.fill();
    return;
  }
  if (drone.kind === "flux") {
    disc(ctx, x, y, half * 0.8, BAND[band]);
    return;
  }
  disc(ctx, x, y, half * 0.92, BAND[band]);
  disc(ctx, x, y, half * CORE_RATIO, BAND[opposite(band)]);
}

/** The charge telegraph: gold arcs filling as a drone nears its overload. */
function chargeTelegraph(
  ctx: CanvasRenderingContext2D,
  drone: DroneState,
  x: number,
  y: number,
  size: number,
): void {
  if (drone.charge <= 0) return;
  const radius = size * 0.55;
  const width = Math.max(3, size * 0.16);
  const span = (Math.PI * 2) / 3;
  layer(ctx, (target) => {
    target.lineCap = "butt";
    target.lineWidth = width;
    for (let index = 0; index < drone.charge; index += 1) {
      const from = -Math.PI / 2 + index * span + 0.08;
      target.strokeStyle = goldAlpha(0.95);
      target.beginPath();
      target.arc(x, y, radius, from, from + span - 0.16);
      target.stroke();
    }
    target.fillStyle = goldAlpha(0.1 * drone.charge);
    target.beginPath();
    target.arc(x, y, radius * 0.8, 0, Math.PI * 2);
    target.fill();
  });
}

/** One drone: its glow, its seeded body in its band, its accent and its charge. */
export function drawDrone(
  state: SpectraState,
  ctx: CanvasRenderingContext2D,
  drone: DroneState,
): void {
  if (!fieldShown(state)) return;
  const size = droneFootprint(drone);
  const { x, y } = drone;
  const band = droneEffectiveBand(drone, state);
  const shimmer = shimmering(drone, state.stage);
  const frames = art();

  // Each kind carries its own light, so a Shard, a Flux and a Prism are told
  // apart at a glance even when two of them hold the same band: a Shard is a hard
  // point of its band, a Flux burns pale because it is between bands, and a Prism
  // shows both of its layers at once.
  if (drone.kind === "flux") {
    glow(ctx, x, y, size * 0.72, "rgba(234, 240, 251, 0.34)");
    glow(ctx, x, y, size * 0.4, bandAlpha(band, 0.18));
  } else if (drone.kind === "prism") {
    glow(ctx, x, y, size * 0.62, bandAlpha(band, 0.16));
    glow(ctx, x, y, size * 0.36, bandAlpha(opposite(band), 0.38));
  } else {
    glow(ctx, x, y, size * 0.58, bandAlpha(band, 0.3));
  }

  const image =
    drone.kind === "shard"
      ? frames.shard
      : drone.kind === "flux"
        ? frames.flux
        : frames.prism;

  if (image === null) {
    fallbackBody(ctx, drone, x, y, size, band);
  } else if (drone.kind === "shard") {
    sprite(ctx, image, x, y, size, bandFilter(band, BAND_LUMA.magenta));
  } else if (drone.kind === "flux") {
    // Mid-shimmer the Flux is settled on neither band and is drawn from the
    // seeded art untouched, which carries both bands at once; holding a band it is
    // the same body in that band's single colour.
    sprite(
      ctx,
      image,
      x,
      y,
      size,
      shimmer ? "none" : bandFilter(band, BAND_LUMA.magenta),
    );
  } else if (drone.shellAlive) {
    // The shell in the stored band, then the core in the opposite one, clipped to
    // the core's own disc — the seeded two-layer construction with its bands put
    // where this Prism's are.
    sprite(
      ctx,
      image,
      x,
      y,
      size,
      bandFilter(band, BAND_LUMA.cyan, SHELL_VALUE),
    );
    layer(ctx, (target) => {
      target.beginPath();
      target.arc(x, y, (size / 2) * CORE_RATIO, 0, Math.PI * 2);
      target.clip();
      sprite(
        target,
        image,
        x,
        y,
        size,
        bandFilter(opposite(band), BAND_LUMA.magenta),
      );
    });
  } else {
    // Only the core is left: the inner layer alone, at its own footprint.
    layer(ctx, (target) => {
      target.beginPath();
      target.arc(x, y, PRISM_CORE_SIZE / 2, 0, Math.PI * 2);
      target.clip();
      sprite(
        target,
        image,
        x,
        y,
        PRISM_CORE_SIZE,
        bandFilter(band, BAND_LUMA.magenta),
        PRISM_CORE_SOURCE,
      );
    });
  }

  if (shimmer) {
    // A shimmering Flux is settled on neither band, so it carries both at once:
    // a core split between them, and both accents around it.
    layer(ctx, (target) => {
      const split = size * 0.26;
      target.beginPath();
      target.arc(x, y, split, Math.PI / 2, (3 * Math.PI) / 2);
      target.fillStyle = BAND.cyan;
      target.fill();
      target.beginPath();
      target.arc(x, y, split, (3 * Math.PI) / 2, Math.PI / 2);
      target.fillStyle = BAND.magenta;
      target.fill();
      target.globalAlpha = 0.9;
      bandAccent(target, x, y, size * 0.62, "cyan");
      bandAccent(target, x, y, size * 0.5, "magenta");
    });
  } else {
    layer(ctx, (target) => {
      bandAccent(target, x, y, size * 0.62, band, 2);
    });
  }

  chargeTelegraph(ctx, drone, x, y, size);
}

/** The ship: its seeded hull, its band core, and its accent. */
export function drawShip(
  state: SpectraState,
  ctx: CanvasRenderingContext2D,
): void {
  if (state.phase === "ready" || !fieldShown(state)) return;
  const { x } = state.ship;
  const band = state.ship.band;
  const y = SHIP_Y;

  // The hull's own light is neutral and the band's is a wash over it, so the ship
  // reads apart from a drone of the band it is tuned to.
  glow(ctx, x, y, SHIP_W * 0.46, "rgba(234, 240, 251, 0.3)");
  glow(ctx, x, y, SHIP_W * 0.62, bandAlpha(band, 0.26));

  const image = art().fighter;
  if (image === null) {
    ctx.fillStyle = COLOR.text;
    ctx.beginPath();
    ctx.moveTo(x, y - SHIP_H / 2);
    ctx.lineTo(x + SHIP_W / 2, y + SHIP_H / 2);
    ctx.lineTo(x - SHIP_W / 2, y + SHIP_H / 2);
    ctx.closePath();
    ctx.fill();
  } else {
    layer(ctx, (target) => {
      target.imageSmoothingEnabled = false;
      target.drawImage(image, x - SHIP_W / 2, y - SHIP_H / 2, SHIP_W, SHIP_H);
    });
  }

  // The hull is the same in both bands; its core is the band, so the ship reads
  // its own tuning at a glance and agrees with the polarity indicator.
  // The core is the band at its brightest rather than a neutral white, so the
  // ship's own centre still says which band it is tuned to.
  const core = SHIP_H * 0.24;
  disc(ctx, x, y, core, BAND[band]);
  disc(ctx, x, y, core * 0.52, BAND_LIGHT[band]);
  layer(ctx, (target) => {
    bandAccent(target, x, y, SHIP_H * 0.56, band, 2.5);
  });
}

/** One bullet, drawn in code in its band's colour and accent. */
export function drawBullet(
  state: SpectraState,
  ctx: CanvasRenderingContext2D,
  bullet: BulletState,
): void {
  if (!fieldShown(state)) return;
  const band = bullet.band;
  const width = bullet.friendly ? PLAYER_BULLET_W : ENEMY_BULLET_W;
  const height = bullet.friendly ? PLAYER_BULLET_H : ENEMY_BULLET_H;
  glow(ctx, bullet.x, bullet.y, height * 0.85, bandAlpha(band, 0.42));
  ctx.fillStyle = BAND[band];
  ctx.fillRect(bullet.x - width / 2, bullet.y - height / 2, width, height);
  layer(ctx, (target) => {
    bandAccent(target, bullet.x, bullet.y, height * 0.5, band, 1.5);
  });
}

/**
 * One drone-burst: the particles its own simulation reports, composited
 * additively over the field so the pop reads as light.
 */
export function drawBurst(
  state: SpectraState,
  ctx: CanvasRenderingContext2D,
  burst: BurstState,
): void {
  if (!fieldShown(state)) return;
  const scale = burst.size / BURST_FIELD;
  const particles = burst.sim.capture();
  layer(ctx, (target) => {
    target.globalCompositeOperation = "lighter";
    for (const particle of particles) {
      const px = burst.x + (particle.position[0] - BURST_FIELD / 2) * scale;
      // The system's field has `y` up; the stage has it down.
      const py = burst.y - (particle.position[1] - BURST_FIELD / 2) * scale;
      const radius = Math.max(0.6, particle.size * scale * 0.9);
      const red = Math.round(Math.min(1, particle.color[0]) * 255);
      const green = Math.round(Math.min(1, particle.color[1]) * 255);
      const blue = Math.round(Math.min(1, particle.color[2]) * 255);
      target.fillStyle = `rgba(${red}, ${green}, ${blue}, ${Math.min(1, particle.opacity).toFixed(3)})`;
      target.beginPath();
      target.arc(px, py, radius, 0, Math.PI * 2);
      target.fill();
    }
  });
}

/** The live discharge wave: a band-blind ring expanding from the ship. */
export function drawDischarge(
  state: SpectraState,
  ctx: CanvasRenderingContext2D,
): void {
  if (!state.discharge.active || !fieldShown(state)) return;
  const radius = state.discharge.radius;
  layer(ctx, (target) => {
    target.globalCompositeOperation = "lighter";
    target.lineWidth = 6;
    target.strokeStyle = goldAlpha(0.7);
    target.beginPath();
    target.arc(state.ship.x, SHIP_Y, Math.max(1, radius), 0, Math.PI * 2);
    target.stroke();
    target.lineWidth = 18;
    target.strokeStyle = "rgba(234, 240, 251, 0.16)";
    target.beginPath();
    target.arc(
      state.ship.x,
      SHIP_Y,
      Math.max(1, radius * 0.86),
      0,
      Math.PI * 2,
    );
    target.stroke();
  });
}

// ---- The HUD -----------------------------------------------------------

/** The two HUD strips: the score, the stage, the lives, the meter, the polarity. */
export function renderHud(
  state: SpectraState,
  ctx: CanvasRenderingContext2D,
): void {
  if (state.screen === "title" || state.screen === "howto") return;

  text(
    ctx,
    String(state.score),
    28,
    HUD_TOP_H / 2,
    FONT.digits,
    COLOR.text,
    "left",
  );
  text(
    ctx,
    `${HUD_STAGE_LABEL} ${state.stage}`,
    STAGE_W - 28,
    HUD_TOP_H / 2,
    FONT.digits,
    COLOR.text,
    "right",
  );

  const midway = HUD_BOTTOM_TOP + (STAGE_H - HUD_BOTTOM_TOP) / 2;

  // Lives, as a row of small hulls.
  for (let index = 0; index < state.lives; index += 1) {
    const x = 34 + index * 26;
    ctx.fillStyle = COLOR.text;
    ctx.beginPath();
    ctx.moveTo(x, midway - 9);
    ctx.lineTo(x + 8, midway + 7);
    ctx.lineTo(x - 8, midway + 7);
    ctx.closePath();
    ctx.fill();
  }

  // The resonance meter.
  const barX = 300;
  const barW = 420;
  const barH = 18;
  const barY = midway - barH / 2;
  const full = state.resonance >= RESONANCE_MAX;
  ctx.fillStyle = "rgba(234, 240, 251, 0.12)";
  ctx.fillRect(barX, barY, barW, barH);
  ctx.fillStyle = full ? COLOR.gold : bandAlpha(state.ship.band, 0.85);
  ctx.fillRect(
    barX,
    barY,
    (barW * Math.max(0, Math.min(RESONANCE_MAX, state.resonance))) /
      RESONANCE_MAX,
    barH,
  );
  ctx.strokeStyle = full ? COLOR.gold : COLOR.rule;
  ctx.lineWidth = full ? 3 : 1;
  ctx.strokeRect(barX - 1, barY - 1, barW + 2, barH + 2);
  if (full) {
    text(ctx, "DISCHARGE", barX + barW / 2, midway, FONT.small, "#1a1300");
  }

  // The polarity indicator.
  const indicatorX = STAGE_W - 150;
  bandAccent(ctx, indicatorX, midway, 13, state.ship.band, 3);
  text(
    ctx,
    BAND_LABELS[state.ship.band],
    indicatorX + 24,
    midway,
    FONT.small,
    BAND[state.ship.band],
    "left",
  );

  if (state.muted) {
    text(ctx, "MUTED", 240, midway, FONT.small, COLOR.dim, "right");
  }
}

// ---- The screens -------------------------------------------------------

/** A vertical menu, with the highlighted item drawn apart from the others. */
function menu(
  ctx: CanvasRenderingContext2D,
  screen: Screen,
  index: number,
): void {
  const shown = menuOf(screen);
  if (shown === null) return;
  const selected = highlightedItem(shown, index);
  shown.items.forEach((item, at) => {
    const chosen = at === selected;
    const row = itemRowY(shown, at);
    if (chosen) {
      const plate = itemRect(shown, at);
      if (plate !== null) {
        ctx.fillStyle = "rgba(255, 216, 107, 0.16)";
        ctx.fillRect(plate.x, plate.y, plate.w, plate.h);
      }
      text(ctx, `> ${item} <`, CENTER_X, row, FONT.heading, COLOR.gold);
      return;
    }
    text(ctx, item, CENTER_X, row, FONT.heading, COLOR.dim);
  });
}

/** A dimming panel behind a screen's copy. */
function veil(ctx: CanvasRenderingContext2D, alpha = 0.72): void {
  ctx.fillStyle = `rgba(7, 11, 22, ${alpha})`;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
}

/** The title screen. */
function renderTitle(state: SpectraState, ctx: CanvasRenderingContext2D): void {
  veil(ctx, 0.82);
  text(ctx, TITLE_TEXT, CENTER_X, 190, FONT.huge, COLOR.text);
  bandAccent(ctx, CENTER_X - 250, 190, 26, "cyan", 4);
  bandAccent(ctx, CENTER_X + 250, 190, 26, "magenta", 4);
  text(ctx, TAGLINE_TEXT, CENTER_X, 264, FONT.body, BAND.cyan);
  menu(ctx, "title", state.menuIndex);
  text(
    ctx,
    "ARROWS or AD to move   SPACE to fire   F to flip   X to discharge",
    CENTER_X,
    620,
    FONT.small,
    COLOR.dim,
  );
}

/** How to play, in a player's words. */
function renderHowTo(ctx: CanvasRenderingContext2D): void {
  veil(ctx, 0.9);
  text(ctx, "HOW TO PLAY", CENTER_X, 92, FONT.title, COLOR.text);
  const lines = [
    "Drones fly in, lock into a swaying block, and peel off to dive at you.",
    "Clear every drone of a wave to finish the stage, before your last life goes.",
    "",
    `Your fighter is tuned to one band at a time, ${BAND_LABELS.cyan} or ${BAND_LABELS.magenta}.`,
    "Only a shot of the matching band destroys a drone.",
    "That same band is your shield: a shot of your own band is absorbed,",
    "and a shot of the other band takes a life. A drone's body always does.",
    "Flipping is instant, but it costs you a beat of fire — time it.",
    "",
    "A Shard holds one band. A Flux swaps on a telegraphed rhythm and cannot",
    "be shot mid-shimmer. A Prism wears two layers, and inverts the whole",
    "field's bands if it reaches the bottom.",
    "",
    "A wrong-band shot is not wasted here: it charges the drone, and three",
    "charges overload it into something worse.",
    "",
    "Absorbing fire and matching kills fill the resonance meter. A full meter",
    "buys one discharge, which clears every diver and every shot on screen.",
    "",
    "Move with ARROWS or AD. Fire with SPACE. Flip with F. Discharge with X.",
    "Pause with P. Mute with M. ESCAPE goes back.",
  ];
  lines.forEach((line, index) => {
    text(ctx, line, CENTER_X, 150 + index * 25, FONT.small, COLOR.text);
  });
}

/** The stage-intro hold. */
function renderStageIntro(
  state: SpectraState,
  ctx: CanvasRenderingContext2D,
): void {
  veil(ctx, 0.55);
  text(
    ctx,
    `${HUD_STAGE_LABEL} ${state.stage}`,
    CENTER_X,
    320,
    FONT.huge,
    COLOR.text,
  );
  if (isChallengeStage(state.stage)) {
    text(ctx, CHALLENGE_BANNER, CENTER_X, 400, FONT.title, COLOR.gold);
  }
}

/** The paused screen, over the frozen field. */
function renderPaused(
  state: SpectraState,
  ctx: CanvasRenderingContext2D,
): void {
  veil(ctx, 0.66);
  text(ctx, "PAUSED", CENTER_X, 210, FONT.title, COLOR.text);
  menu(ctx, "paused", state.menuIndex);
}

/** The interstitial a finished stage opens. */
function renderStageCleared(
  state: SpectraState,
  ctx: CanvasRenderingContext2D,
): void {
  veil(ctx, 0.6);
  if (!isChallengeStage(state.stage)) {
    text(ctx, "STAGE CLEARED", CENTER_X, 290, FONT.title, COLOR.text);
    text(
      ctx,
      `BONUS ${SCORE_STAGE_CLEAR}`,
      CENTER_X,
      356,
      FONT.heading,
      COLOR.gold,
    );
    return;
  }
  if (state.challengeHits >= CHALLENGE_TOTAL) {
    text(ctx, PERFECT_TEXT, CENTER_X, 290, FONT.huge, COLOR.gold);
    return;
  }
  text(ctx, "CHALLENGE OVER", CENTER_X, 280, FONT.title, COLOR.text);
  text(
    ctx,
    `${state.challengeHits} / ${CHALLENGE_TOTAL} DESTROYED`,
    CENTER_X,
    350,
    FONT.heading,
    COLOR.text,
  );
}

/** The game-over screen. */
function renderGameOver(
  state: SpectraState,
  ctx: CanvasRenderingContext2D,
): void {
  veil(ctx, 0.82);
  text(ctx, "GAME OVER", CENTER_X, 170, FONT.title, COLOR.text);
  text(ctx, `SCORE ${state.score}`, CENTER_X, 250, FONT.heading, COLOR.text);
  text(
    ctx,
    `${HUD_STAGE_LABEL} ${state.stage}`,
    CENTER_X,
    300,
    FONT.heading,
    COLOR.dim,
  );
  menu(ctx, "gameOver", state.menuIndex);
}

/** Whichever screen is up, over the field the rest of the layers drew. */
export function renderScreens(
  state: SpectraState,
  ctx: CanvasRenderingContext2D,
): void {
  switch (state.screen) {
    case "title":
      renderTitle(state, ctx);
      break;
    case "howto":
      renderHowTo(ctx);
      break;
    case "stageIntro":
      renderStageIntro(state, ctx);
      break;
    case "paused":
      renderPaused(state, ctx);
      break;
    case "stageCleared":
      renderStageCleared(state, ctx);
      break;
    case "gameOver":
      renderGameOver(state, ctx);
      break;
    case "inWave":
      if (state.phase === "ready") {
        text(ctx, READY_TEXT, CENTER_X, 360, FONT.huge, COLOR.gold);
      }
      break;
  }
}
