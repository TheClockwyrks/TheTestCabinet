// Meltdown — movers/forge-warms: the Forge warms a cold gun.
//
// specs/heat.md gives the Forge's flow as
// `forgeGain(T) = FORGE_K * sharedEdges(T, F) * max(0, setpoint(F) - H_T)`, with
// `FORGE_K` `0.9`, counted per SHARED EDGE-TILE and per DEGREE below the setpoint
// and per second, and divided — with every other term — by the emitter's thermal
// mass. specs/towers.md puts a level-I Forge's setpoint at `72` and gives the Arc a
// 2x2 footprint and a mass of `1.0`.
//
// THE FIGURE. A 2x2 Forge flush against a 2x2 Arc's face abuts it along two
// edge-tiles, so a cold Arc gains `0.9 * 2 * (72 - 0)` a second, which is `129.6`,
// and an Arc at `40` gains `0.9 * 2 * (72 - 40)`, which is `57.6`.
//
// TWO HEATS, BECAUSE ONE READS ONLY HALF THE RULE. At heat `0` alone a build whose
// flow is a flat `FORGE_K * sharedEdges * setpoint` — the thermostat as a fixed
// pump rather than as a difference — is indistinguishable from a conformant one.
// The second reading is where the two part: the flat model still reads `129.6` at
// heat `40` where the specification requires `57.6`. Both heats are well below the
// setpoint, so neither is about the clamp, which is
// `movers/forge-caps-at-its-setpoint`'s item.
//
// WHY THE READING IS A DIFFERENCE. The mover's flow is one term of a sum, and the
// face it stands against is a face taken out of the air term, so `bench.ts` poses
// each floor twice and subtracts a control with an inert wall in the Forge's place.
// The note at the head of that file states the whole of it.

import { afterEach, beforeEach, it } from "vitest";
import { FORGE_K, FORGE_SETPOINT } from "../../src/constants";
import { assertCloseTo } from "../assert";
import {
  captureStill,
  createHarness,
  type Face,
  type Harness,
} from "../harness";
import { faceAnchor, massOf, moverFlow, type Neighbour } from "./bench";

/** The emitter read, and the face the Forge stands against. */
const SUBJECT = "arc";
const FACE: Face = "N";

/** The two heats the flow is read at, both well below the level-I setpoint. */
const COLD = 0;
const WARM = 40;

/** A level-I Forge's setpoint, `72` (specs/towers.md). */
const LEVEL = 1;
const SETPOINT = FORGE_SETPOINT[LEVEL - 1];

/**
 * Edge-tiles the contact runs along: a 2x2 face is two edge-tiles, and a 2x2
 * Forge flush against a 2x2 Arc covers both of them (specs/heat.md).
 */
const SHARED_EDGES = 2;

/** What specs/heat.md requires per second at each heat: `129.6` and `57.6`. */
const expectedRate = (heat: number): number =>
  (FORGE_K * SHARED_EDGES * Math.max(0, SETPOINT - heat)) / massOf(SUBJECT);

/**
 * How close each measured rate must come, as decimal places of heat per second.
 *
 * One place is `0.05` of a heat point per second, four hundredths of one percent
 * of the `129.6` required. The measurement is one frame of a build's own
 * arithmetic over figures the specification states exactly, so a conformant build
 * has no need of the room; what the bound excludes is every other reading of the
 * rule — driving the flow per FACE rather than per edge-tile reads `64.8`, the
 * flat-pump model reads `129.6` where `57.6` is required, and a build with no
 * thermostat at all reads `0`.
 */
const RATE_DIGITS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("The Forge warms a cold gun", async () => {
  const forge: Neighbour = { type: "forge", ...faceAnchor(SUBJECT, FACE) };

  const warm = await moverFlow(h, { type: SUBJECT, heat: WARM }, [forge]);
  const cold = await moverFlow(h, { type: SUBJECT, heat: COLD }, [forge]);
  captureStill(h, "warming");

  assertCloseTo(
    cold,
    expectedRate(COLD),
    RATE_DIGITS,
    `heat per second a level-${LEVEL} Forge drives into an ${SUBJECT} at ` +
      `${COLD} across ${SHARED_EDGES} shared edge-tiles`,
  );
  assertCloseTo(
    warm,
    expectedRate(WARM),
    RATE_DIGITS,
    `heat per second the same Forge drives into an ${SUBJECT} at ${WARM}, ` +
      `which is ${SETPOINT - WARM} degrees below its ${SETPOINT} setpoint`,
  );
});
