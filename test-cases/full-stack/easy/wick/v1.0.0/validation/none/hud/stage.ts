// hud — the night every point in this directory is read on, and the frame each
// reading is taken from.
//
// THE NIGHT. `isolate` from the harness opens a fresh run, empties the world of
// every enemy, projectile, zone, gem, and pickup, drops the Taper a run starts
// with, and holds all nine driver switches, so nothing moves, nothing fires,
// nothing spawns, and nothing is drawn over the world but the HUD itself. Each
// point then poses back exactly the one figure it is about.
//
// THE FRAME. Every reading here compares two frames drawn by the same build a
// pose apart, so anything that changed between them is what the pose changed —
// and the run clock is the exception, since it changes on every tick on its own.
// So each frame is drawn at the same posed tick: `specs/instrumentation.md` has
// `setTick` change nothing but the clock, and `specs/world.md` has phase 1 of a
// tick raise `tick` before the phases that follow it read the new value, so a
// clock posed one short of {@link HUD_TICK} and stepped once draws {@link
// HUD_TICK}. Two frames drawn that way carry the same clock, the same kill
// count, and the same world, and differ only where the pose between them landed.

import { isolate, type Harness, type WickSnapshot } from "../harness";
import type { DrawCall, PixelRect } from "../harness";
import { frame } from "./regions";

/**
 * The tick every frame in this directory is drawn at: `2.5` seconds into the
 * night, which the clock shows as `0:02` and no rounding sits on the edge of.
 */
export const HUD_TICK = 150;

/** Open the isolated night every point here reads the HUD on. */
export function poseNight(h: Harness): Promise<WickSnapshot> {
  return isolate(h);
}

/** Draw one frame at {@link HUD_TICK}, whatever was posed before it. */
export async function drawFrame(h: Harness): Promise<WickSnapshot> {
  await h.debug.setTick(HUD_TICK - 1);
  return h.step(1);
}

/** Draw one frame at {@link HUD_TICK} and read the pixels it left. */
export async function drawnPixels(h: Harness): Promise<PixelRect> {
  await drawFrame(h);
  return frame(h);
}

/** Draw one frame at {@link HUD_TICK} and read the operations it made. */
export async function drawnCalls(h: Harness): Promise<DrawCall[]> {
  await drawFrame(h);
  return h.lastCalls();
}
