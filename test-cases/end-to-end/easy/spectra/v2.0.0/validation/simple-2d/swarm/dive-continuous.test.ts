// swarm/dive-continuous — a dive is travelled, and the one jump allowed is the
// wrap.
//
// specs/swarm.md, "The dive": the path "is continuous, with one exception: a dive
// that leaves below `FIELD_BOTTOM` re-appears above `FIELD_TOP` and carries on, and
// that wrap is the only discontinuity a dive ever holds".
//
// A WRAPPING DIVE IS CORRECT, NOT A FAULT, and this validator is written so that
// both endings the specification allows pass: a dive that turns back holds no jump
// at all, and a dive that wraps holds exactly one, from the bottom edge to the top.
// So the dive is sampled every frame and the steps between samples are counted: at
// most one may be a jump, and a jump has to be a wrap — its last sample before and
// its first sample after have to sit at the two edges the specification names.
//
// WHY FORTY UNITS EITHER SIDE. The two endpoints are samples a frame apart, taken
// at whatever depth below `FIELD_BOTTOM` and height above `FIELD_TOP` the build
// wraps at — neither of which the specification fixes, since a drone's footprint has
// to clear the edge before it re-appears. Forty units is the item's own figure for
// that clearance, and it is small against the field's 592-unit height: a "wrap" from
// the middle of the field, or one that re-appears halfway down it, is not one.
//
// WHY THE BOUND FOR A JUMP IS TWICE A FRAME'S TRAVEL. This point grades CONTINUITY,
// and `swarm/dive-speed` grades the speed: a build entitled to fly 10% fast there
// must not fail here for it. A real wrap crosses most of the field's height in one
// frame, hundreds of units past this bound.
//
// ONE DRONE, POSED HIGH IN THE FIELD, with travel on and firing off, so the whole
// dive is flown and nothing it would shoot reaches the ship. `startPosed` shuts the
// wave's entry and dive gates, so nothing joins it and nothing else launches.

import { afterEach, beforeEach, it } from "vitest";
import {
  DIVE_SPEED,
  FIELD_BOTTOM,
  FIELD_TOP,
  FORM_CENTER_X,
  droneSpeedScale,
} from "../../src/constants";
import { assertLessThanOrEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  poseDrone,
  seconds,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";
import { step, traceDrone } from "./flight";

/** The stage the dive is posed at: the first, where droneSpeedScale is 1. */
const STAGE = 1;

/** One frame's dive travel at that stage, in logical units. */
const FRAME_TRAVEL = DIVE_SPEED * droneSpeedScale(STAGE) * seconds(1);

/** The furthest a dive may move between two frames before it is a jump. */
const MAX_STEP = 2 * FRAME_TRAVEL;

/** The jumps a dive may hold: the wrap, and nothing else. */
const MAX_JUMPS = 1;

/** How near the field's edges a wrap's two endpoints must sit: the item's 40. */
const EDGE_TOLERANCE = 40;

/** The whole span a dive may occupy (`specs/swarm.md`), in frames. */
const DIVE_FRAMES = ticksFor(8);

/** Where the dive is posed: high in the field, off the ship's lane. */
const AT = { x: FORM_CENTER_X + 128, y: FIELD_TOP + 76 } as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("flies a dive with no jump in it but the wrap through the bottom", async () => {
  startPosed(h);
  const id = poseDrone(h, "shard", AT.x, AT.y, {
    phase: "diving",
    travel: true,
  });

  // The sample the dive ends on is kept, because a build that wraps at the end of
  // its dive puts the wrap in exactly that step.
  const trace = await captureReplay(h, "path", () =>
    traceDrone(h, id, {
      frames: DIVE_FRAMES,
      stop: (sample) => sample.phase !== "diving",
    }),
  );

  const jumps: { from: number; to: number; travelled: number }[] = [];
  for (let i = 1; i < trace.samples.length; i += 1) {
    const from = trace.samples[i - 1];
    const to = trace.samples[i];
    const travelled = step(from, to);
    if (travelled > MAX_STEP) jumps.push({ from: from.y, to: to.y, travelled });
  }

  assertLessThanOrEqual(
    jumps.length,
    MAX_JUMPS,
    `the steps of the dive that moved the drone further than twice a frame's ` +
      `travel (${MAX_STEP.toFixed(2)} units) — ` +
      `[${jumps
        .map((jump) => `y ${jump.from.toFixed(0)}->${jump.to.toFixed(0)}`)
        .join(", ")}] (specs/swarm.md)`,
  );

  for (const jump of jumps) {
    assertLessThanOrEqual(
      Math.abs(jump.from - FIELD_BOTTOM),
      EDGE_TOLERANCE,
      `how far the y the dive's one jump left from (${jump.from.toFixed(1)}) ` +
        `sat from FIELD_BOTTOM (${String(FIELD_BOTTOM)}), the only ` +
        `discontinuity a dive may hold being a wrap through the bottom ` +
        `(specs/swarm.md)`,
    );
    assertLessThanOrEqual(
      Math.abs(jump.to - FIELD_TOP),
      EDGE_TOLERANCE,
      `how far the y the dive's one jump arrived at (${jump.to.toFixed(1)}) ` +
        `sat from FIELD_TOP (${String(FIELD_TOP)}), a wrap re-appearing above ` +
        `the field (specs/swarm.md)`,
    );
  }
});
