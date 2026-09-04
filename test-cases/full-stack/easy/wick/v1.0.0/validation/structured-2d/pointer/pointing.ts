// Wick — pointer: what every check in this category shares. NOT a check: a
// module of derivations and pure readings, so a check that needs a stage point
// inside no menu rectangle, the cues one frame raised, or a click that runs no
// tick names the thing it means rather than spelling it again.
//
// WHERE THE POINTS COME FROM. `specs/controls.md`, The pointer: "Each item the
// menu currently shows occupies a rectangle on the stage, and no two of a
// screen's rectangles overlap", and `specs/instrumentation.md` makes
// `menuRects` and `tabRects` report exactly those rectangles, "in stage
// coordinates, `0` to `STAGE_W` across and `0` to `STAGE_H` down, which are the
// coordinates the pointer is read in". The specification fixes no coordinate
// for any of them, so every point a check aims at is DERIVED from what the
// build reported on the frame it was posed: the middle of a reported rectangle
// for a point inside one, and {@link outsidePoint} for a point inside none.
// Nothing here holds a stage coordinate the build did not hand it.

import { fail } from "../assert";
import { STAGE_H, STAGE_W } from "../constants";
import {
  centerOf,
  onCue,
  tap,
  type Harness,
  type TimedCue,
  type WickRect,
  type WickSnapshot,
} from "../harness";

/* ---- A point inside no rectangle ---------------------------------------- */

/** A point in the stage's own coordinates, the ones the pointer is read in. */
export interface StagePoint {
  x: number;
  y: number;
}

/** How far in from each stage edge a candidate point is taken. */
const EDGE_INSET = 16;
/** Candidate points along each axis of the search. */
const GRID = 33;

/**
 * How far outside every rectangle {@link outsidePoint} insists its point lies,
 * in stage units.
 *
 * "The pointer inside no rectangle changes nothing" is a rule about a point
 * strictly outside every one of them, so a point a rounding could put on an
 * edge decides nothing. A clearance of a whole `MENU_CLEARANCE` units leaves
 * room for a build whose hit area is a little larger than the rectangle it
 * reported and for any rounding between stage units and device pixels.
 */
export const MENU_CLEARANCE = 24;

/** How far the point `(x, y)` lies outside `rect`; `0` when it is inside it. */
function gapTo(rect: WickRect, x: number, y: number): number {
  const dx = Math.max(rect.x - x, x - (rect.x + rect.width), 0);
  const dy = Math.max(rect.y - y, y - (rect.y + rect.height), 0);
  return Math.hypot(dx, dy);
}

/**
 * A stage point at least {@link MENU_CLEARANCE} units outside every rectangle
 * in `groups`: the point a check about "inside no rectangle" aims at.
 *
 * DERIVED, never guessed. The specification fixes no layout, so the point is
 * searched for over the stage the pointer is read in against the rectangles the
 * build itself reported on this frame, and the one furthest from all of them
 * wins. A build whose menu leaves no such point on the stage fails here with
 * that as the message, rather than being asked about a coordinate this suite
 * chose.
 */
export function outsidePoint(
  ...groups: readonly (readonly WickRect[])[]
): StagePoint {
  const rects = groups.flat();
  let best = { x: EDGE_INSET, y: EDGE_INSET };
  let bestGap = -1;
  for (let ix = 0; ix < GRID; ix += 1) {
    for (let iy = 0; iy < GRID; iy += 1) {
      const x = EDGE_INSET + ((STAGE_W - 2 * EDGE_INSET) * ix) / (GRID - 1);
      const y = EDGE_INSET + ((STAGE_H - 2 * EDGE_INSET) * iy) / (GRID - 1);
      const gap = rects.reduce(
        (least, rect) => Math.min(least, gapTo(rect, x, y)),
        Number.POSITIVE_INFINITY,
      );
      if (gap > bestGap) {
        bestGap = gap;
        best = { x, y };
      }
    }
  }
  if (bestGap < MENU_CLEARANCE) {
    fail(
      `a stage point at least ${MENU_CLEARANCE} units outside every rectangle the screen reported (specs/controls.md, The pointer)`,
      `the furthest point on the stage is ${bestGap} units out`,
    );
  }
  return best;
}

/* ---- Reading one frame's cues ------------------------------------------- */

/**
 * Record every cue `act` raises, and hand back both what it returned and what
 * sounded while it ran.
 *
 * The pointer rules are applied "on every frame" (`specs/controls.md`), so a
 * hover that moves a highlight raises its `menu-move` on the one frame that
 * read the pointer, and a collector opened around a one-frame drive holds
 * exactly what that frame raised.
 */
export async function cuesDuring<T>(
  h: Harness,
  act: () => T | Promise<T>,
): Promise<{ result: T; played: TimedCue[] }> {
  const played = onCue(h);
  const result = await act();
  return { result, played: [...played] };
}

/** How many of `played` carry the name `cue`. */
export function heard(played: readonly TimedCue[], cue: string): number {
  return played.filter((entry) => entry.name === cue).length;
}

/* ---- A click that runs no tick ------------------------------------------ */

/** How long a frame that must consume no tick is worth, in milliseconds. */
const PARTIAL_MS = 1;

/**
 * Click the middle of `rect` and deliver the press edge on a frame far shorter
 * than one tick, handing back the state that frame left.
 *
 * `specs/controls.md`: "The frame's update then runs on the screen the edges
 * left: a frame whose press enters `playing` ... runs that frame's ticks", so a
 * whole-tick frame would take the item AND advance the run, and a check reading
 * what the click left would be reading a tick's work instead. A frame of a
 * single millisecond is what `specs/instrumentation.md` calls a partial frame,
 * far short of the `TICK_DT − TICK_EPSILON` a tick is consumed at, so what is
 * read is the state the moment the click landed. The move, the press, and the
 * release all arrive before the frame, the way a real click between two frames
 * does.
 */
export async function clickRectPartial(
  h: Harness,
  rect: WickRect,
): Promise<WickSnapshot> {
  const at = centerOf(rect);
  h.movePointer(at.x, at.y);
  h.pressPointer(at.x, at.y);
  h.releasePointer(at.x, at.y);
  await h.frameOf(PARTIAL_MS);
  return h.snapshot();
}

/* ---- Posing a highlight off zero ---------------------------------------- */

/** The key `specs/controls.md` binds `down` to. */
const DOWN = "ArrowDown";

/**
 * Move a menu's highlight `steps` items down with real `down` presses, and
 * read what the last one left.
 *
 * The debug surface carries no operation that poses `menuIndex`
 * (`specs/instrumentation.md`), so the menu's own `down` is the only way onto
 * an item the screen did not open on. `specs/controls.md` reads `down` as a
 * press edge off `playing` and `specs/ui.md` moves the highlight "by one item"
 * per press; a check that needs the highlight somewhere else states the index
 * it expected and reads it back before driving what it is about.
 */
export async function moveHighlight(
  h: Harness,
  steps: number,
): Promise<WickSnapshot> {
  let last = h.snapshot();
  for (let step = 0; step < steps; step += 1) last = await tap(h, DOWN);
  return last;
}
