// Meltdown — movers/movers-do-not-conduct: a mover conducts nothing.
//
// specs/heat.md gives conduction as a term between two EMITTERS —
// "`conduct(T) = COND_K * sharedEdges(T, N) * (H_N - H_T)`, summed over every
// emitter `N` that `T` touches" — and then rules the movers out of it altogether:
// "Movers carry no heat, so they neither conduct with an emitter nor exchange with
// each other. They only drive the flows above into and out of the emitters they
// touch." So a Forge standing between two guns is not a bridge. Whatever the guns
// on either side of it are carrying, neither is any of the other's business.
//
// THE ARRANGEMENT. A Forge with one Arc flush against its north face and another
// flush against its south face, four rows apart and touching each other nowhere.
// One is posed at `90` and the other at `10`, the widest gradient this floor can
// hold short of the trip, so a build that passed heat along the mover would be
// passing eighty degrees of it.
//
// EACH GUN IS READ AGAINST ITSELF, ALONE. The reading is not what a gun's heat
// does — the Forge is warming the cold one hard and the air is cooling the hot
// one, and both of those are other items' business — but whether the OTHER GUN'S
// PRESENCE changes it. So each leg is measured twice on the same floor: once with
// the partner standing beyond the Forge, once with the partner gone and nothing
// else altered. The subject's own faces are identical in both, because the partner
// never touches it, so a conformant build reads the same heat twice and a build
// that bridges reads two heats a long way apart.
//
// A WINDOW RATHER THAN A FRAME, AND THAT IS THE WHOLE DIFFICULTY OF THIS ITEM.
// specs/heat.md computes every term of a frame from the heats that frame opened
// with, so a build that gives its mover a heat of its own and conducts with it
// cannot show that in ONE frame: on the opening frame the mover is still at `0` on
// both floors, and the partner's warmth reaches the subject only on the frame
// after the mover has carried it. A one-frame reading would therefore pass the
// likeliest wrong build there is — the mover modelled as an ordinary emitter with
// a mass and a heat — and name only the cruder one that conducts the two guns
// straight through it. A second of game time gives the second hop a hundred and
// twenty frames to happen in.
//
// BOTH DIRECTIONS, BECAUSE A BRIDGE HAS TWO ENDS. A build that leaks heat out of
// the hot gun and a build that leaks it into the cold one are different mistakes.
//
// NEITHER GUN REACHES A BOUNDARY INSIDE THE WINDOW, so no reading of the clamp or
// of the trip can touch the measurement. The hot Arc has a Forge whose `72`
// setpoint is below its `90`, so it only sheds, and it sheds toward `0`; the cold
// Arc is driven toward the setpoint and settles below it, because the air it sheds
// through its three open faces takes the balance to about `68`. Neither ever
// approaches `100`.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo } from "../assert";
import {
  captureStill,
  createHarness,
  type Face,
  type Harness,
} from "../harness";
import { MOVER_SITE, faceAnchor, heatAfter, type Neighbour } from "./bench";

/** The mover stood between the two guns, and the guns themselves. */
const MOVER = "forge";
const SUBJECT = "arc";

/** The two heats: the widest gradient the floor holds short of the trip. */
const HOT = 90;
const COLD = 10;

/** The face the mover stands against in each leg. */
const HOT_FACE: Face = "S";
const COLD_FACE: Face = "N";

/**
 * How long each leg runs for, in seconds of game time.
 *
 * A second is a hundred and twenty frames of the suite's clock, so a flow that
 * needs a second hop has more than a hundred chances to take it. Geometry, not a
 * tolerance: it says how long the two floors are watched, never how far apart
 * their answers may sit.
 */
const WINDOW_SECONDS = 1;

/**
 * How far beyond the mover the partner stands, in tiles.
 *
 * Geometry, not a tolerance. A 2x2 mover flush against a 2x2 subject's face puts
 * its own far side four rows from the subject's anchor, so a 2x2 partner anchored
 * there is flush against the mover and two clear rows from the subject — touching
 * the mover along both its edge-tiles and the subject along none, which is the
 * arrangement the item names.
 */
const BEYOND = 4;

/**
 * How close a subject's heat with the partner present must come to its heat
 * without it, as decimal places of a heat point.
 *
 * Three places is `0.0005` of a heat point after a second. Both legs are the same
 * build's own arithmetic over a floor whose only difference is a tower that
 * touches the subject nowhere and can therefore appear in no term of its
 * resolution, so a conformant build reads the two identically and needs none of
 * the room. What the bound excludes is tens of heat points: a build that conducts
 * the two guns straight through the mover moves `COND_K * 2 * 80`, which is `560`
 * a second, and one that gives the mover a heat of its own and conducts with it
 * carries the hot gun's warmth into the cold one across the window all the same.
 */
const HEAT_DIGITS = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("A mover conducts nothing", async () => {
  const southMover: Neighbour = {
    type: MOVER,
    ...faceAnchor(SUBJECT, HOT_FACE),
  };
  const northMover: Neighbour = {
    type: MOVER,
    ...faceAnchor(SUBJECT, COLD_FACE),
  };
  /** The partner, flush against the mover's far side and clear of the subject. */
  const southPartner: Neighbour = {
    type: SUBJECT,
    col: MOVER_SITE.col,
    row: MOVER_SITE.row + BEYOND,
    heat: COLD,
  };
  const northPartner: Neighbour = {
    type: SUBJECT,
    col: MOVER_SITE.col,
    row: MOVER_SITE.row - BEYOND,
    heat: HOT,
  };

  const coldAlone = await heatAfter(
    h,
    { type: SUBJECT, heat: COLD },
    [northMover],
    WINDOW_SECONDS,
  );
  const coldPaired = await heatAfter(
    h,
    { type: SUBJECT, heat: COLD },
    [northMover, northPartner],
    WINDOW_SECONDS,
  );
  const hotAlone = await heatAfter(
    h,
    { type: SUBJECT, heat: HOT },
    [southMover],
    WINDOW_SECONDS,
  );
  const hotPaired = await heatAfter(
    h,
    { type: SUBJECT, heat: HOT },
    [southMover, southPartner],
    WINDOW_SECONDS,
  );
  captureStill(h, "inert");

  assertCloseTo(
    hotPaired,
    hotAlone,
    HEAT_DIGITS,
    `the heat an ${SUBJECT} opened at ${HOT} holds after ${WINDOW_SECONDS}s ` +
      `with an ${SUBJECT} at ${COLD} standing beyond its ${MOVER}, against the ` +
      `${hotAlone} it holds with nothing there`,
  );
  assertCloseTo(
    coldPaired,
    coldAlone,
    HEAT_DIGITS,
    `the heat an ${SUBJECT} opened at ${COLD} holds after ${WINDOW_SECONDS}s ` +
      `with an ${SUBJECT} at ${HOT} standing beyond its ${MOVER}, against the ` +
      `${coldAlone} it holds with nothing there`,
  );
});
