// Wireworm — the data-worm (`specs/worm.md`).
//
// A worm is a chain of tiles led by `segments[0]`. It moves in whole tile steps
// on its own clock rather than continuously, so everything here is written as
// one step: the head winds sideways, drops and reverses where it is blocked,
// oscillates off the floor and the entry row, and dives straight down a column
// when a critical node turns it. The body follows the head's exact path, one
// tile behind the segment ahead of it.
//
// Two faculties the debug surface poses cut across every step. `stepping` gates
// the step itself, so a worm posed as an obstacle stays where it was put;
// `body` gates the follow alone, so a check on where the HEAD goes can move one
// tile and read one tile.

import {
  BAND_TOP_ROW,
  CHARGE_MAX,
  COLS,
  ROWS,
  wormLength,
  wormStepInterval,
} from "./constants";
import { bumpNode, nodeAt } from "./field";
import { randomSign } from "./rng";
import {
  takeId,
  type FrameEvents,
  type MutTile,
  type MutWorm,
  type Sim,
} from "./sim";

/** Whether any worm on the board occupies `(c, r)`. */
export function segmentAt(sim: Sim, c: number, r: number): boolean {
  return sim.worms.some((worm) =>
    worm.segments.some((tile) => tile.c === c && tile.r === r),
  );
}

/** A worm of one segment, heading right and descending, appended to the roster. */
export function addWorm(sim: Sim, c: number, r: number): MutWorm {
  const worm: MutWorm = {
    id: takeId(sim),
    segments: [{ c, r }],
    dh: 1,
    dv: 1,
    diving: false,
    stepping: true,
    body: true,
    stepClock: 0,
  };
  sim.worms.push(worm);
  return worm;
}

/**
 * Bring in the level's worm (`specs/worm.md`): `wormLength(level)` segments laid
 * along row `0` from one edge, the head furthest from that edge and the tail
 * nearest it, heading inward and descending. Which edge is a coin flip, unless
 * the debug surface posed it, in which case the pose decides this one entry and
 * is consumed by it.
 */
export function enterWorm(sim: Sim): MutWorm {
  const length = wormLength(sim.level);
  const posed = sim.nextWormEntry;
  sim.nextWormEntry = null;
  const fromLeft = posed === null ? randomSign() > 0 : posed === "left";

  const segments: MutTile[] = [];
  for (let i = 0; i < length; i++) {
    segments.push({ c: fromLeft ? length - 1 - i : COLS - length + i, r: 0 });
  }

  const worm: MutWorm = {
    id: takeId(sim),
    segments,
    dh: fromLeft ? 1 : -1,
    dv: 1,
    diving: false,
    stepping: true,
    body: true,
    stepClock: 0,
  };
  sim.worms.push(worm);
  return worm;
}

/** Move the head onto `head`, bringing the body along behind it where it runs. */
function advance(worm: MutWorm, head: MutTile): void {
  if (worm.body) {
    for (let i = worm.segments.length - 1; i > 0; i--) {
      worm.segments[i] = worm.segments[i - 1];
    }
  }
  worm.segments[0] = head;
}

/** One step of one worm. */
function stepWorm(sim: Sim, worm: MutWorm, ev: FrameEvents): void {
  const head = worm.segments[0];
  if (head === undefined) return;
  const hc = head.c;
  const hr = head.r;

  if (worm.diving) {
    // The dive runs straight down the column, through whatever stands in the
    // way, and ends at the end of the step that reaches the band. A head posed
    // into the band while diving has already reached it, so the dive is over
    // and this step winds.
    if (hr < BAND_TOP_ROW) {
      advance(worm, { c: hc, r: hr + 1 });
      if (hr + 1 >= BAND_TOP_ROW) worm.diving = false;
      return;
    }
    worm.diving = false;
  }

  const tc = hc + worm.dh;
  const ahead = tc < 0 || tc >= COLS ? undefined : nodeAt(sim, tc, hr);
  const blocked =
    tc < 0 || tc >= COLS || ahead !== undefined || segmentAt(sim, tc, hr);

  if (!blocked) {
    advance(worm, { c: tc, r: hr });
    return;
  }

  // A critical node above the band sends the worm diving instead of turning it.
  // Its charge is already capped, so nothing is added to it.
  if (ahead !== undefined && ahead.charge >= CHARGE_MAX && hr < BAND_TOP_ROW) {
    worm.diving = true;
    advance(worm, { c: hc, r: hr + 1 });
    if (hr + 1 >= BAND_TOP_ROW) worm.diving = false;
    return;
  }

  // Only a node charges. A side edge and another segment turn the worm and
  // change nothing.
  if (ahead !== undefined) bumpNode(ahead, ev);

  worm.dh = -worm.dh;
  if (hr + worm.dv < 0 || hr + worm.dv >= ROWS) worm.dv = -worm.dv;
  advance(worm, { c: hc, r: hr + worm.dv });
}

/**
 * Advance every worm's own step clock by `dt` and run each step it covers, in
 * order, carrying the remainder into the next frame.
 */
export function stepWorms(sim: Sim, dt: number, ev: FrameEvents): void {
  const interval = wormStepInterval(sim.level);
  for (const worm of [...sim.worms]) {
    worm.stepClock += dt;
    while (worm.stepClock >= interval) {
      worm.stepClock -= interval;
      if (worm.stepping) stepWorm(sim, worm, ev);
    }
  }
}

/**
 * Take `doomed` segment indices out of `worm` and leave the survivors as worms
 * (`specs/worm.md`).
 *
 * The survivors fall into runs of consecutive segments counted from the head
 * end. The first run keeps the worm's id, its headings, its diving flag and its
 * place in the roster; each further run becomes a new worm with a fresh id,
 * appended in order from the head end, its step clock started at this moment.
 * A worm that loses every segment is gone.
 */
export function splitWorm(
  sim: Sim,
  worm: MutWorm,
  doomed: ReadonlySet<number>,
): void {
  const runs: MutTile[][] = [];
  let run: MutTile[] = [];
  worm.segments.forEach((tile, index) => {
    if (doomed.has(index)) {
      if (run.length > 0) runs.push(run);
      run = [];
      return;
    }
    run.push(tile);
  });
  if (run.length > 0) runs.push(run);

  const first = runs[0];
  if (first === undefined) {
    const index = sim.worms.indexOf(worm);
    if (index >= 0) sim.worms.splice(index, 1);
    return;
  }

  worm.segments = first;
  for (let i = 1; i < runs.length; i++) {
    sim.worms.push({
      id: takeId(sim),
      segments: runs[i] as MutTile[],
      dh: worm.dh,
      dv: worm.dv,
      diving: worm.diving,
      stepping: worm.stepping,
      body: worm.body,
      stepClock: 0,
    });
  }
}
