// audio/attach-cue — the tick an `attach` takes a load sounds the attach cue.
//
// specs/ui.md § Audio names the cue and the event that raises it: "| `attach` |
// a load attaches |", and adds that "A cue plays once for the event that raises
// it, and at most once on a given tick or edit". specs/rigging.md § Attaching
// says the same from the rigging's side — with a candidate found, "the load
// becomes `attached` … The `attach` cue plays."
//
// THE SCENARIO IS THE SMALLEST LIFT THERE IS. The yard is emptied and one crate
// is put back with its lift point exactly at the hook point the run starts with,
// so the candidate search of specs/rigging.md finds it at distance `0`, well
// inside `ATTACH_RADIUS` (`0.8`), and the action cannot miss. The crane is the
// minimal one, because nothing here is about the crane: the load is light enough
// that no member comes near its capacity, so the tick that raises the cue raises
// nothing else.
//
// The tape is the `attach` action and then one long `grip` move, which
// specs/rigging.md makes the one axis whose motion "applies no force to
// anything": the run carries on past the lift rather than ending as
// `loads-unplaced` on the tick after it, so what the check reads is the attach
// and not the end of a run.
//
// THE CUE IS READ FROM THE TICK THAT RAISED IT. The queue is drained after the
// start — which sounds `run-start` — and read back straight after the attach
// tick, so a build that sounds `attach` on some other event is not credited for
// it here.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual } from "../assert";
import { ATTACH_RADIUS, GRIP_MAX_RATE, HOIST_START } from "../constants";
import {
  addOneLoad,
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

/** The site this runs on; the lift is the same on every one. */
const SITE = 0;

/** The minimal crane's pivot at the run-start posture: the track origin. */
const PIVOT = { x: 0, y: 4, z: 0 } as const;

/** Where the run hangs the bare hook: the pivot, `HOIST_START` below it. */
const HOOK = {
  x: PIVOT.x,
  y: PIVOT.y - HOIST_START,
  z: PIVOT.z,
  yaw: 0,
} as const;

/** Light enough that the lift loads no member anywhere near its capacity. */
const LOAD_MASS = 40;

/** The lift, and a move that keeps the run going past it and moves nothing. */
const TAPE: readonly TapeStepSpec[] = [
  { kind: "action", action: "attach" },
  {
    kind: "move",
    commands: [{ axis: "grip", target: 100_000, rate: GRIP_MAX_RATE }],
  },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds the attach cue on the tick a load goes onto the hook", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);
  await addOneLoad(h, "crate", LOAD_MASS, HOOK, HOOK);
  await poseTape(h, TAPE);

  await startRun(h);
  await h.cues(); // the start's own `run-start`, drained
  const attached = await runTicks(h, 1);
  const played = await h.cues();
  await h.capture("state", "the crate on the hook, on the tick it attached");

  assertEqual(
    attached.run.attached,
    0,
    `the load the tape's \`attach\` took: the one crate, standing at the ` +
      `hook point, ${ATTACH_RADIUS} being the radius the candidate search ` +
      "allows (specs/rigging.md)",
  );
  assertContains(
    played,
    "attach",
    "the cues the attach tick sounded: `attach` plays when a load attaches " +
      "(specs/ui.md § Audio)",
  );
});
