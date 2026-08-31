// Meltdown — movers/forge-caps-at-its-setpoint: the Forge never pushes past its
// setpoint.
//
// `specs/heat.md` writes the Forge's flow with the cap inside it —
// `forgeGain(T) = FORGE_K * sharedEdges(T, F) * max(0, setpoint(F) - H_T)` — and
// spells the consequence out: "The Forge warms each emitter it touches toward its
// setpoint and never past it, so an emitter already at or above the setpoint
// gains nothing from it." `specs/towers.md` puts a level-I Forge's setpoint at
// `72`. So an emitter AT `72` and an emitter ABOVE it at `90` both take exactly
// nothing.
//
// THE TWO HEATS NAME THE TWO WRONG MODELS, and they are different mistakes:
//
//   - at `72`, a build whose setpoint is really the level-II `84` warms by
//     `0.9 * 2 * 12 * dt`, which is `0.18` of a heat point over one frame;
//   - at `90`, a build that dropped the `max(0, ...)` and let the term go
//     negative COOLS by `0.9 * 2 * 18 * dt`, which is `0.27` — a thermostat
//     running backwards, which no reading at or below the setpoint can see.
//
// Both legs stand on ONE FLOOR and are read in ONE FRAME, so the pair is
// measured on the same clock with nothing between them.
//
// EVERY OTHER FLOW IS POSED OUT OF BOTH ARRANGEMENTS: each subject's other three
// faces carry plain walls at its own heat, which takes the air term to zero and
// leaves conduction at a gradient of zero, and one frame is short enough that no
// wall's own cooling can reach it (`movers/contact.ts`). The specification
// therefore requires each reading to be exactly zero.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual } from "../assert";
import { FORGE_K, FORGE_SETPOINT } from "../constants";
import {
  captureStill,
  createHarness,
  seconds,
  startRun,
  type Harness,
} from "../harness";
import { sizeOf } from "../thermal";
import { massOf, poseBoxed, readHeat } from "./contact";

/** The gun read on both legs. */
const GUN = "arc";

/** The Forge's level, and the setpoint `specs/towers.md` gives it there. */
const LEVEL = 1;
const SETPOINT = FORGE_SETPOINT[LEVEL - 1];

/** The two heats: exactly at the setpoint, and well above it. */
const AT_SETPOINT = SETPOINT;
const ABOVE_SETPOINT = 90;

/** A 2x2 face is two edge-tiles, so a flush 2x2 Forge is a contact of two. */
const SHARED_EDGES = sizeOf(GUN);

/** The frame each reading is taken over, in seconds of game time. */
const DT = seconds(1);

/**
 * What the two wrong models above would move each subject by, in heat points.
 *
 * Not requirements — they are the yardsticks the bound below is a fraction of.
 */
const WRONG_SETPOINT_GAIN =
  (FORGE_K * SHARED_EDGES * (FORGE_SETPOINT[1] - AT_SETPOINT) * DT) /
  massOf(GUN);
const UNCAPPED_LOSS =
  (FORGE_K * SHARED_EDGES * (ABOVE_SETPOINT - SETPOINT) * DT) / massOf(GUN);

/**
 * How far either subject's heat may move over the frame.
 *
 * The specification requires exactly nothing from both — every term of the frame
 * is identically zero — so the figure is float slack and nothing else: one
 * percent of the smaller of the two wrong models above, which is the `0.18` a
 * build reading the level-II setpoint would add at `72`. A build with either
 * fault misses by a hundred times this; a build that resolves the frame
 * correctly moves by zero.
 */
const DRIFT = 0.01 * Math.min(WRONG_SETPOINT_GAIN, UNCAPPED_LOSS);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("The Forge never pushes past its setpoint", async () => {
  await startRun(h);
  const at = await poseBoxed(
    h,
    { type: GUN, heat: AT_SETPOINT },
    [{ type: "forge", side: "N", level: LEVEL }],
    0,
  );
  const above = await poseBoxed(
    h,
    { type: GUN, heat: ABOVE_SETPOINT },
    [{ type: "forge", side: "N", level: LEVEL }],
    1,
  );

  const openedAt = await readHeat(h, at.id, `the ${GUN} posed at the setpoint`);
  const openedAbove = await readHeat(
    h,
    above.id,
    `the ${GUN} posed above the setpoint`,
  );
  await h.advance(1);
  await captureStill(h, "setpoint");
  const closedAt = await readHeat(h, at.id, "the one at the setpoint, a frame on");
  const closedAbove = await readHeat(
    h,
    above.id,
    "the one above the setpoint, a frame on",
  );

  assertLessThanOrEqual(
    Math.abs(closedAt - openedAt),
    DRIFT,
    `the heat a level-${LEVEL} Forge moves a ${GUN} sitting exactly at its ` +
      `${SETPOINT} setpoint by over one frame, against the ` +
      `${WRONG_SETPOINT_GAIN.toFixed(4)} a level-II setpoint would add`,
  );
  assertLessThanOrEqual(
    Math.abs(closedAbove - openedAbove),
    DRIFT,
    `the heat that Forge moves a ${GUN} at ${ABOVE_SETPOINT} by over one ` +
      `frame, against the ${UNCAPPED_LOSS.toFixed(4)} an uncapped thermostat ` +
      `would take off it`,
  );
});
