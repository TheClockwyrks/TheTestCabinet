// tape/run-first-tick-is-numbered-one — a run's first tick is tick 1.
//
// `specs/state.md` § What a run's start leaves gives the tick count at the start
// as "`0`. A start takes no tick of its own, and carries no earlier time into
// the run, so the run's first tick is the first tick the frame loop takes after
// the start, numbered `1`." `specs/program.md` § Starting and ending a run
// points at the same table for "which tick is the run's first".
//
// THE COUNT IS READ TWICE, either side of one tick, because that is what the
// requirement is: a run that began at `1` and a run that took its first tick
// while starting both read `1` after this drive, and only the reading before it
// tells them apart. The game is off its own clock from the moment the harness
// opens the page (`setAutoStep(false)`), so nothing can have ticked in between —
// the one tick between the two readings is the harness's.
//
// The crane is the smallest that stands and the tape is one long move, because
// nothing about this requirement concerns either: a start is refused only with a
// readiness issue or an empty tape (`specs/program.md`), and the move is long
// enough that the run is still going when the second reading is taken.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { HOIST_MAX_RATE } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runTicks,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "hoist", target: 20, rate: HOIST_MAX_RATE }],
  },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads 0 at the start and 1 after the first tick", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);

  const started = await startRun(h);
  const first = await runTicks(h, 1);

  await h.capture("state", "The run one tick in");

  assertEqual(
    started.run.tick,
    0,
    "run.tick at the moment the run starts, since a start takes no tick of " +
      "its own (specs/state.md)",
  );
  assertEqual(
    first.run.tick,
    1,
    "run.tick after the first tick the loop takes, which the run numbers 1 " +
      "(specs/state.md)",
  );
});
