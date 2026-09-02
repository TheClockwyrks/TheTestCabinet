// Meltdown — movers/forge-caps-at-its-setpoint: the Forge never pushes past it.
//
// specs/heat.md clamps the Forge's flow at zero:
// `forgeGain(T) = FORGE_K * sharedEdges(T, F) * max(0, setpoint(F) - H_T)`, and
// says it in words as well — "The Forge warms each emitter it touches toward its
// setpoint and never past it, so an emitter already at or above the setpoint gains
// nothing from it." specs/towers.md puts a level-I Forge's setpoint at `72`.
//
// TWO HEATS, AND THEY CATCH DIFFERENT MISTAKES.
//
//   - AT `72`, exactly the setpoint, the difference is zero, so a build that
//     dropped the `max(0, ...)` still reads nothing. What this heat catches is a
//     build whose SETPOINT is wrong: a level-I Forge holding `84` reads
//     `0.9 * 2 * 12`, which is `21.6` a second, and one holding `96` reads `43.2`.
//   - AT `90`, eighteen degrees above the setpoint, the clamp is the whole of the
//     answer. A build that dropped it drives `0.9 * 2 * (72 - 90)`, which is
//     `-32.4` a second — the Forge turned into a second Sink, cooling a gun a
//     player built it to feed.
//
// Neither heat is a trip boundary: `90` is below `100`, so no reading of the trip
// can reach this measurement, and both are below the Arc's own `80` redline being
// beside the point — the redline is a damage figure and moves no heat.
//
// WHY THE READING IS A DIFFERENCE. Air cooling at heat `72` and `90` is far from
// nothing, and the face the Forge stands against is a face taken out of the air
// term, so `bench.ts` poses each floor twice and subtracts a control with an inert
// wall in the Forge's place; what survives is the Forge's own term. The note at the
// head of that file states the whole of it.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo } from "../assert";
import { FORGE_SETPOINT } from "../constants";
import {
  captureStill,
  createHarness,
  type Face,
  type Harness,
} from "../harness";
import { faceAnchor, moverFlow, type Neighbour } from "./bench";

/** The emitter read, and the face the Forge stands against. */
const SUBJECT = "arc";
const FACE: Face = "N";

/** A level-I Forge's setpoint, `72` (specs/towers.md). */
const LEVEL = 1;
const SETPOINT = FORGE_SETPOINT[LEVEL - 1];

/** The heat exactly at the setpoint, and one well above it. */
const AT_SETPOINT = SETPOINT;
const ABOVE_SETPOINT = 90;

/** What the clamp requires at both: nothing at all. */
const NO_FLOW = 0;

/**
 * How close each measured flow must come to nothing, as decimal places of heat
 * per second.
 *
 * One place is `0.05` of a heat point per second. The measurement is a difference
 * between two floors that carry the same footprints on the same tiles, so a
 * conformant build's two legs cancel to floating-point noise and need none of the
 * room; the bound is hundreds of times smaller than the distance to either wrong
 * model this item exists to name — a wrong setpoint reads `21.6` at the setpoint,
 * and a missing clamp reads `-32.4` above it.
 */
const FLOW_DIGITS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("The Forge never pushes past its setpoint", async () => {
  const forge: Neighbour = { type: "forge", ...faceAnchor(SUBJECT, FACE) };

  const above = await moverFlow(h, { type: SUBJECT, heat: ABOVE_SETPOINT }, [
    forge,
  ]);
  const at = await moverFlow(h, { type: SUBJECT, heat: AT_SETPOINT }, [forge]);
  captureStill(h, "setpoint");

  assertCloseTo(
    at,
    NO_FLOW,
    FLOW_DIGITS,
    `heat per second a level-${LEVEL} Forge drives into an ${SUBJECT} sitting ` +
      `at its ${SETPOINT} setpoint`,
  );
  assertCloseTo(
    above,
    NO_FLOW,
    FLOW_DIGITS,
    `heat per second the same Forge drives into an ${SUBJECT} at ` +
      `${ABOVE_SETPOINT}, which is ${ABOVE_SETPOINT - SETPOINT} degrees above ` +
      `its setpoint`,
  );
});
