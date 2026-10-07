// Wireworm — the data-worm's step, and what happens when its segments are
// removed (specs/worm.md).
//
// A worm advances one whole tile per step at the level's interval: it winds
// horizontally, turns and moves one row when the step ahead is blocked, dives
// straight down a column when the block was a critical node, and oscillates
// between the floor and the entry row rather than leaving the board. Only a
// HORIZONTAL step can be blocked, so the vertical move a block produces enters
// whatever tile is below — that one sentence is why the drop rules and the block
// rules are separate below.
//
// The step clock itself, the level's interval, and the cues an event raises are
// the caller's; this file is the geometry.

import { BAND_TOP_ROW, CHARGE_MAX, COLS, CUES, ROWS } from "./constants";
import { chargeAt, setCharge } from "./field";
import type { CueSink, Tile, WirewormState, Worm } from "./types";

/** Whether any worm on the board occupies `(c, r)`. */
export function segmentAt(state: WirewormState, c: number, r: number): boolean {
  for (const worm of state.worms) {
    for (const segment of worm.segments) {
      if (segment.c === c && segment.r === r) return true;
    }
  }
  return false;
}

/**
 * Move the head onto `head`, and, when the body's follow is running, move every
 * trailing segment into the tile the segment ahead of it held.
 *
 * Each segment is written as a fresh tile rather than shared with its
 * predecessor, so no two entries of the chain are ever the same object.
 */
export function advanceChain(worm: Worm, head: Tile): void {
  if (worm.body) {
    for (let i = worm.segments.length - 1; i > 0; i -= 1) {
      const ahead = worm.segments[i - 1];
      worm.segments[i] = { c: ahead.c, r: ahead.r };
    }
  }
  worm.segments[0] = head;
}

/**
 * Raise the charge of the node on `(c, r)` by one, capped at `CHARGE_MAX`
 * (specs/nodes.md).
 *
 * The cue sounds on the step the node REACHES critical, once, so a node bumped
 * again while already critical is silent.
 */
export function bumpNode(
  state: WirewormState,
  c: number,
  r: number,
  cues: CueSink,
): void {
  const charge = chargeAt(state.field, c, r);
  if (charge < 0 || charge >= CHARGE_MAX) return;
  setCharge(state.field, c, r, charge + 1);
  if (charge + 1 === CHARGE_MAX) cues.play(CUES.critical);
}

/**
 * Take one whole step.
 *
 * The caller has already decided that this worm's clock reached the level's
 * interval; `stepping` is checked here so that the one gate governs both the
 * clock and the step.
 */
export function stepWorm(
  state: WirewormState,
  worm: Worm,
  cues: CueSink,
): void {
  if (!worm.stepping || worm.segments.length === 0) return;
  const head = worm.segments[0];

  if (worm.diving) {
    // A dive that is somehow already at the band has nothing left to run: it
    // ends here and the worm winds from this step instead. Reached only by a
    // posed worm, since a dive clears itself the step it reaches row 18.
    if (head.r >= BAND_TOP_ROW) worm.diving = false;
    else {
      dive(worm, head);
      return;
    }
  }

  const target = head.c + worm.dh;
  let blocked = false;
  let criticalBlock = false;
  let chargeable = false;

  if (target < 0 || target >= COLS) {
    // The side edge turns the worm and charges nothing.
    blocked = true;
  } else {
    const charge = chargeAt(state.field, target, head.r);
    if (charge >= 0) {
      blocked = true;
      if (charge >= CHARGE_MAX) criticalBlock = true;
      else chargeable = true;
    } else if (segmentAt(state, target, head.r)) {
      // Another segment turns it, and charges nothing.
      blocked = true;
    }
  }

  if (!blocked) {
    advanceChain(worm, { c: target, r: head.r });
    return;
  }

  if (chargeable) bumpNode(state, target, head.r, cues);

  // A critical node starts a dive, but only from above the band; on row 18 or 19
  // it turns the worm the ordinary way.
  if (criticalBlock && head.r < BAND_TOP_ROW) {
    worm.diving = true;
    dive(worm, head);
    return;
  }

  worm.dh = -worm.dh;
  // The vertical heading flips first where the row it would enter is off the
  // board, which is what makes the worm oscillate instead of leaving.
  if (head.r + worm.dv < 0 || head.r + worm.dv > ROWS - 1) worm.dv = -worm.dv;
  advanceChain(worm, { c: head.c, r: head.r + worm.dv });
}

/** One step of a dive: straight down the column, ending at the band. */
function dive(worm: Worm, head: Tile): void {
  const row = head.r + 1;
  advanceChain(worm, { c: head.c, r: row });
  if (row >= BAND_TOP_ROW) worm.diving = false;
}

/** How a run of segments removed from a worm is scored and what it leaves. */
export interface RemovalResult {
  /** The tiles the removed segments stood on, in order from the head end. */
  removed: Tile[];
  /** Whether the head itself was among them. */
  headRemoved: boolean;
}

/**
 * Remove from `worm` every segment `keep` marks `false`, and turn the surviving
 * runs into worms (specs/worm.md).
 *
 * The first surviving run, counted from the head end, IS the worm: it keeps the
 * id, both headings, the diving flag, and the step clock it already had. Each
 * further run becomes a new worm with a fresh id, the same headings and diving
 * flag, and a step clock starting now, and is appended to the roster. A worm
 * with no survivors leaves it.
 */
export function removeSegments(
  state: WirewormState,
  worm: Worm,
  keep: readonly boolean[],
): RemovalResult {
  const removed: Tile[] = [];
  const runs: Tile[][] = [];
  let run: Tile[] | null = null;
  for (let i = 0; i < worm.segments.length; i += 1) {
    const segment = worm.segments[i];
    if (keep[i]) {
      if (run === null) {
        run = [];
        runs.push(run);
      }
      run.push(segment);
    } else {
      removed.push(segment);
      run = null;
    }
  }

  const at = state.worms.indexOf(worm);
  if (runs.length === 0) {
    if (at >= 0) state.worms.splice(at, 1);
  } else {
    worm.segments = runs[0];
    for (let i = 1; i < runs.length; i += 1) {
      state.worms.push({
        id: state.nextId,
        segments: runs[i],
        dh: worm.dh,
        dv: worm.dv,
        diving: worm.diving,
        stepping: worm.stepping,
        body: worm.body,
        stepClock: 0,
      });
      state.nextId += 1;
    }
  }

  return { removed, headRemoved: !keep[0] };
}
