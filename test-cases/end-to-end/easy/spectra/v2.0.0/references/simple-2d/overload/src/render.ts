// Spectra — the field and everything standing on it, in logical stage units.
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
  BURST_FIELD,
  ENEMY_BULLET_H,
  ENEMY_BULLET_W,
  FIELD_BOTTOM,
  FIELD_TOP,
  OVERLOAD_AT,
  PLAYER_BULLET_H,
  PLAYER_BULLET_W,
  PRISM_CORE_SIZE,
  SHIP_H,
  SHIP_W,
  SHIP_Y,
} from "./constants";
import {
  droneFootprint,
  effectiveDroneBand,
  inversionActive,
  opposite,
  shimmering,
  shipAlive,
} from "./bands";
import { accent, drawSprite, fallbackBody, glow } from "./draw";
import { drawHud, drawMuteIndicator, drawStrips } from "./hud";
import { nextRandom } from "./rng";
import { drawScreen, showsField } from "./screens";
import { BAND_COLOR, BAND_LIGHT, COLOR, GLOW, TINT } from "./theme";
import type { BurstState, DroneState, SpectraState } from "./game";
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

/** The Overload telegraph, which reads from the drone's outline and its centre. */
function drawCharge(
  ctx: CanvasRenderingContext2D,
  drone: DeepReadonly<DroneState>,
  size: number,
): void {
  if (drone.charge <= 0) return;
  const level = Math.min(drone.charge, CHARGE_COLORS.length);
  const color = CHARGE_COLORS[level - 1] ?? CHARGE_COLORS[0];
  const share = Math.min(1, drone.charge / OVERLOAD_AT);

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
  drawScreen(ctx, state);

  // The mute indicator is the only thing about the HUD or the field that mute
  // changes, and it is drawn on every screen because mute works on every screen.
  if (state.muted) drawMuteIndicator(ctx);
}
