// presentation/invulnerable-ship-blinks — a ship inside its respawn grace reads as
// protected, and reads normal again once the grace is spent.
//
// THE RULE. `specs/overview.md`: "A ship inside its respawn grace reads as such:
// its drawn appearance changes visibly while the grace runs and settles once it
// ends." `specs/progression.md` states the same from the run's side: through the
// `INVULN_TIME` (`2.5` seconds) window "the ship is fully controllable and ignores
// the three lethal contacts", and "its drawn appearance shows that the grace is
// running". Without it a player cannot tell a ship that will survive a rock from
// one that will not.
//
// THE TWO DIRECTIONS, WHICH ARE THE SENTENCE'S OWN TWO HALVES:
//
//   - IT CHANGES WHILE THE GRACE RUNS. At some instant inside the window the ship
//     is drawn measurably differently from the same ship with no grace running.
//   - AND IT SETTLES ONCE THE GRACE ENDS. Once the window has run out, the ship is
//     drawn as it was before it started. A build that leaves the grace's mark on
//     the ship for the rest of the game tells the player they are protected when
//     they are not, which is the same lie the other way round.
//
// PRESENCE AND DIFFERENCE, NOT ONE IMPLEMENTATION. `specs/overview.md` leaves the
// palette, the glow and every other aspect of the look to the build, so nothing
// here counts drawn pixels, reads a duty cycle or requires the hull to disappear.
// What is measured is HOW MANY of a fixed set of points over the ship were painted
// differently between two frames of the same ship in the same place. A build that
// blinks by alpha, by colour, by outline weight or by a mark it adds around the
// hull all move points; a build that draws the identical ship throughout moves
// none.
//
// WHY A COUNT OF MOVED POINTS AND NOT THEIR AVERAGE. An average over a disc
// depends on how much of the disc the change covers, so it would grade a build
// that rings its ship far more harshly than one that dims the whole hull — and
// both are conformant. A count with a per-point bar does not: a change has to be
// visible where it happens, and enough of the ship has to carry it, and neither
// rewards the change for being large everywhere.
//
// AND WHY THE READING COVERS THE SHIP'S WHOLE DRAWN EXTENT rather than the circle
// it collides as. `specs/overview.md` requires the ship's DRAWN APPEARANCE to
// change, and `specs/ship.md` draws a hull `34` long nose to tail — so a build
// that shows the grace as a ring or a shimmer just outside the hull is doing
// exactly what it was asked, and a reading confined to `SHIP_R` (`14`) would fail
// it for choosing one conformant idiom over another. The disc read is `34` about
// the ship's centre, which holds the hull whatever point inside it a build calls
// the centre, and the mark a build draws around it.
//
// WHY THE WINDOW IS SAMPLED EVERY THREE TICKS. `specs/progression.md` fixes the
// window's LENGTH and says nothing about the cadence of whatever a build draws
// inside it, so a check that read one instant would grade the phase it happened to
// land on. A hundred instants across `2.5` seconds cannot all fall in the same
// phase of anything a player could see: three ticks is a fortieth of a second, and
// a build whose grace were invisible for thirty-nine fortieths of every cycle
// would not be showing the player anything.
//
// THE POSE. An emptied, gated field with the ship at `SHIP_SPOT`, at rest, facing
// `FACE_UP`, `376` from the star's centre — so nothing of the star, drawn out to
// `180` (`specs/field.md`), reaches the disc. The well never pulls the ship
// (`specs/gravity.md`) and no key is held, so it stands exactly where it was posed
// for the whole window and every reading is taken over the same points. The grace
// is posed with `setShipInvuln`, which "sets the timer alone"
// (`specs/instrumentation.md`), so nothing here depends on a death having
// happened.

import { afterEach, beforeEach, it } from "vitest";
import { FACE_UP, HULL_LEN, INVULN_TIME } from "../constants";
import { assertGreaterThanOrEqual, assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { DISC_SAMPLES, changedSamples, readDisc, readPainted } from "./ink";
import { SHIP_SPOT } from "./scene";

/**
 * How far out the ship's drawing is read, in logical units.
 *
 * The hull's length nose to tail (`HULL_LEN`), so the disc holds the whole hull
 * whatever point inside it a build calls the centre, along with any mark a build
 * draws around it to show the grace.
 */
const LOOK_R = HULL_LEN;

/** Ticks between two readings of the grace window. See the header. */
const SAMPLE_STRIDE = 3;

/**
 * The sensing floor on a change: how far a reading must move between two frames
 * before the move can be called a redrawing, of the 441 an RGB distance can span.
 *
 * Eight. Below that a sampling cannot tell a redrawing from the rounding of an
 * 8-bit channel and the host's own anti-aliasing; above it nothing is decided
 * about how strongly the two readings differ. Anything the build drew differently
 * clears it, however faintly it drew it.
 */
const POINT_CHANGE = 8;

/**
 * How many of the {@link DISC_SAMPLES} points must have moved at some instant of
 * the grace.
 *
 * Twelve, the same count `ship-is-drawn-and-distinct` holds the whole hull's
 * presence to: about what a bare one-unit outline marks out of this many samples.
 * It is deliberately low, because `specs/overview.md` fixes no size for whatever a
 * build draws — only that the player sees it — and a ring, a shimmer or a dimmed
 * hull each clear it several times over. The bar is `>=`, as
 * `ship-is-drawn-and-distinct` holds the same twelve of this many samples, and as
 * the `none` project holds this item — so twelve moved points is the same verdict
 * whichever engine a run draws.
 */
const MIN_MOVED = 12;

/**
 * How many points may still be moved once the grace has run out.
 *
 * Four: a third of the floor above, so the two halves of the rule can never both
 * hold of one reading. It is an allowance for a build's own anti-aliasing rather
 * than for a residue — a ship still being drawn as protected moves points by the
 * dozen.
 */
const MAX_MOVED = 4;

/** How long after the window runs out the settled reading is taken. */
const AFTER_TICKS = ticksFor(0.2);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the ship differently at some instant of its grace and as it was once the grace is spent", async () => {
  startPlaying(h);
  h.debug.setShipPosition(SHIP_SPOT.x, SHIP_SPOT.y);
  h.debug.setShipAngle(FACE_UP);
  h.debug.setShipVelocity(0, 0);
  await h.advance(1);

  const steady = readDisc(readPainted(h), SHIP_SPOT, LOOK_R);
  const movedFrom = (): number =>
    changedSamples(
      steady,
      readDisc(readPainted(h), SHIP_SPOT, LOOK_R),
      POINT_CHANGE,
    );

  h.debug.setShipInvuln(INVULN_TIME);
  let mostMoved = 0;
  let captured = false;
  for (let done = 0; done < ticksFor(INVULN_TIME); done += SAMPLE_STRIDE) {
    await h.advance(SAMPLE_STRIDE);
    const moved = movedFrom();
    if (moved > mostMoved) mostMoved = moved;
    if (!captured && moved >= MIN_MOVED) {
      captureStill(h, "grace");
      captured = true;
    }
  }

  await h.advance(AFTER_TICKS);
  const settled = movedFrom();
  if (!captured) captureStill(h, "grace");

  assertGreaterThanOrEqual(
    mostMoved,
    MIN_MOVED,
    `of ${DISC_SAMPLES} points over the ship, how many were drawn more than ` +
      `${POINT_CHANGE} of 441 from the way they are drawn with no grace ` +
      "running, at the instant of the INVULN_TIME window that moved most of " +
      "them (specs/overview.md)",
  );

  assertLessThanOrEqual(
    settled,
    MAX_MOVED,
    `of ${DISC_SAMPLES} points over the ship, how many are still drawn more ` +
      `than ${POINT_CHANGE} of 441 from the way they are drawn with no grace ` +
      "running, once the INVULN_TIME window has run out (specs/overview.md)",
  );
});
