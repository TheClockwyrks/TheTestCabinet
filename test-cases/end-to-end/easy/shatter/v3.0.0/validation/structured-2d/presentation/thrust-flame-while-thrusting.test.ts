// presentation/thrust-flame-while-thrusting — a flame shows while thrust is applied,
// and only then.
//
// THE RULE. `specs/ship.md`: "While thrust is being applied, a flame is drawn
// trailing from the ship's tail. It is absent whenever thrust is not being applied."
// `specs/overview.md` asks for the same from the player's side: "While thrust is
// applied, a flame reads at the ship's tail, and it is absent when thrust is not."
// It is the one feedback the player has for a control whose effect — a change of
// acceleration — takes a second to become visible in the motion.
//
// BOTH DIRECTIONS ARE THE ONE REQUIREMENT, and the specification states them in one
// sentence each way round, so both are read here: a build that draws a flame it
// never puts out is as wrong as one that never draws it, and neither half means
// anything without the other.
//
// WHAT IS READ. The wedge of field BEHIND the ship: the square units between `16`
// and `48` from its centre, within `45` degrees of the direction opposite its
// facing. `specs/ship.md` makes the hull `34` long and `specs/weapons.md` puts the
// nose no further than `SHIP_R` (`14`) ahead of the centre, so the tail sits between
// `20` and `34` behind it and a flame trailing FROM that tail lies inside the wedge
// whatever length a build gives it.
//
// AND WHAT IS COMPARED. HOW MANY square units of the wedge are painted — read as
// units standing further than `INKED` from the field the build itself drew — against
// the same count on a frame of the same ship in the same place not thrusting. The
// wedge holds the back of the hull as well as the flame, and how the hull is drawn
// is the build's, so the RISE in the count is what isolates the flame from
// everything else in the wedge. Nothing here reads a colour, a size or a shape:
// `specs/overview.md` leaves the look to the build, and what is required is that
// something is painted there while the burn runs and nothing while it does not.
//
// WHY THE COUNT RATHER THAN THE CELLS THAT CHANGED. A tick of thrust ACCELERATES the
// ship (`SHIP_THRUST`, `specs/ship.md`) and the tick's motion is applied before the
// frame is drawn, so the burning frame's hull stands a hundredth of a unit from
// where the quiet frame's did however carefully the pose is repeated — and a
// hundredth of a unit is enough to move the anti-aliased edge of the hull's own
// outline across a whole row of square units. Counting the units that CHANGED reads
// those edges: on this case's own reference, a build with its flame taken out still
// moved 26 of them, which is more than a flame's own floor. Counting the units that
// are PAINTED does not: an outline that shifts by a hair paints the same number of
// units, while a flame paints scores more. The same reference reads 58 painted units
// quiet and 110 burning, and 56 burning with the flame removed — so the rise is 52
// where the rule is met and below nothing where it is not.
//
// THE SHIP IS PUT BACK BEFORE EACH READING all the same, with `setShipPosition` and
// `setShipVelocity`, so the hull is drawn in the same place to within that hundredth
// of a unit and the wedge sits over the same part of it in all three frames.
//
// THE POSE. An emptied, gated field with the ship at `SHIP_SPOT` facing `FACE_UP`,
// `376` from the star's centre, so the wedge — which reaches `48` below the ship —
// is nowhere near the `180` nothing of the star is drawn beyond (`specs/field.md`).
// No grace is running, so the respawn blink is not on the frame.

import { afterEach, beforeEach, it } from "vitest";
import { FACE_UP } from "../constants";
import { assertGreaterThanOrEqual, assertLessThanOrEqual } from "../assert";
import { type Vec } from "../geometry";
import {
  captureStill,
  createHarness,
  holdAction,
  keysFor,
  releaseAction,
  startPlaying,
  type Harness,
  type Rgb,
} from "../harness";
import { inkedCells, readInk, readPainted, type InkGrid } from "./ink";
import { SHIP_SPOT, sampleField } from "./scene";

/** The side of a square unit the frame is read in, in logical units. */
const CELL = 1;

/**
 * How far the wedge behind the ship reaches, in logical units.
 *
 * From `16` — inside the `20` the tail is at when the nose is the full `SHIP_R`
 * ahead of the centre, so the wedge starts under the tail wherever a build put it —
 * out to `48`, which is `34` of hull plus half as much again of flame.
 */
const WEDGE_NEAR = 16;
const WEDGE_FAR = 48;

/**
 * How wide the wedge opens either side of straight back, in radians.
 *
 * `45` degrees. `specs/ship.md` makes the tail `26` across, so a flame leaving it at
 * `20` behind the centre spreads to about `33` degrees at its widest; a half-angle
 * of `45` covers that with room and still excludes the sides of the hull, where a
 * build's own outline lives.
 */
const WEDGE_HALF_ANGLE = Math.PI / 4;

/**
 * How far a square unit's reading must stand from the field to count as painted,
 * of 441.
 *
 * The same `60` every presentation item in this suite calls a body drawn at, so a
 * flame drawn faint enough to be only just visible still registers and the field's
 * own gradient does not.
 */
const INKED = 60;

/**
 * How many more square units of the wedge must be painted when the burn starts.
 *
 * `specs/ship.md` gives the tail a width of `26`, so a flame trailing from it covers
 * scores of square units however short a build draws it. Twenty is a floor far under
 * the 52 this case's own reference adds, and far above the handful an outline
 * shifted by a hair between two frames moves either way.
 */
const MIN_FLAME = 20;

/**
 * How many more square units of the wedge may still be painted a frame after the key
 * is let up.
 *
 * Six. The rule is that the flame is ABSENT, so this is an allowance for measurement
 * rather than for a residue: the ship is put back at rest before the reading but
 * still travels a fraction of a unit inside the frame that draws it, which can add
 * or drop a unit or two along the hull's own outline. A flame that is still being
 * drawn is scores of units, not six.
 */
const MAX_RESIDUE = 6;

/** The square the wedge is cut out of, big enough to hold all of it. */
const REGION = {
  x: SHIP_SPOT.x - WEDGE_FAR - 2,
  y: SHIP_SPOT.y - WEDGE_FAR - 2,
  w: 2 * (WEDGE_FAR + 2),
  h: 2 * (WEDGE_FAR + 2),
} as const;

/** Whether a point lies in the wedge behind a ship facing `FACE_UP`. */
function behindTheTail(at: Vec): boolean {
  const dx = at.x - SHIP_SPOT.x;
  const dy = at.y - SHIP_SPOT.y;
  const away = Math.hypot(dx, dy);
  if (away < WEDGE_NEAR || away > WEDGE_FAR) return false;
  const back = { x: -Math.cos(FACE_UP), y: -Math.sin(FACE_UP) };
  return (dx * back.x + dy * back.y) / away > Math.cos(WEDGE_HALF_ANGLE);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("paints the wedge behind the tail while thrust is held and clears it when it is let up", async () => {
  startPlaying(h);
  h.debug.setShipPosition(SHIP_SPOT.x, SHIP_SPOT.y);
  h.debug.setShipAngle(FACE_UP);
  await h.advance(1);

  const quiet = readPainted(h);
  const field: Rgb = sampleField(quiet);
  const read = (): InkGrid => readInk(readPainted(h), REGION, CELL, field);
  const still = read();

  // The burn: the key goes down, the ship is put back where the quiet frame drew
  // it, and the frame that follows is the one the flame is read off. The key comes
  // up in a `finally`, so a reading that threw does not leave it down.
  let burning: InkGrid;
  holdAction(h, "up");
  try {
    h.debug.setShipPosition(SHIP_SPOT.x, SHIP_SPOT.y);
    h.debug.setShipVelocity(0, 0);
    await h.advance(1);
    burning = read();
    captureStill(h, "flame");
  } finally {
    releaseAction(h, "up");
  }

  // And one frame after the key is let up, from the same place at rest.
  h.debug.setShipPosition(SHIP_SPOT.x, SHIP_SPOT.y);
  h.debug.setShipVelocity(0, 0);
  await h.advance(1);
  const released = read();

  const key = keysFor("up")[0];
  const painted = (grid: InkGrid): number =>
    inkedCells(grid, INKED, behindTheTail).length;
  const quietly = painted(still);

  assertGreaterThanOrEqual(
    painted(burning) - quietly,
    MIN_FLAME,
    `holding ${key}: how many MORE square units of the wedge behind the ` +
      `ship's tail the build paints than it paints with the same ship in the ` +
      `same place not thrusting (${String(quietly)} of them), where a flame ` +
      "must be drawn while thrust is applied (specs/ship.md)",
  );

  assertLessThanOrEqual(
    painted(released) - quietly,
    MAX_RESIDUE,
    `a frame after ${key} came up: how many more square units of the wedge ` +
      `behind the ship's tail are painted than the ${String(quietly)} the ` +
      "frame before the burn painted, where the flame must be absent whenever " +
      "thrust is not applied (specs/ship.md)",
  );
});
