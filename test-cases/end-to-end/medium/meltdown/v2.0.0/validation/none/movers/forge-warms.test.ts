// Meltdown — movers/forge-warms: the Forge warms a cold gun.
//
// `specs/heat.md` gives the Forge's flow as
// `forgeGain(T) = FORGE_K * sharedEdges(T, F) * max(0, setpoint(F) - H_T)`,
// summed over every Forge `T` touches, with `FORGE_K` `0.9` per shared edge-tile
// per degree below the setpoint per second, and divides the whole change by the
// emitter's own mass. `specs/towers.md` puts a level-I Forge's setpoint at `72`,
// makes both movers 2x2, and gives the Arc a mass of `1.0`; `specs/heat.md`
// counts one edge-tile per tile of a face's side, so a 2x2 Forge flush against a
// 2x2 Arc is a contact of two edge-tiles. At heat `20` the flow is therefore
// `0.9 * 2 * (72 - 20)`, which is `93.6` per second.
//
// EVERY OTHER FLOW IS POSED OUT OF THE ARRANGEMENT, so the number read is the
// Forge's and nothing else: the Arc's other three faces carry plain walls at its
// own heat, which takes the air term to exactly zero and leaves conduction at a
// gradient of zero, and the reading is ONE FRAME, so no wall's own cooling can
// reach the subject. `movers/contact.ts` states why each part of that is there.
//
// THE HEAT IS WELL BELOW THE SETPOINT, at `20`, so a build reading the setpoint
// off the wrong level lands somewhere else entirely: `84` would warm by `0.96`
// against the `0.78` required, and `96` by `1.14`. What the cap at the setpoint
// itself decides is `movers/forge-caps-at-its-setpoint`.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo } from "../assert";
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

/** The gun read, and the cold heat it opens at. */
const GUN = "arc";
const HEAT = 20;

/** The Forge's level, and the setpoint `specs/towers.md` gives it there. */
const LEVEL = 1;
const SETPOINT = FORGE_SETPOINT[LEVEL - 1];

/** A 2x2 face is two edge-tiles, so a flush 2x2 Forge is a contact of two. */
const SHARED_EDGES = sizeOf(GUN);

/** The frame the flow is measured over, in seconds of game time. */
const DT = seconds(1);

/** `0.9 * 2 * (72 - 20) * dt / 1.0`, which is `0.78` of a heat point. */
const EXPECTED_GAIN =
  (FORGE_K * SHARED_EDGES * (SETPOINT - HEAT) * DT) / massOf(GUN);

/**
 * How close the gain must come, as decimal places of a heat point.
 *
 * Two places is `0.005`, two-thirds of one percent of the `0.78` required. The
 * arrangement leaves the frame's arithmetic as one multiplication over figures
 * the specification states exactly — no air term, no conduction term, no second
 * mover — so a conformant build lands on it to within float slack. What the
 * bound excludes is every wrong reading of the rule: driving the flow per FACE
 * rather than per edge-tile halves it to `0.39`, reading the level-II setpoint
 * gives `0.96`, and ignoring the Forge altogether gives `0`.
 */
const HEAT_DIGITS = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("The Forge warms a cold gun", async () => {
  await startRun(h);
  const boxed = await poseBoxed(h, { type: GUN, heat: HEAT }, [
    { type: "forge", side: "N", level: LEVEL },
  ]);

  const opened = await readHeat(h, boxed.id, `the ${GUN} posed at ${HEAT}`);
  await h.advance(1);
  await captureStill(h, "warming");
  const closed = await readHeat(h, boxed.id, "one frame later");

  assertCloseTo(
    closed - opened,
    EXPECTED_GAIN,
    HEAT_DIGITS,
    `the heat a level-${LEVEL} Forge adds to a ${GUN} at ${HEAT} over one ` +
      `frame across ${SHARED_EDGES} shared edge-tiles`,
  );
});
