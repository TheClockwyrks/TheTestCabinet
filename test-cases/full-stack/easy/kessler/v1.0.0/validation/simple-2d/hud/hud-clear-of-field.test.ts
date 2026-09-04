// hud/hud-clear-of-field — every HUD readout is drawn near the top of the
// stage and clear of the containment field.
//
// specs/screens.md: "The HUD is drawn on `playing`, near the top of the stage
// and clear of the containment field", and the field is "the circle of radius
// `480`" around the stage center (specs/field.md). So nothing the HUD draws
// may cross that circle, and every readout must sit in the top of the stage.
// "Near the top" carries no figure in the spec; the tolerance taken is the
// top quarter of the 1000-unit stage (anchor y at most 250), generous against
// any reading of "near" — a readout lower than that is not near the top.
//
// The full HUD is summoned: score, lives, wave, two timed effects, and the
// shield, over an isolated field, so every readout the build draws is on
// screen at once. What the frame then shows as text runs is the HUD (the
// playing screen has no other text), and what it blits from the produced pod
// or ball sprites away from the stage center is HUD iconography (the one
// centered sprite is the planet). A readout the build paints by some route
// this frame cannot attribute — a pre-composited canvas, say — is invisible
// here and is policed by the drawn-ness items instead; this item decides
// placement for everything it can see.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual, fail } from "../assert";
import {
  FIELD_RADIUS,
  PIERCE_DURATION_TICKS,
  STAGE_CX,
  STAGE_CY,
  WIDEN_DURATION_TICKS,
} from "../constants";
import {
  captureStill,
  isolate,
  openHarness,
  textDraws,
  type Blit,
  type Harness,
} from "../harness";

/** The honest reading of "near the top": the stage's top quarter. */
const NEAR_TOP_LIMIT = 250;

/** How close to the stage center a blit is the planet, not HUD iconography. */
const PLANET_EXCLUSION = 200;

/** A blit wider or taller than this is a composited surface, not an icon. */
const ICON_LIMIT = 300;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("keeps every HUD readout near the top, off the field of play", async () => {
  isolate(h);
  h.debug.setScore(12345);
  h.debug.setWave(2);
  h.debug.setEffectTicks("widen", WIDEN_DURATION_TICKS);
  h.debug.setEffectTicks("pierce", PIERCE_DURATION_TICKS);
  h.debug.setShield(true);

  const { calls, blits } = await h.frameDraw();
  captureStill(h, "hud");

  const view = h.viewport();
  const center = h.device(STAGE_CX, STAGE_CY);
  const fieldRadius = FIELD_RADIUS * view.scale;
  const topLimit = h.device(0, NEAR_TOP_LIMIT).y;

  for (const draw of textDraws(calls)) {
    const what = `the HUD text run ${JSON.stringify(draw.text)}`;
    const [x0, x1] = runExtent(draw);
    assertOffField(center, fieldRadius, x0, x1, draw.y, draw.y, what);
    assertLessThanOrEqual(
      draw.y,
      topLimit,
      `${what}: anchored near the top of the stage (top ${NEAR_TOP_LIMIT} units)`,
    );
  }

  for (const blit of blits) {
    if (!isHudBlit(blit, center, view.scale)) continue;
    const what = `the HUD blit of ${blit.id === "" ? "a painted surface" : blit.id}`;
    assertOffField(
      center,
      fieldRadius,
      blit.x,
      blit.x + blit.w,
      blit.y,
      blit.y + blit.h,
      what,
    );
    assertLessThanOrEqual(
      blit.y,
      topLimit,
      `${what}: near the top of the stage (top ${NEAR_TOP_LIMIT} units)`,
    );
  }
});

/** The horizontal span a text run covers, from its anchor and alignment. */
function runExtent(draw: {
  x: number;
  width: number;
  textAlign: string;
}): [number, number] {
  if (draw.textAlign === "center") {
    return [draw.x - draw.width / 2, draw.x + draw.width / 2];
  }
  if (draw.textAlign === "right" || draw.textAlign === "end") {
    return [draw.x - draw.width, draw.x];
  }
  return [draw.x, draw.x + draw.width];
}

/** A blit that reads as HUD iconography: small, and off the planet. */
function isHudBlit(
  blit: Blit,
  center: { x: number; y: number },
  scale: number,
): boolean {
  if (blit.w > ICON_LIMIT * scale || blit.h > ICON_LIMIT * scale) return false;
  const cx = blit.x + blit.w / 2;
  const cy = blit.y + blit.h / 2;
  return Math.hypot(cx - center.x, cy - center.y) > PLANET_EXCLUSION * scale;
}

/** The rectangle from (x0, y0) to (x1, y1) stays outside the field circle. */
function assertOffField(
  center: { x: number; y: number },
  fieldRadius: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  what: string,
): void {
  const nearestX = Math.min(Math.max(center.x, x0), x1);
  const nearestY = Math.min(Math.max(center.y, y0), y1);
  const distance = Math.hypot(nearestX - center.x, nearestY - center.y);
  if (distance < fieldRadius) {
    fail(
      `${what}: drawn clear of the containment field (no closer than ` +
        `${fieldRadius} device px to the stage center)`,
      `its nearest point sits ${Math.round(distance)} device px from the center, inside the field of play`,
    );
  }
}
