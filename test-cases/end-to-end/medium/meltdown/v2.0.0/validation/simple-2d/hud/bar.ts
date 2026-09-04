// hud/bar — how this group reads a bar the build drew on the floor.
//
// Two items are about a READ drawn over an entity rather than a figure printed in
// the panel: the heat read on a tower's footprint and the health bar over a surge
// unit (specs/hud.md, The reads on the floor). Both are the same shape — an
// extent that tracks a quantity — and neither has a size, a colour, a position or
// an ORIENTATION the specification fixes, so this file reads one without knowing
// any of them.
//
// HOW A BAR IS FOUND. A frame's rectangles are grouped by the corner they are
// anchored at, and the same corner is looked at across several frames posed at
// different values of the quantity. A bar is a corner whose reach changes with
// the quantity, monotonically, in the direction the specification says it should;
// everything else the entity draws — its body, its faces, the track behind the
// bar, the grid under it — reaches the same distance in every frame and so is not
// one. That is the whole method, and it fixes nothing: a build that draws no
// track, that draws the bar in any colour, or that puts it anywhere on the entity
// is read exactly the same way.
//
// FOUR ORIENTATIONS ARE TRIED, because a read that "tracks its heat" may fill
// rightward, leftward, upward or downward and specs/hud.md says nothing about
// which. Each is a corner to anchor at and an extent to measure from it, and the
// first that yields a bar is the reading.
//
// THE NARROWEST RECTANGLE AT EACH CORNER IS THE ONE READ. A read drawn as a track
// with a fill over it puts two rectangles at the same corner, and it is the fill
// whose extent the reading is about; a build that draws the fill alone puts one
// there and is read identically.
//
// NOTHING HERE IS A THRESHOLD. How much a bar must move, and where a marker must
// sit, are stated by the checks that assert them.

import { fail } from "../assert";
import type { DrawnRect } from "../harness";

/**
 * One way a bar may be laid out: the corner it grows from, and the extent it
 * reaches from that corner.
 */
export interface BarAxis {
  /** How the layout reads in a failure message. */
  readonly name: string;
  /** The anchored corner, to half a logical unit. */
  key(rect: DrawnRect): string;
  /** How far the rectangle reaches from that corner. */
  extent(rect: DrawnRect): number;
  /** The coordinate a fraction `t` along a full-scale bar's own track. */
  along(track: DrawnRect, t: number): number;
  /** A rectangle's centre on the axis the bar runs along. */
  centre(rect: DrawnRect): number;
}

/** A coordinate as a key, to half a logical unit, so two frames agree on it. */
function at(value: number): number {
  return Math.round(value * 2) / 2;
}

/** The four layouts a bar is looked for in, in the order they are tried. */
export const BAR_AXES: readonly BarAxis[] = [
  {
    name: "filling rightward from its left edge",
    key: (r) => `${at(r.left)}|${at(r.top)}`,
    extent: (r) => r.w,
    along: (track, t) => track.left + track.w * t,
    centre: (r) => r.x,
  },
  {
    name: "filling leftward from its right edge",
    key: (r) => `${at(r.right)}|${at(r.top)}`,
    extent: (r) => r.w,
    along: (track, t) => track.right - track.w * t,
    centre: (r) => r.x,
  },
  {
    name: "filling downward from its top edge",
    key: (r) => `${at(r.left)}|${at(r.top)}#v`,
    extent: (r) => r.h,
    along: (track, t) => track.top + track.h * t,
    centre: (r) => r.y,
  },
  {
    name: "filling upward from its bottom edge",
    key: (r) => `${at(r.left)}|${at(r.bottom)}`,
    extent: (r) => r.h,
    along: (track, t) => track.bottom - track.h * t,
    centre: (r) => r.y,
  },
];

/** The rectangle reaching least far from each corner, under one layout. */
function shortestByCorner(
  rects: readonly DrawnRect[],
  axis: BarAxis,
): Map<string, DrawnRect> {
  const shortest = new Map<string, DrawnRect>();
  for (const rect of rects) {
    const key = axis.key(rect);
    const held = shortest.get(key);
    if (held === undefined || axis.extent(rect) < axis.extent(held)) {
      shortest.set(key, rect);
    }
  }
  return shortest;
}

/** A bar found across a run of frames: the rectangle it was in each of them. */
export interface Bar {
  readonly axis: BarAxis;
  /** The bar's rectangle in each frame, in the order the frames were given. */
  readonly rects: readonly DrawnRect[];
  /** How far it reached in each frame. */
  readonly extents: readonly number[];
}

/**
 * The bar whose reach moves the way `direction` says across `frames`, or the
 * failure that the entity drew none.
 *
 * `direction` is `1` where the quantity rose from frame to frame and `-1` where
 * it fell, and `step` is how far the reach must move between consecutive frames,
 * which the calling check states from the figures it posed. Every layout of
 * {@link BAR_AXES} is tried and the first that yields a bar is the reading, so a
 * build is never asked to draw one a particular way round.
 */
export function findBar(
  frames: readonly (readonly DrawnRect[])[],
  direction: 1 | -1,
  step: number,
  requirement: string,
): Bar {
  for (const axis of BAR_AXES) {
    const byFrame = frames.map((rects) => shortestByCorner(rects, axis));
    const [first] = byFrame;
    for (const key of first.keys()) {
      const found = byFrame.map((frame) => frame.get(key));
      if (found.some((entry) => entry === undefined)) continue;
      const rects = found as DrawnRect[];
      const extents = rects.map((entry) => axis.extent(entry));
      const moves = extents.every(
        (value, index) =>
          index === 0 || (value - extents[index - 1]) * direction >= step,
      );
      if (moves) return { axis, rects, extents };
    }
  }
  return fail(
    requirement,
    `no rectangle any of the ${frames.length} frames drew reached ` +
      `${direction === 1 ? "further" : "less far"} at each step, in any of ` +
      `the four layouts a bar may take`,
  );
}

/** The rectangles every frame drew with exactly the same geometry. */
export function drawnInEveryFrame(
  frames: readonly (readonly DrawnRect[])[],
): DrawnRect[] {
  const geometry = (rect: DrawnRect): string =>
    `${at(rect.left)}|${at(rect.top)}|${at(rect.w)}|${at(rect.h)}`;
  const [first, ...rest] = frames;
  const seen = new Set<string>();
  const shared: DrawnRect[] = [];
  for (const rect of first) {
    const signature = geometry(rect);
    if (seen.has(signature)) continue;
    if (
      !rest.every((frame) =>
        frame.some((other) => geometry(other) === signature),
      )
    ) {
      continue;
    }
    seen.add(signature);
    shared.push(rect);
  }
  return shared;
}
