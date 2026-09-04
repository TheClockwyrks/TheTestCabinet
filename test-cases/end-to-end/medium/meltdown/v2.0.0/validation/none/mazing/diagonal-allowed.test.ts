// mazing/diagonal-allowed — a clear diagonal is a step, and it costs sqrt(2).
//
// `specs/mazing.md`: a unit "may step to an orthogonally adjacent open tile, or
// to a diagonally adjacent open tile when both of the orthogonal tiles that step
// cuts past are also open"; and "A route's length is measured in tiles: an
// orthogonal step costs `1` and a diagonal step costs `sqrt(2)`."
//
// WHY THE FLOOR IS EMPTY, AND WHY THAT IS THE RIGHT SCENARIO FOR THIS POINT. A
// diagonal is only a step when both tiles it cuts past are open — and when they
// are, the two orthogonal steps through them are open too, costing `2` against
// the diagonal's `1.4142`. A diagonal is therefore always a SHORTCUT and can
// never be the only way through: a one-tile-wide diagonal channel has both its
// cut tiles blocked by construction, so the corner rule closes it. There is
// consequently no floor on which a diagonal is necessary, and the only honest
// reading of "the diagonal is taken" is the route LENGTH it produces. Which
// tiles a route ran over is not readable and must not be asserted:
// `specs/mazing.md` fixes no tie-break among equal-cost routes, and from the
// tile posed here the first step is exactly such a tie.
//
// THE DISTINGUISHING VALUE. The unit stands on tile (44, 12), five columns west
// of the right exhaust and four rows above its nearest row. Under the metric the
// specification states the cheapest route is four diagonals and one orthogonal
// step, `4 * sqrt(2) + 1` = 6.6569 tiles. The two wrong models read as different
// numbers, so a failure names the one the build implemented:
//
//   | the model the build implemented        | the route it reports |
//   | ------------------------------------- | -------------------- |
//   | a diagonal costs sqrt(2) (specified)  | 6.6569               |
//   | a diagonal costs 1                    | 5                    |
//   | there are no diagonal steps           | 9                    |
//
// THE POSE. Nothing on the floor but the unit, so every tile the route could use
// is open and the corner condition is satisfied everywhere. Motion off, because a
// route length read while the unit walks out of the tile it was read from
// measures the reading's own latency; `specs/instrumentation.md` states that its
// route is still computed from the tile it stands on.
//
// The other side of the rule — the diagonal REFUSED where the corner is cut — is
// `mazing/diagonal-needs-both-neighbours`.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual } from "../assert";
import { OPENING_TILES } from "../constants";
import { remainingFrom } from "../routes";
import {
  captureStill,
  createHarness,
  poseTarget,
  requireUnit,
  startRun,
  type Harness,
} from "../harness";

/** Where the unit stands: five columns west and four rows above the exhaust. */
const PROBE_COL = 44;
const PROBE_ROW = 12;

/** The route the specified metric gives from that tile: 4 * sqrt(2) + 1. */
const OCTILE = remainingFrom(new Set<number>(), "right", PROBE_COL, PROBE_ROW);

/** What a build that charged `1` for a diagonal would report: 5 tiles. */
const DIAGONAL_AS_ONE = Math.min(
  ...OPENING_TILES.right.map((tile) =>
    Math.max(Math.abs(tile.col - PROBE_COL), Math.abs(tile.row - PROBE_ROW)),
  ),
);

/** What a build with no diagonal step at all would report: 9 tiles. */
const NO_DIAGONALS = Math.min(
  ...OPENING_TILES.right.map(
    (tile) => Math.abs(tile.col - PROBE_COL) + Math.abs(tile.row - PROBE_ROW),
  ),
);

/**
 * How far the reported route may sit from the computed one, in tiles.
 *
 * The metric is a sum of `1`s and `sqrt(2)`s (`specs/mazing.md`), so a
 * conforming build differs only in the last bits of a double. The bound is set
 * by what has to stay separated: the nearest wrong model above is `1.6569` tiles
 * away, and this is under a hundredth of that.
 */
const TOLERANCE = 0.01;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("measures a clear diagonal step at sqrt(2) tiles", async () => {
  await startRun(h);
  const unit = await poseTarget(h, "mote", PROBE_COL, PROBE_ROW);
  await h.advance(1);
  await captureStill(h, "diagonal");

  const measured = requireUnit(
    await h.snapshot(),
    unit,
    "the unit posed diagonally off its exhaust",
  ).remaining;

  assertLessThanOrEqual(
    Math.abs(measured - OCTILE),
    TOLERANCE,
    `the cheapest route from (${PROBE_COL}, ${PROBE_ROW}) is ` +
      `${OCTILE.toFixed(4)} tiles, four diagonals at sqrt(2) and one ` +
      `orthogonal step; a diagonal charged at 1 would read ` +
      `${DIAGONAL_AS_ONE} and no diagonals at all ${NO_DIAGONALS}. The build ` +
      `reported ${measured.toFixed(4)}, off the specified metric by`,
  );
});
