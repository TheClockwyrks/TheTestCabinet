// tape/run-starts-at-speed-index-zero — every run starts at watch-speed index 0.
//
// `specs/state.md` § What a run's start leaves: the watch-speed index at the
// start is "`0`, rather than the speed the run before it was watched at". The
// second half of that sentence is the requirement — the field is not merely
// initialized once, it is put back on every start.
//
// SO THE FIRST RUN IS WATCHED AT A DIFFERENT SPEED AND ALLOWED TO END. A run
// that ends "is left as it ended until the next one starts" (`specs/state.md`),
// so the speed index the first run was watched at is still standing when the
// second one starts — which is exactly the state the requirement is about, and
// the one an abort would have swept away by putting the idle placeholder back.
// The reading is then taken at the moment of the second start.
//
// The speed is posed rather than cycled with the `speed` action: `setSpeedIndex`
// "poses the watch speed on the run screen, as the `speed` action does", and this
// point is about what a start leaves rather than about a key. The pose is read
// back before the second run for the same reason a scenario reads any
// precondition back: a speed that never changed would leave nothing for a start
// to put back.
//
// A frame is advanced after the second start only so the still shows the run
// screen it is captured from; the reading is taken before it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { HOIST_MAX_RATE, RUN_SPEEDS } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runUntil,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** The speed the first run is watched at: the last of `RUN_SPEEDS`. */
const WATCHED_AT = RUN_SPEEDS.length - 1;

/** A short move: the first run has to end, not to go anywhere. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "hoist", target: 2.5, rate: HOIST_MAX_RATE }],
  },
];

/** Frames the first run is given to end. At speed 4 it takes about eight. */
const CAP = 400;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("puts the watch speed back to 0 on a start after a run watched faster", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);

  await startRun(h);
  await h.debug.setSpeedIndex(WATCHED_AT);
  const ended = await runUntil(
    h,
    (s) => s.run.phase !== "running",
    CAP,
    "the first run to end",
  );
  assertEqual(
    ended.run.speedIndex,
    WATCHED_AT,
    "the speed index the first run was watched at, which a run that has " +
      "ended is left carrying (specs/state.md)",
  );

  // A run starts from the build or the program screen (`specs/program.md`), and
  // an ended run leaves neither showing.
  await h.debug.setScreen("build");
  const second = await startRun(h);
  await h.advance(1);

  await h.capture("speed-reset", "The second run's speed readout");

  assertEqual(
    second.run.speedIndex,
    0,
    "run.speedIndex at the moment a second run starts, after the run before " +
      "it was watched at RUN_SPEEDS[" +
      WATCHED_AT +
      "] (specs/state.md)",
  );
});
