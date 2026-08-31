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
// does — the Forge is warming the cold one hard and the air is cooling the hot one,
// and both of those are other items' business — but whether the OTHER GUN'S
// PRESENCE changes it. So each leg is measured twice on the same floor: once with
// the partner standing beyond the Forge, once with the partner gone and nothing
// else altered. The subject's own faces are identical in both, because the partner
// never touches it, so a conformant build reads the same number twice and a build
// that bridges reads two numbers a long way apart.
//
// BOTH DIRECTIONS, BECAUSE A BRIDGE HAS TWO ENDS. A build that leaks heat out of
// the hot gun and a build that leaks it into the cold one are different mistakes,
// and the wrong model this item names — conduction across the mover at `COND_K`
// over two shared edge-tiles — is worth `3.5 * 2 * 80`, which is `560` a second in
// whichever direction it ran.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo } from "../assert";
import {
  captureStill,
  createHarness,
  type Face,
  type Harness,
} from "../harness";
import { MOVER_SITE, faceAnchor, heatRate, type Neighbour } from "./bench";

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
 * How close a subject's rate with the partner present must come to its rate
 * without it, as decimal places of heat per second.
 *
 * One place is `0.05` of a heat point per second. Both legs are the same build's
 * own arithmetic over a floor whose only difference is a tower that touches the
 * subject nowhere, so a conformant build reads the two identically; the bound is
 * ten thousand times smaller than the `560` a build conducting across the mover
 * would move.
 */
const RATE_DIGITS = 1;

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

  const coldAlone = await heatRate(h, { type: SUBJECT, heat: COLD }, [
    northMover,
  ]);
  const coldPaired = await heatRate(h, { type: SUBJECT, heat: COLD }, [
    northMover,
    northPartner,
  ]);
  const hotAlone = await heatRate(h, { type: SUBJECT, heat: HOT }, [
    southMover,
  ]);
  const hotPaired = await heatRate(h, { type: SUBJECT, heat: HOT }, [
    southMover,
    southPartner,
  ]);
  captureStill(h, "inert");

  assertCloseTo(
    hotPaired,
    hotAlone,
    RATE_DIGITS,
    `heat per second an ${SUBJECT} at ${HOT} moves with an ${SUBJECT} at ` +
      `${COLD} standing beyond its ${MOVER}, against the ${hotAlone} it moves ` +
      `with nothing there`,
  );
  assertCloseTo(
    coldPaired,
    coldAlone,
    RATE_DIGITS,
    `heat per second an ${SUBJECT} at ${COLD} moves with an ${SUBJECT} at ` +
      `${HOT} standing beyond its ${MOVER}, against the ${coldAlone} it moves ` +
      `with nothing there`,
  );
});
