// Kessler — every frame the game draws (specs/screens.md, specs/field.md).
//
// The starfield, the containment field, the three rings and their targets
// (the damaged state included), the deflector, the shield ring, and the HUD
// are drawn in code in the palette `src/theme.ts` holds; the planet, the
// pods, and every ball are drawn from the produced sprites at native size,
// centered on their object, with a code-drawn stand-in wherever a sprite
// failed to load so a missing file costs polish rather than playability
// (`specs/assets.md`). Everything is laid out in logical units on the fixed
// `1000 x 1000` stage; the context arrives already carrying the engine's
// transform, so nothing here reads the canvas element's size.
//
// `renderGame` is a pure read of the state it is handed. Ambient motion (the
// star twinkle) runs on the game's resolved-tick clock rather than the wall
// clock, so a stepped scenario draws the same frame every time it reaches
// the same tick; the live particle effects are the one mutable layer, and
// they advance on the frame delta the state carries (`specs/assets.md`).

import { isReady, type KesslerAssets } from "./assets";
import {
  BALL_FRAME_COUNT,
  BALL_FRAME_TICKS,
  BALL_RADIUS,
  CENTER,
  CONTAINMENT_RADIUS,
  PLANET_RADIUS,
  POD_RADIUS,
  RINGS,
  SHIELD_RADIUS,
  SLOT_GAP_DEG,
  STAGE_SIZE,
  TRACK_INNER_RADIUS,
  TRACK_OUTER_RADIUS,
  type PodKind,
} from "./figures";
import { drawFx } from "./fx";
import { annularSector, text } from "./draw";
import type { View } from "./flow";
import { pointAt } from "./polar";
import { drawScreenChrome } from "./screens";
import { spanOf } from "./state";
import { COLORS } from "./theme";

type Ctx = CanvasRenderingContext2D;

/** The spin frame a ball shows, counted from its own spawn tick. */
export function ballFrameIndex(simTicks: number, spawnTick: number): number {
  const step = Math.floor((simTicks - spawnTick) / BALL_FRAME_TICKS);
  return ((step % BALL_FRAME_COUNT) + BALL_FRAME_COUNT) % BALL_FRAME_COUNT;
}

/** One background star. Laid once, from a fixed stream of its own. */
interface Star {
  x: number;
  y: number;
  r: number;
  alpha: number;
  phase: number;
}

/** A tiny fixed LCG for the star layout — never the game's pod stream. */
function starfield(count: number): Star[] {
  let s = 0x9d2c5680;
  const next = (): number => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
  return Array.from({ length: count }, () => ({
    x: next() * STAGE_SIZE,
    y: next() * STAGE_SIZE,
    r: 0.5 + next() * 1.1,
    alpha: 0.2 + next() * 0.6,
    phase: next() * Math.PI * 2,
  }));
}

const STARS = starfield(150);

const DEG = Math.PI / 180;

/** Draw one whole frame: the field, the live effects, then the screen. */
export function renderGame(state: View, ctx: Ctx): void {
  ctx.fillStyle = COLORS.stage;
  ctx.fillRect(0, 0, STAGE_SIZE, STAGE_SIZE);
  drawStars(ctx, state.ticks);
  drawContainment(ctx);
  drawRings(ctx, state);
  drawPlanet(ctx, state.assets);
  if (state.session.effects.shieldActive) drawShield(ctx);
  drawDeflector(ctx, state);
  drawPods(ctx, state);
  drawBalls(ctx, state);
  drawFx(ctx, state.lastFrameDt);
  drawScreenChrome(ctx, state);
}

function drawStars(ctx: Ctx, ticks: number): void {
  ctx.save();
  ctx.fillStyle = "#cfe2f4";
  for (const star of STARS) {
    const twinkle = 0.78 + 0.22 * Math.sin(ticks * 0.045 + star.phase);
    ctx.globalAlpha = star.alpha * twinkle;
    ctx.beginPath();
    ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawContainment(ctx: Ctx): void {
  ctx.save();
  // A soft halo first, then the glassy edge, so the extent reads at a glance.
  ctx.strokeStyle = COLORS.containment;
  ctx.globalAlpha = 0.1;
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.arc(CENTER, CENTER, CONTAINMENT_RADIUS, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 2.5;
  ctx.shadowColor = COLORS.containment;
  ctx.shadowBlur = 14;
  ctx.beginPath();
  ctx.arc(CENTER, CENTER, CONTAINMENT_RADIUS, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawPlanet(ctx: Ctx, assets: KesslerAssets): void {
  if (isReady(assets.planet)) {
    const half = assets.planet.width / 2;
    ctx.drawImage(assets.planet, CENTER - half, CENTER - half);
    return;
  }
  // The code-drawn stand-in: the one warm thing in view.
  const glow = ctx.createRadialGradient(
    CENTER - 18,
    CENTER - 18,
    8,
    CENTER,
    CENTER,
    PLANET_RADIUS,
  );
  glow.addColorStop(0, "#f0b46a");
  glow.addColorStop(0.65, "#b45f32");
  glow.addColorStop(1, "#5e2c18");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(CENTER, CENTER, PLANET_RADIUS, 0, Math.PI * 2);
  ctx.fill();
}

function drawShield(ctx: Ctx): void {
  ctx.save();
  ctx.strokeStyle = COLORS.shield;
  ctx.globalAlpha = 0.14;
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.arc(CENTER, CENTER, SHIELD_RADIUS, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 0.95;
  ctx.lineWidth = 2.5;
  ctx.shadowColor = COLORS.shield;
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.arc(CENTER, CENTER, SHIELD_RADIUS, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawRings(ctx: Ctx, state: View): void {
  for (let index = 0; index < RINGS.length; index += 1) {
    const spec = RINGS[index];
    const ring = state.session.rings[index];
    const accent = COLORS.ringAccents[index];

    // The faint orbit lane, so an emptied ring still reads as a place.
    ctx.save();
    ctx.strokeStyle = accent;
    ctx.globalAlpha = 0.06;
    ctx.lineWidth = spec.outerRadius - spec.innerRadius;
    ctx.beginPath();
    ctx.arc(CENTER, CENTER, spec.midRadius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    const plating = ctx.createRadialGradient(
      CENTER,
      CENTER,
      spec.innerRadius,
      CENTER,
      CENTER,
      spec.outerRadius,
    );
    plating.addColorStop(0, COLORS.plateDark);
    plating.addColorStop(0.55, COLORS.plate);
    plating.addColorStop(1, "#3a4c68");

    for (let slot = 0; slot < spec.slots; slot += 1) {
      const hp = ring.targets[slot];
      if (hp === null) continue;
      const start = ring.angleDeg + slot * spec.slotWidthDeg + SLOT_GAP_DEG;
      const end = start + spec.arcDeg;
      const damaged = hp < spec.hitPoints;
      ctx.save();
      annularSector(
        ctx,
        CENTER,
        CENTER,
        spec.innerRadius,
        spec.outerRadius,
        start,
        end,
      );
      ctx.fillStyle = damaged ? COLORS.plateDark : plating;
      ctx.fill();
      ctx.strokeStyle = accent;
      ctx.globalAlpha = damaged ? 0.35 : 0.85;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      if (damaged)
        drawCracks(ctx, spec.innerRadius, spec.outerRadius, start, end, slot);
      ctx.restore();
    }
  }
}

/**
 * The damaged state, read at a glance (`specs/rings.md`): the plating goes
 * dark and fracture lines cross it. The crack layout hangs off the slot
 * index alone, so it holds still as the ring orbits.
 */
function drawCracks(
  ctx: Ctx,
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
    ctx.moveTo(CENTER + innerR * Math.cos(a), CENTER + innerR * Math.sin(a));
    ctx.lineTo(
      CENTER + midR * Math.cos(a + bend),
      CENTER + midR * Math.sin(a + bend),
    );
    ctx.lineTo(
      CENTER + outerR * Math.cos(a - bend / 2),
      CENTER + outerR * Math.sin(a - bend / 2),
    );
    ctx.stroke();
  }
}

function drawDeflector(ctx: Ctx, state: View): void {
  const angle = state.session.paddleAngleDeg;
  const span = spanOf(state.session);
  const mid = (TRACK_INNER_RADIUS + TRACK_OUTER_RADIUS) / 2;
  const a0 = (angle - span / 2) * DEG;
  const a1 = (angle + span / 2) * DEG;

  ctx.save();
  // The faint full track, so the deflector reads as riding something.
  ctx.strokeStyle = COLORS.paddleGlow;
  ctx.globalAlpha = 0.07;
  ctx.lineWidth = TRACK_OUTER_RADIUS - TRACK_INNER_RADIUS;
  ctx.beginPath();
  ctx.arc(CENTER, CENTER, mid, 0, Math.PI * 2);
  ctx.stroke();

  // The deflector body, exactly the span in force.
  ctx.globalAlpha = 1;
  ctx.strokeStyle = COLORS.paddle;
  ctx.lineWidth = TRACK_OUTER_RADIUS - TRACK_INNER_RADIUS;
  ctx.lineCap = "butt";
  ctx.shadowColor = COLORS.paddleGlow;
  ctx.shadowBlur = 16;
  ctx.beginPath();
  ctx.arc(CENTER, CENTER, mid, a0, a1);
  ctx.stroke();

  // A bright leading edge on the contact side.
  ctx.shadowBlur = 0;
  ctx.strokeStyle = COLORS.paddleGlow;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(CENTER, CENTER, TRACK_OUTER_RADIUS + 1.5, a0, a1);
  ctx.stroke();

  // The center notch a player aims with.
  const notch = pointAt(mid, angle);
  ctx.fillStyle = COLORS.stage;
  ctx.beginPath();
  ctx.arc(notch.x, notch.y, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawPods(ctx: Ctx, state: View): void {
  for (const pod of state.session.pods) {
    const at = pointAt(pod.r, pod.angleDeg);
    const sprite = state.assets.pods[pod.kind];
    if (isReady(sprite)) {
      const half = sprite.width / 2;
      ctx.drawImage(sprite, at.x - half, at.y - half);
      continue;
    }
    drawPodFallback(ctx, at.x, at.y, pod.kind);
  }
}

/** The code-drawn pod stand-in, shared with the HUD and the how-to page. */
export function drawPodFallback(
  ctx: Ctx,
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

function drawBalls(ctx: Ctx, state: View): void {
  for (const ball of state.session.balls) {
    const frame = ballFrameIndex(state.simTicks, ball.spawnTick);
    const sprite = state.assets.ball[frame];
    if (isReady(sprite)) {
      const half = sprite.width / 2;
      ctx.drawImage(sprite, ball.x - half, ball.y - half);
      continue;
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
}

// --- The HUD (specs/screens.md "The HUD") ---

/** Seconds, whole, a whole-tick timer has left, for the effects readout. */
function secondsLeft(ticks: number): string {
  return `${Math.ceil(ticks / 60)}s`;
}

/**
 * The HUD, drawn on `playing` alone: the score, the lives, the wave, and the
 * active effects, in the stage's top corners — near the top, and clear of
 * the containment field's crown.
 */
export function drawHud(ctx: Ctx, state: View): void {
  const session = state.session;
  text(ctx, "SCORE", 28, 42, {
    size: 13,
    color: COLORS.textFaint,
    spacing: 3,
  });
  text(ctx, String(session.score), 28, 76, {
    size: 30,
    color: COLORS.text,
    bold: true,
  });
  text(ctx, "WAVE", 28, 106, { size: 13, color: COLORS.textFaint, spacing: 3 });
  text(ctx, String(session.wave), 90, 107, {
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
  const lifeSprite = state.assets.ball[0];
  const shown = Math.min(session.lives, 6);
  for (let i = 0; i < shown; i += 1) {
    const x = 962 - i * 26;
    if (isReady(lifeSprite)) {
      ctx.drawImage(lifeSprite, x - 10, 54, 20, 20);
    } else {
      ctx.fillStyle = COLORS.textDim;
      ctx.beginPath();
      ctx.arc(x, 64, 6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (session.lives > 6) {
    text(ctx, `x${session.lives}`, 972, 90, {
      size: 13,
      color: COLORS.textDim,
      align: "right",
    });
  }

  // The effects readout: each timed effect in force, and the shield.
  const rows: { kind: PodKind; label: string }[] = [];
  const effects = session.effects;
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
    const sprite = state.assets.pods[row.kind];
    if (isReady(sprite)) {
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
