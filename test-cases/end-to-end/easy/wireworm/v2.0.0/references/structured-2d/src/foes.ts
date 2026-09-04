// Wireworm — the three support foes: how they travel, what they do to the field,
// and how a level draws them in (`specs/foes.md`).
//
// Each foe carries a velocity in logical units per second and its position is
// integrated against the frame's delta, so nothing here is clocked. What differs
// between the three is the EDGE they leave the board at and the ONE THING each
// does to the tile its center occupies: the glitch eats the node standing there,
// the dropper lays a fresh inert node where there is none, and the corruptor
// slams the node there straight to critical.
//
// The rule that the effect is a per-tile OCCUPANCY rather than a per-transit
// event is what makes a foe posed with its travel held readable: it stands on
// one tile and acts on it, with no motion at all.
//
// The two faculty gates are separate for the same reason. `mind` is the foe's
// own behavior — the glitch's dart re-pick and its eating, the dropper's
// node-laying, the corruptor's slam — and `travel` is its locomotion. Neither
// gate touches the other.

import {
  CHARGE_MAX,
  COLS,
  CORRUPTOR_FROM_LEVEL,
  CORRUPTOR_MAX_INTERVAL,
  CORRUPTOR_MIN_INTERVAL,
  CORRUPTOR_SPEED,
  DROPPER_CHECK_INTERVAL,
  DROPPER_FROM_LEVEL,
  DROPPER_SPARSE_THRESHOLD,
  DROPPER_SPEED,
  FOE_HALF,
  GLITCH_DART_INTERVAL,
  GLITCH_FROM_LEVEL,
  GLITCH_H_SPEED,
  GLITCH_MAX_INTERVAL,
  GLITCH_MAX_ON_BOARD,
  GLITCH_MIN_INTERVAL,
  GLITCH_V_SPEED,
  SCATTER_BOTTOM_ROW,
  SCATTER_TOP_ROW,
  STAGE_H,
  STAGE_W,
  inBounds,
  tileCX,
  tileCY,
} from "./constants";
import type { FrameCues } from "./audio";
import type { FoeKind, FoeState, WirewormState } from "./game";
import { dropNode, nodeAt, putNode, tileColumn, tileRow } from "./grid";
import { randomInt, randomRange, randomSign } from "./rng";

/** The velocity a foe of `kind` rests at, travelling in `direction`. */
export function restingVelocity(
  kind: FoeKind,
  direction: number,
): { vx: number; vy: number } {
  switch (kind) {
    case "glitch":
      return { vx: GLITCH_H_SPEED * direction, vy: GLITCH_V_SPEED };
    case "dropper":
      return { vx: 0, vy: DROPPER_SPEED };
    case "corruptor":
      return { vx: CORRUPTOR_SPEED * direction, vy: 0 };
  }
}

/** A foe of `kind` centered at `(x, y)`, appended with the next free id. */
export function addFoeTo(
  state: WirewormState,
  kind: FoeKind,
  x: number,
  y: number,
  direction = 1,
): FoeState {
  const { vx, vy } = restingVelocity(kind, direction);
  const foe: FoeState = {
    id: state.nextId,
    kind,
    x,
    y,
    vx,
    vy,
    hit: false,
    mind: true,
    travel: true,
    dartClock: 0,
  };
  state.nextId += 1;
  state.foes.push(foe);
  return foe;
}

/** Travel every foe that has its locomotion, and run every foe's own behavior. */
export function advanceFoes(
  state: WirewormState,
  dt: number,
  cues: FrameCues,
): void {
  const surviving: FoeState[] = [];
  for (const foe of state.foes) {
    if (foe.travel) travel(foe, dt);
    if (foe.mind) think(state, foe, dt, cues);
    if (!offBoard(foe)) surviving.push(foe);
  }
  state.foes = surviving;
}

/** One foe's locomotion: its velocity over the frame, and the side edges. */
function travel(foe: FoeState, dt: number): void {
  foe.x += foe.vx * dt;
  foe.y += foe.vy * dt;

  // A glitch reverses at a side edge rather than leaving through one.
  if (foe.kind === "glitch") {
    if (foe.x <= 0) {
      foe.x = 0;
      foe.vx = Math.abs(foe.vx);
    } else if (foe.x >= STAGE_W) {
      foe.x = STAGE_W;
      foe.vx = -Math.abs(foe.vx);
    }
  }
}

/** Whether the foe has passed the edge its kind leaves the board through. */
function offBoard(foe: FoeState): boolean {
  if (foe.kind === "corruptor") return foe.x < 0 || foe.x > STAGE_W;
  return foe.y > STAGE_H;
}

/** One foe's own behavior, on the tile its center occupies. */
function think(
  state: WirewormState,
  foe: FoeState,
  dt: number,
  cues: FrameCues,
): void {
  const c = tileColumn(foe.x);
  const r = tileRow(foe.y);

  if (foe.kind === "glitch") {
    // The dart clock runs on the same accumulate-and-carry rule the worm's step
    // clock does, so a frame covering several intervals makes several
    // reversals.
    foe.dartClock += dt;
    while (foe.dartClock >= GLITCH_DART_INTERVAL) {
      foe.dartClock -= GLITCH_DART_INTERVAL;
      foe.vx = -foe.vx;
    }
    // It eats the node on its tile whatever the charge, and a critical node
    // eaten this way is removed without detonating.
    if (inBounds(c, r)) dropNode(state, c, r);
    return;
  }

  if (foe.kind === "dropper") {
    if (r < SCATTER_TOP_ROW || r > SCATTER_BOTTOM_ROW) return;
    if (!inBounds(c, r)) return;
    if (nodeAt(state.nodes, c, r) !== null) return;
    putNode(state, c, r, 0);
    return;
  }

  const node = inBounds(c, r) ? nodeAt(state.nodes, c, r) : null;
  if (node === null || node.charge >= CHARGE_MAX) return;
  node.charge = CHARGE_MAX;
  cues.critical = true;
}

/** Start the clocks the level's own spawners keep, as its play becomes active. */
export function resetSpawnClocks(state: WirewormState): void {
  state.glitchTimer = randomRange(
    state,
    GLITCH_MIN_INTERVAL,
    GLITCH_MAX_INTERVAL,
  );
  state.corruptorTimer = randomRange(
    state,
    CORRUPTOR_MIN_INTERVAL,
    CORRUPTOR_MAX_INTERVAL,
  );
  state.dropperTimer = DROPPER_CHECK_INTERVAL;
}

/**
 * The level's own spawning of foes: the glitch's paced arrival, the corruptor's,
 * and the dropper's sparse-field check. This is the whole of what
 * `setFoeSpawning(false)` holds; a foe already on the board still thinks,
 * travels and acts.
 *
 * A clock resting at zero — the value a `reset` leaves it at — is drawn afresh
 * before it is counted down, so a level whose play has just become active waits
 * out a whole interval rather than admitting a foe on its first frame.
 */
export function runSpawners(state: WirewormState, dt: number): void {
  if (state.level >= GLITCH_FROM_LEVEL) {
    if (state.glitchTimer <= 0) {
      state.glitchTimer = randomRange(
        state,
        GLITCH_MIN_INTERVAL,
        GLITCH_MAX_INTERVAL,
      );
    }
    state.glitchTimer -= dt;
    if (state.glitchTimer <= 0) {
      const onBoard = state.foes.filter((foe) => foe.kind === "glitch").length;
      if (onBoard < GLITCH_MAX_ON_BOARD) enterGlitch(state);
      state.glitchTimer = randomRange(
        state,
        GLITCH_MIN_INTERVAL,
        GLITCH_MAX_INTERVAL,
      );
    }
  }

  if (state.level >= CORRUPTOR_FROM_LEVEL) {
    if (state.corruptorTimer <= 0) {
      state.corruptorTimer = randomRange(
        state,
        CORRUPTOR_MIN_INTERVAL,
        CORRUPTOR_MAX_INTERVAL,
      );
    }
    state.corruptorTimer -= dt;
    if (state.corruptorTimer <= 0) {
      enterCorruptor(state);
      state.corruptorTimer = randomRange(
        state,
        CORRUPTOR_MIN_INTERVAL,
        CORRUPTOR_MAX_INTERVAL,
      );
    }
  }

  if (state.level >= DROPPER_FROM_LEVEL) {
    if (state.dropperTimer <= 0) state.dropperTimer = DROPPER_CHECK_INTERVAL;
    state.dropperTimer -= dt;
    if (state.dropperTimer <= 0) {
      if (lowerFieldCount(state) < DROPPER_SPARSE_THRESHOLD) {
        enterDropper(state);
      }
      state.dropperTimer = DROPPER_CHECK_INTERVAL;
    }
  }
}

/** The nodes standing in rows 10 to 19, which is what "sparse" is counted over. */
export function lowerFieldCount(state: WirewormState): number {
  return state.nodes.filter((node) => node.r >= 10).length;
}

/** A glitch entering at a side edge, on a row from 8 to 15, heading inward. */
function enterGlitch(state: WirewormState): FoeState {
  const edge = randomSign(state);
  const row = randomInt(state, 8, 15);
  const x = edge < 0 ? FOE_HALF : STAGE_W - FOE_HALF;
  return addFoeTo(state, "glitch", x, tileCY(row), edge < 0 ? 1 : -1);
}

/** A corruptor entering at a side edge, on a row from 1 to 6, heading inward. */
function enterCorruptor(state: WirewormState): FoeState {
  const edge = randomSign(state);
  const row = randomInt(state, 1, 6);
  const x = edge < 0 ? FOE_HALF : STAGE_W - FOE_HALF;
  return addFoeTo(state, "corruptor", x, tileCY(row), edge < 0 ? 1 : -1);
}

/** A dropper entering at row 0, on the center of a column, falling. */
function enterDropper(state: WirewormState): FoeState {
  const column = randomInt(state, 0, COLS - 1);
  return addFoeTo(state, "dropper", tileCX(column), tileCY(0));
}
