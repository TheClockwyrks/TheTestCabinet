// presentation/wheel-spokes-reach-its-ring — the wheel is drawn as a hub carrying
// its ring, with a spoke reaching each of the six fixture hexes.
//
// THE RULE. `specs/assets.md` puts "The wheel's spokes out to its fixture ring"
// under "What stays drawn in code", fixed by `specs/parts.md`, whose anatomy is
// "A `wheel` is a hub on its anchor hex carrying six fixture motes, one on each
// adjacent hex" — and `specs/field.md` asks that "A fixture reads as part of its
// wheel rather than as a loose mote". A spoke reaching each of the six is what
// carries that: the ring is drawn as held by the hub rather than as six motes that
// happen to sit around it.
//
// WHAT IS READ, AND WHY IT IS THE FRAME'S OPERATIONS RATHER THAN ITS PIXELS. A
// fixture hex carries a `48`-unit fixture mount and a `44`-unit mote sprite, and
// the wheel hub is `48` units across, so between the hub's edge and the mount's
// there is no stretch of the stage a spoke could be read on without a sprite over
// it. What settles the question instead is where the frame's own drawing REACHED:
// the operations it issued, each mapped through the transform in force at it
// (`drawing.ts`).
//
// A SPOKE IS A SEGMENT, AND THAT IS WHAT IS READ. A spoke joins the hub to a
// fixture, so it is one straight run of the frame's path that STARTS inside the
// hub's own hex and ENDS inside that fixture's — within `HEX_PITCH / 2` (`24`) of
// each centre, which is a hex's inradius, so each endpoint is in that hex and in
// no other. Reading the segment rather than the points it names is what keeps the
// verdict about a spoke: a mark that names a point inside a fixture hex — a dot on
// its centre, a mount sprite's corner, a star — names one point and spans nothing,
// and a cell traced round either hex has both ends of every edge within `27.71` of
// its own centre and so reaches neither into the other. Only a run of the path
// that crosses from the one hex into the other satisfies this, and that is a
// spoke. Nothing is required of its colour, its width, its exact endpoints, or
// whether the build drew it before or after the sprites over it.
//
// A SEGMENT IS COUNTED ONLY WHERE THE FRAME PAINTED IT: the `moveTo`/`lineTo` runs
// of a path, taken when a `stroke` or a `fill` renders that path, so a path built
// and abandoned draws nothing. `closePath` closes the run back to where it began,
// as the canvas does.
//
// THE COMPARISON IS AGAINST THE SAME FRAME WITHOUT THE WHEEL, so nothing is
// required of the bare field either. `specs/field.md` asks only that the field's
// hexes be "visible enough to place parts by" and `specs/ui.md` fixes no
// background, so a build may trace each cell inset from its pitch, dot its centre,
// or scatter stars over the sky — and were a build to rule its sky with lines from
// one cell's centre to the next, those would be there before a wheel exists. What
// is read is the DIFFERENCE the wheel makes: how many more such segments the
// wheel's frame draws into each ring hex than the bare frame drew there.
//
// THE WHEEL IS PLACED INTO A LIVE RUN, which is what raises its ring: "While a run
// is live, a part one of them adds enters the run at its rest pose holding nothing,
// with a wheel's six fixtures on its spoke hexes" (`specs/instrumentation.md`). The
// run is held paused, so nothing turns between the two frames, and the bare opener
// emptied the field, so the six fixtures are the whole of what is on it.
//
// WHICH SIX HEXES. `specs/parts.md` puts one fixture "on each adjacent hex", and
// `wheelFixtureHexes` is that list, built from the `DIRS` of `specs/field.md`.
//
// THE VERDICT. With the wheel on the field the frame draws, into each of the six
// fixture hexes, a segment out of the hub's hex that the bare field's frame did
// not draw.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLength } from "../assert";
import { HEX_PITCH } from "../constants";
import { hexCenter, type Hex } from "../field";
import { BARE, ORIGIN } from "../fixtures";
import {
  apply,
  captureStill,
  createHarness,
  distanceBetween,
  fixturesOf,
  numbers,
  openBareRun,
  placePart,
  walk,
  type DrawCall,
  type Harness,
  type Matrix,
  type Point,
} from "../harness";
import { wheelFixtureHexes } from "../parts";

/** How near a hex's centre a point counts as inside that hex: its inradius. */
const INSIDE = HEX_PITCH / 2;

/** The six hexes `specs/parts.md` puts a wheel's fixtures on. */
const RING: readonly Hex[] = wheelFixtureHexes(ORIGIN);

/** One straight run of a frame's path, in stage units. */
interface Segment {
  from: Point;
  to: Point;
}

/**
 * The path calls that leave the pen where this reading cannot follow it, so the
 * `lineTo` after one starts a run rather than continuing the one before.
 */
const BREAKS_THE_RUN: readonly string[] = [
  "arc",
  "arcTo",
  "ellipse",
  "rect",
  "roundRect",
  "quadraticCurveTo",
  "bezierCurveTo",
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/**
 * Every straight run of the frame's path that a `stroke` or a `fill` rendered,
 * each end mapped through the transform in force at the call that named it.
 *
 * The current point follows the canvas: `moveTo` starts a run, `lineTo` extends
 * it, `closePath` returns to where the subpath began, and a call that puts the
 * pen somewhere this reading cannot follow — an arc, a rectangle, a curve —
 * breaks the chain rather than inventing a run across it.
 */
function paintedSegments(calls: readonly DrawCall[]): Segment[] {
  const painted: Segment[] = [];
  let pending: Segment[] = [];
  let start: Point | null = null;
  let current: Point | null = null;
  const at = (matrix: Matrix, args: unknown[]): Point | null => {
    const v = numbers(args, 2);
    return v ? apply(matrix, v[0] as number, v[1] as number) : null;
  };
  walk(calls, (method, args, matrix) => {
    if (method === "beginPath") {
      pending = [];
      start = null;
      current = null;
    } else if (method === "moveTo") {
      current = at(matrix, args);
      start = current;
    } else if (method === "lineTo") {
      const next = at(matrix, args);
      if (next !== null) {
        if (current !== null) pending.push({ from: current, to: next });
        current = next;
      }
    } else if (method === "closePath") {
      if (current !== null && start !== null) {
        pending.push({ from: current, to: start });
      }
      current = start;
    } else if (method === "stroke" || method === "fill") {
      painted.push(...pending);
    } else if (BREAKS_THE_RUN.includes(method)) {
      current = null;
    }
  });
  return painted;
}

/**
 * How many painted segments run from inside the hub's hex to inside `hex`.
 *
 * Each endpoint is within a hex's inradius of its centre, so it lies in that hex
 * and in no other, and a segment counted here crossed from the one into the other.
 */
function spokesInto(calls: readonly DrawCall[], hex: Hex): number {
  const hub = hexCenter(ORIGIN);
  const ring = hexCenter(hex);
  return paintedSegments(calls).filter((segment) => {
    const ends: Point[] = [segment.from, segment.to];
    return ends.some(
      (end, index) =>
        distanceBetween(end, hub) <= INSIDE &&
        distanceBetween(ends[1 - index] as Point, ring) <= INSIDE,
    );
  }).length;
}

/** How many such segments the last frame drew into each fixture hex. */
async function reachedRing(): Promise<number[]> {
  const calls = await h.lastCalls();
  return RING.map((hex) => spokesInto(calls, hex));
}

it("draws a spoke reaching each of the wheel's six fixture hexes", async () => {
  await openBareRun(h, { challenge: BARE, paused: true });
  await h.advance(1);

  // What the bare field's frame draws between those hexes, which is whatever the
  // build's cells and sky put there and is not the wheel's.
  const bare = await reachedRing();

  const wheel = await placePart(h, "wheel", ORIGIN, 0);
  // The editor outlines the selected part's hexes (`specs/editor.md`), which
  // would reach into the ring for a reason that is not a spoke.
  await h.debug.setSelected(null);
  await h.advance(1);
  await captureStill(h, "spokes");

  assertLength(
    fixturesOf(await h.snapshot(), wheel),
    RING.length,
    "the wheel placed into the live run raised its six fixtures, so the ring the spokes reach is really on the field",
  );

  for (const [index, reached] of (await reachedRing()).entries()) {
    assertGreaterThan(
      reached,
      bare[index] as number,
      `segments the frame paints from inside the hub's hex to inside the hex (${(RING[index] as Hex).q}, ${(RING[index] as Hex).r}) carrying the fixture on spoke ${index}, over the ${bare[index] as number} the bare field's frame painted there, so the hub is drawn as carrying its ring`,
    );
  }
});
