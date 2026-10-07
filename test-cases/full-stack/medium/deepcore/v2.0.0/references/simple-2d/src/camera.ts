// Deepcore — the camera (specs/world.md).
//
// This engine draws nothing and holds no camera, so the view over the mine is
// the game's own: `camX` and `camY` are the world point drawn at the top-left of
// the mine viewport, and `src/render.ts` applies them as a transform on the
// context the engine hands it. Nothing here draws; the camera is a pair of
// numbers the simulation carries, and a scenario can read them back.
//
// Horizontally the miner is centered and the view is clamped so the bedrock
// border never leaves the frame. Vertically the camera LEADS the miner's travel:
// a signed distance carried across frames that builds toward a full lead over
// `CAM_LEAD_RAMP` seconds of sustained travel and unwinds `CAM_UNWIND_MULT`
// times faster, so a sustained descent brings the floor of a shaft into view
// early and a brief hop barely leads at all. The lead is driven by TIME rather
// than by speed, so a slow drift and a fast plunge reach it over the same span.

import {
  CAM_LEAD_MAX,
  CAM_LEAD_RAMP,
  CAM_STILL_SPEED,
  CAM_UNWIND_MULT,
  TILE,
  VIEW_H,
  VIEW_W,
} from "./constants";
import { minerCenterX, minerCenterY } from "./physics";
import type { Draft } from "./state";
import { MAX_CAM_X } from "./tuning";

function clamp(value: number, lo: number, hi: number): number {
  return value < lo ? lo : value > hi ? hi : value;
}

/** The lead the miner's vertical velocity is asking for. */
export function leadTarget(vy: number): number {
  return Math.abs(vy) <= CAM_STILL_SPEED ? 0 : Math.sign(vy) * CAM_LEAD_MAX;
}

/**
 * Move the carried lead toward its target for one update, at the ramp rate away
 * from `0` and the unwind rate toward it, never overshooting.
 */
export function stepLead(lead: number, vy: number, dt: number): number {
  const target = leadTarget(vy);
  const delta = target - lead;
  if (delta === 0) return lead;
  const dir = Math.sign(delta);
  const away = lead === 0 || Math.sign(lead) === dir;
  const step =
    (CAM_LEAD_MAX / CAM_LEAD_RAMP) * (away ? 1 : CAM_UNWIND_MULT) * dt;
  return Math.abs(delta) <= step ? target : lead + dir * step;
}

/** Place the camera on the miner from the lead as it stands. */
export function placeCamera(d: Draft): void {
  d.camX = clamp(minerCenterX(d.miner) - VIEW_W / 2, 0, MAX_CAM_X);
  // There is no ceiling above the surface, so nothing clamps the rise.
  d.camY = Math.min(
    minerCenterY(d.miner) - VIEW_H / 2 + d.camLead,
    (d.coreRow + 1) * TILE - VIEW_H,
  );
}

/** Follow the miner, carrying a vertical lead toward the way it is travelling. */
export function updateCamera(d: Draft, dt: number): void {
  d.camLead = stepLead(d.camLead, d.miner.vy, dt);
  placeCamera(d);
}

/** Put the camera on the miner at once, with no lead, after a jump. */
export function recenterCamera(d: Draft): void {
  d.camLead = 0;
  placeCamera(d);
}
