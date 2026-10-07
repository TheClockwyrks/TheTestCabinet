// instrumentation/start-run-has-not-ticked — a run begun through the surface
// stands at tick `0`, running, with no cause.
//
// `specs/instrumentation.md` § The run and the screens: "A run that begins is the
// ordinary run, and it starts as `specs/state.md` says a run starts: nothing has
// ticked at the call, so `run.tick` reads `0` immediately after it". `specs/state.md`
// § What a run's start leaves gives the same two facts in its table: the phase and
// cause are "`running`, and no cause", and the tick count is "`0`. A start takes no
// tick of its own, and carries no earlier time into the run, so the run's first
// tick is the first tick the frame loop takes after the start".
//
// THE READING IS TAKEN WITH NO FRAME ADVANCED. The harness holds the game off its
// own clock (`setAutoStep(false)`) from the moment the page opens, so between
// `startRun` and this reading nothing can have ticked: a build that ran the run's
// first tick as part of starting it reads `1` here, and a build that started
// nothing reads `idle`.
//
// The crane and the tape are the smallest that let a run legally begin — a start
// is refused with a readiness issue or an empty tape (`specs/program.md`) — and
// the yard is emptied first, because nothing in this requirement concerns a load.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import { HOIST_MAX_RATE, HOIST_START } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** One short hoist move: enough for a run to legally start. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [
      { axis: "hoist", target: HOIST_START + 2, rate: HOIST_MAX_RATE },
    ],
  },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("stands at tick 0, running and uncaused, immediately after the start", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);

  const started = await startRun(h);

  await h.advance(1);
  await h.capture("state", "The driven state this point decides");

  assertEqual(
    started.run.phase,
    "running",
    "the phase a started run carries (specs/state.md)",
  );
  assertNull(
    started.run.cause,
    "the cause a started run carries (specs/state.md)",
  );
  assertEqual(
    started.run.tick,
    0,
    "run.tick immediately after startRun, since a start takes no tick of its " +
      "own (specs/instrumentation.md)",
  );
});
