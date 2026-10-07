// machinery/backflow-below-inlet-holds — a core standing below arc position 0
// holds where it stands while backflow runs.
//
// WHAT THE SPEC FIXES. `specs/machinery.md` ("Backflow"): "Each core stops at the
// channel spacing ahead of the core behind it, and the tail core stops at arc
// position `0`. A core standing below arc position `0` holds where it stands."
//
// WHY A CORE CAN BE THERE AT ALL. `specs/injector.md` ("Insertion"): "A shift that
// carries an arc position below `0` is kept as it stands, and the core holding it
// is drawn at the inlet as `specs/channel.md` states." So a core below `0` is an
// ordinary thing for the hall to hold, and `specs/instrumentation.md`'s
// `poseTrain` clamps an arc position "to at most `5000`" and nothing at the bottom
// — so it is posed directly rather than reached through an insertion this point
// does not grade.
//
// WHY IT IS A POINT OF ITS OWN. `machinery/backflow-direction` decides the RATE
// every core travels at while backflow runs. This decides the boundary the same
// section fixes at the other end: what a core already past the inlet does. A
// build that clamps every core to `0` — the reading of the sentence before it,
// taken one word too far — carries the rate perfectly and drives this core
// forward to `0`, which nothing else in the suite catches.
//
// THE POSE. One core at arc `-20`, and one far out at `500` whose fall is the
// evidence that backflow is really running. `specs/machinery.md` gives backflow
// 60 units/s, so over the 60 ticks read here the far core falls 60 units, to 440
// — nowhere near either the inlet or the core below it, so neither the "stops at
// the channel spacing ahead of the core behind it" clause nor the "tail core
// stops at `0`" clause comes into play and what is left is the sentence under
// test.
//
// WHY THE HALL DOES NOT MOVE ON. `poseHall` holds the inlet and leaves the level's
// quota where it stands, so nothing arrives to join the two cores and the level is
// never cleared out from under the reading. Backflow's own 5 s duration is 300
// ticks, five times the window read here.
//
// THE TOLERANCE. The held core is asserted unchanged within the case's standing
// arc tolerance of 0.5 units. It has to be some non-zero span because a held
// position is still a number a build carries through arithmetic, and it is 120
// times under the 60 units a build that carried this core forward at the feed
// speed, or backward at the backflow speed, would show over the same window.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import { ARC_TOL, BACKFLOW_SPEED, TICK_HZ } from "../constants";
import {
  captureReplay,
  coreNear,
  createHarness,
  poseHall,
  seconds,
  type Harness,
} from "../harness";

/** The level the drive opens on; backflow ignores the feed speed either way. */
const LEVEL = 1;

/** The core under test: past the inlet, where the spec says it holds. */
const BELOW_S = -20;

/** A core far out on the channel, whose fall says backflow is really running. */
const RIDING_S = 500;

/** The window the two are read over: one second, well inside backflow's 5 s. */
const MEASURE_TICKS = TICK_HZ;

/** How far {@link MEASURE_TICKS} of backflow carries the riding core. */
const EXPECTED_FALL = BACKFLOW_SPEED * seconds(MEASURE_TICKS);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it(`holds a core standing at arc ${BELOW_S} exactly where it stands while backflow runs`, async () => {
  await poseHall(h, {
    level: LEVEL,
    pressure: 0,
    cores: [
      [RIDING_S, "halide", null],
      [BELOW_S, "cobalt", null],
    ],
    machinery: "backflow",
  });

  const after = await captureReplay(h, "held", () => h.step(MEASURE_TICKS));

  // Backflow really ran: the core out on the channel fell at its stated rate.
  // How far it falls is `machinery/backflow-direction`'s point, so this is read
  // as a corroboration at that point's own tolerance rather than as a figure.
  const riding = coreNear(after, RIDING_S - EXPECTED_FALL);
  assertNear(
    riding?.s ?? Number.NaN,
    RIDING_S - EXPECTED_FALL,
    BACKFLOW_SPEED / 2,
    `the core posed at arc ${RIDING_S}, carried back while backflow ran`,
  );

  const held = coreNear(after, BELOW_S);
  assertNear(
    held?.s ?? Number.NaN,
    BELOW_S,
    ARC_TOL,
    `the core posed at arc ${BELOW_S}, which holds where it stands`,
  );
});
