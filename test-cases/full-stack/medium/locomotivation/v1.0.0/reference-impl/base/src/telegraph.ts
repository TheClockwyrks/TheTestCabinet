// Locomotivation — crossing telegraph + train proximity (specs/trains.md).
//
// Pure, derived-from-state helpers shared by the renderer (signal sprites, headlight glow)
// and the audio layer (horn edge, rising rumble). They read the sim but never mutate it, so
// they stay out of the deterministic core (sim/*) yet reuse its geometry.

import { TELEGRAPH_DANGER_LEAD, TELEGRAPH_LEAD, TILE, TRAIN_HALF_BAND, VIEW_H, VIEW_W } from "./constants";
import type { SignalState } from "./types";
import type { SimState, TrainInstance } from "./sim/world";
import { laneCenter, trainBody } from "./sim/world";

/** The crossing coordinate (px along the lane axis) a signal watches. */
function crossCoordFor(state: SimState, trackId: string): { axisPos: number; line: number; orientation: "horizontal" | "vertical"; lines: number[] } | null {
  const track = state.level.tracks.find((t) => t.id === trackId);
  const signal = state.level.signals.find((s) => s.trackId === trackId);
  if (!track || !signal) return null;
  const axisPos = track.orientation === "horizontal" ? signal.at.col * TILE + TILE / 2 : signal.at.row * TILE + TILE / 2;
  const lines = [track.line];
  if (track.sidingLine !== undefined) lines.push(track.sidingLine);
  return { axisPos, line: track.line, orientation: track.orientation, lines };
}

/** Signed distance a train's leading edge still has to travel to reach `axisPos` (≥0 = ahead). */
function distanceToCross(t: TrainInstance, axisPos: number): number {
  const body = trainBody(t, VIEW_W, VIEW_H, TRAIN_HALF_BAND); // second arg unused for horizontal
  if (t.orientation === "horizontal") {
    if (t.dir === "east") return axisPos - body.x1; // head is x1
    return body.x0 - axisPos; // head is x0, moving left
  }
  if (t.dir === "south") return axisPos - body.y1;
  return body.y0 - axisPos;
}

/** Whether a train's body currently straddles the crossing coordinate. */
function overCross(t: TrainInstance, axisPos: number): boolean {
  const body = trainBody(t, VIEW_W, VIEW_H, TRAIN_HALF_BAND);
  if (t.orientation === "horizontal") return body.x0 <= axisPos && axisPos <= body.x1;
  return body.y0 <= axisPos && axisPos <= body.y1;
}

/** The telegraph state of one signal, from the nearest approaching train on its lane. */
export function signalStateFor(state: SimState, trackId: string): SignalState {
  const info = crossCoordFor(state, trackId);
  if (!info) return "clear";
  let best: SignalState = "clear";
  for (const t of state.trains) {
    if (t.orientation !== info.orientation) continue;
    if (!info.lines.includes(t.line)) continue;
    if (overCross(t, info.axisPos)) return "danger";
    const d = distanceToCross(t, info.axisPos);
    if (d < 0) continue; // already passed
    const tta = d / t.speed;
    if (tta <= TELEGRAPH_DANGER_LEAD) return "danger";
    if (tta <= TELEGRAPH_LEAD) best = "warning";
  }
  return best;
}

/** All signal states this frame, keyed by signal id (for the renderer). */
export function computeSignalStates(state: SimState): Record<string, SignalState> {
  const out: Record<string, SignalState> = {};
  for (const s of state.level.signals) out[s.id] = signalStateFor(state, s.trackId);
  return out;
}

/** 0..1 proximity of the nearest train to the worker (1 = right on top), for rumble gain. */
export function nearestTrainProximity(state: SimState): number {
  const w = state.worker.pos;
  let best = 0;
  for (const t of state.trains) {
    const body = trainBody(t, VIEW_W, VIEW_H, TRAIN_HALF_BAND);
    const dx = Math.max(body.x0 - w.x, 0, w.x - body.x1);
    const dy = Math.max(body.y0 - w.y, 0, w.y - body.y1);
    const d = Math.hypot(dx, dy);
    const prox = Math.max(0, 1 - d / 220);
    if (prox > best) best = prox;
  }
  return best;
}

/** True when any signal is in warning/danger — used to fire the horn on the rising edge. */
export function anyApproaching(states: Record<string, SignalState>): boolean {
  return Object.values(states).some((s) => s !== "clear");
}

/** The lane-center y (or x) of a track line, re-exported for renderer convenience. */
export { laneCenter };
