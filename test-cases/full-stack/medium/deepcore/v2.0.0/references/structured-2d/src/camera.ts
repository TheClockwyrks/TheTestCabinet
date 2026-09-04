// Deepcore — the camera (specs/world.md).
//
// The mine is far wider and far deeper than the logical stage, and the view over
// it is THE ENGINE'S CAMERA, positioned by the game. `camX` and `camY` on the
// state are the world point the game wants drawn at the top-left of the mine
// viewport; `syncCamera` places the engine's camera so that point lands exactly
// there, at a zoom of `1` and no rotation, so a world unit and a logical unit are
// the same length. Nothing here draws.
//
// Horizontally the miner is centered and the view is clamped so the bedrock
// border never leaves the frame. Vertically the camera LEADS the miner's travel:
// a signed distance carried across frames that builds toward a full lead over
// `CAM_LEAD_RAMP` seconds of sustained travel and unwinds `CAM_UNWIND_MULT`
// times faster, so a sustained descent brings the floor of a shaft into view
// early and a brief hop barely leads at all. The lead is driven by TIME rather
// than by speed, so a slow drift and a fast plunge reach it over the same span.

import type { World } from "@test-cabinet/structured-2d";
import {
  CAM_LEAD_MAX,
  CAM_LEAD_RAMP,
  CAM_STILL_SPEED,
  CAM_UNWIND_MULT,
  HUD_H,
  STAGE_H,
  STAGE_W,
  TILE,
  VIEW_H,
  VIEW_W,
} from "./constants";
import type { DeepcoreState } from "./game";
import { minerCenterX, minerCenterY } from "./physics";
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
export function placeCamera(d: DeepcoreState): void {
  d.camX = clamp(minerCenterX(d.miner) - VIEW_W / 2, 0, MAX_CAM_X);
  // There is no ceiling above the surface, so nothing clamps the rise.
  d.camY = Math.min(
    minerCenterY(d.miner) - VIEW_H / 2 + d.camLead,
    (d.coreRow + 1) * TILE - VIEW_H,
  );
}

/** Follow the miner, carrying a vertical lead toward the way it is travelling. */
export function updateCamera(d: DeepcoreState, dt: number): void {
  d.camLead = stepLead(d.camLead, d.miner.vy, dt);
  placeCamera(d);
}

/** Put the camera on the miner at once, with no lead, after a jump. */
export function recenterCamera(d: DeepcoreState): void {
  d.camLead = 0;
  placeCamera(d);
}

/**
 * Hand the engine's camera the projection the game is asking for.
 *
 * The engine's camera names the world point drawn at the CENTER of the logical
 * field; `camX` and `camY` name the one drawn at the top-left corner of the mine
 * viewport, which sits `HUD_H` below the top of that field. The two differ by
 * half the field, less the status bar, and nothing else: the zoom stays `1` and
 * the rotation `0`, so the conversion is exact in both directions.
 */
export function syncCamera(world: World, d: DeepcoreState): void {
  const camera = world.camera;
  camera.x = d.camX + STAGE_W / 2;
  camera.y = d.camY + STAGE_H / 2 - HUD_H;
}

/**
 * The world point drawn at the top-left corner of the mine viewport, read back
 * off the engine's own camera. It is the inverse of {@link syncCamera}, so it is
 * what the debug surface reports and what a drawing layer culls against.
 */
export function cameraCorner(world: World): { x: number; y: number } {
  const camera = world.camera;
  return {
    x: camera.x - STAGE_W / 2,
    y: camera.y - STAGE_H / 2 + HUD_H,
  };
}
