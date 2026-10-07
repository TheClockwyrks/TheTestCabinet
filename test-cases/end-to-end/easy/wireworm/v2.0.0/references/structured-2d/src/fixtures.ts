// The scenarios the build's own tests are written over.
//
// These are the pure half of the harness: a `WirewormState` built by hand, with
// no engine and no canvas behind it, which is all the rules modules need. The
// engine-level checks in `engine.test.ts` go through `src/harness.ts` instead.
//
// `playingState` is the same arrangement `startPlaying` poses through the debug
// surface: live play on an empty, quiet board, with the three world gates held
// so nothing the scenario did not ask for arrives, enters, or costs a life.

import type { FoeKind, FoeState, WirewormState, WormState } from "./game";
import { WirewormState as State } from "./game";
import { addFoeTo } from "./foes";
import { tileCX, tileCY } from "./constants";
import { addWormTo } from "./worm";

/** Live play on an empty, quiet board. */
export function playingState(): WirewormState {
  const state = new State();
  state.screen = "playing";
  state.phase = "active";
  state.phaseTimer = 0;
  state.foeSpawning = false;
  state.wormEntry = false;
  state.cursor.contact = false;
  return state;
}

/**
 * A worm of `length` segments, its head on `(c, r)` and its chain laid out
 * behind it, opposite the heading it travels on.
 */
export function poseWorm(
  state: WirewormState,
  c: number,
  r: number,
  length = 1,
  dh = 1,
  dv = 1,
): WormState {
  const segments = Array.from({ length }, (_unused, index) => ({
    c: c - dh * index,
    r,
  }));
  const worm = addWormTo(state, segments, dh, dv);
  return worm;
}

/** A foe of `kind` standing on the center of tile `(c, r)`. */
export function poseFoe(
  state: WirewormState,
  kind: FoeKind,
  c: number,
  r: number,
  direction = 1,
): FoeState {
  return addFoeTo(state, kind, tileCX(c), tileCY(r), direction);
}
