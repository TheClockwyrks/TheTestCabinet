// Kessler — what each render component draws (specs/screens.md,
// specs/field.md, specs/assets.md).
//
// The starfield, the containment field, the three rings and their targets
// (the damaged state included), the deflector, the shield ring, and the HUD
// are drawn in code in the palette `src/theme.ts` holds; the planet, the
// pods, and every ball are drawn from the produced sprites at native size,
// centered on their object, with a code-drawn stand-in wherever a sprite
// failed to load so a missing file costs polish rather than playability
// (`specs/assets.md`). Everything is laid out in logical units on the fixed
// `1000 x 1000` stage; the transform the engine's pipeline hands each draw
// component maps that onto device pixels.
//
// Ambient motion (the star twinkle) runs on the game's resolved-tick clock
// rather than the wall clock, so a stepped scenario draws the same frame
// every time it reaches the same tick.

import {
  BALL_FRAME_TICKS,
  BALL_RADIUS,
  BALL_SPIN_FRAMES,
  DEFLECTOR_TRACK_INNER,
  DEFLECTOR_TRACK_OUTER,
  FIELD_RADIUS,
  PLANET_RADIUS,
  POD_RADIUS,
  RINGS,
  SHIELD_RADIUS,
  STAGE_CX,
  STAGE_CY,
  STAGE_W,
  STAGE_H,
  STRUCTURAL_GAP_DEG,
  type PodKind,
} from "./constants";
import { annularSector, text } from "./draw";
import { pointAt } from "./polar";
import { spanOf, type Ball, type Pod } from "./session";
import { COLORS } from "./theme";
import type { KesslerAssets } from "./assets";
import type { KesslerState } from "./state";

/** Whether an image actually decoded, so a component can fall back. */
export function ready(image: ImageBitmap | null): image is ImageBitmap {
  return image !== null;
}

/** The spin frame a ball shows, counted from its own spawn tick. */
export function ballFrameIndex(simTicks: number, spawnTick: number): number {
  const step = Math.floor((simTicks - spawnTick) / BALL_FRAME_TICKS);
  return ((step % BALL_SPIN_FRAMES) + BALL_SPIN_FRAMES) % BALL_SPIN_FRAMES;
}

/** One background star. Laid once, from a fixed stream of its own. */
interface Star {
  x: number;
  y: number;
  r: number;
  alpha: number;
  phase: number;
}

/** A tiny fixed LCG for the star layout alone; the pod draw never reads it. */
function starfield(count: number): Star[] {
  let s = 0x9d2c5680;
  const next = (): number => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
  return Array.from({ length: count }, () => ({
    x: next() * STAGE_W,
    y: next() * STAGE_H,
    r: 0.5 + next() * 1.1,
    alpha: 0.2 + next() * 0.6,
    phase: next() * Math.PI * 2,
  }));
}

const STARS = starfield(150);

const DEG = Math.PI / 180;

/** The stage ground, the twinkling starfield, and the containment field. */
export function drawBackdrop(
  ctx: CanvasRenderingContext2D,
  state: KesslerState,
): void {
  ctx.fillStyle = COLORS.stage;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);

  ctx.save();
  ctx.fillStyle = "#cfe2f4";
  for (const star of STARS) {
    const twinkle = 0.78 + 0.22 * Math.sin(state.ticks * 0.045 + star.phase);
    ctx.globalAlpha = star.alpha * twinkle;
    ctx.beginPath();
    ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // The containment field: a soft halo first, then the glassy edge, so its
  // extent reads at a glance (specs/field.md).
  ctx.save();
  ctx.strokeStyle = COLORS.containment;
  ctx.globalAlpha = 0.1;
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.arc(STAGE_CX, STAGE_CY, FIELD_RADIUS, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 2.5;
  ctx.shadowColor = COLORS.containment;
  ctx.shadowBlur = 14;
  ctx.beginPath();
  ctx.arc(STAGE_CX, STAGE_CY, FIELD_RADIUS, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // The faint orbit lane of each ring, so an emptied ring still reads as a
  // place while its target components are gone.
  for (let index = 0; index < RINGS.length; index += 1) {
    const spec = RINGS[index];
    ctx.save();
    ctx.strokeStyle = COLORS.ringAccents[index];
    ctx.globalAlpha = 0.06;
    ctx.lineWidth = spec.outerRadius - spec.innerRadius;
    ctx.beginPath();
    ctx.arc(STAGE_CX, STAGE_CY, spec.midRadius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

/** The produced planet sprite, and the shield ring while one is active. */
export function drawPlanetAndShield(
  ctx: CanvasRenderingContext2D,
  state: KesslerState,
  assets: KesslerAssets,
): void {
  if (ready(assets.planet)) {
    const half = assets.planet.width / 2;
    ctx.drawImage(assets.planet, STAGE_CX - half, STAGE_CY - half);
  } else {
    // The code-drawn stand-in: the one warm thing in view.
    const glow = ctx.createRadialGradient(
      STAGE_CX - 18,
      STAGE_CY - 18,
      8,
      STAGE_CX,
      STAGE_CY,
      PLANET_RADIUS,
    );
    glow.addColorStop(0, "#f0b46a");
    glow.addColorStop(0.65, "#b45f32");
    glow.addColorStop(1, "#5e2c18");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(STAGE_CX, STAGE_CY, PLANET_RADIUS, 0, Math.PI * 2);
    ctx.fill();
  }

  if (!state.effects.shieldActive) return;
  ctx.save();
  ctx.strokeStyle = COLORS.shield;
  ctx.globalAlpha = 0.14;
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.arc(STAGE_CX, STAGE_CY, SHIELD_RADIUS, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 0.95;
  ctx.lineWidth = 2.5;
  ctx.shadowColor = COLORS.shield;
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.arc(STAGE_CX, STAGE_CY, SHIELD_RADIUS, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/**
 * One derelict target: slot `slot` of ring `ringIndex`, under the ring's
 * angle as the state holds it. A ring 2 target that has taken a hit is drawn
 * visibly distinct — darker plating crossed by fracture lines — so a player
 * reads its state at a glance (`specs/rings.md`).
 */
export function drawTarget(
  ctx: CanvasRenderingContext2D,
  state: KesslerState,
  ringIndex: number,
  slot: number,
): void {
  const spec = RINGS[ringIndex];
  const ring = state.rings[ringIndex];
  const hp = ring?.targets[slot];
  if (hp === null || hp === undefined) return;
  const accent = COLORS.ringAccents[ringIndex];

  const start = ring.angleDeg + slot * spec.slotWidthDeg + STRUCTURAL_GAP_DEG;
  const end = start + spec.targetArcDeg;
  const damaged = hp < spec.hitPoints;

  ctx.save();
  annularSector(
    ctx,
    STAGE_CX,
    STAGE_CY,
    spec.innerRadius,
    spec.outerRadius,
    start,
    end,
  );
  if (damaged) {
    ctx.fillStyle = COLORS.plateDark;
  } else {
    const plating = ctx.createRadialGradient(
      STAGE_CX,
      STAGE_CY,
      spec.innerRadius,
      STAGE_CX,
      STAGE_CY,
      spec.outerRadius,
    );
    plating.addColorStop(0, COLORS.plateDark);
    plating.addColorStop(0.55, COLORS.plate);
    plating.addColorStop(1, "#3a4c68");
    ctx.fillStyle = plating;
  }
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.globalAlpha = damaged ? 0.35 : 0.85;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  if (damaged) {
    drawCracks(ctx, spec.innerRadius, spec.outerRadius, start, end, slot);
  }
  ctx.restore();
}

/**
 * The damaged state's fracture lines. The crack layout hangs off the slot
 * index alone, so it holds still as the ring orbits.
 */
function drawCracks(
  ctx: CanvasRenderingContext2D,
  innerR: number,
  outerR: number,
  startDeg: number,
  endDeg: number,
  slot: number,
): void {
  const span = endDeg - startDeg;
  ctx.strokeStyle = "#0a0f18";
  ctx.globalAlpha = 0.95;
  ctx.lineWidth = 2;
  for (let i = 0; i < 3; i += 1) {
    const f = (0.22 + 0.28 * i + ((slot * 7 + i * 5) % 10) / 45) % 1;
    const a = (startDeg + span * f) * DEG;
    const bend = (((slot + i) % 3) - 1) * 4 * DEG;
    const midR = (innerR + outerR) / 2;
    ctx.beginPath();
    ctx.moveTo(
      STAGE_CX + innerR * Math.cos(a),
      STAGE_CY + innerR * Math.sin(a),
    );
    ctx.lineTo(
      STAGE_CX + midR * Math.cos(a + bend),
      STAGE_CY + midR * Math.sin(a + bend),
    );
    ctx.lineTo(
      STAGE_CX + outerR * Math.cos(a - bend / 2),
      STAGE_CY + outerR * Math.sin(a - bend / 2),
    );
    ctx.stroke();
  }
}

/** The deflector on its track, exactly the span in force. */
export function drawDeflector(
  ctx: CanvasRenderingContext2D,
  state: KesslerState,
): void {
  const angle = state.paddleAngleDeg;
  const span = spanOf(state);
  const mid = (DEFLECTOR_TRACK_INNER + DEFLECTOR_TRACK_OUTER) / 2;
  const a0 = (angle - span / 2) * DEG;
  const a1 = (angle + span / 2) * DEG;

  ctx.save();
  // The faint full track, so the deflector reads as riding something.
  ctx.strokeStyle = COLORS.paddleGlow;
  ctx.globalAlpha = 0.07;
  ctx.lineWidth = DEFLECTOR_TRACK_OUTER - DEFLECTOR_TRACK_INNER;
  ctx.beginPath();
  ctx.arc(STAGE_CX, STAGE_CY, mid, 0, Math.PI * 2);
  ctx.stroke();

  // The deflector body, exactly the span in force.
  ctx.globalAlpha = 1;
  ctx.strokeStyle = COLORS.paddle;
  ctx.lineWidth = DEFLECTOR_TRACK_OUTER - DEFLECTOR_TRACK_INNER;
  ctx.lineCap = "butt";
  ctx.shadowColor = COLORS.paddleGlow;
  ctx.shadowBlur = 16;
  ctx.beginPath();
  ctx.arc(STAGE_CX, STAGE_CY, mid, a0, a1);
  ctx.stroke();

  // A bright leading edge on the contact side.
  ctx.shadowBlur = 0;
  ctx.strokeStyle = COLORS.paddleGlow;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(STAGE_CX, STAGE_CY, DEFLECTOR_TRACK_OUTER + 1.5, a0, a1);
  ctx.stroke();

  // The center notch a player aims with.
  const notch = pointAt(mid, angle);
  ctx.fillStyle = COLORS.stage;
  ctx.beginPath();
  ctx.arc(notch.x, notch.y, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** One falling pod: its produced sprite at native size, centered on it. */
export function drawPod(
  ctx: CanvasRenderingContext2D,
  pod: Pod,
  assets: KesslerAssets,
): void {
  const at = pointAt(pod.r, pod.angleDeg);
  const sprite = assets.pods[pod.kind];
  if (ready(sprite)) {
    const half = sprite.width / 2;
    ctx.drawImage(sprite, at.x - half, at.y - half);
    return;
  }
  drawPodFallback(ctx, at.x, at.y, pod.kind);
}

/** The code-drawn pod stand-in, tinted by kind. */
export function drawPodFallback(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  kind: PodKind,
): void {
  ctx.save();
  ctx.fillStyle = COLORS.pods[kind];
  ctx.shadowColor = COLORS.pods[kind];
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.arc(x, y, POD_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * One ball, from the produced spin sheet: frames `0` through `5` in order,
 * one frame per `5` ticks of simulation time, the phase counted from the
 * ball's own spawn tick (`specs/assets.md`).
 */
export function drawBall(
  ctx: CanvasRenderingContext2D,
  ball: Ball,
  state: KesslerState,
  assets: KesslerAssets,
): void {
  const frame = ballFrameIndex(state.simTicks, ball.spawnTick);
  const sprite = assets.ball[frame];
  if (ready(sprite)) {
    const half = sprite.width / 2;
    ctx.drawImage(sprite, ball.x - half, ball.y - half);
    return;
  }
  ctx.save();
  const steel = ctx.createRadialGradient(
    ball.x - 3,
    ball.y - 3,
    1,
    ball.x,
    ball.y,
    BALL_RADIUS,
  );
  steel.addColorStop(0, "#e9f2fb");
  steel.addColorStop(1, "#5d708a");
  ctx.fillStyle = steel;
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, BALL_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// --- The HUD (specs/screens.md "The HUD") ---

/** Seconds, whole, a whole-tick timer has left, for the effects readout. */
function secondsLeft(ticks: number): string {
  return `${Math.ceil(ticks / 60)}s`;
}

/**
 * The HUD: the score, the lives, the wave, and the active effects, in the
 * stage's top corners — near the top, and clear of the containment field's
 * crown.
 */
export function drawHud(
  ctx: CanvasRenderingContext2D,
  state: KesslerState,
  assets: KesslerAssets,
): void {
  text(ctx, "SCORE", 28, 42, {
    size: 13,
    color: COLORS.textFaint,
    spacing: 3,
  });
  text(ctx, String(state.score), 28, 76, {
    size: 30,
    color: COLORS.text,
    bold: true,
  });
  text(ctx, "WAVE", 28, 106, { size: 13, color: COLORS.textFaint, spacing: 3 });
  text(ctx, String(state.wave), 90, 107, {
    size: 18,
    color: COLORS.textDim,
    bold: true,
  });

  text(ctx, "LIVES", 972, 42, {
    size: 13,
    color: COLORS.textFaint,
    spacing: 3,
    align: "right",
  });
  const lifeSprite = assets.ball[0];
  const shown = Math.min(state.lives, 6);
  for (let i = 0; i < shown; i += 1) {
    const x = 962 - i * 26;
    if (ready(lifeSprite)) {
      ctx.drawImage(lifeSprite, x - 10, 54, 20, 20);
    } else {
      ctx.fillStyle = COLORS.textDim;
      ctx.beginPath();
      ctx.arc(x, 64, 6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (state.lives > 6) {
    text(ctx, `x${state.lives}`, 972, 90, {
      size: 13,
      color: COLORS.textDim,
      align: "right",
    });
  }

  // The effects readout: each timed effect in force, and the shield, each
  // indicated by its produced pod sprite (`specs/screens.md` lets the HUD
  // reuse them).
  const rows: { kind: PodKind; label: string }[] = [];
  const effects = state.effects;
  if (effects.widenTicks > 0) {
    rows.push({ kind: "widen", label: secondsLeft(effects.widenTicks) });
  }
  if (effects.narrowTicks > 0) {
    rows.push({ kind: "narrow", label: secondsLeft(effects.narrowTicks) });
  }
  if (effects.pierceTicks > 0) {
    rows.push({ kind: "pierce", label: secondsLeft(effects.pierceTicks) });
  }
  if (effects.shieldActive) rows.push({ kind: "shield", label: "ARMED" });
  let y = 108;
  for (const row of rows) {
    const sprite = assets.pods[row.kind];
    if (ready(sprite)) {
      ctx.drawImage(sprite, 948, y - 16);
    } else {
      drawPodFallback(ctx, 960, y - 4, row.kind);
    }
    text(ctx, row.label, 940, y + 1, {
      size: 14,
      color: COLORS.textDim,
      align: "right",
    });
    y += 30;
  }
}
