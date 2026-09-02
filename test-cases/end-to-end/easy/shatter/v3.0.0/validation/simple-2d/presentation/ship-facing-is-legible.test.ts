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
// WHAT MAKES A FACING LEGIBLE, MEASURED. A drawing carries a direction only if it
// is ASYMMETRIC about the ship's centre ALONG that direction: a body with as much
// of itself ahead of the centre as behind reads the same flown forwards and
// backwards, whatever colours it is drawn in. So the frame is read as ink — every
// square unit within `LOOK_R` of the ship's centre that the build painted
// something other than the field on — and each unit is put ahead of the centre or
// behind it by the sign of its projection onto the facing. What is asserted is the
// gap between the two shares.
//
// WHY AREA AND NOT REACH. A triangle `34` long is not `17` of hull ahead and `17`
// behind in AREA even when it is in REACH: it comes to a point at the nose and is
// `26` wide at the tail, so the half behind the centre carries far more of the
// drawing than the half ahead. Reading the furthest painted unit instead would
// report a hull whose apex and whose tail corners sit the same distance out as
// perfectly symmetric, and grade a legible ship as illegible.
//
// AND WHY THE GAP IS UNSIGNED. `specs/ship.md` fixes the shape and
// `specs/weapons.md` puts the nose "ahead of the ship's centre along its facing,
// and no further from it than `SHIP_R`", but neither fixes where inside the hull a
// build calls the centre, so which SIDE carries more of the drawing is the
// build's. What every legible drawing has in common is that the two sides differ.
//
// FOUR FACINGS, EACH ITS OWN ASSERTION. A build that draws its hull at a fixed
// heading, or at the facing plus a quarter turn, is asymmetric on the frame and
// symmetric about the direction it claims to be pointing — so it passes at
// whichever facings happen to agree with its bug and fails at the others, and the
// failure names the facing that caught it.
//
// THE POSE. An emptied, gated field with the ship at `SHIP_SPOT`, `376` from the
// star's centre, so nothing of the star — drawn out to `180`, `specs/field.md` —
// reaches the square being read. No thrust is held and no grace is running, so
// neither the flame nor the respawn blink is on the frame: this reads the hull.

import { afterEach, beforeEach, it } from "vitest";
import { DEG } from "../constants";
import { assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import {
  cellCentre,
  inkedCells,
  readInk,
  readPainted,
  type Painted,
} from "./ink";
import { SHIP_SPOT, sampleField } from "./scene";

/** How far a square unit must be from the field to count as drawn, of 441. */
const APART = 60;

/**
 * How far out the ship's drawing is read, in logical units.
 *
 * `specs/ship.md` makes the hull `34` long nose to tail, and
 * `specs/weapons.md` puts the nose no further than `SHIP_R` (`14`) ahead of the
 * centre, so no part of the hull is further than `34` from the centre whatever
 * point inside it a build calls the centre. `40` covers that with room for the
 * outline a build strokes around it.
 */
const LOOK_R = 40;

/** The side of a square unit the frame is read in, in logical units. */
const CELL = 1;

/**
 * Square units nearer the centre than this, along the facing, are read as neither
 * ahead nor behind.
 *
 * A one-unit deadband either side of the line through the centre. It keeps the
 * unit a build's own anti-aliasing straddles out of both counts, and it is a
 * fortieth of `LOOK_R`, so it cannot move the shares it excludes itself from.
 */
const DEADBAND = 1;

/**
 * How far apart the two shares must be, as a fraction of all the ink read.
 *
 * A tenth. The shape `specs/ship.md` fixes is far more lopsided than that: a plain
 * triangle `34` long and `26` across at the tail, with its nose the `SHIP_R` (`14`)
 * ahead of the centre that `specs/weapons.md` allows at most, puts a sixth of its
 * area ahead of the centre and five sixths behind — a gap of two thirds. The bar is
 * set at a sixth of that, so a build that softens the shape with a notched tail, a
 * canopy or a nose marker still clears it easily, while a drawing symmetric about
 * its centre — the one thing a legible facing cannot be — reads zero.
 */
const MIN_GAP = 0.1;

/** The four facings the drawing is read at, in degrees clockwise from +x. */
const FACINGS = [0, 90, 180, 270] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/**
 * How lopsided the ink within `LOOK_R` of the ship is about the line through its
 * centre across `facing`: `|ahead - behind| / (ahead + behind)`.
 *
 * Zero for a drawing with as much of itself on one side as the other, and zero
 * for a build that drew nothing at all, which fails the same assertion.
 */
function lopsidedness(painted: Painted, facing: number): number {
  const field = sampleField(painted);
  const grid = readInk(
    painted,
    {
      x: SHIP_SPOT.x - LOOK_R,
      y: SHIP_SPOT.y - LOOK_R,
      w: 2 * LOOK_R,
      h: 2 * LOOK_R,
    },
    CELL,
    field,
  );
  const forward = { x: Math.cos(facing), y: Math.sin(facing) };
  let ahead = 0;
  let behind = 0;
  for (const cell of inkedCells(grid, APART)) {
    const at = cellCentre(grid, cell.col, cell.row);
    const dx = at.x - SHIP_SPOT.x;
    const dy = at.y - SHIP_SPOT.y;
    if (Math.hypot(dx, dy) > LOOK_R) continue;
    const along = dx * forward.x + dy * forward.y;
    if (along > DEADBAND) ahead += 1;
    else if (along < -DEADBAND) behind += 1;
  }
  const drawn = ahead + behind;
  return drawn === 0 ? 0 : Math.abs(ahead - behind) / drawn;
}

it("draws the hull lopsided about its centre along the facing, at four facings", async () => {
  startPlaying(h);
  h.debug.setShipPosition(SHIP_SPOT.x, SHIP_SPOT.y);

  const read: { degrees: number; gap: number }[] = [];
  for (const degrees of FACINGS) {
    h.debug.setShipAngle(degrees * DEG);
    await h.advance(1);
    read.push({ degrees, gap: lopsidedness(readPainted(h), degrees * DEG) });
  }
  captureStill(h, "facings");

  for (const { degrees, gap } of read) {
    assertGreaterThan(
      gap,
      MIN_GAP,
      `facing ${degrees} degrees: how far apart the drawn area ahead of the ` +
        "ship's centre and the drawn area behind it sit, as a fraction of " +
        "both, where a triangle pointing along the facing must be lopsided " +
        "(specs/ship.md, specs/overview.md)",
    );
  }
});
