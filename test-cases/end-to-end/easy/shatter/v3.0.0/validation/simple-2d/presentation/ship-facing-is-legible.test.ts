// presentation/ship-facing-is-legible — which way the ship points is readable off
// the drawing alone.
//
// THE RULE. `specs/overview.md`: "The ship reads apart from the field behind it
// and from every other body, and its facing is legible at a glance."
// `specs/ship.md` says what is drawn: "The ship is drawn as a triangle pointing
// along its current facing, roughly `34` long from nose to tail and `26` wide at
// the tail." A player who cannot see which way the hull points cannot aim, and
// cannot tell a thrust that will speed the ship up from one that will turn it
// around.
//
// WHAT IS READ, AND WHY IT IS A CHANGE. No shape is demanded of the canvas here and
// no dimension: `specs/overview.md` leaves the palette, the type and every other
// aspect of the look to the build, and a build drawing a dart, a wedge or a hull
// with a marker at its nose is legible. What every legible facing has in common is
// that the drawing MOVES when the facing does. So the same disc about the ship's
// own centre is read twice — once with the ship facing one way and once with it
// facing the other way about — and what is asserted is that the samples changed
// between the two frames.
//
// A HALF TURN, because it is the pair a legible drawing must differ across: a hull
// that reads the same nose-on and tail-on is one a player cannot fly. `30` and
// `210` degrees rather than `0` and `180`, so a build that swapped a sine for a
// cosine cannot pass on a facing where the two agree.
//
// NOTHING BUT THE HULL IS IN THE DISC BETWEEN THE TWO READINGS. An emptied, gated
// field with the ship at `SHIP_SPOT`, `376` from the star's centre, so nothing of
// the star — drawn out to `180`, `specs/field.md` — reaches the disc. No thrust is
// held and no grace is running, so neither the flame nor the respawn blink is on
// either frame, and the ship is at rest with the well not pulling it
// (`specs/gravity.md`), so between the two frames the only thing that moved is the
// facing.

import { afterEach, beforeEach, it } from "vitest";
import { DEG } from "../constants";
import { assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { changedSamples, DISC_SAMPLES, readDisc, readPainted } from "./ink";
import { SHIP_SPOT } from "./scene";

/** The two facings the hull is read at, in degrees clockwise from +x. */
const FACINGS = [30, 210] as const;

/**
 * How far out the ship's drawing is read, in logical units.
 *
 * `specs/ship.md` makes the hull `34` long nose to tail, and `specs/weapons.md`
 * puts the nose no further than `SHIP_R` (`14`) ahead of the centre, so a hull
 * centred anywhere sensible on that length lies inside `30` of the centre either
 * way. Wide enough to hold the whole ship, tight enough that nothing else on a
 * field posed like this can enter it.
 */
const SEARCH_R = 30;

/**
 * How far a sample's colour must move to count as changed, of the 441 a colour
 * distance can span.
 *
 * The figure `armor/damaged-look` reads its own redraw at, and for the same
 * reason: well above what a build's anti-aliasing does to a stationary edge, and
 * far below the contrast between a hull and the field it is drawn on.
 */
const SAMPLE_DELTA = 16;

/**
 * How many of the `DISC_SAMPLES` readings must have moved.
 *
 * A fortieth of the disc. A hull `34` long and `26` across covers about a sixth of
 * a disc of `SEARCH_R`, and turning it about redraws most of what it covers, so a
 * conformant drawing moves several times this many samples even when it is stroked
 * as a bare outline. A body drawn the same in every direction — a disc, a ring, a
 * square — moves none of them, which is the failure this item exists to name.
 */
const MIN_CHANGED = 12;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the ship differently at two facings a half turn apart", async () => {
  startPlaying(h);
  h.debug.setShipPosition(SHIP_SPOT.x, SHIP_SPOT.y);

  h.debug.setShipAngle(FACINGS[0] * DEG);
  await h.advance(1);
  const one = readDisc(readPainted(h), SHIP_SPOT, SEARCH_R);

  h.debug.setShipAngle(FACINGS[1] * DEG);
  await h.advance(1);
  const other = readDisc(readPainted(h), SHIP_SPOT, SEARCH_R);
  captureStill(h, "facings");

  assertGreaterThan(
    changedSamples(one, other, SAMPLE_DELTA),
    MIN_CHANGED,
    `of ${DISC_SAMPLES} samples inside ${SEARCH_R} of the ship's centre, how ` +
      `many the build redrew between facing ${FACINGS[0]} degrees and facing ` +
      `${FACINGS[1]} (specs/overview.md)`,
  );
});
