// machinery/backflow-below-inlet-holds — a core standing below arc position 0
// holds where it stands while backflow runs.
//
// THE SPEC LINE. `specs/machinery.md` — "Backflow": "Each core stops at the
// channel spacing ahead of the core behind it, and the tail core stops at arc
// position `0`, so the train packs against the inlet and holds there for the
// remainder of the duration. A core standing below arc position `0` holds where
// it stands."
//
// WHY THERE ARE CORES BELOW 0 AT ALL. `specs/injector.md` — "Insertion": "A shift
// that carries an arc position below `0` is kept as it stands, and the core
// holding it is drawn at the inlet as `specs/channel.md` states." So a shot
// seated into a train packed at the inlet leaves cores behind arc 0, and the rule
// above says what backflow then does with them: nothing.
//
// WHY IT IS A POINT. It is the boundary case of backflow's own rule, and the two
// ways of missing it move the core in opposite directions. A build that clamps
// every core to `max(0, s - step)` drags it FORWARD to 0, and a build that
// applies the rate unconditionally drives it further BEHIND the inlet. Both are
// invisible to `machinery/backflow-direction`, which poses its segment far out on
// the channel.
//
// THE POSE. Two cores, and both of them are the reading:
//
//   {@link WITNESS_S}  out on the channel, so backflow has something to move
//   {@link BELOW_S}    behind the inlet, the core the rule is about
//
// The witness is what stops a build with no backflow at all from passing: a hall
// in which nothing moves satisfies "held where it stands" for the wrong reason.
// Its own rate is `machinery/backflow-direction`'s requirement, so it is read as
// a DIRECTION here and not as a figure.
//
// WHERE THE TWO ARE PUT. The witness at 200 travels 60 units over the measured
// second at `BACKFLOW_SPEED`, ending at 140 — far short of the
// `BELOW_S + SPACING` = -2 floor the core behind it puts under it, so the two
// never interact and the held core is never the reason the witness stopped.
//
// TOLERANCE. The case's standing +/- 0.5 units on an arc position for the held
// core, which the two ways of missing the rule beat by 30 units and by 60. The
// witness is a strict inequality, so no tolerance is spent on it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThan, assertNear } from "../assert";
import { ARC_TOL, SPACING, TICK_HZ } from "../constants";
import {
  captureReplay,
  coreCount,
  coreNear,
  createHarness,
  poseHall,
  type Harness,
  type PosedCore,
} from "../harness";

/** The core the rule is about: one spacing behind the inlet. */
const BELOW_S = -SPACING;

/** The core out on the channel, so backflow visibly runs. */
const WITNESS_S = 200;

/** One second of play under backflow, well inside its 5 s duration. */
const RUN_TICKS = TICK_HZ;

const CORES: PosedCore[] = [
  [WITNESS_S, "cobalt", null],
  [BELOW_S, "halide", null],
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds a core standing below arc position 0 where it stands under backflow", async () => {
  await poseHall(h, { pressure: 0, cores: CORES, machinery: "backflow" });
  const posed = await h.snapshot();
  assertEqual(coreCount(posed), CORES.length, "the cores the pose put up");
  assertNear(
    coreNear(posed, BELOW_S)?.s ?? Number.NaN,
    BELOW_S,
    ARC_TOL,
    "the core posed behind the inlet, before backflow ran",
  );

  const after = await captureReplay(h, "held", () => h.step(RUN_TICKS));

  // Backflow really ran: the core out on the channel moved toward the inlet.
  assertLessThan(
    coreNear(after, WITNESS_S - 1)?.s ?? Number.POSITIVE_INFINITY,
    WITNESS_S,
    "the core out on the channel, driven toward the inlet by backflow",
  );
  assertNear(
    coreNear(after, BELOW_S)?.s ?? Number.NaN,
    BELOW_S,
    ARC_TOL,
    `the core standing ${-BELOW_S} units behind the inlet, which backflow holds ` +
      "where it stands",
  );
});
