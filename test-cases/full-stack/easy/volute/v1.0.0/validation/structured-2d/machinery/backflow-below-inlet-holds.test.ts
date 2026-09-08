// machinery/backflow-below-inlet-holds — a core standing below arc position 0
// holds where it stands while backflow runs.
//
// WHAT THE SPEC FIXES. `specs/machinery.md` ("Backflow"): while backflow is
// active every core "moves toward the inlet at `BACKFLOW_SPEED`, in place of the
// advance it would otherwise make ... Each core stops at the channel spacing
// ahead of the core behind it, and the tail core stops at arc position `0` ... A
// core standing below arc position `0` holds where it stands."
//
// WHY IT IS ITS OWN POINT. `machinery/backflow-direction` decides the rate every
// core travels back at. This decides the boundary at the other end of the same
// rule, and a build can get one right and the other wrong: driving a core that is
// already behind the inlet further back is exactly what a build that implements
// the rate and not the stop does. `specs/channel.md` ("Arc positions") is why such
// a core exists at all — "An arc position below `0` selects the first leg as
// well: its point is the inlet ... so a core carrying one is drawn at the inlet
// until the train carries it past `0`".
//
// THE POSE. One core, at arc -50. `specs/instrumentation.md` (`poseTrain`) bounds
// an arc position "at most `5000`" and states no lower bound, so a negative one
// is placed exactly as given, and the core is the whole train — a lone core "forms
// a segment of one" (`specs/channel.md`), so there is no core behind it whose
// spacing could decide the reading instead. The inlet is held and the quota is a
// level start's, so nothing arrives and the level cannot clear.
//
// WHAT THE READING TELLS APART. Over the 60 ticks measured, a build that carries
// the core on at `BACKFLOW_SPEED` moves it 60 units to -110; a build that runs no
// backflow at all advances it 22 units forward at level 1's feed speed; a
// conformant build leaves it at -50. The window is a fifth of the 5 s backflow
// runs for, so the grant is still in force for every tick of it.
//
// THE TOLERANCE. The case's standing +/- 0.5 units on an arc position. The two
// ways of getting the rule wrong miss by 60 and 22 units, so the bound is not
// close to either.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { ARC_TOL, BACKFLOW_SPEED, TICK_HZ } from "../constants";
import {
  captureReplay,
  createHarness,
  head,
  poseHall,
  seconds,
  type Harness,
} from "../harness";

/** Where the lone core is posed: behind the inlet, which is arc position 0. */
const BELOW_S = -50;

/** The measured window: one second, a fifth of backflow's 5 s duration. */
const WINDOW_TICKS = TICK_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it(`holds a core standing at arc ${BELOW_S} where it stands while backflow runs`, async () => {
  await poseHall(h, {
    level: 1,
    pressure: 0,
    cores: [[BELOW_S, "halide", null]],
    machinery: "backflow",
  });

  const posed = h.snapshot();
  assertEqual(
    posed.machinery?.kind ?? null,
    "backflow",
    "the machinery in force over the posed core",
  );
  assertNear(
    head(posed).s,
    BELOW_S,
    ARC_TOL,
    "the arc position the core was posed at, below the inlet",
  );

  const after = await captureReplay(h, "held", () => h.step(WINDOW_TICKS));

  assertEqual(
    after.machinery?.kind ?? null,
    "backflow",
    `the machinery still in force after ${seconds(WINDOW_TICKS)} s, ` +
      "so the whole window was driven under backflow",
  );
  assertNear(
    head(after).s,
    BELOW_S,
    ARC_TOL,
    `the arc position of a core below 0 after ${WINDOW_TICKS} ticks of ` +
      `backflow, which would carry it ${BACKFLOW_SPEED * seconds(WINDOW_TICKS)} ` +
      "units further back if it did not hold",
  );
});
