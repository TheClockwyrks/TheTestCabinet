// Wireworm — the data-worm: how it enters, how it steps, and what is left when
// its segments are removed (`specs/worm.md`).
//
// The worm is the one CLOCKED thing in the game. Everything else is a per-second
// rate integrated against the frame's delta; a worm accumulates that same delta
// in its own `stepClock` and takes one whole tile step each time the clock
// reaches the level's interval, taking the interval off the clock rather than
// zeroing it — so a frame covering several intervals runs several steps in order
// and the remainder carries into the next frame, and an interval of game time
// produces the same number of steps however it was divided into frames.
//
// Every step is one of two things: a WIND, which tries one tile horizontally and
// turns where it cannot, or a DIVE, which drives one tile straight down whatever
// stands there. Only a horizontal step can be blocked, which is why a drop — the
// vertical half of a turn — passes through the tile below it and leaves whatever
// stands there exactly as it was.

import {
  BAND_TOP_ROW,
  CHARGE_MAX,
  COLS,
  inBounds,
  wormLength,
  wormStepInterval,
} from "./constants";
import type { FrameCues } from "./audio";
import type { Tile, WirewormState, WormState } from "./game";
import { nodeAt, segmentAt } from "./grid";
import { random } from "./rng";

/** A worm of `segments`, appended to the roster with the next free id. */
export function addWormTo(
  state: WirewormState,
  segments: Tile[],
  dh: number,
  dv: number,
): WormState {
  const worm: WormState = {
    id: state.nextId,
    segments,
    dh,
    dv,
    diving: false,
    stepping: true,
    body: true,
    stepClock: 0,
  };
  state.nextId += 1;
  state.worms.push(worm);
  return worm;
}

/**
 * Bring in the level's worm along the entry row (`specs/worm.md`, Length and
 * entry): `wormLength(level)` segments laid on row `0`, entering from the left
 * edge or the right, the head furthest from that edge and the tail nearest it,
 * heading inward and descending. Which edge is a coin flip, unless the debug
 * surface posed it, in which case the pose decides this one entry and is
 * consumed by it.
 */
export function enterLevelWorm(state: WirewormState): WormState {
  const length = wormLength(state.level);
  const posed = state.nextWormEntry;
  state.nextWormEntry = null;
  const fromLeft = posed === null ? random() < 0.5 : posed === "left";
  const segments: Tile[] = [];
  for (let index = 0; index < length; index += 1) {
    // `index` counts from the head, which is the segment furthest from the edge.
    segments.push(
      fromLeft
        ? { c: length - 1 - index, r: 0 }
        : { c: COLS - length + index, r: 0 },
    );
  }
  return addWormTo(state, segments, fromLeft ? 1 : -1, 1);
}

/**
 * Advance every worm's step clock by `dt` and run the whole steps it completed.
 *
 * The roster is copied before the walk because a step never adds a worm but a
 * split does, and copying keeps this loop's meaning independent of that.
 */
export function advanceWorms(
  state: WirewormState,
  dt: number,
  cues: FrameCues,
): void {
  const interval = wormStepInterval(state.level);
  for (const worm of [...state.worms]) {
    if (!worm.stepping) continue;
    worm.stepClock += dt;
    while (worm.stepClock >= interval) {
      worm.stepClock -= interval;
      stepWorm(state, worm, cues);
    }
  }
}

/** One whole tile step of one worm. */
export function stepWorm(
  state: WirewormState,
  worm: WormState,
  cues: FrameCues,
): void {
  const head = worm.segments[0];
  if (head === undefined) return;

  // Where every segment stood before the step, which is the path the body
  // follows into.
  const before = worm.segments.map((segment) => ({
    c: segment.c,
    r: segment.r,
  }));

  // A worm posed diving on the band by the debug surface has nowhere left to
  // dive to, so the dive ends and the step is an ordinary wind.
  if (worm.diving && head.r >= BAND_TOP_ROW) worm.diving = false;

  if (worm.diving) {
    // Straight down its own column, whatever stands on the tile it enters.
    head.r += 1;
  } else {
    windHead(state, worm, head, cues);
  }

  // The dive ends at the end of the step in which the head reaches the band.
  if (worm.diving && head.r >= BAND_TOP_ROW) worm.diving = false;

  if (worm.body) {
    for (let index = 1; index < worm.segments.length; index += 1) {
      worm.segments[index].c = before[index - 1].c;
      worm.segments[index].r = before[index - 1].r;
    }
  }
}

/** The winding half of a step: one tile across, or the turn a block produces. */
function windHead(
  state: WirewormState,
  worm: WormState,
  head: Tile,
  cues: FrameCues,
): void {
  const tc = head.c + worm.dh;
  const tr = head.r;
  const node = inBounds(tc, tr) ? nodeAt(state.nodes, tc, tr) : null;
  const blocked =
    !inBounds(tc, tr) ||
    node !== null ||
    segmentAt(state.worms, tc, tr) !== null;

  if (!blocked) {
    head.c = tc;
    return;
  }

  // A block by a node at the critical charge sends the worm diving, from any row
  // above the player band. The node is already capped, so nothing is charged.
  if (node !== null && node.charge >= CHARGE_MAX && head.r < BAND_TOP_ROW) {
    worm.diving = true;
    head.r += 1;
    return;
  }

  // Any other block by a node charges it one level, capped. A block by the side
  // edge of the board or by a worm segment charges nothing.
  if (node !== null && node.charge < CHARGE_MAX) {
    node.charge += 1;
    if (node.charge === CHARGE_MAX) cues.critical = true;
  }

  // The turn: the horizontal heading reverses, the vertical heading flips where
  // the row it would take is off the board, and the head moves one row on it.
  worm.dh = -worm.dh;
  if (!inBounds(head.c, head.r + worm.dv)) worm.dv = -worm.dv;
  head.r += worm.dv;
}

/**
 * Remove the segments at `removed` from `worm` and leave behind the worms the
 * survivors make (`specs/worm.md`, Cutting the worm).
 *
 * The survivors fall into runs of consecutive segments counted from the head
 * end. The first run keeps the worm's id, its headings, its diving flag and its
 * own step clock; each further run becomes a new worm with a fresh id, appended
 * to the roster in order from the head end, its leading segment its head and its
 * step clock started at that moment. A worm that lost every segment is gone.
 *
 * The faculty gates are inherited, so a worm posed with its stepping held for a
 * scenario does not come back to life as two worms that step.
 */
export function cutWorm(
  state: WirewormState,
  worm: WormState,
  removed: ReadonlySet<number>,
): void {
  const runs: Tile[][] = [];
  let run: Tile[] = [];
  for (let index = 0; index < worm.segments.length; index += 1) {
    if (removed.has(index)) {
      if (run.length > 0) runs.push(run);
      run = [];
      continue;
    }
    run.push(worm.segments[index]);
  }
  if (run.length > 0) runs.push(run);

  if (runs.length === 0) {
    const at = state.worms.indexOf(worm);
    if (at !== -1) state.worms.splice(at, 1);
    return;
  }

  worm.segments = runs[0];
  for (let index = 1; index < runs.length; index += 1) {
    const piece = addWormTo(state, runs[index], worm.dh, worm.dv);
    piece.diving = worm.diving;
    piece.stepping = worm.stepping;
    piece.body = worm.body;
  }
}
