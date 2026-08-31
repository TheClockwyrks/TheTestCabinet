// mazing/diagonal-needs-both-neighbours — a diagonal never cuts a corner.
//
// specs/mazing.md: "From the tile its centre occupies it may step to an
// orthogonally adjacent open tile, or to a diagonally adjacent open tile when
// both of the orthogonal tiles that step cuts past are also open. A diagonal
// between two diagonally-touching towers is therefore not a step, and the unit
// goes around."
//
// THE FLOOR POSED. Two 4x4 Lances that touch at one corner and nowhere else: one
// covering columns 20..23 of rows 12..15, the other columns 24..27 of rows
// 16..19. Their corner tiles (23, 15) and (24, 16) are diagonally adjacent, and
// the unit is posed on (23, 16), the tile from which the corner cut would be
// offered: the step (23, 16) -> (24, 15) cuts past (24, 16) and (23, 15), and
// BOTH of those are covered.
//
// THE DISTINGUISHING VALUE. A build that honours the corner rule has to leave the
// corridor entirely and come back over the upper Lance, and the route from that
// tile is 30.4142 tiles. A build that lets the diagonal through squeezes between
// the two footprints onto the open row 15 and reads 26.8284 — three and a half
// tiles shorter. Both numbers are computed here, from the specification's own
// step rule and from the rule with its corner condition dropped (`./routes.ts`),
// and the wrong one is carried into the failure message, so a build that cuts
// corners is told which model it implemented rather than merely that its number
// was wrong.
//
// NEITHER VENT IS SEALED by this floor — the left route is 49.8284 tiles and the
// top route is untouched at 35 — so the never-seal rule of specs/mazing.md plays
// no part in what is being read, and the towers are ADDED rather than placed so
// no placement check runs at all (specs/instrumentation.md, `addTower`).
//
// THE POSE. Motion off on the unit, because a route length read while the unit
// walks out of the tile it was read from measures the reading's own latency;
// specs/instrumentation.md states that its route is still computed from the tile
// it stands on. Guns off on both Lances, because walling is the only faculty this
// requirement exercises.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseTarget,
  startRun,
  type Harness,
} from "../harness";
import { cuttingRemaining, remainingFromTile, type Footprint } from "./routes";
import { poseWall, unitOf } from "./scenario";

/**
 * The two footprints, touching at the corner between (23, 15) and (24, 16).
 *
 * The lower one spans the corridor's whole four-row run, so the corner is the
 * only place a route could get past it without leaving the corridor.
 */
const UPPER: Footprint = { type: "lance", col: 20, row: 12 };
const LOWER: Footprint = { type: "lance", col: 24, row: 16 };

/** The tile the corner cut would be offered from. */
const PROBE_COL = 23;
const PROBE_ROW = 16;

/**
 * The hp the probe is posed with.
 *
 * Both Lances have their guns held off, so nothing on this floor fires; the
 * figure is set far past anything the game could remove so a build that fires
 * anyway is named by the route it reported rather than by a unit that died
 * mid-reading.
 */
const PROBE_HP = 1e6;

/** The route the corner rule gives from that tile: 30.4142 tiles. */
const AROUND = remainingFromTile([UPPER, LOWER], "right", PROBE_COL, PROBE_ROW);

/** What a build that cut the corner would report instead: 26.8284 tiles. */
const CUTTING = cuttingRemaining([UPPER, LOWER], "right", PROBE_COL, PROBE_ROW);

/**
 * How far the reported route may sit from the computed one, in tiles.
 *
 * The metric is a sum of `1`s and `sqrt(2)`s (specs/mazing.md), so a conforming
 * build differs only in the last bits of a double. The bound is set by what has
 * to stay separated: the two models above are `3.5858` tiles apart, and this is
 * under a three-hundredth of that.
 */
const TOLERANCE = 0.01;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("refuses the diagonal between two diagonally-touching towers", async () => {
  startRun(h);
  poseWall(h, [UPPER, LOWER]);
  const unit = poseTarget(h, "mote", PROBE_COL, PROBE_ROW, PROBE_HP);
  await h.advance(1);
  captureStill(h, "corner");

  const measured = unitOf(h.snapshot(), unit).remaining;

  assertLessThanOrEqual(
    Math.abs(measured - AROUND),
    TOLERANCE,
    `going around the corner is ${AROUND.toFixed(4)} tiles from ` +
      `(${PROBE_COL}, ${PROBE_ROW}); cutting it would read ` +
      `${CUTTING.toFixed(4)}. The build reported ${measured.toFixed(4)}, off ` +
      `the route around by`,
  );
});
