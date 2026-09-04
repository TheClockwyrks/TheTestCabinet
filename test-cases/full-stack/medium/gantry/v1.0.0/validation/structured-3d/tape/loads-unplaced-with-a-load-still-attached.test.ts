// tape/loads-unplaced-with-a-load-still-attached — a tape that runs out with a
// load on the hook fails as `loads-unplaced`.
//
// `specs/program.md` § The tick pipeline: "A tick that finds no live step and no
// step left to take is the tick the run ends on: cleared if every load is
// `placed`, otherwise failed as `loads-unplaced`." A load hanging on the hook is
// `attached` rather than `placed` (`specs/state.md`), so the run that runs out
// over it is a failed one.
//
// THE LOAD IS PUT ON THE HOOK AND LEFT THERE. `setLoadPhase` to `"attached"`
// "hangs that load on the hook exactly as a successful `attach` leaves it,
// without the candidate search" (`specs/instrumentation.md`), so the scenario
// reaches the state the requirement is about without an `attach` step, a
// candidate search, or an `attach-missed` verdict on the way — none of which this
// point is about. The tape then holds one short move and no `release`, so the
// only way it can end is by running out with the load still hanging.
//
// THE ONE STEP HOISTS UP, from `HOIST_START` (`2`) to `1.9`, so the load rises
// off the ground it starts level with rather than settling into it: the hook
// hangs at the pivot's height less the cable length, and a load's box hangs from
// its lift point (`specs/world.md`). The rise is a tenth of a unit because the
// requirement is about the tape RUNNING OUT rather than about how far it moved
// first — the shortest move that still lifts is the whole of what this point
// needs, and it runs out in about a dozen ticks rather than thirty. The yard is
// emptied of obstacles and of every other load first, so the verdict rests on the
// one load the requirement concerns.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { HOIST_MAX_RATE } from "../constants";
import {
  addOneLoad,
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

/** The one load: where it waits, and the pad it never reaches. */
const FROM = { x: 8, y: 2, z: 0, yaw: 0 };
const TO = { x: 0, y: 2, z: 8, yaw: 0 };

/** A short hoist up: the whole tape, and it ends with the load still hanging. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "hoist", target: 1.9, rate: HOIST_MAX_RATE }],
  },
];

/** Ticks the tape is given to run out: the move takes about a dozen. */
const CAP = 120;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("fails as loads-unplaced when the tape runs out with a load on the hook", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await addOneLoad(h, "crate", 40, FROM, TO);
  await poseTape(h, TAPE);
  await startRun(h);

  await h.debug.setLoadPhase(0, "attached");
  const ended = await runUntil(
    h,
    (s) => s.run.phase !== "running",
    CAP,
    "the tape to run out with the load still on the hook",
  );

  await h.capture("state", "The run that ran out of tape with a load hanging");

  assertEqual(
    ended.run.loads[0]?.phase,
    "attached",
    "the load's phase when the tape ran out: still on the hook, and so not " +
      "placed (specs/state.md)",
  );
  assertEqual(
    ended.run.phase,
    "failed",
    "the phase of a run whose tape ran out with a load unplaced " +
      "(specs/program.md)",
  );
  assertEqual(
    ended.run.cause,
    "loads-unplaced",
    "the cause that run carries (specs/program.md)",
  );
});
