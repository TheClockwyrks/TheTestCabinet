// Meltdown — movers/sink-cools: the Sink drains a hot gun.
//
// `specs/heat.md` gives the Sink's drain as
// `sinkLoss(T) = output(S) * sharedEdges(T, S) * (H_T / 100)`, summed over every
// Sink `T` touches, and divides the whole change by the emitter's own mass.
// `specs/towers.md` puts a level-I Sink's per-shared-edge output at `16`, makes
// both movers 2x2, and gives the Arc a mass of `1.0`; `specs/heat.md` counts one
// edge-tile per tile of a face's side, so a 2x2 Sink flush against a 2x2 Arc is a
// contact of two edge-tiles. At heat `70` the drain is therefore
// `16 * 2 * 0.70`, which is `22.4` per second.
//
// THE HEAT IS 70 RATHER THAN 100, and that is deliberate. The drain is
// proportional to `H / 100`, so a build that drains a flat `output * edges`
// whatever the heat reads the SAME number as a conformant one at `100` and a
// different one everywhere else. At `70` the two are `0.2667` and `0.1867` of a
// heat point over one frame — a gap of forty percent.
//
// EVERY OTHER FLOW IS POSED OUT OF THE ARRANGEMENT, so the number read is the
// Sink's and nothing else: the Arc's other three faces carry plain walls at its
// own heat, which takes the air term to exactly zero and leaves conduction at a
// gradient of zero, and the reading is ONE FRAME, so no wall's own cooling can
// reach the subject. `movers/contact.ts` states why each part of that is there.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo } from "../assert";
import { SINK_OUTPUT, TRIP_HEAT, type TowerType } from "../constants";
import {
  captureStill,
  createHarness,
  seconds,
  startRun,
  type Harness,
} from "../harness";
import { sizeOf } from "../thermal";
import { massOf, poseBoxed, readHeat } from "./contact";

/** The gun read, and the heat it opens at. */
const GUN: TowerType = "arc";
const HEAT = 70;

/** The Sink's level, and the per-edge output `specs/towers.md` gives it there. */
const LEVEL = 1;
const OUTPUT = SINK_OUTPUT[LEVEL - 1];

/** A 2x2 face is two edge-tiles, so a flush 2x2 Sink is a contact of two. */
const SHARED_EDGES = sizeOf(GUN);

/** The frame the drain is measured over, in seconds of game time. */
const DT = seconds(1);

/** `16 * 2 * (70 / 100) * dt / 1.0`, which is `0.1867` of a heat point. */
const EXPECTED_LOSS =
  (OUTPUT * SHARED_EDGES * (HEAT / TRIP_HEAT) * DT) / massOf(GUN);

/**
 * How close the drain must come, as decimal places of a heat point.
 *
 * Three places is `0.0005`, a quarter of one percent of the `0.1867` required.
 * The arrangement leaves the frame's arithmetic as one multiplication over
 * figures the specification states exactly — no air term, no conduction term, no
 * second mover — so a conformant build lands on it to within float slack. The
 * bound is set by what has to stay separated: draining per FACE rather than per
 * edge-tile halves the figure, draining a flat rate regardless of heat gives
 * `0.2667`, and the level-II output gives `0.28`. Each of those is at least a
 * hundred and eighty times the bound away.
 */
const HEAT_DIGITS = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("The Sink drains a hot gun", async () => {
  await startRun(h);
  const boxed = await poseBoxed(h, { type: GUN, heat: HEAT }, [
    { type: "sink", side: "N", level: LEVEL },
  ]);

  const opened = await readHeat(h, boxed.id, `the ${GUN} posed at ${HEAT}`);
  await h.advance(1);
  await captureStill(h, "draining");
  const closed = await readHeat(h, boxed.id, "one frame later");

  assertCloseTo(
    opened - closed,
    EXPECTED_LOSS,
    HEAT_DIGITS,
    `the heat a level-${LEVEL} Sink takes off a ${GUN} at ${HEAT} over one ` +
      `frame across ${SHARED_EDGES} shared edge-tiles`,
  );
});
