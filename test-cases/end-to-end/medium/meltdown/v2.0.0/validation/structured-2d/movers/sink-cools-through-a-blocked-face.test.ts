// Meltdown — movers/sink-cools-through-a-blocked-face: the Sink cools a boxed core.
//
// specs/heat.md makes this the Sink's whole reason for existing: "An edge-tile
// facing another tower sheds nothing to air", so "A tower boxed in on all four
// faces sheds nothing to air at all", and "The Sink drains each emitter it touches
// through a face that would otherwise shed nothing, which is the only way a
// boxed-in tower loses heat."
//
// THREE FLOORS, AND THE POINT IS WHAT THEY SAY AGAINST EACH OTHER.
//
//   - THE SEALED FLOOR. An Arc at `80` with a plain emitter flush against every one
//     of its four faces. Every edge-tile it has faces another tower, so its air term
//     is nothing; every neighbour is posed at its own `80`, so specs/heat.md has the
//     pair exchange nothing across each shared edge; and it fires nothing. The
//     specification leaves it exactly `0` heat per second, and this is the "which no
//     arrangement of plain walls achieves" half of the item: a player who walls a
//     core in has taken away every way it had of cooling.
//   - THE BOXED FLOOR. The same floor with the north wall replaced by a Sink of the
//     same 2x2 footprint. The blocked faces are blocked exactly as before, so the
//     air term is still nothing and the whole of what moves this Arc's heat is the
//     Sink.
//   - THE OPEN FLOOR. The same Arc at the same heat with the same Sink against the
//     same face and its other three faces on open floor, read through `bench.ts`'s
//     walled control so that only the Sink's own term survives.
//
// THE READING IS THAT THE LAST TWO AGREE. A Sink drains through a blocked face
// exactly as it drains through any other, so a boxed core loses the same heat per
// second a core in open air loses to the same Sink. Holding the two against each
// other rather than against a figure is what keeps this item about the BOX: a build
// whose Sink output or whose per-edge counting is wrong reads the same wrong number
// on both floors and is graded on that by `movers/sink-cools` and
// `movers/sink-output-scales`, while a build that lets a Sink drain only a tower
// that still has air to shed to — the defect this item exists to catch — reads
// nothing on the boxed floor and its full drain on the open one.
//
// THE WALLS ARE THE SAME SIZE AS THE TOWER THEY BOX, so each covers one whole face
// and any two of them meet at a corner alone; two towers touching only at a corner
// share no edge-tiles (specs/heat.md), so no wall abuts another and nothing in the
// arrangement conducts.
//
// POSED AT `80` RATHER THAN AT THE TRIP, so no reading of the trip boundary can
// reach the measurement.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertLessThan } from "../assert";
import {
  captureStill,
  createHarness,
  type Face,
  type Harness,
} from "../harness";
import { WALL, faceAnchor, heatRate, moverFlow, type Neighbour } from "./bench";

/** The emitter read, its heat, and the face the Sink takes over. */
const SUBJECT = "arc";
const HEAT = 80;
const DRAINED_FACE: Face = "N";

/** Every face of a footprint (specs/heat.md, Faces, edge-tiles, and neighbours). */
const FACES: readonly Face[] = ["N", "E", "S", "W"];

/** What a tower boxed by plain walls alone loses: nothing at all. */
const SEALED_RATE = 0;

/**
 * How close each rate must come, as decimal places of heat per second.
 *
 * One place is `0.05` of a heat point per second. The sealed floor's requirement is
 * exact — every term of the specification's sum is identically zero on it — and the
 * two drained readings are the same build's own arithmetic over the same Sink
 * against the same face, so a conformant build reads them identically. What the
 * bound excludes is the failure this item names: a build whose boxed core cannot be
 * cooled reads `0` where its open floor reads its full drain, which is `25.6` a
 * second at the specification's own figures — five hundred times the bound.
 */
const RATE_DIGITS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("The Sink cools a boxed core", async () => {
  const walls: Neighbour[] = FACES.map((face) => ({
    type: WALL,
    ...faceAnchor(SUBJECT, face),
  }));
  const boxed: Neighbour[] = walls.map((wall, i) =>
    FACES[i] === DRAINED_FACE ? { ...wall, type: "sink" } : wall,
  );
  const alone: Neighbour = {
    type: "sink",
    ...faceAnchor(SUBJECT, DRAINED_FACE),
  };

  const open = await moverFlow(h, { type: SUBJECT, heat: HEAT }, [alone]);
  const sealed = await heatRate(h, { type: SUBJECT, heat: HEAT }, walls);
  const cooled = await heatRate(h, { type: SUBJECT, heat: HEAT }, boxed);
  captureStill(h, "boxed");

  assertCloseTo(
    sealed,
    SEALED_RATE,
    RATE_DIGITS,
    `heat per second an ${SUBJECT} at ${HEAT} boxed by plain walls on all ` +
      `${FACES.length} faces loses`,
  );
  assertLessThan(
    open,
    0,
    `precondition: heat per second a Sink draws out of an ${SUBJECT} at ` +
      `${HEAT} standing in open air`,
  );
  assertCloseTo(
    cooled,
    open,
    RATE_DIGITS,
    `heat per second an ${SUBJECT} at ${HEAT} boxed on all ` +
      `${FACES.length} faces, its ${DRAINED_FACE} one a Sink, loses — against ` +
      `the ${open} the same Sink draws through the same face in open air`,
  );
});
