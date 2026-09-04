// Wireworm — the three support foes (specs/foes.md).
//
// Each foe works the node field in its own way: the glitch eats the tile it
// stands on, the dropper reseeds the empty tiles it falls through, and the
// corruptor slams the tiles it crawls across straight to critical. A foe acts on
// the tile its CENTER occupies and on no other, which is what makes a foe posed
// with its travel gated a scenario with no motion in it at all.
//
// The two faculties are separate on purpose. `mind` is the foe's own behavior —
// the glitch's dart and its eating, the dropper's laying, the corruptor's slam.
// `travel` is its locomotion. Gating one leaves the other running, so a check on
// what a foe DOES cannot be disturbed by where it went, and the other way about.
//
// Arrival is the LEVEL's, not the foe's: it is gated by `foeSpawning` and paced
// by the three clocks the state carries. A clock resting at zero is one that has
// not been armed yet — which is what a fresh level, a respawn, and the debug
// surface's `reset` all leave behind — so the first active update arms it rather
// than firing it.

import {
  CHARGE_MAX,
  CORRUPTOR_ENTRY_BOTTOM_ROW,
  CORRUPTOR_ENTRY_TOP_ROW,
  CORRUPTOR_FROM_LEVEL,
  CORRUPTOR_MAX_INTERVAL,
  CORRUPTOR_MIN_INTERVAL,
  CORRUPTOR_SPEED,
  COLS,
  CUES,
  DROPPER_CHECK_INTERVAL,
  DROPPER_COUNT_BOTTOM_ROW,
  DROPPER_COUNT_TOP_ROW,
  DROPPER_FROM_LEVEL,
  DROPPER_SPARSE_THRESHOLD,
  DROPPER_SPEED,
  ENTRY_ROW,
  GLITCH_DART_INTERVAL,
  GLITCH_ENTRY_BOTTOM_ROW,
  GLITCH_ENTRY_TOP_ROW,
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
  colAt,
  rowAt,
  tileCX,
  tileCY,
} from "./constants";
import { chargeAt, countNodes, hasNode, removeNode, setCharge } from "./field";
import { nextChance, nextInt, nextRange } from "./rng";
import type { CueSink, Foe, FoeKind, WirewormState } from "./types";

/** The velocity a foe of each kind rests at, travelling rightward or falling. */
export function restingVelocity(kind: FoeKind): { vx: number; vy: number } {
  switch (kind) {
    case "glitch":
      return { vx: GLITCH_H_SPEED, vy: GLITCH_V_SPEED };
    case "dropper":
      return { vx: 0, vy: DROPPER_SPEED };
    case "corruptor":
      return { vx: CORRUPTOR_SPEED, vy: 0 };
  }
}

/** Build one foe of `kind` with its center at `(x, y)` and both faculties on. */
export function makeFoe(
  state: WirewormState,
  kind: FoeKind,
  x: number,
  y: number,
): Foe {
  const { vx, vy } = restingVelocity(kind);
  const foe: Foe = {
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
  return foe;
}

/** Advance every foe, drop the ones that left the board, and run the arrivals. */
export function updateFoes(
  state: WirewormState,
  dt: number,
  cues: CueSink,
): void {
  state.foes = state.foes.filter((foe) => advanceFoe(state, foe, dt, cues));
  if (state.foeSpawning) runSpawners(state, dt);
}

/** One foe's frame. Returns `false` once it has left the board for good. */
function advanceFoe(
  state: WirewormState,
  foe: Foe,
  dt: number,
  cues: CueSink,
): boolean {
  switch (foe.kind) {
    case "glitch":
      return advanceGlitch(state, foe, dt);
    case "dropper":
      return advanceDropper(state, foe, dt);
    case "corruptor":
      return advanceCorruptor(state, foe, dt, cues);
  }
}

/**
 * The glitch: horizontal darts as it descends, eating whatever node it is over.
 *
 * The dart clock accumulates the frame's delta and carries its remainder, so a
 * frame covering several intervals makes several reversals — the same
 * accumulate-and-carry rule the worm's step clock uses. A reversal is a change
 * of DIRECTION, so the speed a scenario posed survives it.
 */
function advanceGlitch(state: WirewormState, foe: Foe, dt: number): boolean {
  if (foe.mind) {
    foe.dartClock += dt;
    while (foe.dartClock >= GLITCH_DART_INTERVAL) {
      foe.dartClock -= GLITCH_DART_INTERVAL;
      foe.vx = -foe.vx;
    }
  }
  if (foe.travel) {
    foe.x += foe.vx * dt;
    foe.y += foe.vy * dt;
    // A side edge turns it back rather than letting it leave sideways.
    if (foe.x <= 0) {
      foe.x = 0;
      foe.vx = Math.abs(foe.vx);
    } else if (foe.x >= STAGE_W) {
      foe.x = STAGE_W;
      foe.vx = -Math.abs(foe.vx);
    }
  }
  if (foe.mind) {
    // It eats the node under it whatever its charge, and a critical one is
    // removed without detonating.
    const c = colAt(foe.x);
    const r = rowAt(foe.y);
    if (hasNode(state.field, c, r)) removeNode(state.field, c, r);
  }
  return foe.y <= STAGE_H;
}

/** The dropper: straight down its column, laying a node on every empty tile. */
function advanceDropper(state: WirewormState, foe: Foe, dt: number): boolean {
  if (foe.travel) {
    foe.x += foe.vx * dt;
    foe.y += foe.vy * dt;
  }
  if (foe.mind) {
    const c = colAt(foe.x);
    const r = rowAt(foe.y);
    if (
      r >= SCATTER_TOP_ROW &&
      r <= SCATTER_BOTTOM_ROW &&
      !hasNode(state.field, c, r)
    ) {
      setCharge(state.field, c, r, 0);
    }
  }
  return foe.y <= STAGE_H;
}

/** The corruptor: across its row, slamming every node it crosses to critical. */
function advanceCorruptor(
  state: WirewormState,
  foe: Foe,
  dt: number,
  cues: CueSink,
): boolean {
  if (foe.travel) {
    foe.x += foe.vx * dt;
    foe.y += foe.vy * dt;
  }
  if (foe.mind) {
    const c = colAt(foe.x);
    const r = rowAt(foe.y);
    const charge = chargeAt(state.field, c, r);
    // It lays nothing on an empty tile, and a node it crosses goes straight to
    // critical rather than up one level.
    if (charge >= 0 && charge < CHARGE_MAX) {
      setCharge(state.field, c, r, CHARGE_MAX);
      cues.play(CUES.critical);
    }
  }
  return foe.x >= 0 && foe.x <= STAGE_W;
}

/** The level's own arrivals, each on its own clock. */
function runSpawners(state: WirewormState, dt: number): void {
  if (state.level >= GLITCH_FROM_LEVEL) {
    if (state.glitchTimer <= 0) {
      state.glitchTimer = nextRange(
        state,
        GLITCH_MIN_INTERVAL,
        GLITCH_MAX_INTERVAL,
      );
    }
    state.glitchTimer -= dt;
    while (state.glitchTimer <= 0) {
      state.glitchTimer += nextRange(
        state,
        GLITCH_MIN_INTERVAL,
        GLITCH_MAX_INTERVAL,
      );
      const onBoard = state.foes.filter((foe) => foe.kind === "glitch").length;
      if (onBoard < GLITCH_MAX_ON_BOARD) state.foes.push(enterGlitch(state));
    }
  }

  if (state.level >= DROPPER_FROM_LEVEL) {
    if (state.dropperTimer <= 0) state.dropperTimer = DROPPER_CHECK_INTERVAL;
    state.dropperTimer -= dt;
    while (state.dropperTimer <= 0) {
      state.dropperTimer += DROPPER_CHECK_INTERVAL;
      const below = countNodes(
        state.field,
        DROPPER_COUNT_TOP_ROW,
        DROPPER_COUNT_BOTTOM_ROW,
      );
      if (below < DROPPER_SPARSE_THRESHOLD)
        state.foes.push(enterDropper(state));
    }
  }

  if (state.level >= CORRUPTOR_FROM_LEVEL) {
    if (state.corruptorTimer <= 0) {
      state.corruptorTimer = nextRange(
        state,
        CORRUPTOR_MIN_INTERVAL,
        CORRUPTOR_MAX_INTERVAL,
      );
    }
    state.corruptorTimer -= dt;
    while (state.corruptorTimer <= 0) {
      state.corruptorTimer += nextRange(
        state,
        CORRUPTOR_MIN_INTERVAL,
        CORRUPTOR_MAX_INTERVAL,
      );
      state.foes.push(enterCorruptor(state));
    }
  }
}

/** A glitch entering at a side edge, on a row between 8 and 15, heading inward. */
function enterGlitch(state: WirewormState): Foe {
  const fromLeft = nextChance(state, 0.5);
  const row = nextInt(state, GLITCH_ENTRY_TOP_ROW, GLITCH_ENTRY_BOTTOM_ROW);
  const foe = makeFoe(
    state,
    "glitch",
    fromLeft ? tileCX(0) : tileCX(COLS - 1),
    tileCY(row),
  );
  foe.vx = fromLeft ? GLITCH_H_SPEED : -GLITCH_H_SPEED;
  return foe;
}

/** A dropper entering at row 0, on the center of a column the generator picks. */
function enterDropper(state: WirewormState): Foe {
  const column = nextInt(state, 0, COLS - 1);
  return makeFoe(state, "dropper", tileCX(column), tileCY(ENTRY_ROW));
}

/** A corruptor entering at a side edge, on a row between 1 and 6, heading inward. */
function enterCorruptor(state: WirewormState): Foe {
  const fromLeft = nextChance(state, 0.5);
  const row = nextInt(
    state,
    CORRUPTOR_ENTRY_TOP_ROW,
    CORRUPTOR_ENTRY_BOTTOM_ROW,
  );
  const foe = makeFoe(
    state,
    "corruptor",
    fromLeft ? tileCX(0) : tileCX(COLS - 1),
    tileCY(row),
  );
  foe.vx = fromLeft ? CORRUPTOR_SPEED : -CORRUPTOR_SPEED;
  return foe;
}
