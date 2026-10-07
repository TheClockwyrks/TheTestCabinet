// Meltdown — movers/sink-cools-through-a-blocked-face: the Sink cools a boxed
// core.
//
// `specs/heat.md` states the two halves of this in consecutive sentences. "A
// tower boxed in on all four faces sheds nothing to air at all." And: "The Sink
// drains each emitter it touches through a face that would otherwise shed
// nothing, which is the only way a boxed-in tower loses heat." That is what makes
// a Sink threaded into the middle of a maze worth its twenty money, and it is the
// contrast this point reads.
//
// THE TWO LEGS ARE THE SAME CORE WITH ONE WALL SWAPPED. A Lance at `90` — the
// bulkiest, hottest-running gun on the roster (`specs/towers.md`) — with all
// sixteen of its edge-tiles covered:
//
//   - by plain walls throughout, at the Lance's own heat, it holds its heat
//     exactly. Every term of the frame is zero: no edge-tile faces air, so there
//     is no air term, and two emitters at the same heat exchange nothing, so
//     there is no conduction — a gradient of zero rather than a faculty switched
//     off. NO ARRANGEMENT OF PLAIN WALLS CAN DO BETTER, which is the second half
//     of the claim;
//   - with a level-I Sink covering half of one face, it loses
//     `16 * 2 * 0.90 / 2.8` per second through it, and nothing else about the
//     arrangement has changed.
//
// WHY THE BOUND ON THE FALL IS LOOSE. What is decided here is that a boxed core
// loses heat AT ALL through a Sink, and that plain walls never let it. The exact
// per-edge rate is `movers/sink-cools`'s point, read on a footprint where the
// arithmetic is simplest, so this one asks only that the fall reach half of what
// the specification's own figure gives — enough to separate a build that drains
// through the blocked face from one that does not, without failing twice for one
// fault.
//
// BOTH LEGS STAND ON ONE FLOOR and are read in ONE FRAME, so no wall's own
// cooling can reach either core and nothing separates the two readings but the
// swapped wall.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual, assertLessThanOrEqual } from "../assert";
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

/** The core, and the heat both legs open at. */
const CORE: TowerType = "lance";
const HEAT = 90;

/** The Sink's level, and the per-edge output `specs/towers.md` gives it there. */
const LEVEL = 1;
const OUTPUT = SINK_OUTPUT[LEVEL - 1];

/** A 2x2 Sink presents two edge-tiles, whatever face it is put against. */
const SHARED_EDGES = sizeOf("sink");

/** The frame both readings are taken over, in seconds of game time. */
const DT = seconds(1);

/** `16 * 2 * (90 / 100) * dt / 2.8`, which is `0.0857` of a heat point. */
const SPEC_FALL =
  (OUTPUT * SHARED_EDGES * (HEAT / TRIP_HEAT) * DT) / massOf(CORE);

/**
 * How much of the specification's own figure the fall through the Sink must
 * reach.
 *
 * Half. This point decides that a boxed core loses heat through a Sink at all;
 * the exact rate is `movers/sink-cools`'s, so a build whose output table is off
 * fails there rather than twice. Half still separates draining through a blocked
 * face from not draining at all by a wide margin.
 */
const MIN_FALL = 0.5 * SPEC_FALL;

/**
 * How far the plain-walled core's heat may move over the same frame.
 *
 * The specification requires exactly nothing — every term of that frame is
 * identically zero — so the figure is float slack and nothing else: one percent
 * of what the Sink is required to take off the other core. A build that sheds
 * through a blocked face, or conducts with a wall at its own heat, misses by
 * many times this.
 */
const DRIFT = 0.01 * SPEC_FALL;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("The Sink cools a boxed core", async () => {
  await startRun(h);
  const sunk = await poseBoxed(
    h,
    { type: CORE, heat: HEAT },
    [{ type: "sink", side: "N", slot: 0, level: LEVEL }],
    0,
  );
  const walled = await poseBoxed(h, { type: CORE, heat: HEAT }, [], 1);

  const openedSunk = await readHeat(h, sunk.id, "the core with a Sink on it");
  const openedWalled = await readHeat(
    h,
    walled.id,
    "the core walled all round",
  );
  await h.advance(1);
  await captureStill(h, "boxed");
  const sunkFall =
    openedSunk - (await readHeat(h, sunk.id, "the sunk core, a frame on"));
  const walledDrift =
    (await readHeat(h, walled.id, "the walled core, a frame on")) -
    openedWalled;

  assertGreaterThanOrEqual(
    sunkFall,
    MIN_FALL,
    `the heat a boxed ${CORE} at ${HEAT} loses over one frame through a ` +
      `level-${LEVEL} Sink covering ${SHARED_EDGES} of its edge-tiles, ` +
      `against the ${SPEC_FALL.toFixed(4)} specs/heat.md's own figure gives`,
  );
  assertLessThanOrEqual(
    Math.abs(walledDrift),
    DRIFT,
    `the heat the same ${CORE} moves by with every face walled by a plain ` +
      "tower instead: no arrangement of plain walls cools a boxed core",
  );
});
