// torpedo/wraps — a torpedo leaving an edge re-enters at the opposite one.
//
// `specs/field.md` makes the field a torus with no outer walls and keeps a
// coordinate in range by taking it modulo the field size on that axis; the wrap
// "applies to every body on the field". `specs/weapons.md` says it again for this
// body: a torpedo "wraps at the field's edges carrying its speed". So leaving an
// edge is not what removes one, and the speed it re-enters with is the speed it
// left with.
//
// WHAT IS READ IS THE PAIR OF TICKS THE SEAM LIES BETWEEN. The tick's own motion
// says how far past the edge the torpedo went, and the rule says where that lands:
// `1280` units to the left of it. A build that snaps the coordinate to the far
// edge, one that reflects it, one that re-enters a radius late, and one that treats
// the edge as the end of the torpedo's life each read as a different number.
//
// AND THE SPEED IS READ ACROSS THE SAME SEAM, AGAINST ITSELF. "Carrying its speed"
// is the half a build that re-enters at rest, or that rebuilds a velocity from a
// wrapped position, gets wrong. What it is held against is the speed the SAME
// torpedo was travelling at the tick before the crossing, not the figure
// `TORPEDO_SPEED` — a build whose torpedo flies at the wrong speed altogether fails
// `speed`, and this item would be reading that fault rather than the wrap. Both
// speeds are measured from the travel between consecutive positions rather than
// from the velocity the build reports, so what is graded is where the torpedo
// actually went.
//
// THE CROSSING IS FLOWN ALONG THE BOTTOM LANE, `330` units below the star's row, so
// a build that resolves the core against the segment between two consecutive
// positions — which `specs/collision.md` demands — draws its false line across the
// bottom of the field on the tick of the seam rather than through the core. The
// guidance is off and the field is empty, so nothing steers the crossing.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual, fail } from "../assert";
import { FIELD_W, TICK_DT } from "../constants";
import { separation, wrapX } from "../geometry";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  torpedoesOf,
  type Harness,
} from "../harness";
import { HEADING_RIGHT, LANE_Y, poseStraight } from "./scene";
import type { TorpedoSnapshot } from "../surface";

/** Where the crossing begins: `20` units inside the right edge. */
const FROM_X = FIELD_W - 20;

/** How long the seam is looked for, in ticks: `24` ticks of travel covers `84` units. */
const WATCH_TICKS = ticksFor(0.2);

/**
 * How far the wrapped centre may sit from where the modulus puts it, in units.
 *
 * Half a unit. The rule is arithmetic and the reading is taken one tick after the
 * position and velocity it is predicted from, and `specs/gravity.md` adds nothing at
 * all to a torpedo, so there is nothing for a conformant build to be off by. It is a
 * seventh of the `3.5` units a tick carries the torpedo past the seam by — which is
 * what a build that snaps to the edge misses by — and well under `TORPEDO_R` (`6`),
 * so a build that wraps on the torpedo's edge rather than its centre fails.
 */
const WRAP_TOLERANCE = 0.5;

/**
 * How far the speed after the seam may sit from the speed before it, as a fraction.
 *
 * Two per cent. Nothing acts on a torpedo across a seam — `specs/gravity.md` never
 * pulls one and its speed is held constant — so a conformant build reads the two as
 * the same number to the last float. A build that re-enters at rest reads `0` and
 * one that rebuilds its velocity from the wrapped position reads the width of the
 * field per tick.
 */
const SPEED_TOLERANCE = 0.02;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("re-enters at the left edge carrying its speed after leaving the right", async () => {
  startPlaying(h);
  const id = poseStraight(h, FROM_X, LANE_Y, HEADING_RIGHT);

  // Where the torpedo stood at every tick of the run-up, the crossing, and the
  // tick after it, so the seam has a step either side of it to be read from.
  const path: TorpedoSnapshot[] = [];
  for (let tick = 0; tick <= WATCH_TICKS; tick += 1) {
    const standing = torpedoesOf(h.snapshot()).find(
      (torpedo) => torpedo.id === id,
    );
    if (standing === undefined) break;
    path.push(standing);
    await h.advance(1);
  }
  // The torpedo re-entering at the opposite edge.
  captureStill(h, "wrap");

  const seam = path.findIndex(
    (standing, index) => index > 0 && standing.x < path[index - 1].x,
  );
  if (seam < 2 || path.length < seam + 2) {
    fail(
      "a torpedo driven off the right edge re-entering at the left within " +
        `${WATCH_TICKS} ticks, carrying its speed (specs/field.md, ` +
        "specs/weapons.md: it wraps at the field's edges)",
      seam < 0
        ? "no tick carried it across the seam, or it left the roster at the edge"
        : `the crossing fell on sample ${seam} of ${path.length}, with no tick ` +
            "either side of it to read the speed from",
    );
  }
  const before = path[seam - 1];
  const after = path[seam];

  // Where the tick's own motion put it, brought into range by the rule.
  const carriedTo = before.x + before.vx * TICK_DT;
  assertLessThanOrEqual(
    Math.abs(after.x - wrapX(carriedTo)),
    WRAP_TOLERANCE,
    "the torpedo's centre x one tick after leaving the right edge, which the " +
      `tick's own motion carried to ${carriedTo.toFixed(3)} (specs/field.md: a ` +
      "coordinate is kept in range by taking it modulo the field size on that " +
      "axis)",
  );
  assertLessThanOrEqual(
    Math.abs(after.y - before.y),
    WRAP_TOLERANCE,
    "the torpedo's centre y across the crossing, which a wrap on x leaves alone",
  );

  // And the speed it re-entered with, against the speed it left with: both read
  // from the travel between consecutive positions.
  const into = separation(path[seam - 2], before);
  const outOf = separation(after, path[seam + 1]);
  const carried = Math.hypot(into.x, into.y) / TICK_DT;
  const kept = Math.hypot(outOf.x, outOf.y) / TICK_DT;
  assertLessThanOrEqual(
    Math.abs(kept - carried) / carried,
    SPEED_TOLERANCE,
    "the fraction the torpedo's speed changed across the seam: it travelled " +
      `${carried.toFixed(2)} units per second into the right edge and ` +
      `${kept.toFixed(2)} out of the left (specs/weapons.md: it wraps at the ` +
      "field's edges carrying its speed)",
  );
});
