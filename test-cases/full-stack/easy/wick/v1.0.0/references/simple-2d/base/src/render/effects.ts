// Wick — the weapon effects over their hitboxes (specs/assets.md "The
// weapon effects", "Animation").
//
// Every zone and projectile is drawn as its weapon's produced effect, scaled
// to the live shape so the drawn extent is the hitbox's extent: a slash over
// its rectangle, everything else over its circle. A sheet's frame comes from
// the ticks since the shape appeared, so a strike and a burst play once
// through their flash and a sconce spins for its life. A pulsing effect
// brightens on the tick it pulses and fades toward the next, so the pulse
// reads. Where an effect did not decode, a plain shape of the same extent
// stands in.

import {
  EFFECT_SPRITES,
  FLARE_FLASH,
  PUFF_SHEET,
  PUFF_TIME,
  SPARK_FLASH,
  TICK_DT,
  WALK_FRAME_TIME,
  type WeaponId,
} from "../constants";
import { effectPath, spriteImage } from "../assets";
import type { ProjectileState, RunState, ZoneState } from "../game";
import { pulseInterval } from "../sim/weapons";
import { centeredRect, circle, sprite } from "./draw";
import { COLORS } from "./theme";

/** The frame of a sheet of `frames` played once over `flash` seconds. */
function onceThrough(t: number, flash: number, frames: number): number {
  return Math.max(0, Math.min(frames - 1, Math.floor(t / (flash / frames))));
}

/** The strike's frame `t` seconds after it landed. */
export function sparkFrame(t: number): number {
  return onceThrough(t, SPARK_FLASH, EFFECT_SPRITES.spark.frames);
}

/** The burst's frame `t` seconds after it fired. */
export function flareFrame(t: number): number {
  return onceThrough(t, FLARE_FLASH, EFFECT_SPRITES.flare.frames);
}

/** The sconce's frame `t` seconds after it was launched; it spins. */
export function sconceFrame(t: number): number {
  return (
    Math.floor(Math.max(0, t) / WALK_FRAME_TIME) % EFFECT_SPRITES.sconce.frames
  );
}

/** The puff's frame `t` seconds after the death. */
export function puffFrame(t: number): number {
  return onceThrough(t, PUFF_TIME, PUFF_SHEET.frames);
}

/** The frame of a walk cycle of `frames` after `seconds` of walking. */
export function walkFrame(seconds: number, frames: number): number {
  return Math.floor(Math.max(0, seconds) / WALK_FRAME_TIME) % frames;
}

/** Seconds of ticks since `bornTick`, at `run.tick`. */
export function ageOf(run: RunState, bornTick: number): number {
  return (run.tick - bornTick) * TICK_DT;
}

/** The frame of `weapon`'s effect at `t` seconds of age. */
export function effectFrame(weapon: WeaponId, t: number): number {
  if (EFFECT_SPRITES[weapon].frames === 1) return 0;
  switch (weapon) {
    case "spark":
      return sparkFrame(t);
    case "flare":
      return flareFrame(t);
    default:
      return sconceFrame(t);
  }
}

/** The effect image of `weapon` at `t` seconds of age, or `null`. */
export function effectImage(weapon: WeaponId, t: number): ImageBitmap | null {
  return spriteImage(effectPath(weapon, effectFrame(weapon, t)));
}

/**
 * How bright a pulsing zone is, `1` on the tick it pulsed and falling to
 * `0` as the next pulse nears. An aura pulses on its weapon's cooldown, a
 * puddle on its own pulse timer.
 */
export function pulseGlow(run: RunState, zone: ZoneState): number {
  if (zone.kind === "aura") {
    const held = run.weapons.find((weapon) => weapon.id === zone.weapon);
    if (!held || held.cooldownSet <= 0) return 0;
    return Math.max(0, Math.min(1, held.cooldown / held.cooldownSet));
  }
  if (zone.kind === "puddle" && zone.pulse !== undefined) {
    return Math.max(0, Math.min(1, zone.pulse / pulseInterval(zone.weapon)));
  }
  return 0;
}

/** Draw one zone at stage `(x, y)`. */
export function drawZone(
  ctx: CanvasRenderingContext2D,
  run: RunState,
  zone: ZoneState,
  x: number,
  y: number,
): void {
  const image = effectImage(zone.weapon, ageOf(run, zone.bornTick));
  if (zone.kind === "slash") {
    const width = zone.width ?? 0;
    const height = zone.height ?? 0;
    if (image) {
      sprite(ctx, image, x, y, width, height, {
        mirror: zone.x < run.player.x,
      });
    } else {
      centeredRect(ctx, x, y, width, height, COLORS.zone, COLORS.zoneEdge);
    }
    return;
  }
  const size = zone.radius * 2;
  const glow = pulseGlow(run, zone);
  if (image) {
    sprite(ctx, image, x, y, size, size, { alpha: 0.7 + 0.3 * glow });
  } else {
    circle(ctx, x, y, zone.radius, COLORS.zone, COLORS.zoneEdge);
  }
  if (glow > 0) {
    circle(ctx, x, y, zone.radius, `rgba(255, 230, 160, ${0.28 * glow})`);
  }
}

/** Draw one projectile at stage `(x, y)`, turned the way it flies. */
export function drawProjectile(
  ctx: CanvasRenderingContext2D,
  run: RunState,
  projectile: ProjectileState,
  x: number,
  y: number,
): void {
  const image = effectImage(projectile.weapon, ageOf(run, projectile.bornTick));
  if (!image) {
    circle(ctx, x, y, projectile.radius, COLORS.projectile);
    return;
  }
  const size = projectile.radius * 2;
  const moving = projectile.vx !== 0 || projectile.vy !== 0;
  const rotation =
    projectile.weapon === "sconce" || !moving
      ? 0
      : Math.atan2(projectile.vy, projectile.vx);
  sprite(ctx, image, x, y, size, size, { rotation });
}
